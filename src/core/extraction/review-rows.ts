import { getField } from '../model/notice-fields';
import { sameKey } from '../model/merge';
import type { Notice } from '../types/notice';
import { EXTRACTION_KEYS, type Extraction, type ExtractionKey } from '../types/extraction';
import { NA_NOTE, fieldReviewState, isNaNote, itemReviewState, naNoteOf } from './review-count';

export type ReviewLeafKey =
  | 'postedAt' | 'registrationDeadline' | 'proposalPeriod' | 'proposalEvalAt' | 'budgetAmount' | 'projectPeriod'
  | 'evalMethod' | 'differentialScoring' | 'credibilityScore' | 'managementScore'
  | 'performanceScore' | 'performancePeriod' | 'performanceMinAmount' | 'performanceCondition'
  | 'jointVentureAllowed' | 'priceMethod';
export type ReviewRowKey = Exclude<ReviewLeafKey, 'performancePeriod' | 'performanceMinAmount' | 'performanceCondition'>;

export const REVIEW_ROWS: ReadonlyArray<{ key: ReviewRowKey; sub?: ReviewLeafKey[] }> = [
  { key: 'postedAt' }, { key: 'registrationDeadline' }, { key: 'proposalPeriod' }, { key: 'proposalEvalAt' },
  { key: 'budgetAmount' }, { key: 'projectPeriod' }, { key: 'evalMethod' }, { key: 'differentialScoring' },
  { key: 'credibilityScore' }, { key: 'managementScore' },
  { key: 'performanceScore', sub: ['performancePeriod', 'performanceMinAmount', 'performanceCondition'] },
  { key: 'jointVentureAllowed' }, { key: 'priceMethod' },
];
export const REVIEW_LEAF_KEYS: ReviewLeafKey[] = REVIEW_ROWS.flatMap((r) => [r.key as ReviewLeafKey, ...(r.sub ?? [])]);

export const REVIEW_LABEL: Record<ReviewLeafKey, string> = {
  postedAt: '공고게시일시', registrationDeadline: '입찰참가자격등록 마감', proposalPeriod: '제안서 제출기간', proposalEvalAt: '제안서 평가일자',
  budgetAmount: '사업금액', projectPeriod: '사업기간', evalMethod: '평가방법', differentialScoring: '차등점수제',
  credibilityScore: '대외신인도 배점', managementScore: '경영상태 배점', performanceScore: '수행실적 배점',
  performancePeriod: '실적 인정기간', performanceMinAmount: '실적 인정금액', performanceCondition: '실적 인정조건',
  jointVentureAllowed: '공동수급 여부', priceMethod: '예가방법',
};
export const REVIEW_ROW_LABEL: Partial<Record<ReviewRowKey, string>> = { performanceScore: '실적점수 평가' };

export type ReviewValueKind = 'score' | 'period' | 'amount' | 'text' | 'bool' | 'datetime' | 'joint';
export const REVIEW_KIND: Record<ReviewLeafKey, ReviewValueKind> = {
  postedAt: 'datetime', registrationDeadline: 'datetime', proposalEvalAt: 'datetime',
  budgetAmount: 'amount', jointVentureAllowed: 'joint',
  proposalPeriod: 'text', projectPeriod: 'text', evalMethod: 'text', priceMethod: 'text',
  credibilityScore: 'score', managementScore: 'score', performanceScore: 'score', performancePeriod: 'period',
  performanceMinAmount: 'amount', performanceCondition: 'text', differentialScoring: 'bool',
};

export const isExtractionLeaf = (k: ReviewLeafKey): k is ExtractionKey => (EXTRACTION_KEYS as string[]).includes(k);
export const NOT_RUN_TEXT = '이전 버전 결과, 다시 수집 필요';

export type LeafState = 'verified' | 'needs_review' | 'user_edited' | 'covered' | 'not_applicable' | 'not_run';
export interface LeafJudgement { state: LeafState; reason?: string; value: unknown; editedOrigin?: 'ai' | 'confirm' }

const isNil = (v: unknown): boolean => v === null || v === undefined;

export function leafReviewState(notice: Notice, x: Extraction | null, key: ReviewLeafKey): LeafJudgement {
  if (isExtractionLeaf(key)) {
    const item = x?.items[key];
    if (x && item) {
      const state = itemReviewState(x.items, key);
      const value = item.userEdited?.value ?? item.value;
      const j: LeafJudgement = { state, value };
      if (state === 'not_run') j.reason = NOT_RUN_TEXT;
      if (state === 'not_applicable') j.reason = naNoteOf(item);
      if (state === 'user_edited') {
        if (item.userEdited?.origin?.kind === 'ai') j.editedOrigin = 'ai';
        else if (sameKey(item.userEdited?.value) === sameKey(item.value)) j.editedOrigin = 'confirm';
      }
      return j;
    }
    if (!x) {
      const f = getField(notice, key);
      if (f?.status === 'user_edited') return { state: 'user_edited', value: f.value };
      return { state: 'not_run', reason: '문서 분석 전', value: null };
    }
    // 추출은 있는데 이 항목이 없음(이전 버전 추출). pendingKeys와 같게 세지 않고, 다시 추출을 안내한다
    return { state: 'not_run', reason: NOT_RUN_TEXT, value: null };
  }
  const f = getField(notice, key);
  if (!f) return { state: 'needs_review', reason: '공고정보에 값 없음', value: null };
  const s = fieldReviewState(f, x, key);
  switch (s) {
    case 'user_edited': {
      const j: LeafJudgement = { state: 'user_edited', value: f.value };
      const before = f.userEdit?.before;
      if (f.source?.ref?.startsWith('ai:')) j.editedOrigin = 'ai';
      else if (before && sameKey(f.value) === sameKey(before.value)) j.editedOrigin = 'confirm';
      return j;
    }
    case 'verified': return { state: 'verified', value: f.value };
    case 'covered': return { state: 'covered', value: f.value };
    case 'not_applicable': return { state: 'not_applicable', reason: isNaNote(f.note) ? f.note! : NA_NOTE, value: f.value };
    case 'needs_review': return { state: 'needs_review', reason: f.note ?? '출처별 값이 서로 다름', value: f.value };
    case 'not_run': return { state: 'not_run', value: f.value };
    default: return { state: 'needs_review', reason: '공고정보에 값 없음', value: null };
  }
}

const ROW_PRIORITY: LeafState[] = ['needs_review', 'not_run', 'user_edited', 'covered', 'not_applicable', 'verified'];
export function rowStateOf(leaves: LeafState[]): LeafState {
  return ROW_PRIORITY.find((s) => leaves.includes(s)) ?? 'verified';
}

export function pendingLeafKeys(notice: Notice, x: Extraction | null): ReviewLeafKey[] {
  return REVIEW_LEAF_KEYS.filter((k) => leafReviewState(notice, x, k).state === 'needs_review');
}
export const noticeReviewCount = (n: Notice, x: Extraction | null): number => pendingLeafKeys(n, x).length;

export function rowKeyOf(leaf: ReviewLeafKey): ReviewRowKey {
  return REVIEW_ROWS.find((r) => r.key === leaf || r.sub?.includes(leaf))!.key;
}
