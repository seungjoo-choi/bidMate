import { describe, expect, it } from 'vitest';
import { normalizePerformance, validatePerformanceInput } from '../../src/core/performances/normalize';
import { compareAmountOf } from '../../src/core/types/performance';

const base = { id: 'perf_1', title: '시스템 구축', client: '공단', amount: 350000000, startAt: '2024-03-01', endAt: '2024-12-31', source: 'excel', updatedAt: '2025-01-01T00:00:00Z' };

describe('normalizePerformance', () => {
  it('정상 항목은 그대로 통과', () => {
    expect(normalizePerformance(base, 'F')).toEqual(base);
  });
  it('필수가 깨지면 null', () => {
    expect(normalizePerformance({ ...base, title: '' }, 'F')).toBeNull();
    expect(normalizePerformance({ ...base, amount: 1.5 }, 'F')).toBeNull();
    expect(normalizePerformance({ ...base, startAt: '2024-02-30' }, 'F')).toBeNull();
    expect(normalizePerformance(null, 'F')).toBeNull();
  });
  it('share 범위 밖이면 제거', () => {
    const r = normalizePerformance({ ...base, share: 150 }, 'F');
    expect(r).not.toBeNull();
    expect('share' in r!).toBe(false);
    expect(normalizePerformance({ ...base, share: 70 }, 'F')!.share).toBe(70);
  });
  it('endAt < startAt이면 null', () => {
    expect(normalizePerformance({ ...base, endAt: '2024-02-01' }, 'F')).toBeNull();
  });
  it('updatedAt이 없으면 파일 시각 사용', () => {
    expect(normalizePerformance({ ...base, updatedAt: undefined }, 'F')!.updatedAt).toBe('F');
  });
});

describe('validatePerformanceInput', () => {
  const ok = { title: ' 사업 ', client: '기관', amount: 1000, startAt: '2024-03-01' };
  const code = (input: unknown) => {
    try { validatePerformanceInput(input); } catch (e) { return (e as { code?: string }).code; }
    return undefined;
  };
  it('통과하면 trim된 값', () => {
    expect(validatePerformanceInput(ok)).toEqual({ title: '사업', client: '기관', amount: 1000, startAt: '2024-03-01' });
  });
  it('amount 소수와 1e13은 INVALID_VALUE', () => {
    expect(code({ ...ok, amount: 10.5 })).toBe('INVALID_VALUE');
    expect(code({ ...ok, amount: 1e13 })).toBe('INVALID_VALUE');
  });
  it('존재하지 않는 날짜는 INVALID_VALUE', () => {
    expect(code({ ...ok, startAt: '2024-02-30' })).toBe('INVALID_VALUE');
  });
  it('share 0은 INVALID_VALUE', () => {
    expect(code({ ...ok, share: 0 })).toBe('INVALID_VALUE');
  });
  it('빈 category는 키 생략', () => {
    const r = validatePerformanceInput({ ...ok, category: '  ' });
    expect('category' in r).toBe(false);
  });
});

describe('compareAmountOf', () => {
  it('지분율 적용', () => {
    expect(compareAmountOf({ amount: 350000000, share: 70 })).toBe(245000000);
  });
  it('share 없음은 원금', () => {
    expect(compareAmountOf({ amount: 350000000 })).toBe(350000000);
  });
});
