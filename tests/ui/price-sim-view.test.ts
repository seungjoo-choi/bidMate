import { describe, expect, it } from 'vitest';
import type { SimRow } from '../../src/core/pricing/simulate';
import {
  baseSourceLabel, collapsedRows, diffTone, formatDiff, formatRate, formatScore, verificationText, weightSourceLabel,
} from '../../src/ui/notice-detail/price-sim-view';

const row = (rate: number, isRival = false): SimRow => ({ rate, amount: 0, ourScore: 0, rivalScore: 0, diff: 0, excluded: false, isRival });
const rows = Array.from({ length: 41 }, (_, k) => row(80 + k * 0.5, 80 + k * 0.5 === 88));

describe('price-sim-view 포맷', () => {
  it('점수 2자리', () => {
    expect(formatScore(9.0909)).toBe('9.09');
    expect(formatScore(10)).toBe('10.00');
  });
  it('차이 부호', () => {
    expect(formatDiff(0.9091)).toBe('+0.91');
    expect(formatDiff(-1.2)).toBe('−1.20');
    expect(formatDiff(0)).toBe('0.00');
    expect(formatDiff(0.001)).toBe('0.00');
    expect(diffTone(0.9)).toBe('primary');
    expect(diffTone(-1.2)).toBe('warn');
    expect(diffTone(0)).toBe('none');
  });
  it('투찰률', () => {
    expect(formatRate(88)).toBe('88%');
    expect(formatRate(77.44)).toBe('77.44%');
  });
  it('출처 문구', () => {
    expect(weightSourceLabel('api', false)).toBe('공고정보');
    expect(weightSourceLabel('evalMethod', false)).toBe('평가방법 문자열에서 보정');
    expect(weightSourceLabel(null, false)).toBe('');
    expect(weightSourceLabel('api', true)).toBe('직접 입력');
    expect(baseSourceLabel(true, false)).toBe('공고정보 추정가격');
  });
  it('검증 문구', () => {
    expect(verificationText(null)).toBe('확인 불가');
    expect(verificationText({ ok: 0, total: 0 })).toBe('검증할 평가 이력이 없습니다');
    expect(verificationText({ ok: 3, total: 4 })).toBe('이 공식은 저장된 평가 이력 4건 중 3건에서 확인됨');
  });
});

describe('collapsedRows', () => {
  it('rival 행 ±5행', () => {
    const out = collapsedRows(rows);
    expect(out).toHaveLength(11);
    expect(out[5]?.isRival).toBe(true);
    expect(out[0]?.rate).toBe(85.5);
    expect(out[10]?.rate).toBe(90.5);
  });
  it('경계에서는 잘림', () => {
    const edge = rows.map((r, i) => ({ ...r, isRival: i === 1 }));
    expect(collapsedRows(edge).map((r) => r.rate)[0]).toBe(80);
    expect(collapsedRows(edge)).toHaveLength(7);
  });
  it('빈 입력', () => {
    expect(collapsedRows([])).toEqual([]);
  });
});
