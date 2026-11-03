import { describe, expect, it } from 'vitest';
import { defaultBaseOf, formulaVerification, priceEvalRateOf, simulate } from '../../src/core/pricing/simulate';
import { emptyNotice } from '../../src/core/model/notice-fields';
import type { EvalRecord } from '../../src/core/types/evaluation';
import type { Notice, NoticeRef } from '../../src/core/types/notice';

const base = { priceWeight: 10, base: 1_000_000, rivalRate: 88 };
const rowAt = (r: ReturnType<typeof simulate>, rate: number) => r.rows.find((x) => x.rate === rate)!;

describe('simulate', () => {
  it('W=10, L=88: r=88/100/80 점수', () => {
    const r = simulate(base);
    expect(rowAt(r, 88)).toMatchObject({ ourScore: 10, rivalScore: 10, diff: 0, isRival: true });
    expect(rowAt(r, 100)).toMatchObject({ ourScore: 8.8, rivalScore: 10, diff: -1.2 });
    expect(rowAt(r, 80)).toMatchObject({ ourScore: 10, rivalScore: 9.0909, diff: 0.9091 });
    expect(r.pricePerCut).toBe(0.1);
  });
  it('rows 오름차순, rivalRate가 없으면 삽입', () => {
    const r = simulate({ ...base, rivalRate: 88.3 });
    expect(r.rows).toHaveLength(42);
    expect(r.rows.map((x) => x.rate)).toEqual([...r.rows.map((x) => x.rate)].sort((a, b) => a - b));
    expect(r.rows.filter((x) => x.isRival).map((x) => x.rate)).toEqual([88.3]);
  });
  it('amount 반올림', () => {
    const r = simulate({ ...base, base: 1_234_567 });
    expect(rowAt(r, 88.5).amount).toBe(Math.round(1_234_567 * 0.885));
  });
  it('낙찰하한율 85면 80~84.5 excluded', () => {
    const r = simulate({ ...base, lowerLimitRate: 85 });
    expect(r.rows.filter((x) => x.excluded).map((x) => x.rate)).toEqual([80, 80.5, 81, 81.5, 82, 82.5, 83, 83.5, 84, 84.5]);
    expect(r.rows.length).toBe(41);
  });
  it('낙찰하한율 > 경쟁 최저 투찰률이면 경고', () => {
    expect(simulate({ ...base, lowerLimitRate: 90 }).warnings.length).toBe(1);
  });
  it('ourRate 임의 행', () => {
    expect(simulate({ ...base, ourRate: 95 }).custom).toMatchObject({ rate: 95, ourScore: 9.2632 });
    expect(simulate(base).custom).toBeNull();
  });
  it('breakEven', () => {
    expect(simulate({ ...base, techGap: -1.2 }).breakEven).toMatchObject({ rate: 77.44, impossible: false });
    expect(simulate({ ...base, techGap: 1.2 }).breakEven).toMatchObject({ rate: 100, impossible: false });
    expect(simulate({ ...base, techGap: 10 }).breakEven).toMatchObject({ rate: null, impossible: false, note: '어떤 투찰률도 우세' });
    expect(simulate({ ...base, techGap: -10 }).breakEven).toMatchObject({ rate: null, impossible: true });
    expect(simulate(base).breakEven).toBeNull();
    expect(simulate({ ...base, techGap: -1.2, lowerLimitRate: 80 }).breakEven?.excluded).toBe(true);
  });
  it('잘못된 입력은 빈 rows + 경고', () => {
    for (const bad of [{ priceWeight: 0 }, { base: 0 }, { rivalRate: 0 }, { rivalRate: 201 }]) {
      const r = simulate({ ...base, ...bad });
      expect(r.rows).toEqual([]);
      expect(r.warnings.length).toBeGreaterThan(0);
    }
  });
});

const ref = {} as NoticeRef;
const mk = (): Notice => emptyNotice('n1', ref, 'f', '2026-10-22T00:00:00.000Z');

describe('priceEvalRateOf / defaultBaseOf', () => {
  it('API 값 우선', () => {
    const n = mk();
    n.evaluation.priceEvalRate = { value: 20, status: 'verified' };
    n.evaluation.evalMethod = { value: '협상 (기술 90 : 가격 10)', status: 'verified' };
    expect(priceEvalRateOf(n)).toEqual({ value: 20, source: 'api' });
  });
  it('evalMethod 문자열에서 보정', () => {
    const n = mk();
    n.evaluation.evalMethod = { value: '협상에의한계약 (기술 90 : 가격 10)', status: 'verified' };
    expect(priceEvalRateOf(n)).toEqual({ value: 10, source: 'evalMethod' });
  });
  it('둘 다 없으면 null', () => {
    expect(priceEvalRateOf(mk())).toBeNull();
  });
  it('defaultBaseOf는 추정가격만', () => {
    const n = mk();
    expect(defaultBaseOf(n)).toBeNull();
    n.basic.budgetAmount = { value: 1100, status: 'verified' };
    expect(defaultBaseOf(n)).toBeNull();
    n.basic.estimatedPrice = { value: 1000, status: 'verified' };
    expect(defaultBaseOf(n)).toBe(1000);
  });
});

describe('formulaVerification', () => {
  const rec = (official: EvalRecord['official'], techWeight: number | null = 90): EvalRecord => ({ techWeight, official } as EvalRecord);
  const row = (bidAmount: number, priceScore: number) => ({ bizNo: 'x', rank: 1, bidAmount, priceScore, techScore: null, totalScore: null, techRaw: null });
  it('official 없는 레코드는 total 제외', () => {
    const good = rec({ fetchedAt: '', rows: [row(1000, 10), row(1250, 8)] });
    const bad = rec({ fetchedAt: '', rows: [row(1000, 10), row(1250, 9)] });
    expect(formulaVerification([good, bad, rec(null)])).toEqual({ ok: 1, total: 2 });
    expect(formulaVerification([])).toEqual({ ok: 0, total: 0 });
  });
});
