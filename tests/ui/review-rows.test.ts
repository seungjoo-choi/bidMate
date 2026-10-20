import { describe, expect, it } from 'vitest';
import { REVIEW_LEAF_KEYS } from '../../src/core/extraction/review-rows';
import { emptyNotice, getField } from '../../src/core/model/notice-fields';
import type { FieldValue, SourceKind } from '../../src/core/types/common';
import type { AiRun, AiSuggestion } from '../../src/core/types/ai';
import { EXTRACTION_KEYS, type Extraction, type ExtractedItem, type ExtractionKey } from '../../src/core/types/extraction';
import type { NoticeFieldKey } from '../../src/core/types/notice';
import type { AiCardInfo } from '../../src/ui/review/ai-view';
import { autoOpen, buildReviewRows, formatLeafValue, nextPendingRowKey, summarizeRows } from '../../src/ui/review/rows';

const notice = () => emptyNotice('id', { noticeNo: 'a', origin: 'g2b' }, 'f', 't');
const src = (kind: SourceKind, ref = 'r') => ({ kind, ref, fetchedAt: 't' });
const setField = (n: ReturnType<typeof notice>, key: NoticeFieldKey, f: FieldValue<unknown>) => { Object.assign(getField(n, key)!, f); };
const ok = (value: unknown): ExtractedItem<unknown> => ({ value, status: 'verified' });
const nf = (): ExtractedItem<unknown> => ({ value: null, status: 'needs_review', reason: 'not_found' });
const make = (over: Partial<Record<ExtractionKey, ExtractedItem<unknown>>>): Extraction => {
  const items = {} as Record<ExtractionKey, ExtractedItem<unknown>>;
  for (const k of EXTRACTION_KEYS) items[k] = ok(1);
  return { items: { ...items, ...over } } as unknown as Extraction;
};
const aiInfo = (over: Partial<AiSuggestion>): AiCardInfo =>
  ({ suggestion: { key: 'performanceScore', value: 3, quote: 'q', verdict: 'differs', baseline: 1, ...over } as AiSuggestion, run: {} as AiRun });
const row = (rows: ReturnType<typeof buildReviewRows>, key: string) => rows.find((r) => r.key === key)!;

describe('buildReviewRows', () => {
  it('행 13개, 잎 16개 순서, 묶음 행 sub 3개와 pendingCount', () => {
    const x = make({ performanceScore: nf(), performancePeriod: nf(), performanceMinAmount: ok(1) });
    const rows = buildReviewRows(notice(), x);
    expect(rows).toHaveLength(13);
    expect(rows.flatMap((r) => [r.head, ...r.sub]).map((l) => l.key)).toEqual(REVIEW_LEAF_KEYS);
    const p = row(rows, 'performanceScore');
    expect(p.sub).toHaveLength(3);
    expect(p.label).toBe('실적점수 평가');
    expect(p.pendingCount).toBe(2);
    expect(p.state).toBe('needs_review');
  });
  it('confirmable/aiFindable 표', () => {
    const n = notice();
    setField(n, 'projectPeriod', { value: '12개월', status: 'needs_review', source: src('api') });
    const x = make({ performanceScore: nf(), performancePeriod: { value: 2, status: 'needs_review', reason: 'low_confidence' } });
    const rows = buildReviewRows(n, x);
    const pp = row(rows, 'projectPeriod').head;
    expect(pp).toMatchObject({ state: 'needs_review', confirmable: true, aiFindable: true, badge: 'needs_review', userEdited: false });
    const none = row(rows, 'priceMethod').head;
    expect(none).toMatchObject({ confirmable: false, aiFindable: true });
    const ps = row(rows, 'performanceScore');
    expect(ps.head).toMatchObject({ confirmable: false, aiFindable: true });
    expect(ps.sub[0]).toMatchObject({ confirmable: true, aiFindable: true });
  });
  it('공고 필드 candidates 2개 이상이면 변환, confirmable false', () => {
    const n = notice();
    setField(n, 'projectPeriod', { value: 'a', status: 'needs_review', candidates: [{ value: 'a', source: src('api') }, { value: 'b', source: src('html') }] });
    const l = row(buildReviewRows(n, null), 'projectPeriod').head;
    expect(l.candidates).toEqual([
      { value: 'a', valueText: 'a', sourceText: '나라장터 공고정보' },
      { value: 'b', valueText: 'b', sourceText: '나라장터 상세화면' },
    ]);
    expect(l.confirmable).toBe(false);
  });
  it('sourceText 출처별', () => {
    const n = notice();
    setField(n, 'postedAt', { value: '2026-10-01T09:00:00+09:00', status: 'verified', source: src('derived') });
    setField(n, 'projectPeriod', { value: 'x', status: 'verified', source: src('html') });
    setField(n, 'evalMethod', { value: 'x', status: 'verified', source: src('document', 'a.hwp') });
    setField(n, 'priceMethod', { value: 'x', status: 'verified', source: src('document', '') });
    setField(n, 'proposalPeriod', { value: 'x', status: 'user_edited', userEdit: { editedAt: 't', before: { value: 'x', status: 'needs_review' } } });
    setField(n, 'proposalEvalAt', { value: '2026-10-02T09:00:00+09:00', status: 'user_edited', userEdit: { editedAt: 't', before: { value: '2026-10-01T09:00:00+09:00', status: 'needs_review' } } });
    const rows = buildReviewRows(n, make({ managementScore: nf() }));
    const t = (k: string) => row(rows, k).head.sourceText;
    expect(t('postedAt')).toBe('나라장터 공고정보');
    expect(t('projectPeriod')).toBe('나라장터 상세화면');
    expect(t('evalMethod')).toBe('문서, a.hwp');
    expect(t('priceMethod')).toBe('문서');
    expect(t('proposalPeriod')).toBe('확인함');
    expect(t('proposalEvalAt')).toBe('직접 수정');
    expect(row(rows, 'proposalEvalAt').head.autoValueText).toBe(formatLeafValue('datetime', '2026-10-01T09:00:00+09:00'));
    expect(row(rows, 'proposalPeriod').head.autoValueText).toBeUndefined();
    expect(t('budgetAmount')).toBe('—');
    expect(t('managementScore')).toBe('찾지 못함');
  });
  it('summarizeRows는 잎 기준', () => {
    const x = make({ performanceScore: nf(), credibilityScore: { value: 1, status: 'needs_review', userEdited: { value: 2, editedAt: 't' } } });
    const s = summarizeRows(buildReviewRows(notice(), x));
    expect(s.total).toBe(16);
    expect(s.pending).toBe(1 + 9);
    expect(s.edited).toBe(1);
    expect(s.pending + s.done + s.notRun).toBe(16);
  });
});

