import { redactKey } from '../../adapters/g2b/openapi';
import type { AiErrorCode, AiProvider, AiReviewFile, AiRun, AiRunState, AiScope } from '../../core/types/ai';
import type { AiKey } from '../../core/ai/keys';
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
export interface ExecRequest { noticeId: string; scope: AiScope; keys?: AiKey[]; provider: AiProvider; files?: string[]; api: { key: string; model: string; sendFullText?: boolean } }
/** 실행 결과. 예외 경로는 failed + error */
export interface AiRunOutcome { status: 'done' | 'failed' | 'cancelled'; error?: { code: string; message: string }; run?: AiRun }
/** 여러 AI 비교 실행. 같은 공고 잠금을 쥔 채 targets 순서대로 실행한다. */
export interface CompareRequest { noticeId: string; scope: AiScope; keys?: AiKey[]; files?: string[]; compareId: string; targets: Array<{ provider: AiProvider; api: ExecRequest['api'] }> }
type Compare = NonNullable<AiRunState['compare']>;
/** runId가 ''이면 첫 prepare 중. preparing이면 비교의 다음 run을 prepare 중(runId는 직전 run) */
type Entry = { runId: string; abort: AbortController; preparing?: boolean };

const LABEL: Record<AiRunState['status'], string> = {
  preparing: '요청 준비 중', requesting: 'AI에 요청하는 중', verifying: '근거 확인 중', done: '완료', failed: '실패', cancelled: '취소됨',
};
const INTERRUPTED = '실행이 중단되었습니다. 다시 실행하세요';
const err = (code: AiErrorCode, message: string) => Object.assign(new Error(message), { code });
/** 예외를 AI 오류로 바꾼다(AI_로 시작하지 않는 코드는 AI_HTTP). 키는 가린다. */
const toAiError = (e: unknown, key: string): { code: AiErrorCode; message: string } => {
  const raw = (e as { code?: string }).code;
  return { code: (raw?.startsWith('AI_') ? raw : 'AI_HTTP') as AiErrorCode, message: redactKey(e instanceof Error ? e.message : String(e), key) };
};

/** offscreen의 AI 실행 조율: 공고당 1개 실행 Map, 상태 push, 취소 abort, 예외 시 failRun + failed push, 고아 run 정리. */
export class AiRunner {
  private runs = new Map<string, Entry>();
  constructor(private d: AiRunnerDeps) {}

  isRunning(noticeId: string): boolean { return this.runs.has(noticeId); }

