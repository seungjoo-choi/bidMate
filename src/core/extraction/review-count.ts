import { EXTRACTION_KEYS, type Extraction, type ExtractedItem, type ExtractionKey } from '../types/extraction';

type Items = Record<ExtractionKey, ExtractedItem<unknown>>;

/** 같은 그룹 중 하나만 충족해도 다른 항목의 "문서에 없음"은 확인 필요로 세지 않는다(예: 대외신인도 평가 = 경영상태 또는 대외신인도). */
export const REVIEW_GROUPS: ExtractionKey[][] = [['credibilityScore', 'managementScore']];

const NO_VALUE_REASONS = new Set(['not_found', 'no_total', 'no_documents']);
const satisfiedItem = (it: ExtractedItem<unknown>): boolean => it.status === 'verified' || it.userEdited !== undefined;

/** 이 항목이 값 없음이고, 같은 그룹의 다른 멤버가 충족이면 true. conflict/low_confidence는 해당 없음. */
export function coveredByGroup(items: Items, key: ExtractionKey): boolean {
  const it = items[key];
  if (it.status !== 'needs_review' || it.userEdited !== undefined || !it.reason || !NO_VALUE_REASONS.has(it.reason)) return false;
  return REVIEW_GROUPS.some((g) => g.includes(key) && g.some((m) => m !== key && satisfiedItem(items[m])));
}

/** needs_review이면서 사용자가 수정하지 않았고 그룹으로 충족되지 않은 항목 키. */
export function pendingKeys(items: Items): ExtractionKey[] {
  return EXTRACTION_KEYS.filter((k) => items[k].status === 'needs_review' && items[k].userEdited === undefined && !coveredByGroup(items, k));
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
