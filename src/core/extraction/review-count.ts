import { EXTRACTION_KEYS, type Extraction } from '../types/extraction';

/** needs_review이면서 사용자가 수정하지 않은 항목 수. */
export function reviewCountOf(x: Extraction): number {
  return EXTRACTION_KEYS.filter((k) => x.items[k].status === 'needs_review' && x.items[k].userEdited === undefined).length;
}

/** needs_review이고 reason이 conflict/low_confidence이며 사용자가 수정하지 않은 항목 수. */
export function conflictCountOf(x: Extraction): number {
  return EXTRACTION_KEYS.filter((k) => {
    const it = x.items[k];
    return it.status === 'needs_review' && (it.reason === 'conflict' || it.reason === 'low_confidence') && it.userEdited === undefined;
  }).length;
}
