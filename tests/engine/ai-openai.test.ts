import { describe, expect, it } from 'vitest';
import type { OutputSpec } from '../../src/core/types/ai';
import { openaiAdapter } from '../../src/engine/ai/providers/openai';

const spec: OutputSpec = {
  tag: 'bidmate-ai-review/2', runId: 'r1', keys: ['credibilityScore', 'differentialScoring'],
  kindOf: { credibilityScore: 'number', managementScore: 'number', performanceScore: 'number', performancePeriod: 'string', performanceMinAmount: 'number', performanceCondition: 'string', differentialScoring: 'boolean' },
};
const KEY = 'sk-openai-test-9999';
const ok = (message: object, finish_reason = 'stop') => ({
  choices: [{ message: { role: 'assistant', ...message }, finish_reason }], usage: { prompt_tokens: 50, completion_tokens: 20 },
});
const err = (code: string | null, message: string) => ({ error: { code, message, type: 't' } });

describe('OpenAI 어댑터', () => {
  it('buildRequest: Bearer 헤더, messages[system,user], json_schema strict, 키는 URL·바디에 없음', () => {
    const r = openaiAdapter.buildRequest({ apiKey: KEY, model: 'gpt-x', system: 'SYS', user: 'USR', spec, maxTokens: 8192 });
    expect(r.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(r.url).not.toContain(KEY);
    expect(r.headers).toMatchObject({ authorization: `Bearer ${KEY}` });
    const b = r.body as { model: string; temperature: number; messages: unknown[]; response_format: { type: string; json_schema: { name: string; strict: boolean; schema: { additionalProperties: boolean; required: string[]; properties: { items: { items: { anyOf: Array<{ additionalProperties: boolean; required: string[]; properties: Record<string, { enum?: string[]; type?: string[] }> }> } } } } } } };
    expect(b).toMatchObject({ model: 'gpt-x', temperature: 0, messages: [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'USR' }] });
    expect(b.response_format).toMatchObject({ type: 'json_schema', json_schema: { name: 'bidmate_ai_review', strict: true } });
    const schema = b.response_format.json_schema.schema;
    expect(schema.additionalProperties).toBe(false);
    for (const alt of schema.properties.items.items.anyOf) {
      expect(alt.additionalProperties).toBe(false);
      expect(alt.required.sort()).toEqual(Object.keys(alt.properties).sort()); // strict: 모든 속성 required
      expect(alt.properties.key!.enum).toHaveLength(1); // const 대신 enum
    }
    expect(JSON.stringify(r.body)).not.toContain(KEY);
    expect(JSON.stringify(r.body)).not.toContain('"const"');
  });

  it('parseResponse 정상: content·usage·finish stop', () => {
    expect(openaiAdapter.parseResponse(200, ok({ content: '{"a":1}' }))).toEqual({ ok: true, text: '{"a":1}', usage: { inputTokens: 50, outputTokens: 20 }, finish: 'stop' });
  });

  it('refusal·content_filter→refusal, length→length, 텍스트 없음→AI_BAD_RESPONSE', () => {
    expect(openaiAdapter.parseResponse(200, ok({ content: null, refusal: '거절' }))).toMatchObject({ ok: true, finish: 'refusal' });
    expect(openaiAdapter.parseResponse(200, ok({ content: '' }, 'content_filter'))).toMatchObject({ ok: true, finish: 'refusal' });
    expect(openaiAdapter.parseResponse(200, ok({ content: '{' }, 'length'))).toMatchObject({ ok: true, finish: 'length' });
    expect(openaiAdapter.parseResponse(200, ok({ content: null }))).toMatchObject({ ok: false, error: { code: 'AI_BAD_RESPONSE' } });
  });

  it('오류 매핑: 401→AI_AUTH, 429 insufficient_quota→AI_QUOTA(비재시도), 그 외 429→AI_RATE_LIMIT(재시도), 500·503→AI_OVERLOADED, 400→AI_BAD_REQUEST', () => {
    expect(openaiAdapter.parseResponse(401, err('invalid_api_key', 'Incorrect API key'))).toMatchObject({ ok: false, error: { code: 'AI_AUTH', provider: 'openai', status: 401 } });
    expect(openaiAdapter.parseResponse(429, err('insufficient_quota', 'You exceeded your current quota'))).toMatchObject({ error: { code: 'AI_QUOTA', retryable: false } });
    expect(openaiAdapter.parseResponse(429, err('rate_limit_exceeded', 'slow'))).toMatchObject({ error: { code: 'AI_RATE_LIMIT', retryable: true } });
    for (const s of [500, 503]) expect(openaiAdapter.parseResponse(s, err(null, 'x'))).toMatchObject({ error: { code: 'AI_OVERLOADED', retryable: true } });
    expect(openaiAdapter.parseResponse(400, err('invalid_request_error', 'bad'))).toMatchObject({ error: { code: 'AI_BAD_REQUEST' } });
  });

  it('listModels: gpt·o 접두만 남긴다, 키는 헤더로만', async () => {
    let seen: { url: string; headers: Record<string, string> } | undefined;
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen = { url, headers: init.headers as Record<string, string> };
      return new Response(JSON.stringify({ data: [{ id: 'gpt-a' }, { id: 'o3-mini' }, { id: 'text-embedding-3-small' }, { id: 'whisper-1' }, { id: 'dall-e-3' }] }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await openaiAdapter.listModels(KEY, fetchFn)).toEqual([{ id: 'gpt-a' }, { id: 'o3-mini' }]);
    expect(seen!.url).toBe('https://api.openai.com/v1/models');
    expect(seen!.headers.authorization).toBe(`Bearer ${KEY}`);
    const bad = (async () => new Response(JSON.stringify(err('invalid_api_key', 'x')), { status: 401 })) as unknown as typeof fetch;
    await expect(openaiAdapter.listModels(KEY, bad)).rejects.toMatchObject({ code: 'AI_AUTH' });
  });
});
