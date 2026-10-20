import { describe, expect, it } from 'vitest';
import { itemReviewState, pendingKeys } from '../../src/core/extraction/review-count';
import {
  REVIEW_LEAF_KEYS, isExtractionLeaf, leafReviewState, noticeReviewCount, pendingLeafKeys, rowKeyOf, rowStateOf, type LeafState,
} from '../../src/core/extraction/review-rows';
import { isEditableKey } from '../../src/core/model/field-edit';
import { emptyNotice, getField } from '../../src/core/model/notice-fields';
import type { FieldValue } from '../../src/core/types/common';
import { EXTRACTION_KEYS, type Extraction, type ExtractedItem, type ExtractionKey } from '../../src/core/types/extraction';
import type { NoticeFieldKey } from '../../src/core/types/notice';

const notice = () => emptyNotice('id', { noticeNo: 'a', origin: 'g2b' }, 'f', 't');
const src = { kind: 'api' as const, ref: 'r', fetchedAt: 't' };
const ok = (value: unknown): ExtractedItem<unknown> => ({ value, status: 'verified' });
const nf = (reason: ExtractedItem<unknown>['reason'] = 'not_found'): ExtractedItem<unknown> => ({ value: null, status: 'needs_review', reason });
const make = (over: Partial<Record<ExtractionKey, ExtractedItem<unknown>>>): Extraction => {
  const items = {} as Record<ExtractionKey, ExtractedItem<unknown>>;
  for (const k of EXTRACTION_KEYS) items[k] = ok(1);
  return { items: { ...items, ...over } } as unknown as Extraction;
};
const withField = (key: NoticeFieldKey, f: FieldValue<unknown>) => {
  const n = notice();
  (getField(n, key) as unknown) && Object.assign(getField(n, key)!, f);
  return n;
};
const edit = (value: unknown, before?: FieldValue<unknown>): FieldValue<unknown> => ({
  value, status: 'user_edited', userEdit: { editedAt: 't', ...(before ? { before } : {}) },
});
const aiOrigin = { kind: 'ai' as const, runId: 'r', provider: 'claude' as never, model: null, promptVersion: 'v' };

describe('REVIEW_LEAF_KEYS', () => {
  it('16개, 순서, 전부 편집 가능 키', () => {
    expect(REVIEW_LEAF_KEYS).toEqual([
      'postedAt', 'registrationDeadline', 'proposalPeriod', 'proposalEvalAt', 'budgetAmount', 'projectPeriod', 'evalMethod', 'differentialScoring',
      'credibilityScore', 'managementScore', 'performanceScore', 'performancePeriod', 'performanceMinAmount', 'performanceCondition',
      'jointVentureAllowed', 'priceMethod',
    ]);
    expect(REVIEW_LEAF_KEYS.every((k) => isEditableKey(k))).toBe(true);
    expect(rowKeyOf('performanceCondition')).toBe('performanceScore');
    expect(rowKeyOf('priceMethod')).toBe('priceMethod');
  });
});

describe('공고 잎', () => {
  it('verified', () => {
    const n = withField('postedAt', { value: '2026-10-01T09:00', status: 'verified', source: src });
    expect(leafReviewState(n, null, 'postedAt')).toMatchObject({ state: 'verified', value: '2026-10-01T09:00' });
  });
  it('missing -> needs_review', () => {
    expect(leafReviewState(notice(), null, 'priceMethod')).toEqual({ state: 'needs_review', reason: '공고정보에 값 없음', value: null });
  });
  it('needs_review는 note를 reason으로', () => {
    const n = withField('projectPeriod', { value: 'a', status: 'needs_review', note: '충돌' });
    expect(leafReviewState(n, null, 'projectPeriod')).toMatchObject({ state: 'needs_review', reason: '충돌' });
  });
  it('user_edited: before 같은 값이면 confirm', () => {
    const n = withField('projectPeriod', edit('a', { value: 'a', status: 'needs_review' }));
    expect(leafReviewState(n, null, 'projectPeriod')).toMatchObject({ state: 'user_edited', editedOrigin: 'confirm' });
  });
  it('user_edited: before 다른 값이면 editedOrigin 없음', () => {
    const n = withField('projectPeriod', edit('b', { value: 'a', status: 'needs_review' }));
    const j = leafReviewState(n, null, 'projectPeriod');
    expect(j.state).toBe('user_edited');
    expect(j.editedOrigin).toBeUndefined();
  });
});

