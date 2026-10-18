import { describe, expect, it } from 'vitest';
import { mergeDocumentLayer, mergeFields, type MergeLayer } from '../../src/core/model/merge';
import { emptyNotice } from '../../src/core/model/notice-fields';
import type { FieldValue } from '../../src/core/types/common';

const fv = <T,>(value: T, kind: 'api' | 'html' = 'api'): FieldValue<T> => ({
  value, status: 'verified', source: { kind, ref: 'x', fetchedAt: 't' },
});
const api = (fields: MergeLayer['fields']): MergeLayer => ({ kinds: ['api', 'derived'], fields });
const html = (fields: MergeLayer['fields']): MergeLayer => ({ kinds: ['html'], fields });
const notice = () => emptyNotice('id', { noticeNo: 'a', origin: 'g2b' }, 'f', 't');

describe('mergeFields', () => {
  it('user_edited 보존', () => {
    const ex = notice();
    ex.basic.title = { value: '내가 수정', status: 'user_edited' };
    const out = mergeFields(ex, [api({ title: fv('API 제목') })]);
    expect(out.title?.value).toBe('내가 수정');
    expect(out.title?.status).toBe('user_edited');
  });
  it('우선순위: 앞 layer가 우선', () => {
    const out = mergeFields(null, [api({ title: fv('A') }), html({ title: fv('A', 'html') })]);
    expect(out.title?.value).toBe('A');
    expect(out.title?.source?.kind).toBe('api');
    expect(out.title?.status).toBe('verified');
  });
  it('null이면 다음 layer 사용', () => {
    const out = mergeFields(null, [api({ title: { value: null, status: 'missing' } }), html({ title: fv('H', 'html') })]);
    expect(out.title?.value).toBe('H');
  });
  it('값 충돌 시 needs_review + candidates (공백/분 단위 차이는 충돌 아님)', () => {
    const out = mergeFields(null, [
      api({ title: fv('A B'), bidCloseAt: fv('2026-10-22T14:00:00+09:00') }),
      html({ title: fv('다른', 'html'), bidCloseAt: fv('2026-10-22T14:00:30+09:00', 'html') }),
    ]);
    expect(out.title?.status).toBe('needs_review');
    expect(out.title?.candidates).toHaveLength(2);
    expect(out.bidCloseAt?.status).toBe('verified');
    const same = mergeFields(null, [api({ title: fv('A B') }), html({ title: fv('AB', 'html') })]);
    expect(same.title?.status).toBe('verified');
  });
  it('전부 비면 missing', () => {
    const out = mergeFields(null, [api({}), html({})]);
    expect(out.title?.status).toBe('missing');
    expect(out.title?.value).toBeNull();
  });
  it('다시 조회한 출처의 값이 사라지면 existing을 needs_review로 유지', () => {
    const ex = notice();
    ex.basic.title = fv('예전 값');
    const out = mergeFields(ex, [api({})]);
    expect(out.title?.value).toBe('예전 값');
    expect(out.title?.status).toBe('needs_review');
    expect(out.title?.note).toBe('최근 수집에서 값이 확인되지 않음');
  });
  it('이번에 조회하지 않은 출처(html)의 기존 값은 상태 그대로 유지', () => {
    const ex = notice();
    ex.basic.projectPeriod = fv('계약일로부터 12개월', 'html');
    const out = mergeFields(ex, [api({})]);
    expect(out.projectPeriod?.value).toBe('계약일로부터 12개월');
    expect(out.projectPeriod?.status).toBe('verified');
  });
  it('재수집을 반복해도 html 전용 필드가 needs_review로 떨어지지 않음', () => {
    const ex = notice();
    ex.basic.projectPeriod = fv('12개월', 'html');
    const out = mergeFields(ex, [api({}), html({ projectPeriod: fv('12개월', 'html') })]);
    expect(out.projectPeriod?.status).toBe('verified');
  });
  it('해석 실패 값은 raw/needs_review를 보존 (다른 값이 없을 때)', () => {
    const failed: FieldValue<number> = {
      value: null, raw: '19억 2천만원', status: 'needs_review', note: '숫자로 해석하지 않음',
      source: { kind: 'html', ref: 'title=사업금액', fetchedAt: 't' },
    };
    const out = mergeFields(null, [api({ budgetAmount: { value: null, status: 'missing' } }), html({ budgetAmount: failed })]);
    expect(out.budgetAmount?.raw).toBe('19억 2천만원');
    expect(out.budgetAmount?.status).toBe('needs_review');
  });
  it('API 해석 실패(missing+raw)도 needs_review로 올림', () => {
    const out = mergeFields(null, [api({ bidCloseAt: { value: null, raw: '2026.10.22', status: 'missing' } })]);
    expect(out.bidCloseAt?.raw).toBe('2026.10.22');
    expect(out.bidCloseAt?.status).toBe('needs_review');
    expect(out.bidCloseAt?.note).toBeTruthy();
  });
  it('API 값이 있고 화면값이 해석 실패면 값은 API, 원문은 note로 남김', () => {
    const failed: FieldValue<number> = { value: null, raw: '19억', status: 'needs_review', source: { kind: 'html', ref: 'x', fetchedAt: 't' } };
    const out = mergeFields(null, [api({ budgetAmount: fv(1923000000) }), html({ budgetAmount: failed })]);
    expect(out.budgetAmount?.note).toContain('19억');
  });
  it('해석 실패 값보다 다른 layer의 실제 값이 우선', () => {
    const failed: FieldValue<number> = { value: null, raw: '19억', status: 'needs_review', source: { kind: 'html', ref: 'x', fetchedAt: 't' } };
    const out = mergeFields(null, [api({ budgetAmount: fv(1923000000) }), html({ budgetAmount: failed })]);
    expect(out.budgetAmount?.value).toBe(1923000000);
    expect(out.budgetAmount?.status).toBe('verified');
  });
});

