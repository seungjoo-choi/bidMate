import type { AiProvider } from '../../core/types/ai';
import type { AskRecord } from '../../core/types/search';
import type { IFileStore } from '../file-store/types';
import { askNotice, type AskDeps } from './ask-api';

export interface AskRunnerDeps {
  store: IFileStore;
  fetch: typeof globalThis.fetch;
  now?: () => Date;
  isBusy?: (noticeId: string) => boolean;
  retryDelayMs?: number;
}
/** search/ask-exec payload. 키는 SW가 주입한다. */
export interface AskExecRequest {
  noticeId: string; askId: string; question: string; fieldDocText: string;
  provider: AiProvider; contextMode?: 'context' | 'full'; api: { key: string; model: string };
}

/** offscreen의 질문 실행 조율. 공고당 1개만 실행하고(Map), 취소는 AbortController로 한다. AiRunner와 상태·잠금을 공유하지 않는다. */
export class AskRunner {
  private runs = new Map<string, { askId: string; abort: AbortController }>();
  constructor(private d: AskRunnerDeps) {}

  isRunning(noticeId: string): boolean { return this.runs.has(noticeId); }

  async exec(p: AskExecRequest): Promise<AskRecord> {
    if (this.runs.has(p.noticeId)) throw Object.assign(new Error('이 공고는 이미 질문을 처리 중입니다.'), { code: 'SEARCH_ASK_BUSY' });
    const entry = { askId: p.askId, abort: new AbortController() };
    this.runs.set(p.noticeId, entry);
    const deps: AskDeps = { now: this.d.now, isBusy: this.d.isBusy, retryDelayMs: this.d.retryDelayMs };
    try {
      return await askNotice(this.d.store, { ...p, contextMode: p.contextMode ?? 'context', fetch: this.d.fetch, signal: entry.abort.signal }, deps);
    } finally {
      if (this.runs.get(p.noticeId) === entry) this.runs.delete(p.noticeId);
    }
  }

  cancel(p: { noticeId: string; askId: string }): { cancelled: boolean } {
    const cur = this.runs.get(p.noticeId);
    if (!cur || cur.askId !== p.askId) return { cancelled: false };
    cur.abort.abort();
    return { cancelled: true };
  }
}
