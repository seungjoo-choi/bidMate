import type { AiErrorCode } from '../../../core/types/ai';
import { outputSchema } from './schema';
import type { AiError, AiParsedResponse, AiProviderAdapter } from './types';

// 실측(S0, decisions.md "AI 공급자 실측"): x-goog-api-key 헤더, generateContent, responseJsonSchema(표준 JSON Schema),
// parts에 text와 thoughtSignature가 섞여 옴, thinkingLevel 'low'.
const ORIGIN = 'https://generativelanguage.googleapis.com';
const HEADERS = { 'content-type': 'application/json' };
/** 이름에 들어 있으면 목록에서 뺀다(TTS·이미지·음악·로보틱스·에이전트 등 이 용도에 맞지 않는 모델) */
const EXCLUDED_MODEL_WORDS = ['tts', 'image', 'banana', 'lyria', 'transcribe', 'robotics', 'computer-use', 'deep-research', 'antigravity', 'omni', 'customtools', 'gemma'];
const REFUSAL_REASONS = new Set(['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT', 'BLOCKLIST']);

function httpError(status: number, json: unknown): AiError {
  const e = (json as { error?: { status?: string; message?: string; details?: Array<{ reason?: string }> } } | null)?.error;
  const msg = typeof e?.message === 'string' ? e.message : `HTTP ${status}`;
  const st = e?.status;
  const mk = (code: AiErrorCode, message: string, retryable = false): AiError => ({ code, message, retryable, provider: 'gemini', status });
  if (status === 401 || status === 403 || st === 'UNAUTHENTICATED' || st === 'PERMISSION_DENIED') return mk('AI_AUTH', msg);
  if (status === 400 && (e?.details?.some((d) => d.reason === 'API_KEY_INVALID') || /API key not valid/i.test(msg))) return mk('AI_AUTH', msg); // 미실측, 방어용
  if (status === 404) return mk('AI_BAD_REQUEST', `모델을 쓸 수 없습니다. 다른 모델을 고르세요 (${msg})`);
  // S0 미확인: 429 본문 형태
  if (status === 429) return st === 'RESOURCE_EXHAUSTED' ? mk('AI_QUOTA', msg) : mk('AI_RATE_LIMIT', msg, true);
  if (status === 500 || status === 503) return mk('AI_OVERLOADED', msg, true);
  if (status === 400 || status === 413 || status === 422) return mk('AI_BAD_REQUEST', msg);
  return mk('AI_HTTP', msg, status >= 500);
}

export const geminiAdapter: AiProviderAdapter = {
  id: 'gemini', label: 'Gemini', apiOrigin: ORIGIN, webUrl: 'https://gemini.google.com/app', manualMaxChars: 30_000,
  buildRequest(r) {
    return {
      url: `${ORIGIN}/v1beta/models/${encodeURIComponent(r.model)}:generateContent`,
      headers: { ...HEADERS, 'x-goog-api-key': r.apiKey },
      body: {
        systemInstruction: { parts: [{ text: r.system }] },
        contents: [{ role: 'user', parts: [{ text: r.user }] }],
        generationConfig: {
          temperature: 0, maxOutputTokens: r.maxTokens,
          responseMimeType: 'application/json', responseJsonSchema: outputSchema(r.spec),
          thinkingConfig: { thinkingLevel: 'low' },
        },
      },
    };
  },
  parseResponse(status, json): AiParsedResponse {
    if (status < 200 || status >= 300) return { ok: false, error: httpError(status, json) };
    const j = json as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: unknown; thought?: boolean }> }; finishReason?: string }>;
      promptFeedback?: { blockReason?: string };
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    } | null;
    const usage = typeof j?.usageMetadata?.promptTokenCount === 'number' && typeof j.usageMetadata.candidatesTokenCount === 'number'
      ? { inputTokens: j.usageMetadata.promptTokenCount, outputTokens: j.usageMetadata.candidatesTokenCount } : undefined;
    if (j?.promptFeedback?.blockReason) return { ok: true, text: '', ...(usage ? { usage } : {}), finish: 'refusal' };
    const cand = j?.candidates?.[0];
    // text 파트만 이어 붙인다(thoughtSignature 파트·thought 파트 제외)
    const text = (cand?.content?.parts ?? []).filter((p) => typeof p?.text === 'string' && p.thought !== true).map((p) => p.text as string).join('');
    const reason = cand?.finishReason;
    const finish = reason === 'STOP' ? 'stop' : reason === 'MAX_TOKENS' ? 'length' : reason && REFUSAL_REASONS.has(reason) ? 'refusal' : 'other';
    if (finish === 'refusal') return { ok: true, text, ...(usage ? { usage } : {}), finish };
    if (!text) return { ok: false, error: { code: 'AI_BAD_RESPONSE', message: '응답에 텍스트가 없습니다.', retryable: false, provider: 'gemini', status } };
    return { ok: true, text, ...(usage ? { usage } : {}), finish };
  },
  async listModels(apiKey, fetchFn) {
    const res = await fetchFn(`${ORIGIN}/v1beta/models?pageSize=200`, { headers: { 'x-goog-api-key': apiKey } });
    const json = (await res.json().catch(() => null)) as { models?: Array<{ name?: string; displayName?: string; supportedGenerationMethods?: string[] }> } | null;
    if (!res.ok) {
      const err = httpError(res.status, json);
      throw Object.assign(new Error(err.message), { code: err.code });
    }
    return (json?.models ?? [])
      .filter((m) => typeof m.name === 'string' && m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => ({ id: (m.name as string).replace(/^models\//, ''), displayName: m.displayName }))
      .filter((m) => !EXCLUDED_MODEL_WORDS.some((w) => m.id.includes(w)))
      .map((m) => ({ id: m.id, ...(m.displayName ? { displayName: m.displayName } : {}) }));
  },
};
