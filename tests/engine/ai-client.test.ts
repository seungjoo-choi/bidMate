import { describe, expect, it, vi } from 'vitest';
import { callProvider } from '../../src/engine/ai/ai-client';
import { claudeAdapter } from '../../src/engine/ai/providers/claude';
import type { OutputSpec } from '../../src/core/types/ai';

const KEY = 'sk-ant-SECRET-9999';
const spec: OutputSpec = {
  tag: 'bidmate-ai-review/1', runId: 'r1', keys: ['credibilityScore'],
  kindOf: { credibilityScore: 'number', managementScore: 'number', performanceScore: 'number', performancePeriod: 'string', performanceMinAmount: 'number', performanceCondition: 'string', differentialScoring: 'boolean' },
};
const req = { apiKey: KEY, model: 'm', system: 's', user: 'u', spec, maxTokens: 8192 };
const ok = () => new Response(JSON.stringify({ content: [{ type: 'text', text: '{}' }], stop_reason: 'end_turn' }), { status: 200 });
const status = (code: number, message = 'x') => new Response(JSON.stringify({ error: { message } }), { status: code });
const f = (impl: (...a: unknown[]) => Promise<Response>) => vi.fn(impl) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

describe('callProvider', () => {
  it('성공하면 text·usage·finish를 돌려준다', async () => {
    const fetchFn = f(async () => ok());
    const r = await callProvider(claudeAdapter, req, { fetch: fetchFn });
    expect(r).toMatchObject({ ok: true, text: '{}', finish: 'stop' });
  });

  it('retryable(529)이면 1회만 재시도한다', async () => {
    const fetchFn = f(async () => status(529));
    fetchFn.mockResolvedValueOnce(status(529)).mockResolvedValueOnce(ok());
    const r = await callProvider(claudeAdapter, req, { fetch: fetchFn, retryDelayMs: 1 });
    expect(r.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const always = f(async () => status(529));
    const r2 = await callProvider(claudeAdapter, req, { fetch: always, retryDelayMs: 1 });
    expect(r2).toMatchObject({ ok: false, error: { code: 'AI_OVERLOADED' } });
    expect(always).toHaveBeenCalledTimes(2);
  });

  it('재시도 불가(401)는 한 번만 호출한다', async () => {
    const fetchFn = f(async () => status(401));
    const r = await callProvider(claudeAdapter, req, { fetch: fetchFn, retryDelayMs: 1 });
    expect(r).toMatchObject({ ok: false, error: { code: 'AI_AUTH' } });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('네트워크 오류는 AI_NETWORK(재시도 1회), 타임아웃은 AI_TIMEOUT', async () => {
    const net = f(async () => { throw new TypeError('Failed to fetch'); });
    const r = await callProvider(claudeAdapter, req, { fetch: net, retryDelayMs: 1 });
    expect(r).toMatchObject({ ok: false, error: { code: 'AI_NETWORK' } });
    expect(net).toHaveBeenCalledTimes(2);
    const hang = f((_u, init) => new Promise<Response>((_res, rej) => { (init as RequestInit).signal!.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))); }));
    const t = await callProvider(claudeAdapter, req, { fetch: hang, timeoutMs: 20, retryDelayMs: 1 });
    expect(t).toMatchObject({ ok: false, error: { code: 'AI_TIMEOUT' } });
    expect(hang).toHaveBeenCalledTimes(1);
  });

  it('abort하면 재시도 없이 AI_RUN_CLOSED', async () => {
    const ac = new AbortController();
    const hang = f((_u, init) => new Promise<Response>((_res, rej) => { (init as RequestInit).signal!.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))); }));
    const p = callProvider(claudeAdapter, req, { fetch: hang, signal: ac.signal, retryDelayMs: 1 });
    ac.abort();
    expect(await p).toMatchObject({ ok: false, error: { code: 'AI_RUN_CLOSED' } });
    expect(hang).toHaveBeenCalledTimes(1);
  });

  it('refusal은 AI_REFUSED, 오류 메시지의 키는 가려진다', async () => {
    const refusal = f(async () => new Response(JSON.stringify({ content: [], stop_reason: 'refusal' }), { status: 200 }));
    expect(await callProvider(claudeAdapter, req, { fetch: refusal })).toMatchObject({ ok: false, error: { code: 'AI_REFUSED' } });
    const leak = f(async () => status(401, `bad key ${KEY}`));
    const r = await callProvider(claudeAdapter, req, { fetch: leak });
    expect(JSON.stringify(r)).not.toContain(KEY);
    const netLeak = f(async () => { throw new Error(`connect failed for ${KEY}`); });
    const r2 = await callProvider(claudeAdapter, req, { fetch: netLeak, retryDelayMs: 1 });
    expect(JSON.stringify(r2)).not.toContain(KEY);
  });
});
