import type { AiErrorCode, AiProvider } from '../../../core/types/ai';

export interface AiError { code: AiErrorCode; message: string; retryable: boolean; provider: AiProvider; status?: number }

export interface AiBuildRequestInput { apiKey: string; model: string; system: string; user: string; schema: unknown; schemaName: string; maxTokens: number }
export interface AiBuiltRequest { url: string; headers: Record<string, string>; body: unknown }
export type AiParsedResponse =
  | { ok: true; text: string; usage?: { inputTokens: number; outputTokens: number }; finish: 'stop' | 'length' | 'refusal' | 'other' }
  | { ok: false; error: AiError };

/** 공급자별 순수 함수 묶음. 네트워크는 직접 하지 않는다(listModels만 fetch를 주입받는다). */
export interface AiProviderAdapter {
  id: AiProvider; label: string;
  /** 권한 요청·contains 검사 `${apiOrigin}/*` */
  apiOrigin: string;
  /** 반자동 탭 */
  webUrl: string;
  manualMaxChars: number;
  buildRequest(r: AiBuildRequestInput): AiBuiltRequest;
  parseResponse(status: number, json: unknown): AiParsedResponse;
  listModels(apiKey: string, fetch: typeof globalThis.fetch): Promise<Array<{ id: string; displayName?: string }>>;
}
