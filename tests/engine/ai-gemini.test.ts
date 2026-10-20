import { describe, expect, it } from 'vitest';
import type { OutputSpec } from '../../src/core/types/ai';
import { geminiAdapter } from '../../src/engine/ai/providers/gemini';

const spec: OutputSpec = {
  tag: 'bidmate-ai-review/2', runId: 'r1', keys: ['credibilityScore', 'performancePeriod'],
  kindOf: { credibilityScore: 'number', managementScore: 'number', performanceScore: 'number', performancePeriod: 'string', performanceMinAmount: 'number', performanceCondition: 'string', differentialScoring: 'boolean' },
};
const KEY = 'AQ.test-key-1234567890';
const ok = (parts: unknown[], finishReason = 'STOP', extra: object = {}) => ({
  candidates: [{ content: { role: 'model', parts }, finishReason }],
  usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30, thoughtsTokenCount: 5 }, ...extra,
});
const err = (code: number, status: string, message: string) => ({ error: { code, status, message } });

describe('Gemini 어댑터', () => {
  it('buildRequest: 키는 헤더에만, 바디는 실측 형태(responseJsonSchema·thinkingLevel low)', () => {
    const r = geminiAdapter.buildRequest({ apiKey: KEY, model: 'gemini-3.5-flash', system: 'SYS', user: 'USR', spec, maxTokens: 8192 });
    expect(r.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent');
    expect(r.url).not.toContain('key=');
    expect(r.url).not.toContain(KEY);
    expect(r.headers).toMatchObject({ 'x-goog-api-key': KEY, 'content-type': 'application/json' });
    const b = r.body as { systemInstruction: unknown; contents: unknown; generationConfig: Record<string, unknown> };
    expect(b.systemInstruction).toEqual({ parts: [{ text: 'SYS' }] });
    expect(b.contents).toEqual([{ role: 'user', parts: [{ text: 'USR' }] }]);
    expect(b.generationConfig).toMatchObject({ temperature: 0, maxOutputTokens: 8192, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'low' } });
    expect(b.generationConfig).not.toHaveProperty('responseSchema');
    const schema = b.generationConfig.responseJsonSchema as { required: string[]; properties: { items: { items: { anyOf: Array<{ properties: { key: { enum: string[] }; value: { type: string[] } } }> } } } };
    expect(schema.required).toEqual(['schema', 'runId', 'items']);
    const alts = schema.properties.items.items.anyOf;
    expect(alts.map((a) => a.properties.key.enum[0])).toEqual(['credibilityScore', 'performancePeriod']);
    expect(alts[0]!.properties.value.type).toEqual(['number', 'null']);
    expect(alts[1]!.properties.value.type).toEqual(['string', 'null']);
    expect(JSON.stringify(r.body)).not.toContain(KEY);
  });

  it('parseResponse 정상: text 파트만 이어 붙이고 thoughtSignature 파트는 무시, usage 매핑', () => {
    const r = geminiAdapter.parseResponse(200, ok([{ text: '{"a":' }, { thoughtSignature: 'abc==' }, { text: '1}' }]));
    expect(r).toEqual({ ok: true, text: '{"a":1}', usage: { inputTokens: 120, outputTokens: 30 }, finish: 'stop' });
  });

  it('finishReason 매핑: MAX_TOKENS→length, SAFETY 등→refusal, 그 외→other', () => {
    expect(geminiAdapter.parseResponse(200, ok([{ text: '{' }], 'MAX_TOKENS'))).toMatchObject({ ok: true, finish: 'length' });
    for (const reason of ['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT', 'BLOCKLIST']) {
      expect(geminiAdapter.parseResponse(200, ok([], reason))).toMatchObject({ ok: true, finish: 'refusal' });
    }
    expect(geminiAdapter.parseResponse(200, ok([{ text: 'x' }], 'OTHER'))).toMatchObject({ ok: true, finish: 'other' });
  });

  it('promptFeedback.blockReason이 있으면 refusal, 텍스트가 없으면 AI_BAD_RESPONSE', () => {
    expect(geminiAdapter.parseResponse(200, { promptFeedback: { blockReason: 'SAFETY' } })).toMatchObject({ ok: true, finish: 'refusal' });
    expect(geminiAdapter.parseResponse(200, ok([{ thoughtSignature: 'x' }]))).toMatchObject({ ok: false, error: { code: 'AI_BAD_RESPONSE' } });
  });

  it('오류 매핑: 401 UNAUTHENTICATED→AI_AUTH(실측 본문)', () => {
    const r = geminiAdapter.parseResponse(401, err(401, 'UNAUTHENTICATED', 'API key not valid. Please pass a valid API key.'));
    expect(r).toMatchObject({ ok: false, error: { code: 'AI_AUTH', retryable: false, provider: 'gemini', status: 401 } });
  });

  it('오류 매핑: 404 NOT_FOUND→AI_BAD_REQUEST + 안내와 서버 메시지', () => {
    const r = geminiAdapter.parseResponse(404, err(404, 'NOT_FOUND', 'models/x is not found for API version v1beta'));
    expect(r).toMatchObject({ ok: false, error: { code: 'AI_BAD_REQUEST', retryable: false } });
    const m = (r as { error: { message: string } }).error.message;
    expect(m).toContain('모델을 쓸 수 없습니다. 다른 모델을 고르세요');
    expect(m).toContain('models/x is not found');
  });

  it('오류 매핑: RESOURCE_EXHAUSTED→AI_QUOTA(비재시도), 그 외 429→AI_RATE_LIMIT(재시도), 400 API_KEY_INVALID·403→AI_AUTH, 500·503→AI_OVERLOADED', () => {
    expect(geminiAdapter.parseResponse(429, err(429, 'RESOURCE_EXHAUSTED', 'quota'))).toMatchObject({ ok: false, error: { code: 'AI_QUOTA', retryable: false } });
    expect(geminiAdapter.parseResponse(429, err(429, 'UNAVAILABLE', 'slow down'))).toMatchObject({ ok: false, error: { code: 'AI_RATE_LIMIT', retryable: true } });
    expect(geminiAdapter.parseResponse(400, { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'bad', details: [{ reason: 'API_KEY_INVALID' }] } })).toMatchObject({ error: { code: 'AI_AUTH' } });
    expect(geminiAdapter.parseResponse(403, err(403, 'PERMISSION_DENIED', 'no'))).toMatchObject({ error: { code: 'AI_AUTH' } });
    expect(geminiAdapter.parseResponse(400, err(400, 'INVALID_ARGUMENT', 'bad schema'))).toMatchObject({ error: { code: 'AI_BAD_REQUEST' } });
    for (const s of [500, 503]) expect(geminiAdapter.parseResponse(s, err(s, 'UNAVAILABLE', 'x'))).toMatchObject({ error: { code: 'AI_OVERLOADED', retryable: true } });
  });

  it('listModels: generateContent 지원만 남기고 models/ 접두와 제외 단어(tts·image·gemma 등)를 뺀다, 키는 헤더로만', async () => {
    let seen: { url: string; headers: Record<string, string> } | undefined;
    const g = ['generateContent'];
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen = { url, headers: init.headers as Record<string, string> };
      return new Response(JSON.stringify({ models: [
        { name: 'models/gemini-3.5-flash', displayName: 'Gemini 3.5 Flash', supportedGenerationMethods: g },
        { name: 'models/gemini-3.5-flash-lite', displayName: 'Gemini 3.5 Flash-Lite', supportedGenerationMethods: [...g, 'countTokens'] },
        { name: 'models/text-embedding-9', displayName: 'Embedding', supportedGenerationMethods: ['embedContent'] },
        { name: 'models/gemini-3-flash-preview-tts', supportedGenerationMethods: g },
        { name: 'models/gemini-3-pro-image-preview', supportedGenerationMethods: g },
        { name: 'models/nano-banana-pro', supportedGenerationMethods: g },
        { name: 'models/gemma-4-27b-it', supportedGenerationMethods: g },
        { name: 'models/lyria-3', supportedGenerationMethods: g },
        { name: 'models/deep-research-pro', supportedGenerationMethods: g },
        { name: 'models/gemini-robotics-er', supportedGenerationMethods: g },
        { name: 'models/gemini-computer-use-1', supportedGenerationMethods: g },
        { name: 'models/gemini-x-transcribe', supportedGenerationMethods: g },
      ] }), { status: 200 });
    }) as unknown as typeof fetch;
    const list = await geminiAdapter.listModels(KEY, fetchFn);
    expect(list).toEqual([
      { id: 'gemini-3.5-flash', displayName: 'Gemini 3.5 Flash' },
      { id: 'gemini-3.5-flash-lite', displayName: 'Gemini 3.5 Flash-Lite' },
    ]);
    expect(seen!.url).toBe('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200');
    expect(seen!.headers['x-goog-api-key']).toBe(KEY);
    expect(seen!.url).not.toContain(KEY);
  });

  it('listModels 오류는 code를 달아 던진다', async () => {
    const bad = (async () => new Response(JSON.stringify(err(401, 'UNAUTHENTICATED', 'API key not valid.')), { status: 401 })) as unknown as typeof fetch;
    await expect(geminiAdapter.listModels(KEY, bad)).rejects.toMatchObject({ code: 'AI_AUTH' });
  });

  it('메타: 원점·웹 URL·수동 상한', () => {
    expect(geminiAdapter).toMatchObject({ id: 'gemini', apiOrigin: 'https://generativelanguage.googleapis.com', webUrl: 'https://gemini.google.com/app', manualMaxChars: 30_000 });
  });
});