describe('formatLeafValue', () => {
  it('false, 0은 값이고 null/undefined만 대시', () => {
    expect(formatLeafValue('joint', false)).toBe('불허');
    expect(formatLeafValue('joint', true, '가능')).toBe('허용 (가능)');
    expect(formatLeafValue('amount', 0)).not.toBe('—');
    expect(formatLeafValue('score', 0)).not.toBe('—');
    expect(formatLeafValue('bool', false)).not.toBe('—');
    expect(formatLeafValue('text', null)).toBe('—');
    expect(formatLeafValue('datetime', undefined)).toBe('—');
  });
});

describe('autoOpen / nextPendingRowKey', () => {
  it('needs_review 행은 열림', () => {
    const rows = buildReviewRows(notice(), make({}));
    expect(autoOpen(row(rows, 'priceMethod'))).toBe(true);
    expect(autoOpen(row(rows, 'credibilityScore'))).toBe(false);
  });
  it('AI differs 미처리는 열림, 처리됨은 닫힘', () => {
    const x = make({});
    const open = buildReviewRows(notice(), x, { credibilityScore: aiInfo({ key: 'credibilityScore' }) });
    expect(autoOpen(row(open, 'credibilityScore'))).toBe(true);
    const applied = buildReviewRows(notice(), x, { credibilityScore: aiInfo({ key: 'credibilityScore', appliedAt: 't' }) });
    expect(autoOpen(row(applied, 'credibilityScore'))).toBe(false);
    const dismissed = buildReviewRows(notice(), x, { credibilityScore: aiInfo({ key: 'credibilityScore', dismissedAt: 't' }) });
    expect(autoOpen(row(dismissed, 'credibilityScore'))).toBe(false);
  });
  it('nextPendingRowKey 순환과 null', () => {
    const n = notice();
    const all = buildReviewRows(n, make({}));
    expect(nextPendingRowKey(all)).toBe('postedAt');
    expect(nextPendingRowKey(all, 'postedAt')).toBe('registrationDeadline');
    expect(nextPendingRowKey(all, 'priceMethod')).toBe('postedAt');
    const only = all.map((r) => ({ ...r, pendingCount: r.key === 'evalMethod' ? 1 : 0 }));
    expect(nextPendingRowKey(only, 'evalMethod')).toBe('evalMethod');
    expect(nextPendingRowKey(only.map((r) => ({ ...r, pendingCount: 0 })))).toBeNull();
  });
});

describe('공고 잎 AI 제안', () => {
  it('공고 잎에도 ai가 붙고 aiFindable, verified 공고 잎 + differs 미처리는 autoOpen', () => {
    const n = notice();
    setField(n, 'priceMethod', { value: '복수예비가격', status: 'verified', source: src('api') });
    const info = aiInfo({ key: 'priceMethod' as never, value: '단일 예가' });
    const rows = buildReviewRows(n, make({}), { priceMethod: info });
    const l = row(rows, 'priceMethod').head;
    expect(l.ai).toBe(info);
    expect(l).toMatchObject({ state: 'verified', badge: 'verified', userEdited: false, aiFindable: false });
    expect(autoOpen(row(rows, 'priceMethod'))).toBe(true);
  });
});
