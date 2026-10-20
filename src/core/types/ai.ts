import type { ISODate } from './common';
import type { EvidenceRef, ExtractionKey } from './extraction';

export type AiProvider = 'claude' | 'openai' | 'gemini';
export type AiMode = 'api' | 'manual';
export type AiScope = 'pending' | 'all';
export type AiRunStatus = 'awaiting' | 'requesting' | 'done' | 'failed' | 'cancelled'; // awaiting = 반자동 답변 대기
export type AiRejectReason = 'quote_missing' | 'quote_too_short' | 'quote_not_found' | 'bad_format' | 'unknown_key' | 'file_not_found';
export type AiErrorCode =
  | 'AI_KEY_MISSING' | 'AI_MODEL_MISSING' | 'AI_PERMISSION_MISSING' | 'AI_MODE_MISMATCH'
  | 'AI_AUTH' | 'AI_RATE_LIMIT' | 'AI_QUOTA' | 'AI_OVERLOADED' | 'AI_BAD_REQUEST' | 'AI_HTTP'
  | 'AI_REFUSED' | 'AI_TRUNCATED' | 'AI_NETWORK' | 'AI_TIMEOUT'
  | 'AI_BAD_RESPONSE' | 'AI_RUN_MISMATCH' | 'AI_CLIPBOARD_IS_PROMPT' | 'AI_RUN_CLOSED'
  | 'AI_SUGGESTION_INVALID' | 'AI_STALE'
  | 'AI_RUN_BUSY' | 'NOTHING_TO_REVIEW' | 'NO_DOCUMENTS' | 'AI_INTERRUPTED'; // 공고당 실행 1개 초과 / 대상 항목 0개 / 읽을 문서 없음

export interface AiReviewFile { schemaVersion: 1; noticeId: string; runs: AiRun[] } // 최신 먼저, 최대 AI_MAX_RUNS(10)
export interface AiRun {
  id: string; createdAt: ISODate; finishedAt?: ISODate;
  provider: AiProvider; mode: AiMode; model: string | null; // manual은 null
  promptVersion: string; scope: AiScope; keys: ExtractionKey[];
  extractionJobId: string; extractedAt: ISODate;            // 이 run이 본 extraction. 현재 jobId와 다르면 stale
  status: AiRunStatus;
  files: Array<{ attachmentId: string; sourceFile: string; name: string; chars: number; truncated: boolean }>;
  skipped: Array<{ name: string; reason: 'scanned' | 'unsupported' | 'encrypted' | 'drm' | 'failed' | 'unselected' }>;
  excerptChars: number; truncated: boolean;
  usage?: { inputTokens: number; outputTokens: number };
  error?: { code: AiErrorCode; message: string };
  warnings: string[];
  suggestions: Partial<Record<ExtractionKey, AiSuggestion>>;
  rejected: Array<{ key: string; reason: AiRejectReason; value?: unknown; quote?: string; file?: string }>;
  promptPath: string; responsePath?: string;               // `<folder>/ai/<runId>-prompt.txt`, `-response.txt`
}
export interface AiSuggestion {
  key: ExtractionKey; value: unknown | null; quote: string; note?: string; file?: string; page?: number | null;
  evidence?: EvidenceRef;   // 검증 성공 시 코드가 생성. ruleId `ai:<provider>:<promptVersion>`, location `line N`
  verdict: 'match' | 'differs' | 'new' | 'none';
  baseline: unknown | null; // 비교 당시 효과값(userEdited.value 우선, 없으면 item.value)
  valueInQuote: boolean;    // false면 경고만
  appliedAt?: ISODate; dismissedAt?: ISODate;
}
export interface AiRunState { // storage.session `aiRun.<noticeId>`
  noticeId: string; runId: string; provider: AiProvider;
  status: 'preparing' | 'requesting' | 'verifying' | 'done' | 'failed' | 'cancelled';
  label: string; at: ISODate; error?: { code: AiErrorCode; message: string };
}
export interface OutputSpec { tag: 'bidmate-ai-review/1'; runId: string; keys: ExtractionKey[]; kindOf: Record<ExtractionKey, 'number' | 'string' | 'boolean'> }
export const AI_RUN_SESSION_PREFIX = 'aiRun.';
export const AI_SCHEMA_TAG = 'bidmate-ai-review/1';
export const AI_MAX_RUNS = 10;