describe('mergeDocumentLayer', () => {
  const doc = <T,>(value: T): FieldValue<T> => ({ value, status: 'verified', source: { kind: 'document', ref: 'f3#표1', fetchedAt: 't' } });
  const docConflict = (a: number, b: number): FieldValue<number> => ({
    value: null, raw: `${a} / ${b}`, status: 'needs_review', note: '문서 간 값이 서로 다름',
    candidates: [{ value: a, source: doc(a).source! }, { value: b, source: doc(b).source! }],
  });

  it('문서 간 충돌은 html 값이 있어도 needs_review로 드러난다', () => {
    const ex = notice();
    ex.evaluation.credibilityScore = fv(4, 'html');
    const out = mergeDocumentLayer(ex, { credibilityScore: docConflict(4, 5) });
    expect(out.credibilityScore?.status).toBe('needs_review');
    expect(out.credibilityScore?.value).toBe(4);
    expect(out.credibilityScore?.candidates?.map((c) => c.value)).toEqual([4, 5]);
  });
  it('문서 후보가 모두 html 값과 같으면 verified 유지', () => {
    const ex = notice();
    ex.evaluation.credibilityScore = fv(4, 'html');
    expect(mergeDocumentLayer(ex, { credibilityScore: docConflict(4, 4) }).credibilityScore?.status).toBe('verified');
  });
  it('html/문서 충돌 후 재추출에서 문서가 같은 값이면 needs_review가 풀린다', () => {
    const ex = notice();
    ex.evaluation.credibilityScore = fv(4, 'html');
    const first = mergeDocumentLayer(ex, { credibilityScore: doc(5) });
    expect(first.credibilityScore?.status).toBe('needs_review');
    ex.evaluation.credibilityScore = first.credibilityScore as FieldValue<number>;
    const again = mergeDocumentLayer(ex, { credibilityScore: doc(4) });
    expect(again.credibilityScore).toMatchObject({ value: 4, status: 'verified' });
    expect(again.credibilityScore?.candidates).toBeUndefined();
  });
  it('재추출에서 문서가 값을 못 찾으면 html 값이 verified로 돌아온다', () => {
    const ex = notice();
    ex.evaluation.credibilityScore = fv(4, 'html');
    ex.evaluation.credibilityScore = mergeDocumentLayer(ex, { credibilityScore: doc(5) }).credibilityScore as FieldValue<number>;
    expect(mergeDocumentLayer(ex, {}).credibilityScore).toMatchObject({ value: 4, status: 'verified' });
  });
  it('html 값을 문서 값이 덮어쓰지 않고, user_edited는 보존', () => {
    const ex = notice();
    ex.evaluation.credibilityScore = fv(4, 'html');
    ex.evaluation.performanceScore = { value: 7, status: 'user_edited' };
    const out = mergeDocumentLayer(ex, { credibilityScore: doc(4), performanceScore: doc(6) });
    expect(out.credibilityScore?.source?.kind).toBe('html');
    expect(out.performanceScore).toMatchObject({ value: 7, status: 'user_edited' });
  });
  it('최근 수집에서 확인 안 된 html 값은 문서 충돌이 풀려도 verified로 올라가지 않는다', () => {
    const ex = notice();
    ex.evaluation.credibilityScore = { ...fv(4, 'html'), status: 'needs_review', note: '최근 수집에서 값이 확인되지 않음' };
    const conflicted = mergeDocumentLayer(ex, { credibilityScore: doc(5) }).credibilityScore as FieldValue<number>;
    expect(conflicted.status).toBe('needs_review');
    ex.evaluation.credibilityScore = conflicted;
    const again = mergeDocumentLayer(ex, {}).credibilityScore;
    expect(again).toMatchObject({ value: 4, status: 'needs_review', note: '최근 수집에서 값이 확인되지 않음' });
    expect(again?.candidates).toBeUndefined();
  });
});
