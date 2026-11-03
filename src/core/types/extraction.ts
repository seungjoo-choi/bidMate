import type { ISODate } from './common';
import type { DocFormat } from '../doc/model';
import type { DocKind } from '../extraction/classify';
import type { AiProvider } from './ai';
import type { AttachmentOrigin } from './notice';

export type ExtractionStatus = 'verified' | 'needs_review' | 'unsupported' | 'failed' | 'not_run';
export type ExtractionKey =
  | 'credibilityScore' | 'managementScore' | 'performanceScore' | 'performancePeriod'
  | 'performanceMinAmount' | 'performanceCondition' | 'differentialScoring';
export const EXTRACTION_KEYS: ExtractionKey[] = [
  'credibilityScore', 'managementScore', 'performanceScore', 'performancePeriod',
  'performanceMinAmount', 'performanceCondition', 'differentialScoring',
];
export const EXTRACTION_SCHEMA_VERSION = 2 as const;
export interface EvidenceRef {
  attachmentId: string; sourceFile: string; page?: number; sheet?: string; location: string; line?: number;
  evidence: string; /* ≤300자 원문 */
  context?: string; /* ≤400자 */
  ruleId: string; docKind: DocKind;
  origin?: AttachmentOrigin;
}
export type NaKind = 'quant_table' | 'quant_none' | 'perf_aggregate' | 'small_quote' | 'qualified' | 'lowest_price';
export interface ExtractedItem<T> {
  value: T | null; raw?: string; status: ExtractionStatus;
  reason?: 'not_found' | 'conflict' | 'multi' | 'low_confidence' | 'no_documents' | 'no_total' | 'not_applicable';
  /** reason==='not_applicable'일 때 판정 근거 종류. 없으면 quant_table */
  naKind?: NaKind;
  evidence?: EvidenceRef;
  candidates?: Array<{ value: T; raw?: string; evidence: EvidenceRef }>;
  userEdited?: {
    value: T | null; editedAt: ISODate; note?: string;
    origin?: { kind: 'ai'; runId: string; provider: AiProvider; model: string | null; promptVersion: string };
  };
}
export type ExtractionFileStatus =
  | 'parsed' | 'unsupported' | 'encrypted' | 'drm' | 'scanned' | 'corrupt' | 'failed' | 'timeout' | 'skipped' | 'cancelled';
export interface ExtractionFile {
  attachmentId: string; name: string; innerPath?: string; docKind: DocKind; priority: number;
  origin?: AttachmentOrigin;
  format?: DocFormat | 'zip' | 'hwp3' | 'unknown';
  status: ExtractionFileStatus;
  skipReason?: 'excluded' | 'duplicate' | 'budget' | 'too_large' | 'not_saved' | 'unsupported_ext';
  pages?: number; chars?: number; tables?: number; ms?: number; textPath?: string; error?: string;
}
export interface Extraction {
  schemaVersion: 2; noticeId: string; jobId: string; extractedAt: ISODate; rulesVersion: string;
  status: ExtractionStatus;
  items: Record<ExtractionKey, ExtractedItem<unknown>>;
  extras: Record<string, ExtractedItem<unknown>>;
  files: ExtractionFile[]; warnings: string[];
}
