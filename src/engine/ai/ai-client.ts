import { redactKey } from '../../adapters/g2b/openapi';
import type { AiBuildRequestInput, AiError, AiProviderAdapter } from './providers/types';

export const AI_MAX_TOKENS = 8192;
export const AI_TIMEOUT_MS = 120_000;
const RETRY_DELAY_MS = 5_000;

export type AiCallResult =
  | { ok: true; text: string; usage?: { inputTokens: number; outputTokens: number }; finish: 'stop' | 'length' | 'other' }
  | { ok: false; error: AiError };

export interface AiCallOptions {
  fetch: typeof globalThis.fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** 재시도 전 대기(기본 5초). 테스트에서 줄인다. */
  retryDelayMs?: number;
}

const abortableSleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve) => {
  if (signal?.aborted) return resolve();
  const t = setTimeout(done, ms);
  function done() { clearTimeout(t); signal?.removeEventListener('abort', done); resolve(); }
  signal?.addEventListener('abort', done, { once: true });
});

/** 요청 1회. 네트워크·타임아웃·취소는 AiError로 돌려준다(던지지 않는다). */
async function attempt(adapter: AiProviderAdapter, req: AiBuildRequestInput, o: AiCallOptions): Promise<AiCallResult> {
  const provider = adapter.id;
  const ac = new AbortController();
  let timedOut = false;
  const onAbort = () => ac.abort();
  o.signal?.addEventListener('abort', onAbort, { once: true });
  if (o.signal?.aborted) ac.abort();
  const timer = setTimeout(() => { timedOut = true; ac.abort(); }, o.timeoutMs ?? AI_TIMEOUT_MS);
  try {
    const built = adapter.buildRequest(req);
    let res: Response;
    try {
      res = await o.fetch(built.url, { method: 'POST', headers: built.headers, body: JSON.stringify(built.body), signal: ac.signal });
    } catch (e) {
      if (timedOut) return { ok: false, error: { code: 'AI_TIMEOUT', message: '응답 시간이 초과되었습니다.', retryable: false, provider } };
      if (o.signal?.aborted) return { ok: false, error: { code: 'AI_RUN_CLOSED', message: '취소되었습니다.', retryable: false, provider } };
      return { ok: false, error: { code: 'AI_NETWORK', message: e instanceof Error ? e.message : String(e), retryable: true, provider } };
    }
    let json: unknown = null;
    try { json = await res.json(); } catch (e) {
      if (timedOut) return { ok: false, error: { code: 'AI_TIMEOUT', message: '응답 시간이 초과되었습니다.', retryable: false, provider } };
      if (o.signal?.aborted) return { ok: false, error: { code: 'AI_RUN_CLOSED', message: '취소되었습니다.', retryable: false, provider } };
      json = null;
    }
    const parsed = adapter.parseResponse(res.status, json);
    if (!parsed.ok) return parsed;
    if (parsed.finish === 'refusal') return { ok: false, error: { code: 'AI_REFUSED', message: 'AI가 요청을 거절했습니다.', retryable: false, provider } };
    return { ok: true, text: parsed.text, ...(parsed.usage ? { usage: parsed.usage } : {}), finish: parsed.finish };
  } finally {
    clearTimeout(timer);
    o.signal?.removeEventListener('abort', onAbort);
  }
}

/** 공급자 호출. retryable이면 5초 후 1회 재시도. 모든 오류 메시지에서 키를 가린다. finish 'length'는 ok로 돌려주고 호출자가 AI_TRUNCATED를 판단한다. */
export async function callProvider(adapter: AiProviderAdapter, req: AiBuildRequestInput, o: AiCallOptions): Promise<AiCallResult> {
  let r = await attempt(adapter, req, o);
  if (!r.ok && r.error.retryable && !o.signal?.aborted) {
    await abortableSleep(o.retryDelayMs ?? RETRY_DELAY_MS, o.signal);
    if (!o.signal?.aborted) r = await attempt(adapter, req, o);
  }
  if (!r.ok) return { ok: false, error: { ...r.error, message: redactKey(r.error.message, req.apiKey) } };
  return r;
}
