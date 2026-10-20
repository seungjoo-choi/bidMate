import { REVIEW_LEAF_KEYS, REVIEW_KIND, isExtractionLeaf, type ReviewLeafKey, type ReviewValueKind } from '../extraction/review-rows';

/** AI 재검토 대상 키. 공고 잎 9개와 문서 잎 7개(검토 탭 잎 16개와 같다). 런타임 목록은 여기서만 만든다. */
export type AiKey = ReviewLeafKey;
export const AI_KEYS: readonly AiKey[] = REVIEW_LEAF_KEYS;
export const isAiKey = (k: unknown): k is AiKey => typeof k === 'string' && (AI_KEYS as string[]).includes(k);
export const isDocAiKey = isExtractionLeaf;
export const aiKindOf = (k: AiKey): ReviewValueKind => REVIEW_KIND[k];
