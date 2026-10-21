import type { AiErrorCode } from '../../../core/types/ai';
import type { AiBuildRequestInput, AiError, AiParsedResponse, AiProviderAdapter } from './types';

// S0 실측 전: 엔드포인트·헤더·요청/응답 형태는 명세 §4 표 그대로이며 실측 후 이 파일 안에서만 고친다.
const ORIGIN = 'https://api.anthropic.com';
const COMMON_HEADERS = { 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true', 'content-type': 'application/json' };

function httpError(status: number, json: unknown): AiError {
  const e = (json as { error?: { type?: string; message?: string } } | null)?.error;
  const msg = typeof e?.message === 'string' ? e.message : `HTTP ${status}`;
  let code: AiErrorCode = 'AI_HTTP';
  let retryable = false;
  if (status === 401 || status === 403) code = 'AI_AUTH';
  else if (status === 429) { code = 'AI_RATE_LIMIT'; retryable = true; }
  else if (status === 529 || status === 503) { code = 'AI_OVERLOADED'; retryable = true; }
  else if (status === 400 || status === 404 || status === 413 || status === 422) code = 'AI_BAD_REQUEST';
  else if (status >= 500) retryable = true;
  return { code, message: msg, retryable, provider: 'claude', status };
}

export const claudeAdapter: AiProviderAdapter = {
  id: 'claude', label: 'Claude', apiOrigin: ORIGIN, webUrl: 'https://claude.ai/new', manualMaxChars: 30_000,
  buildRequest(r) {
    // S0 실측 전: output_config.format 파라미터 형태
    return {
      url: `${ORIGIN}/v1/messages`,
      headers: { ...COMMON_HEADERS, 'x-api-key': r.apiKey },
      body: {
        // temperature는 보내지 않는다: Sonnet 5.5·Opus 5.5·Fable 5.1·Haiku 5.5는 기본값 외 sampling 값을 400으로 거부한다
        model: r.model, max_tokens: r.maxTokens,
        system: r.system,
        messages: [{ role: 'user', content: r.user }],
        output_config: { format: { type: 'json_schema', schema: r.schema } },
      },
    };
  },
  parseResponse(status, json): AiParsedResponse {
    if (status < 200 || status >= 300) return { ok: false, error: httpError(status, json) };
    // S0 실측 전: 응답 형태(content[].text, stop_reason, usage)
    const j = json as { content?: Array<{ type?: string; text?: string }>; stop_reason?: string; usage?: { input_tokens?: number; output_tokens?: number } } | null;
    const text = (j?.content ?? []).filter((c) => typeof c?.text === 'string').map((c) => c.text as string).join('');
    const reason = j?.stop_reason;
    const finish = reason === 'end_turn' || reason === 'stop_sequence' ? 'stop' : reason === 'max_tokens' ? 'length' : reason === 'refusal' ? 'refusal' : 'other';
    const usage = j?.usage && typeof j.usage.input_tokens === 'number' && typeof j.usage.output_tokens === 'number'
      ? { inputTokens: j.usage.input_tokens, outputTokens: j.usage.output_tokens } : undefined;
    if (finish === 'refusal') return { ok: true, text, ...(usage ? { usage } : {}), finish };
    if (!text) return { ok: false, error: { code: 'AI_BAD_RESPONSE', message: '응답에 텍스트가 없습니다.', retryable: false, provider: 'claude', status } };
    return { ok: true, text, ...(usage ? { usage } : {}), finish };
  },
  async listModels(apiKey, fetchFn) {
    // S0 실측 전: GET /v1/models 응답 형태(data[].id, display_name)
    // 기본 페이지 크기는 20개라 최대치(1000)로 한 번에 받는다
    const res = await fetchFn(`${ORIGIN}/v1/models?limit=1000`, { headers: { ...COMMON_HEADERS, 'x-api-key': apiKey } });
    const json = (await res.json().catch(() => null)) as { data?: Array<{ id?: string; display_name?: string }> } | null;
    if (!res.ok) {
      const err = httpError(res.status, json);
      throw Object.assign(new Error(err.message), { code: err.code });
    }
    return (json?.data ?? []).filter((m) => typeof m.id === 'string').map((m) => ({ id: m.id as string, ...(m.display_name ? { displayName: m.display_name } : {}) }));
  },
};
