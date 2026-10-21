import type { DocFormat } from '../doc/model';
import type { DocKind } from '../extraction/classify';
import type { AiProvider } from './ai';
import type { ISODate } from './common';

/** 추출 규칙이 바뀌면 올린다. 캐시된 RequirementSet은 버전이 다르면 다시 추출한다. */
export const RFP_EXTRACTOR_VERSION = 2; /* 2: 중첩 표를 행 단위(칸=탭)로 */

export type RfpDocRef =
  | { kind: 'notice'; noticeId: string; attachmentId: string; innerPath?: string } /* innerPath: zip 내부 경로 */
  | { kind: 'upload'; uploadId: string };

export type RequirementForm = 'card' | 'list' | 'para';
export interface RequirementItem {
  id: string; /* 원문 표기 "SFR-01" */
  key: string; /* 정규화 "SFR-001" */
  prefix: string; seq: number; sub?: number;
  name: string; category?: string; definition?: string; detail?: string;
  extras?: Array<{ label: string; text: string }>; /* 산출정보, 관련요구사항 등 */
  form: RequirementForm;
  loc: { line: number; page?: number; table?: number }; /* 렌더 텍스트 줄(0부터) */
  dupCount?: number; /* 같은 key가 여러 곳(요약표+카드)에 있었음 */
}
export type RfpQuality = 'good' | 'partial' | 'none';
export interface RequirementSetBody {
  items: RequirementItem[];
  prefixes: Array<{ prefix: string; label?: string; count: number }>;
  quality: RfpQuality;
  warnings: string[];
  stats: { tables: number; cardTables: number; listTables: number; paraItems: number; idLikeUnparsed: number };
}
export interface RequirementSet extends RequirementSetBody {
  schemaVersion: 1; extractorVersion: number; ref: RfpDocRef; extractedAt: ISODate;
  source: { name: string; format: DocFormat; size: number; pages?: number; textPath: string };
  ms: number;
}

export interface RfpUploadEntry { uploadId: string; name: string; label?: string; size: number; format: DocFormat; uploadedAt: ISODate; itemCount: number; quality: RfpQuality }
export interface RfpDocCandidate {
  ref: Extract<RfpDocRef, { kind: 'notice' }>; name: string; docKind: DocKind;
  status: 'ready' | 'parse_needed' | 'unsupported'; itemCount?: number; quality?: RfpQuality;
}

export type RfpPairOverride = { op: 'pair' | 'unpair'; prevKey: string; nextKey: string };
export interface RfpCompareSession {
  schemaVersion: 1; id: string; createdAt: ISODate; updatedAt: ISODate;
  prev: { ref: RfpDocRef; title: string; subtitle?: string }; /* 표시용 제목은 저장 시점 스냅샷 */
  next: { ref: RfpDocRef; title: string; subtitle?: string };
  overrides: RfpPairOverride[];
  reviewed: string[]; /* 확인함 pair key */
  ai?: RfpAiSummary[]; /* 최신이 마지막 */
  /** 최근 비교 목록 표시용 스냅샷. 대시보드가 계산해 저장할 때 같이 넣는다(권위 아님). */
  summary?: { counts: Record<RfpPairStatus, number>; reviewTotal: number };
}
export interface RfpCompareEntry {
  id: string; createdAt: ISODate; updatedAt: ISODate; prevTitle: string; nextTitle: string;
  reviewedCount: number; summary?: RfpCompareSession['summary'];
}

// ── 계산 결과(저장 안 함) ──
export type RfpPairStatus = 'same' | 'changed' | 'added' | 'removed';
/**
 * renumbered 번호 바뀜 / numeric 수치 바뀜 / minor 몇 글자 바뀜 / major 본문 대폭 변경 /
 * weak 번호로 짝지었지만 다른 항목일 수 있음 / format 띄어쓰기·문장부호만 다름 /
 * number_only 내용은 같고 번호만 바뀜(changed) /
 * split·merged 나뉨·합쳐짐 / id_collision 같은 번호, 다른 내용(짝 안 지음)
 */
export type RfpPairTag = 'renumbered' | 'number_only' | 'numeric' | 'minor' | 'major' | 'weak' | 'format' | 'split' | 'merged' | 'id_collision';
export interface RfpPair {
  key: string; /* `${prevKey ?? '-'}|${nextKey ?? '-'}` */
  status: RfpPairStatus; prev?: RequirementItem; next?: RequirementItem;
  matchedBy?: 'id' | 'similarity' | 'manual'; score?: number;
  tags: RfpPairTag[];
  /** split: 이번 항목이 이전 항목(keys)에서 나뉨 / merged: 이전 항목이 이번 항목(keys)으로 합쳐짐 */
  group?: { kind: 'split' | 'merged'; keys: string[] };
}
export interface RfpCompareResult { pairs: RfpPair[]; counts: Record<RfpPairStatus, number>; prefixes: string[] }

export type DiffSegment = { op: 'eq' | 'ins' | 'del'; text: string; fine?: boolean /* 글자 단위로 다시 쪼갠 조각 */ };
export type LineOp =
  | { op: 'eq'; prev: string; next: string }
  | { op: 'del'; prev: string }
  | { op: 'ins'; next: string }
  | { op: 'mod'; prev: string; next: string; segs: DiffSegment[] };

export interface RfpAiInput {
  scope: 'changed' | 'selected'; prevTitle: string; nextTitle: string;
  items: Array<{ key: string; status: RfpPairStatus; prevId?: string; nextId?: string; name: string; text: string }>;
  chars: number; truncated: boolean; omitted: number;
}
export interface RfpAiSummary {
  id: string; at: ISODate; provider: AiProvider; model: string; scope: RfpAiInput['scope']; selectedKey?: string;
  overall: string; highlights: Array<{ key: string; summary: string; impact: 'high' | 'medium' | 'low' }>; risks: string[];
  usage?: { inputTokens: number; outputTokens: number };
}