describe('공고 잎 AI 적용', () => {
  it('source.ref가 ai:로 시작하면 editedOrigin ai', () => {
    const n = withField('priceMethod', { ...edit('a', { value: 'a', status: 'needs_review' }), source: { kind: 'user', ref: 'ai:run1', fetchedAt: 't' } });
    expect(leafReviewState(n, null, 'priceMethod')).toMatchObject({ state: 'user_edited', editedOrigin: 'ai' });
  });
});

describe('문서 잎', () => {
  it('extraction 있으면 itemReviewState와 같은 상태', () => {
    const x = make({ managementScore: ok(4), credibilityScore: nf('no_total'), performanceScore: nf(), performancePeriod: { value: null, status: 'not_run' } as ExtractedItem<unknown> });
    for (const k of EXTRACTION_KEYS) expect(leafReviewState(notice(), x, k).state).toBe(itemReviewState(x.items, k));
    expect(leafReviewState(notice(), x, 'performancePeriod')).toMatchObject({ state: 'not_run', reason: '이전 버전 결과, 다시 추출 필요' });
  });
  it('userEdited.origin ai -> ai', () => {
    const x = make({ performanceScore: { value: 5, status: 'needs_review', userEdited: { value: 7, editedAt: 't', origin: aiOrigin } } });
    expect(leafReviewState(notice(), x, 'performanceScore')).toMatchObject({ state: 'user_edited', value: 7, editedOrigin: 'ai' });
  });
  it('userEdited.value == item.value -> confirm', () => {
    const x = make({ performanceScore: { value: 5, status: 'needs_review', userEdited: { value: 5, editedAt: 't' } } });
    expect(leafReviewState(notice(), x, 'performanceScore').editedOrigin).toBe('confirm');
  });
  it('extraction null: notice.evaluation user_edited면 user_edited', () => {
    const n = withField('performanceScore', edit(9));
    expect(leafReviewState(n, null, 'performanceScore')).toMatchObject({ state: 'user_edited', value: 9 });
  });
  it('extraction null 그 외 not_run', () => {
    expect(leafReviewState(notice(), null, 'performanceScore')).toMatchObject({ state: 'not_run', reason: '문서 분석 전' });
  });
});

describe('rowStateOf 우선순위', () => {
  const all: LeafState[] = ['verified', 'covered', 'user_edited', 'not_run', 'needs_review'];
  it('needs_review > not_run > user_edited > covered > verified', () => {
    expect(rowStateOf(all)).toBe('needs_review');
    expect(rowStateOf(all.slice(0, 4))).toBe('not_run');
    expect(rowStateOf(all.slice(0, 3))).toBe('user_edited');
    expect(rowStateOf(all.slice(0, 2))).toBe('covered');
    expect(rowStateOf(['verified'])).toBe('verified');
  });
});

describe('pendingLeafKeys', () => {
  it('문서 잎 부분은 pendingKeys와 같다', () => {
    const combos = [
      make({}),
      make({ managementScore: ok(4), credibilityScore: nf() }),
      make({ managementScore: nf(), credibilityScore: nf(), performanceScore: nf('conflict') }),
      make({ differentialScoring: { value: null, status: 'needs_review', reason: 'not_found', userEdited: { value: true, editedAt: 't' } }, performancePeriod: { value: null, status: 'not_run' } as ExtractedItem<unknown> }),
    ];
    for (const x of combos) {
      expect(pendingLeafKeys(notice(), x).filter(isExtractionLeaf)).toEqual(pendingKeys(x.items));
    }
  });
  it('covered는 pending에 안 들어간다', () => {
    const x = make({ managementScore: ok(4), credibilityScore: nf() });
    expect(leafReviewState(notice(), x, 'credibilityScore').state).toBe('covered');
    expect(pendingLeafKeys(notice(), x)).not.toContain('credibilityScore');
    expect(noticeReviewCount(notice(), x)).toBe(pendingLeafKeys(notice(), x).length);
  });
  it('false, 0은 값이다', () => {
    let n = withField('jointVentureAllowed', { value: false, status: 'verified', source: src });
    n = Object.assign(n, {});
    Object.assign(n.basic.budgetAmount, { value: 0, status: 'verified', source: src });
    expect(leafReviewState(n, null, 'jointVentureAllowed')).toMatchObject({ state: 'verified', value: false });
    expect(leafReviewState(n, null, 'budgetAmount')).toMatchObject({ state: 'verified', value: 0 });
  });
});
