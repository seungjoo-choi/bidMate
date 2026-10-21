import type { FieldValue } from '../types/common';
import { EXTRACTION_KEYS, type Extraction, type ExtractedItem, type ExtractionKey, type NaKind } from '../types/extraction';

type Items = Record<ExtractionKey, ExtractedItem<unknown>>;

/** 같은 그룹 중 하나만 충족해도 다른 항목의 "문서에 없음"은 확인 필요로 세지 않는다(예: 대외신인도 평가 = 경영상태 또는 대외신인도). */
export const REVIEW_GROUPS: ExtractionKey[][] = [['credibilityScore', 'managementScore']];

const NO_VALUE_REASONS = new Set(['not_found', 'no_total', 'no_documents']);

/** 정량평가 표에 해당 항목이 없어 "해당 없음"으로 판정된 항목(값은 항상 null). */
export const NA_NOTES: Record<NaKind, string> = {
  quant_table: '정량평가 표에 해당 항목 없음',
  quant_none: '정량평가 없음',
  perf_aggregate: '건당 하한 없음, 실적 금액 합산 비율로 평가',
};
// 기존 값은 저장된 notice.json 판별에 쓰이므로 변경 금지
export const NA_NOTE = NA_NOTES.quant_table;
export const naKindOf = (it: ExtractedItem<unknown>): NaKind => it.naKind ?? 'quant_table';
export const naNoteOf = (it: ExtractedItem<unknown>): string => NA_NOTES[naKindOf(it)];
const NA_NOTE_SET = new Set<string>(Object.values(NA_NOTES));
export const isNaNote = (s?: string): boolean => !!s && NA_NOTE_SET.has(s);
export const NA_VALUE_TEXT = '해당 없음';
export const isNotApplicable = (it?: ExtractedItem<unknown>): boolean => !!it && it.status === 'verified' && it.reason === 'not_applicable';
export const isNotApplicableField = (f?: FieldValue<unknown>): boolean => !!f && f.status === 'verified' && f.value === null && isNaNote(f.note);

// 해당 없음은 같은 그룹의 다른 항목을 충족시키는 근거가 아니다.
const satisfiedItem = (it: ExtractedItem<unknown> | undefined): boolean => !!it && ((it.status === 'verified' && !isNotApplicable(it)) || it.userEdited !== undefined);

/** 이 항목을 충족시킨 같은 그룹의 다른 항목 키. 이 항목이 값 없음(not_found/no_total/no_documents)일 때만 찾는다. */
export function coveringKey(items: Partial<Items>, key: ExtractionKey): ExtractionKey | undefined {
  const it = items[key];
  if (!it || it.status !== 'needs_review' || it.userEdited !== undefined || !it.reason || !NO_VALUE_REASONS.has(it.reason)) return undefined;
  return REVIEW_GROUPS.filter((g) => g.includes(key)).flat().find((m) => m !== key && satisfiedItem(items[m]));
}

/** 이 항목이 값 없음이고, 같은 그룹의 다른 멤버가 충족이면 true. conflict/low_confidence는 해당 없음. */
export function coveredByGroup(items: Partial<Items>, key: ExtractionKey): boolean {
  return coveringKey(items, key) !== undefined;
}

/**
 * 평가 항목 검토 상태의 단일 판정. 화면, 개수, 추출 전체 상태가 모두 이 함수(또는 fieldReviewState)만 쓴다.
 * not_run: 추출 전이거나 needs_review/verified가 아닌 상태.
 */
export type ReviewState = 'verified' | 'not_applicable' | 'user_edited' | 'covered' | 'needs_review' | 'not_run';

/** 추출 항목 기준 상태. items에 그룹 멤버가 없으면 그룹 충족은 보지 않는다. */
export function itemReviewState(items: Partial<Items>, key: ExtractionKey): ReviewState {
  const it = items[key];
  if (!it) return 'not_run';
  if (it.userEdited !== undefined) return 'user_edited';
  if (isNotApplicable(it)) return 'not_applicable';
  if (it.status === 'verified') return 'verified';
  if (coveredByGroup(items, key)) return 'covered';
  return it.status === 'needs_review' ? 'needs_review' : 'not_run';
}

/** 공고 필드 기준 상태(개요 탭, 사이드패널). 그룹 충족은 추출 결과로 판정한다. missing은 값 없음. */
export function fieldReviewState(f: FieldValue<unknown>, x: Extraction | null, key: string): ReviewState | 'missing' {
  if (f.status === 'user_edited') return 'user_edited';
  if (isNotApplicableField(f) || (x && (EXTRACTION_KEYS as string[]).includes(key) && isNotApplicable(x.items[key as ExtractionKey]))) return 'not_applicable';
  if (f.status === 'verified') return 'verified';
  if (x && (EXTRACTION_KEYS as string[]).includes(key) && coveredByGroup(x.items, key as ExtractionKey)) return 'covered';
  return f.status;
}

/**
 * 추출 결과 없이 공고 필드만으로 보는 그룹 충족(메일 템플릿용). 이 필드가 값 없음이고
 * 같은 그룹 다른 필드가 확인 또는 수정된 값이면 그 키를 돌려준다.
 */
export function fieldCoveringKey(fields: Partial<Record<ExtractionKey, FieldValue<unknown>>>, key: ExtractionKey): ExtractionKey | undefined {
  const f = fields[key];
  const empty = (v: FieldValue<unknown> | undefined) => !v || v.value === null || v.value === undefined;
  if (!empty(f) || (f && (f.status === 'verified' || f.status === 'user_edited'))) return undefined;
  return REVIEW_GROUPS.filter((g) => g.includes(key)).flat()
    .find((m) => m !== key && !empty(fields[m]) && (fields[m]!.status === 'verified' || fields[m]!.status === 'user_edited'));
}

/** 확인 필요 상태인 추출 항목 키(그룹으로 충족, 사용자 수정 제외). */
export function pendingKeys(items: Items): ExtractionKey[] {
  return EXTRACTION_KEYS.filter((k) => itemReviewState(items, k) === 'needs_review');
}

/** 확인 필요 항목 수(그룹으로 충족된 항목 제외). */
export function reviewCountOf(x: Extraction): number {
  return pendingKeys(x.items).length;
}

/** needs_review이고 reason이 conflict/low_confidence이며 사용자가 수정하지 않은 항목 수. */
export function conflictCountOf(x: Extraction): number {
  return EXTRACTION_KEYS.filter((k) => {
    const it = x.items[k];
    return it.status === 'needs_review' && (it.reason === 'conflict' || it.reason === 'multi' || it.reason === 'low_confidence') && it.userEdited === undefined;
  }).length;
}
