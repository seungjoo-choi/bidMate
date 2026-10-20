import { describe, expect, it } from 'vitest';
import { computeStatus } from '../../src/core/extraction/decide';
import { conflictCountOf, coveredByGroup, reviewCountOf } from '../../src/core/extraction/review-count';
import { EXTRACTION_KEYS, type Extraction, type ExtractedItem, type ExtractionKey } from '../../src/core/types/extraction';

const ok = (value: unknown): ExtractedItem<unknown> => ({ value, status: 'verified' });
const nf = (reason: ExtractedItem<unknown>['reason'] = 'not_found'): ExtractedItem<unknown> => ({ value: null, status: 'needs_review', reason });
const make = (over: Partial<Record<ExtractionKey, ExtractedItem<unknown>>>): Extraction => {
  const items = {} as Record<ExtractionKey, ExtractedItem<unknown>>;
  for (const k of EXTRACTION_KEYS) items[k] = ok(1);
  return { items: { ...items, ...over } } as unknown as Extraction;
};

describe('검토 그룹(대외신인도/경영상태)', () => {
  it('한쪽 verified + 다른 쪽 not_found -> 0건, 상태 verified', () => {
    const x = make({ managementScore: ok(4), credibilityScore: nf() });
    expect(reviewCountOf(x)).toBe(0);
    expect(coveredByGroup(x.items, 'credibilityScore')).toBe(true);
    expect(computeStatus(x.items, ['parsed'])).toBe('verified');
  });
  it('한쪽 userEdited + 다른 쪽 no_total -> 0건', () => {
    const x = make({ managementScore: { value: null, status: 'needs_review', reason: 'not_found', userEdited: { value: 3 } } as ExtractedItem<unknown>, credibilityScore: nf('no_total') });
    expect(reviewCountOf(x)).toBe(0);
  });
  it('둘 다 not_found -> 2건', () => {
    const x = make({ managementScore: nf(), credibilityScore: nf() });
    expect(reviewCountOf(x)).toBe(2);
    expect(computeStatus(x.items, ['parsed'])).toBe('needs_review');
  });
  it('한쪽 verified + 다른 쪽 conflict -> 1건, conflict 수 유지', () => {
    const x = make({ managementScore: ok(4), credibilityScore: nf('conflict') });
    expect(reviewCountOf(x)).toBe(1);
    expect(conflictCountOf(x)).toBe(1);
  });
});
