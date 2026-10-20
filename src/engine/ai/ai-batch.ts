import { redactKey } from '../../adapters/g2b/openapi';
import { runSummary } from '../../core/ai/summary';
import {
  AI_BATCH_GAP_MS, AI_BATCH_OVERLOAD_STOP, AI_BATCH_RATE_WAIT_MS,
  type AiBatchItem, type AiBatchState, type AiProvider, type AiReviewFile,
} from '../../core/types/ai';
import type { AiRunOutcome, ExecRequest } from './ai-runner';

/** AiRunner 중 일괄 실행이 쓰는 부분(테스트에서 가짜로 바꾼다). 반드시 exec를 거친다(prepareRun 직접 호출 금지). */
export interface AiBatchRunner {
  exec(p: ExecRequest): Promise<{ runId: string; done: Promise<AiRunOutcome> }>;
  cancel(p: { noticeId: string; runId: string }): Promise<{ cancelled: boolean }>;
}
export interface AiBatchDeps {
  runner: AiBatchRunner;
  /** ai/batch-status push. 던지지 않아야 한다 */
  pushStatus(s: AiBatchState): void;
  getReview(noticeId: string): Promise<AiReviewFile | null>;
  now?(): Date;
  gapMs?: number;
  rateWaitMs?: number;
}
export interface AiBatchStart { batchId: string; noticeIds: string[]; provider: AiProvider; api: { key: string; model: string; sendFullText?: boolean } }

const err = (code: string, message: string) => Object.assign(new Error(message), { code });
const isActive = (s: AiBatchState | null): boolean => s?.status === 'running' || s?.status === 'waiting';

/** 취소하면 즉시 깨어나는 대기. */
function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() { clearTimeout(t); signal.removeEventListener('abort', done); resolve(); }
    signal.addEventListener('abort', done, { once: true });
  });
}

/** offscreen의 일괄 실행: 한 번에 1개 배치, 공고를 순차로 runner.exec(scope 'auto')로 돌린다. */
export class AiBatch {
  private state: AiBatchState | null = null;
  private abort: AbortController | null = null;
  private currentRun: { noticeId: string; runId: string } | null = null;
  constructor(private d: AiBatchDeps) {}

  current(): AiBatchState | null { return this.state ? structuredClone(this.state) : null; }

  /** 활성 배치가 있으면 AI_BATCH_BUSY. 상태 push는 변화마다. */
  start(p: AiBatchStart): { batchId: string; done: Promise<void> } {
    if (isActive(this.state)) throw err('AI_BATCH_BUSY', '이미 일괄 실행 중입니다.');
    const nowIso = this.now().toISOString();
    this.state = {
      batchId: p.batchId, provider: p.provider, model: p.api.model, status: 'running', startedAt: nowIso, updatedAt: nowIso,
      items: p.noticeIds.map((noticeId) => ({ noticeId, status: 'queued', attempts: 0 })),
    };
    const ac = new AbortController();
    this.abort = ac;
    this.push();
    const done = Promise.resolve().then(() => this.loop(p, ac)).catch((e) => {
      // 루프 자체의 예기치 못한 오류: 배치를 멈춘다(키는 가림)
      this.stop(this.firstOpen() ?? this.state!.items.length, { code: (e as { code?: string }).code ?? 'AI_HTTP', message: redactKey(e instanceof Error ? e.message : String(e), p.api.key) });
    }).finally(() => { if (this.abort === ac) this.abort = null; });
    return { batchId: p.batchId, done };
  }

  async cancel(batchId: string): Promise<{ cancelled: boolean }> {
    if (!this.state || this.state.batchId !== batchId || !isActive(this.state) || !this.abort) return { cancelled: false };
    this.abort.abort();
    const cur = this.currentRun;
    if (cur) { try { await this.d.runner.cancel(cur); } catch { /* 이미 끝남 */ } }
    return { cancelled: true };
  }

  private now(): Date { return this.d.now?.() ?? new Date(); }
  private push(): void {
    this.state!.updatedAt = this.now().toISOString();
    this.d.pushStatus(structuredClone(this.state!));
  }
  private firstOpen(): number | undefined {
    const i = this.state!.items.findIndex((it) => it.status === 'queued' || it.status === 'running');
    return i < 0 ? undefined : i;
  }

  /** from번째부터 남은(queued·running) 항목을 skipped로 닫는다. */
  private skipRest(from: number, code: string, message: string): void {
    this.state!.items.forEach((it, i) => {
      if (i >= from && (it.status === 'queued' || it.status === 'running')) { it.status = 'skipped'; it.error = { code, message }; }
    });
  }
  private finish(status: AiBatchState['status']): void {
    const s = this.state!;
    s.status = status; s.finishedAt = this.now().toISOString();
    delete s.currentIndex; delete s.waitUntil;
    this.push();
  }
  private stop(from: number, reason: { code: string; message: string }): void {
    this.skipRest(from, 'AI_BATCH_STOPPED', '중단으로 미실행');
    this.state!.stopReason = reason;
    this.finish('stopped');
  }
  private cancelled(from: number): void {
    this.skipRest(from, 'AI_BATCH_CANCELLED', '취소');
    this.finish('cancelled');
  }

