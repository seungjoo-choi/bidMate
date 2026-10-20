import { redactKey } from '../../adapters/g2b/openapi';
import type { AiErrorCode, AiProvider, AiReviewFile, AiRunState, AiScope } from '../../core/types/ai';
import type { IFileStore } from '../file-store/types';
import { cancelRunState, execApiRun, failRun, getReview, prepareRun, type AiApiDeps, type PreparedRun } from './ai-review-api';
import { AiReviewStore } from './ai-review-store';
import { NoticeStore } from '../notices/notice-store';

export interface AiRunnerDeps {
  store: IFileStore;
  fetch: typeof globalThis.fetch;
  /** ai/status push(SW로 보낸다). 실패해도 던지지 않아야 한다. */
  pushStatus: (s: AiRunState) => void;
  /** 호출 때마다 규칙·isBusy·now를 만든다. */
  apiDeps: () => Promise<AiApiDeps>;
  now?: () => Date;
  retryDelayMs?: number;
}
export interface ExecRequest { noticeId: string; scope: AiScope; provider: AiProvider; files?: string[]; api: { key: string; model: string } }

const LABEL: Record<AiRunState['status'], string> = {
  preparing: '요청 준비 중', requesting: 'AI에 요청하는 중', verifying: '근거 확인 중', done: '완료', failed: '실패', cancelled: '취소됨',
};
const INTERRUPTED = '실행이 중단되었습니다. 다시 실행하세요';
const err = (code: AiErrorCode, message: string) => Object.assign(new Error(message), { code });

/** offscreen의 AI 실행 조율: 공고당 1개 실행 Map, 상태 push, 취소 abort, 예외 시 failRun + failed push, 고아 run 정리. */
export class AiRunner {
  /** runId가 ''이면 prepare 중 */
  private runs = new Map<string, { runId: string; abort: AbortController }>();
  constructor(private d: AiRunnerDeps) {}

  isRunning(noticeId: string): boolean { return this.runs.has(noticeId); }

  private push(noticeId: string, runId: string, provider: AiProvider, status: AiRunState['status'], error?: AiRunState['error']): void {
    this.d.pushStatus({ noticeId, runId, provider, status, label: LABEL[status], at: (this.d.now?.() ?? new Date()).toISOString(), ...(error ? { error } : {}) });
  }

  /** requesting인데 실행 Map에 없는 run(offscreen 재시작, 실패 기록 실패)을 AI_INTERRUPTED로 닫는다. 정리 실패는 무시한다. */
  async sweepOrphans(noticeId: string): Promise<void> {
    try {
      const notice = await new NoticeStore(this.d.store).loadNotice(noticeId);
      if (!notice) return;
      const review = await new AiReviewStore(this.d.store).load(notice);
      for (const r of review?.runs ?? []) {
        if (r.status !== 'requesting') continue;
        const live = this.runs.get(noticeId); // load/failRun을 기다리는 사이 등록된 실행을 놓치지 않도록 매번 다시 읽는다
        if (live && (live.runId === r.id || live.runId === '')) continue;
        const error = { code: 'AI_INTERRUPTED' as const, message: INTERRUPTED };
        await failRun(this.d.store, { noticeId, runId: r.id, error }, await this.d.apiDeps());
        this.push(noticeId, r.id, r.provider, 'failed', error);
      }
    } catch { /* best effort */ }
  }

  async get(noticeId: string): Promise<AiReviewFile | null> {
    await this.sweepOrphans(noticeId);
    return getReview(this.d.store, noticeId);
  }

  /** 반자동 준비. 살아 있는 실행이 있으면 AI_RUN_BUSY. */
  async prepare(p: { noticeId: string; scope: AiScope; provider: AiProvider; files?: string[] }): Promise<PreparedRun> {
    await this.sweepOrphans(p.noticeId);
    if (this.runs.has(p.noticeId)) throw err('AI_RUN_BUSY', '이 공고는 이미 AI 실행 중입니다.');
    return prepareRun(this.d.store, { noticeId: p.noticeId, scope: p.scope, provider: p.provider, mode: 'manual', model: null, files: p.files }, await this.d.apiDeps());
  }

  /** prepare 후 즉시 runId를 돌려주고 실행은 비동기로 진행한다. done은 실행이 끝나면 풀린다(테스트용). */
  async exec(p: ExecRequest): Promise<{ runId: string; done: Promise<void> }> {
    await this.sweepOrphans(p.noticeId);
    if (this.runs.has(p.noticeId)) throw err('AI_RUN_BUSY', '이 공고는 이미 AI 실행 중입니다.');
    const entry = { runId: '', abort: new AbortController() };
    this.runs.set(p.noticeId, entry);
    let prepared: PreparedRun;
    try {
      prepared = await prepareRun(this.d.store, { noticeId: p.noticeId, scope: p.scope, provider: p.provider, mode: 'api', model: p.api.model, files: p.files }, await this.d.apiDeps());
    } catch (e) {
      this.runs.delete(p.noticeId);
      throw e;
    }
    const runId = prepared.run.id;
    entry.runId = runId;
    this.push(p.noticeId, runId, p.provider, 'preparing');
    const done = new Promise<void>((resolve) => setTimeout(resolve, 0)).then(() => this.run(p, prepared, entry));
    return { runId, done };
  }

  private async run(p: ExecRequest, prepared: PreparedRun, entry: { runId: string; abort: AbortController }): Promise<void> {
    const { noticeId } = p;
    const runId = prepared.run.id;
    try {
      const review = await execApiRun(this.d.store, {
        prepared, apiKey: p.api.key, model: p.api.model, fetch: this.d.fetch, signal: entry.abort.signal, retryDelayMs: this.d.retryDelayMs,
        onStatus: (s) => this.push(noticeId, runId, p.provider, s),
      }, await this.d.apiDeps());
      const run = review?.runs.find((r) => r.id === runId);
      if (!run || run.status === 'cancelled') this.push(noticeId, runId, p.provider, 'cancelled');
      else if (run.status === 'failed') this.push(noticeId, runId, p.provider, 'failed', run.error);
      else this.push(noticeId, runId, p.provider, 'done');
    } catch (e) {
      const message = redactKey(e instanceof Error ? e.message : String(e), p.api.key);
      const raw = (e as { code?: string }).code;
      const code = (raw?.startsWith('AI_') ? raw : 'AI_HTTP') as AiErrorCode;
      try { await failRun(this.d.store, { noticeId, runId, error: { code, message } }, await this.d.apiDeps()); } catch { /* 고아 정리가 나중에 닫는다 */ }
      this.push(noticeId, runId, p.provider, 'failed', { code, message });
    } finally {
      if (this.runs.get(noticeId) === entry) this.runs.delete(noticeId);
    }
  }

  async cancel(p: { noticeId: string; runId: string }): Promise<{ cancelled: boolean }> {
    const e = this.runs.get(p.noticeId);
    if (e && e.runId === p.runId) e.abort.abort();
    return cancelRunState(this.d.store, p, await this.d.apiDeps());
  }
}
