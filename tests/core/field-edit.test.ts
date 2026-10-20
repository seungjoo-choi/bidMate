import { describe, expect, it } from 'vitest';
import { applyUserEdit, editTargetsOf, parseFieldInput, revertUserEdit, validateFieldValue } from '../../src/core/model/field-edit';
import type { FieldValue } from '../../src/core/types/common';

const NOW = '2026-10-20T00:00:00.000Z';

describe('editTargetsOf', () => {
  it('합성 키는 2개, 일반 키는 자신, 자동 항목은 0개', () => {
    expect(editTargetsOf('credibilityEval')).toEqual(['managementScore', 'credibilityScore']);
    expect(editTargetsOf('performanceEval')).toEqual(['performanceScore', 'performancePeriod', 'performanceMinAmount']);
    expect(editTargetsOf('evalMethodText')).toEqual(['evalMethodDoc', 'evalMethod']);
    expect(editTargetsOf('projectPeriod')).toEqual(['projectPeriod']);
    for (const k of ['sourceUrl', 'today', 'noticeNo', 'round'] as const) expect(editTargetsOf(k)).toEqual([]);
    expect(editTargetsOf('custom.비고')).toEqual(['custom.비고']);
    expect(editTargetsOf('custom.')).toEqual([]);
  });
});

describe('validateFieldValue', () => {
  it('값 형식을 검증한다', () => {
    expect(validateFieldValue('budgetAmount', 1000).ok).toBe(true);
    for (const v of [-1, 1.5, '100']) expect(validateFieldValue('budgetAmount', v).ok).toBe(false);
    expect(validateFieldValue('bidCloseAt', '2026-10-21T18:00:00+09:00').ok).toBe(true);
    expect(validateFieldValue('bidCloseAt', '2026-10-21').ok).toBe(false);
    expect(validateFieldValue('jointVentureAllowed', true, '공동이행').ok).toBe(true);
    expect(validateFieldValue('jointVentureAllowed', 'yes').ok).toBe(false);
    expect(validateFieldValue('eligibility', 'a'.repeat(5001)).ok).toBe(false);
    expect(validateFieldValue('credibilityScore', 1001).ok).toBe(false);
  });
});

describe('applyUserEdit / revertUserEdit', () => {
  const review: FieldValue<string> = {
    value: 'A', status: 'needs_review', note: '충돌',
    candidates: [{ value: 'A', source: { kind: 'api', ref: 'x', fetchedAt: 't' } }, { value: 'B', source: { kind: 'html', ref: 'x', fetchedAt: 't' } }],
  };
  it('needs_review prev는 before에 통째로 보존된다', () => {
    const e = applyUserEdit(review, '내 값', NOW, {});
    expect(e.status).toBe('user_edited');
    expect(e.value).toBe('내 값');
    expect(e.userEdit?.before).toEqual(review);
  });
  it('다시 고쳐도 before는 최초 자동값을 유지한다', () => {
    const e1 = applyUserEdit(review, '1차', NOW, {});
    const e2 = applyUserEdit(e1, '2차', NOW, { note: '메모' });
    expect(e2.value).toBe('2차');
    expect(e2.userEdit?.before).toEqual(review);
    expect(e2.userEdit?.before?.userEdit).toBeUndefined();
    expect(e2.userEdit?.note).toBe('메모');
  });
  it('revert는 before를 돌려주고, 수정되지 않은 prev는 그대로 돌려준다', () => {
    const e = applyUserEdit(review, '내 값', NOW, {});
    expect(revertUserEdit(e)).toEqual(review);
    expect(revertUserEdit(review)).toBe(review);
  });
});

describe('parseFieldInput', () => {
  it('종류별로 입력을 해석한다', () => {
    expect(parseFieldInput('datetime', '2026-10-21 18:00')).toEqual({ ok: true, value: '2026-10-21T18:00:00+09:00' });
    expect(parseFieldInput('amount', '1,000,000원')).toEqual({ ok: true, value: 1000000 });
    expect(parseFieldInput('period', '5')).toEqual({ ok: true, value: '5년' });
    expect(parseFieldInput('bool_joint', '공동이행', { joint: true })).toEqual({ ok: true, value: true, raw: '공동이행' });
    expect(parseFieldInput('text', '  ').ok).toBe(false);
  });
});
