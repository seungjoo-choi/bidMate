import type { AiErrorCode } from '../../../core/types/ai';
import { outputSchema } from './schema';
import type { AiError, AiParsedResponse, AiProviderAdapter } from './types';

// S0 실측 전: 엔드포인트·헤더·요청/응답/오류 형태는 명세 §4 표의 1차 후보(chat/completions)이며 실측 후 이 파일 안에서만 고친다.
const ORIGIN = 'https://api.openai.com';

function httpError(status: number, json: unknown): AiError {
  // S0 실측 전: 오류 본문 형태(error.code, error.message)
  const e = (json as { error?: { code?: string; message?: string } } | null)?.error;
  const msg = typeof e?.message === 'string' ? e.message : `HTTP ${status}`;
  const mk = (code: AiErrorCode, retryable = false): AiError => ({ code, message: msg, retryable, provider: 'openai', status });
  if (status === 401 || status === 403) return mk('AI_AUTH');
  if (status === 429) return e?.code === 'insufficient_quota' ? mk('AI_QUOTA') : mk('AI_RATE_LIMIT', true);
  if (status === 500 || status === 503) return mk('AI_OVERLOADED', true);
  if (status === 400 || status === 404 || status === 413 || status === 422) return mk('AI_BAD_REQUEST');
  return mk('AI_HTTP', status >= 500);
}

export const openaiAdapter: AiProviderAdapter = {
  id: 'openai', label: 'OpenAI', apiOrigin: ORIGIN, webUrl: 'https://chatgpt.com/', manualMaxChars: 30_000,
  buildRequest(r) {
    // S0 실측 전: response_format json_schema(strict), max_completion_tokens
    return {
      url: `${ORIGIN}/v1/chat/completions`,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${r.apiKey}` },
      body: {
        model: r.model, temperature: 0, max_completion_tokens: r.maxTokens,
        messages: [{ role: 'system', content: r.system }, { role: 'user', content: r.user }],
        response_format: { type: 'json_schema', json_schema: { name: 'bidmate_ai_review', schema: outputSchema(r.spec), strict: true } },
      },
    };
  },
  parseResponse(status, json): AiParsedResponse {
    if (status < 200 || status >= 300) return { ok: false, error: httpError(status, json) };
    // S0 실측 전: 응답 형태(choices[0].message.content/refusal, finish_reason, usage)
    const j = json as {
      choices?: Array<{ message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    } | null;
    const usage = typeof j?.usage?.prompt_tokens === 'number' && typeof j.usage.completion_tokens === 'number'
      ? { inputTokens: j.usage.prompt_tokens, outputTokens: j.usage.completion_tokens } : undefined;
    const c = j?.choices?.[0];
    const text = typeof c?.message?.content === 'string' ? c.message.content : '';
    const reason = c?.finish_reason;
    const finish = c?.message?.refusal || reason === 'content_filter' ? 'refusal' : reason === 'stop' ? 'stop' : reason === 'length' ? 'length' : 'other';
    if (finish === 'refusal') return { ok: true, text, ...(usage ? { usage } : {}), finish };
    if (!text) return { ok: false, error: { code: 'AI_BAD_RESPONSE', message: '응답에 텍스트가 없습니다.', retryable: false, provider: 'openai', status } };
    return { ok: true, text, ...(usage ? { usage } : {}), finish };
  },
  async listModels(apiKey, fetchFn) {
    // S0 실측 전: GET /v1/models 응답 형태(data[].id). gpt·o 접두 모델만 남긴다.
    const res = await fetchFn(`${ORIGIN}/v1/models`, { headers: { authorization: `Bearer ${apiKey}` } });
    const json = (await res.json().catch(() => null)) as { data?: Array<{ id?: string }> } | null;
    if (!res.ok) {
      const err = httpError(res.status, json);
      throw Object.assign(new Error(err.message), { code: err.code });
    }
    return (json?.data ?? []).filter((m) => typeof m.id === 'string' && /^(gpt|o\d)/.test(m.id)).map((m) => ({ id: m.id as string }));
  },
};
