import { NOTICE_KINDS } from '../helpers/ai-notice-kinds';
import { describe, expect, it } from 'vitest';
import type { OutputSpec } from '../../src/core/types/ai';
import { claudeAdapter } from '../../src/engine/ai/providers/claude';
import { getAdapter, PROVIDERS } from '../../src/engine/ai/providers';

const spec: OutputSpec = {
  tag: 'bidmate-ai-review/2', runId: 'r1', keys: ['credibilityScore', 'differentialScoring'],
  kindOf: { credibilityScore: 'number', managementScore: 'number', performanceScore: 'number', performancePeriod: 'string', performanceMinAmount: 'number', performanceCondition: 'string', differentialScoring: 'boolean', ...NOTICE_KINDS },
};

describe('Claude 어댑터', () => {
  it('buildRequest: 엔드포인트·헤더·system/messages·temperature 미전송·스키마', () => {
    const r = claudeAdapter.buildRequest({ apiKey: 'K', model: 'claude-x', system: 'SYS', user: 'USR', spec, maxTokens: 8192 });
    expect(r.url).toBe('https://api.anthropic.com/v1/messages');
    expect(r.headers).toMatchObject({ 'x-api-key': 'K', 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' });
    const b = r.body as { model: string; max_tokens: number; temperature?: number; system: string; messages: unknown[]; output_config: { format: { type: string; schema: { properties: { items: { items: { anyOf: Array<{ properties: { key: { enum: string[] } } }> } } } } } } };
    expect(b).toMatchObject({ model: 'claude-x', max_tokens: 8192, system: 'SYS', messages: [{ role: 'user', content: 'USR' }] });
    expect(b.temperature).toBeUndefined();
    expect(b.output_config.format.type).toBe('json_schema');
    expect(b.output_config.format.schema.properties.items.items.anyOf.map((x) => x.properties.key.enum[0])).toEqual(['credibilityScore', 'differentialScoring']);
    expect(JSON.stringify(r.body)).not.toContain('"K"');
  });

  it('parseResponse 정상: 텍스트 이어붙이기, usage, finish 매핑', () => {
    const r = claudeAdapter.parseResponse(200, { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }], stop_reason: 'end_turn', usage: { input_tokens: 3, output_tokens: 4 } });
    expect(r).toEqual({ ok: true, text: 'ab', usage: { inputTokens: 3, outputTokens: 4 }, finish: 'stop' });
  });

  it('parseResponse: max_tokens → length, refusal → refusal, 텍스트 없음 → AI_BAD_RESPONSE', () => {
    expect(claudeAdapter.parseResponse(200, { content: [{ type: 'text', text: '{' }], stop_reason: 'max_tokens' })).toMatchObject({ ok: true, finish: 'length' });
    expect(claudeAdapter.parseResponse(200, { content: [], stop_reason: 'refusal' })).toMatchObject({ ok: true, finish: 'refusal' });
    expect(claudeAdapter.parseResponse(200, { content: [], stop_reason: 'end_turn' })).toMatchObject({ ok: false, error: { code: 'AI_BAD_RESPONSE' } });
  });

  it.each([
    [401, 'AI_AUTH', false], [403, 'AI_AUTH', false], [429, 'AI_RATE_LIMIT', true], [529, 'AI_OVERLOADED', true],
    [503, 'AI_OVERLOADED', true], [400, 'AI_BAD_REQUEST', false], [500, 'AI_HTTP', true],
  ])('오류 %i → %s(retryable %s)', (status, code, retryable) => {
    const r = claudeAdapter.parseResponse(status, { error: { type: 't', message: 'm' } });
    expect(r).toMatchObject({ ok: false, error: { code, retryable, provider: 'claude', status, message: 'm' } });
  });

  it('listModels: data[].id/display_name을 변환, 오류는 code를 달아 던진다', async () => {
    const okFetch = (async () => new Response(JSON.stringify({ data: [{ id: 'a', display_name: 'A' }, { id: 'b' }] }), { status: 200 })) as unknown as typeof fetch;
    expect(await claudeAdapter.listModels('K', okFetch)).toEqual([{ id: 'a', displayName: 'A' }, { id: 'b' }]);
    const bad = (async () => new Response(JSON.stringify({ error: { message: 'no' } }), { status: 401 })) as unknown as typeof fetch;
    await expect(claudeAdapter.listModels('K', bad)).rejects.toMatchObject({ code: 'AI_AUTH' });
  });

  it('레지스트리: 세 공급자 모두 등록돼 있다', () => {
    expect(PROVIDERS.claude).toBe(claudeAdapter);
    expect(getAdapter('openai').id).toBe('openai');
    expect(getAdapter('gemini').id).toBe('gemini');
  });
});