  private push(noticeId: string, runId: string, provider: AiProvider, status: AiRunState['status'], error?: AiRunState['error'], compare?: Compare): void {
    this.d.pushStatus({ noticeId, runId, provider, status, label: LABEL[status], at: (this.d.now?.() ?? new Date()).toISOString(), ...(error ? { error } : {}), ...(compare ? { compare } : {}) });
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
        if (live && (live.runId === r.id || live.runId === '' || live.preparing)) continue;
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
  async prepare(p: { noticeId: string; scope: AiScope; keys?: AiKey[]; provider: AiProvider; files?: string[] }): Promise<PreparedRun> {
    await this.sweepOrphans(p.noticeId);
    if (this.runs.has(p.noticeId)) throw err('AI_RUN_BUSY', '이 공고는 이미 AI 실행 중입니다.');
    return prepareRun(this.d.store, { noticeId: p.noticeId, scope: p.scope, keys: p.keys, provider: p.provider, mode: 'manual', model: null, files: p.files }, await this.d.apiDeps());
  }

  /** prepare 후 즉시 runId를 돌려주고 실행은 비동기로 진행한다. done은 실행이 끝나면 풀린다(테스트용). */
  async exec(p: ExecRequest): Promise<{ runId: string; done: Promise<AiRunOutcome> }> {
    await this.sweepOrphans(p.noticeId);
    if (this.runs.has(p.noticeId)) throw err('AI_RUN_BUSY', '이 공고는 이미 AI 실행 중입니다.');
    const entry: Entry = { runId: '', abort: new AbortController() };
    this.runs.set(p.noticeId, entry);
    let prepared: PreparedRun;
    try {
      prepared = await this.prepareApi(p);
    } catch (e) {
      this.runs.delete(p.noticeId);
      throw e;
    }
    const runId = prepared.run.id;
    entry.runId = runId;
    this.push(p.noticeId, runId, p.provider, 'preparing');
    const done = new Promise<void>((resolve) => setTimeout(resolve, 0)).then(() => this.runOne(p, prepared, entry)).finally(() => this.release(p.noticeId, entry));
    return { runId, done };
  }

  /** 비교 실행. 첫 run을 prepare한 뒤 즉시 돌려주고, 공급자를 순서대로 실행한다. 한 공급자 실패는 기록하고 계속, 취소면 남은 공급자를 실행하지 않는다. */
  async execCompare(p: CompareRequest): Promise<{ compareId: string; runId: string; done: Promise<AiRunOutcome[]> }> {
    const providers = p.targets.map((t) => t.provider);
    if (providers.length < 2 || providers.length > 3 || new Set(providers).size !== providers.length) throw err('AI_BAD_REQUEST', '비교할 AI는 2~3개이고 서로 달라야 합니다.');
    await this.sweepOrphans(p.noticeId);
    if (this.runs.has(p.noticeId)) throw err('AI_RUN_BUSY', '이 공고는 이미 AI 실행 중입니다.');
    const entry: Entry = { runId: '', abort: new AbortController() };
    this.runs.set(p.noticeId, entry);
    const reqOf = (i: number, scope: AiScope, keys?: AiKey[]): ExecRequest => ({
      noticeId: p.noticeId, scope, ...(keys ? { keys } : {}), provider: p.targets[i]!.provider, ...(p.files ? { files: p.files } : {}), api: p.targets[i]!.api,
    });
    const cmp = (index: number): Compare => ({ id: p.compareId, providers, index });
    const r0 = reqOf(0, p.scope, p.keys);
    let first: PreparedRun;
    try {
      first = await this.prepareApi(r0, p.compareId);
    } catch (e) {
      this.runs.delete(p.noticeId);
      throw e;
    }
    entry.runId = first.run.id;
    this.push(p.noticeId, entry.runId, r0.provider, 'preparing', undefined, cmp(0));
    const series = async (): Promise<AiRunOutcome[]> => {
      const outcomes = [await this.runOne(r0, first, entry, cmp(0))];
      for (let i = 1; i < p.targets.length; i++) {
        if (entry.abort.signal.aborted) break;
        // 2번째부터는 첫 run의 키 집합으로 고정한다(실행 중 적용으로 pending이 바뀌어도 같은 항목을 비교).
        const ri = reqOf(i, 'keys', first.run.keys);
        let prepared: PreparedRun;
        entry.preparing = true;
        try {
          prepared = await this.prepareApi(ri, p.compareId);
        } catch (e) {
          outcomes.push({ status: 'failed', error: toAiError(e, ri.api.key) });
          continue;
        } finally {
          entry.preparing = false;
        }
        entry.runId = prepared.run.id;
        this.push(p.noticeId, entry.runId, ri.provider, 'preparing', undefined, cmp(i));
        const o = await this.runOne(ri, prepared, entry, cmp(i));
        outcomes.push(o);
        if (o.status === 'cancelled' && entry.abort.signal.aborted) break;
      }
      return outcomes;
    };
    const done = new Promise<void>((resolve) => setTimeout(resolve, 0)).then(series).finally(() => this.release(p.noticeId, entry));
    return { compareId: p.compareId, runId: first.run.id, done };
  }

  private async prepareApi(p: ExecRequest, compareId?: string): Promise<PreparedRun> {
    return prepareRun(this.d.store, {
      noticeId: p.noticeId, scope: p.scope, keys: p.keys, provider: p.provider, mode: 'api', model: p.api.model, sendFullText: p.api.sendFullText, files: p.files,
      ...(compareId ? { compareId } : {}),
    }, await this.d.apiDeps());
  }

  private release(noticeId: string, entry: Entry): void {
    if (this.runs.get(noticeId) === entry) this.runs.delete(noticeId);
  }

  /** run 하나를 실행한다. Map 정리는 호출자가 한다. */
  private async runOne(p: ExecRequest, prepared: PreparedRun, entry: Entry, compare?: Compare): Promise<AiRunOutcome> {
    const { noticeId } = p;
    const runId = prepared.run.id;
    try {
      const review = await execApiRun(this.d.store, {
        prepared, apiKey: p.api.key, model: p.api.model, fetch: this.d.fetch, signal: entry.abort.signal, retryDelayMs: this.d.retryDelayMs,
        onStatus: (s) => this.push(noticeId, runId, p.provider, s, undefined, compare),
      }, await this.d.apiDeps());
      const run = review?.runs.find((r) => r.id === runId);
      if (!run || run.status === 'cancelled') { this.push(noticeId, runId, p.provider, 'cancelled', undefined, compare); return { status: 'cancelled', ...(run ? { run } : {}) }; }
      if (run.status === 'failed') { this.push(noticeId, runId, p.provider, 'failed', run.error, compare); return { status: 'failed', ...(run.error ? { error: run.error } : {}), run }; }
      this.push(noticeId, runId, p.provider, 'done', undefined, compare);
      return { status: 'done', run };
    } catch (e) {
      const error = toAiError(e, p.api.key);
      try { await failRun(this.d.store, { noticeId, runId, error }, await this.d.apiDeps()); } catch { /* 고아 정리가 나중에 닫는다 */ }
      this.push(noticeId, runId, p.provider, 'failed', error, compare);
      return { status: 'failed', error };
    }
  }

  async cancel(p: { noticeId: string; runId: string }): Promise<{ cancelled: boolean }> {
    const e = this.runs.get(p.noticeId);
    if (e && e.runId === p.runId) e.abort.abort();
    return cancelRunState(this.d.store, p, await this.d.apiDeps());
  }
}