  private async loop(p: AiBatchStart, ac: AbortController): Promise<void> {
    const s = this.state!;
    const signal = ac.signal;
    const mask = (m: string) => redactKey(m, p.api.key);
    const gap = this.d.gapMs ?? AI_BATCH_GAP_MS;
    const rateWait = this.d.rateWaitMs ?? AI_BATCH_RATE_WAIT_MS;
    // 연속 과부하 카운터: 실제로 실행한 건만 센다. 사전 검사로 건너뛴 공고는 실행 결과가 아니므로 카운터를 올리지도 리셋하지도 않는다.
    let overloads = 0;

    for (let i = 0; i < s.items.length; i++) {
      const item: AiBatchItem = s.items[i]!;
      if (signal.aborted) return this.cancelled(i);

      // 사전 검사: 반자동 답변 대기 중이거나, 이 배치 중에 이미 실행된 공고는 건너뛴다.
      try {
        const latest = (await this.d.getReview(item.noticeId))?.runs[0];
        if (latest?.status === 'awaiting') { item.status = 'skipped'; item.error = { code: 'AI_RUN_BUSY', message: 'AI 답변 붙여넣기 대기 중' }; this.push(); continue; }
        if (latest?.status === 'done' && latest.createdAt >= s.startedAt) { item.status = 'skipped'; item.error = { code: 'AI_ALREADY_RAN', message: '배치 중 직접 실행됨' }; this.push(); continue; }
      } catch { /* 사전 검사 실패는 실행으로 확인한다 */ }
      if (signal.aborted) return this.cancelled(i);

      let ran = false;
      for (;;) {
        item.attempts++;
        item.status = 'running'; delete item.error;
        s.currentIndex = i; s.status = 'running'; delete s.waitUntil;
        this.push();

        let outcome: AiRunOutcome;
        try {
          const started = await this.d.runner.exec({ noticeId: item.noticeId, scope: 'auto', provider: p.provider, api: p.api });
          ran = true;
          item.runId = started.runId;
          this.currentRun = { noticeId: item.noticeId, runId: started.runId };
          this.push();
          if (signal.aborted) void this.d.runner.cancel(this.currentRun).catch(() => undefined); // 준비 중에 취소가 들어온 경우
          outcome = await started.done;
        } catch (e) {
          this.currentRun = null;
          item.status = 'skipped';
          item.error = { code: (e as { code?: string }).code ?? 'AI_HTTP', message: mask(e instanceof Error ? e.message : String(e)) };
          this.push();
          break;
        }
        this.currentRun = null;

        if (outcome.status === 'done') {
          overloads = 0;
          item.status = 'done';
          if (outcome.run) item.summary = runSummary(outcome.run);
          this.push();
          break;
        }
        if (outcome.status === 'cancelled') {
          overloads = 0;
          if (signal.aborted) { item.status = 'skipped'; item.error = { code: 'AI_BATCH_CANCELLED', message: '취소' }; return this.cancelled(i + 1); }
          item.status = 'failed'; item.error = { code: 'AI_RUN_CLOSED', message: '실행이 취소되었습니다' };
          this.push();
          break;
        }

        // failed
        const code = outcome.error?.code ?? 'AI_HTTP';
        const message = mask(outcome.error?.message ?? '');
        item.status = 'failed'; item.error = { code, message };
        if (code === 'AI_QUOTA' || code === 'AI_AUTH') return this.stop(i + 1, { code, message });
        if (code === 'AI_RATE_LIMIT') {
          overloads = 0;
          if (item.attempts >= 2) return this.stop(i + 1, { code, message });
          s.status = 'waiting'; s.waitUntil = new Date(this.now().getTime() + rateWait).toISOString();
          this.push();
          await abortableSleep(rateWait, signal);
          if (signal.aborted) { item.status = 'skipped'; item.error = { code: 'AI_BATCH_CANCELLED', message: '취소' }; return this.cancelled(i + 1); }
          continue; // 같은 공고 재시도
        }
        if (code === 'AI_OVERLOADED') {
          overloads++;
          this.push();
          if (overloads >= AI_BATCH_OVERLOAD_STOP) return this.stop(i + 1, { code, message });
          break;
        }
        overloads = 0;
        this.push();
        break;
      }

      // 실제로 실행한 공고 뒤에서만 간격을 둔다(건너뛴 공고는 기다릴 이유가 없다).
      if (ran && i < s.items.length - 1) {
        await abortableSleep(gap, signal);
        if (signal.aborted) return this.cancelled(i + 1);
      }
    }
    // 마지막 공고를 실행하는 중에 취소가 들어왔으면 done이 아니라 cancelled로 마무리한다.
    if (signal.aborted) return this.cancelled(s.items.length);
    this.finish('done');
  }
}
