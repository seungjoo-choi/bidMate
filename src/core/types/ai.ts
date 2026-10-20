import type { ISODate } from './common';
import type { AiRunSummary } from '../ai/summary';
import type { EvidenceRef, ExtractionKey } from './extraction';

export type AiProvider = 'claude' | 'openai' | 'gemini';
export type AiMode = 'api' | 'manual';
/** auto(확인 필요가 있으면 그것만, 없으면 전체)와 keys(지정 항목만)는 요청 전용이다. 저장된 run의 scope는 pending | all | keys */
export type AiScope = 'pending' | 'all' | 'auto' | 'keys';
export type AiRunStatus = 'awaiting' | 'requesting' | 'done' | 'failed' | 'cancelled'; // awaiting = 반자동 답변 대기
export type AiRejectReason = 'quote_missing' | 'quote_too_short' | 'quote_not_found' | 'bad_format' | 'unknown_key' | 'file_not_found';
export type AiErrorCode =
  | 'AI_KEY_MISSING' | 'AI_MODEL_MISSING' | 'AI_PERMISSION_MISSING' | 'AI_MODE_MISMATCH'
  | 'AI_AUTH' | 'AI_RATE_LIMIT' | 'AI_QUOTA' | 'AI_OVERLOADED' | 'AI_BAD_REQUEST' | 'AI_HTTP'
  | 'AI_REFUSED' | 'AI_TRUNCATED' | 'AI_NETWORK' | 'AI_TIMEOUT'
  | 'AI_BAD_RESPONSE' | 'AI_RUN_MISMATCH' | 'AI_CLIPBOARD_IS_PROMPT' | 'AI_RUN_CLOSED'
  | 'AI_SUGGESTION_INVALID' | 'AI_STALE'
  | 'AI_RUN_BUSY' | 'NOTHING_TO_REVIEW' | 'NO_DOCUMENTS' | 'AI_INTERRUPTED' | 'AI_BATCH_BUSY'; // 공고당 실행 1개 초과 / 대상 항목 0개 / 읽을 문서 없음

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
export type AiRuleRelation = 'in_candidates' | 'differs_from_candidates' | 'no_candidates';
/** raw: AI가 준 원문 표기(금액·기간, 환산 전). 화면에서 환산값과 함께 보여 준다. */
export interface AiVariant { condition: string; value: unknown; raw?: string; quote: string; file?: string; page?: number | null; evidence?: EvidenceRef; valueInQuote: boolean }
export interface AiSuggestion {
  key: ExtractionKey; value: unknown | null; raw?: string; quote: string; note?: string; file?: string; page?: number | null;
  evidence?: EvidenceRef;   // 검증 성공 시 코드가 생성. ruleId `ai:<provider>:<promptVersion>`, location `line N`
  verdict: 'match' | 'differs' | 'new' | 'none' | 'multi'; // multi = value null + 검증 통과 variants ≥ 1
  /** 조건별 값. 검증 통과분만(구 run에는 없음) */
  variants?: AiVariant[];
  /** 규칙 후보와의 비교(구 run에는 없음) */
  ruleRelation?: AiRuleRelation;
  baseline: unknown | null; // 비교 당시 효과값(userEdited.value 우선, 없으면 item.value)
  valueInQuote: boolean;    // false면 경고만
  appliedAt?: ISODate; dismissedAt?: ISODate;
}
export interface AiRunState { // storage.session `aiRun.<noticeId>`
  noticeId: string; runId: string; provider: AiProvider;
  status: 'preparing' | 'requesting' | 'verifying' | 'done' | 'failed' | 'cancelled';
  label: string; at: ISODate; error?: { code: AiErrorCode; message: string };
}
export interface OutputSpec { tag: typeof AI_SCHEMA_TAG; runId: string; keys: ExtractionKey[]; kindOf: Record<ExtractionKey, 'number' | 'string' | 'boolean'> }
export const AI_RUN_SESSION_PREFIX = 'aiRun.';
export const AI_SCHEMA_TAG = 'bidmate-ai-review/2';
/** 파서가 받아들이는 태그(저장된 v1 응답 리플레이용 포함) */
export const AI_SCHEMA_TAGS_ACCEPTED: readonly string[] = ['bidmate-ai-review/1', AI_SCHEMA_TAG];
export const AI_MAX_VARIANTS = 8;
export const AI_MAX_RUNS = 10;

// ---- 일괄 실행(여러 공고를 순차로). 상태에는 키·제목·프롬프트를 넣지 않는다(UI가 noticeId로 제목을 붙인다).
export type AiBatchItemStatus = 'queued' | 'running' | 'done' | 'failed' | 'skipped';
/** item.error.code에는 AiErrorCode 외에 AI_BATCH_CANCELLED · AI_BATCH_STOPPED · AI_ALREADY_RAN도 쓴다 */
export interface AiBatchItem { noticeId: string; status: AiBatchItemStatus; attempts: number; runId?: string; summary?: AiRunSummary; error?: { code: string; message: string } }
export interface AiBatchState {
  batchId: string; provider: AiProvider; model: string;
  status: 'running' | 'waiting' | 'done' | 'stopped' | 'cancelled';
  startedAt: ISODate; updatedAt: ISODate; finishedAt?: ISODate;
  items: AiBatchItem[]; currentIndex?: number; waitUntil?: ISODate;
  stopReason?: { code: string; message: string };
}
export const AI_BATCH_SESSION_KEY = 'aiBatch';
export const AI_BATCH_MAX = 50;
export const AI_BATCH_GAP_MS = 2_000;
export const AI_BATCH_RATE_WAIT_MS = 60_000;
export const AI_BATCH_OVERLOAD_STOP = 3;
