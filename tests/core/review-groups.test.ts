import { describe, expect, it } from 'vitest';
import { computeStatus } from '../../src/core/extraction/decide';
import { conflictCountOf, coveredByGroup, coveringKey, fieldReviewState, itemReviewState, reviewCountOf } from '../../src/core/extraction/review-count';
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

describe('단일 판정 itemReviewState/fieldReviewState', () => {
  it('추출 항목: 수정, 확인, 충족, 확인 필요, 미실행', () => {
    const x = make({ managementScore: ok(4), credibilityScore: nf('no_total'), performanceScore: nf(), performancePeriod: { value: null, status: 'not_run' } as unknown as ExtractedItem<unknown>,
      differentialScoring: { value: null, status: 'needs_review', reason: 'not_found', userEdited: { value: true } } as ExtractedItem<unknown> });
    expect(itemReviewState(x.items, 'differentialScoring')).toBe('user_edited');
    expect(itemReviewState(x.items, 'managementScore')).toBe('verified');
    expect(itemReviewState(x.items, 'credibilityScore')).toBe('covered');
    expect(coveringKey(x.items, 'credibilityScore')).toBe('managementScore');
    expect(itemReviewState(x.items, 'performanceScore')).toBe('needs_review');
    expect(itemReviewState(x.items, 'performancePeriod')).toBe('not_run');
  });
  it('그룹 멤버가 없는 부분 items면 충족을 보지 않는다', () => {
    expect(itemReviewState({ credibilityScore: nf('no_total') }, 'credibilityScore')).toBe('needs_review');
  });
  it('conflict는 그룹이 충족돼도 확인 필요', () => {
    const x = make({ managementScore: ok(4), credibilityScore: nf('conflict') });
    expect(itemReviewState(x.items, 'credibilityScore')).toBe('needs_review');
  });
  it('공고 필드: 추출 결과로 그룹 충족, 없으면 필드 상태 그대로', () => {
    const x = make({ managementScore: ok(4), credibilityScore: nf('no_total') });
    const f = { value: null, status: 'needs_review' as const };
    expect(fieldReviewState(f, x, 'credibilityScore')).toBe('covered');
    expect(fieldReviewState(f, null, 'credibilityScore')).toBe('needs_review');
    expect(fieldReviewState({ value: null, status: 'missing' }, null, 'title')).toBe('missing');
    expect(fieldReviewState({ value: 3, status: 'user_edited' }, x, 'credibilityScore')).toBe('user_edited');
  });
});
