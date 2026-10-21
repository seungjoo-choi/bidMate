import { describe, expect, it } from 'vitest';
import { formatAmountFull, formatAmountShort, formatDate, formatDateTime, formatDifferential, formatPeriod, formatScore, isDueSoon, isPast } from '../../src/ui/review/format';

describe('금액 표기', () => {
  it('억/만 단위', () => {
    expect(formatAmountShort(500_000_000)).toBe('5억 원');
    expect(formatAmountShort(550_000_000)).toBe('5억 5,000만 원');
    expect(formatAmountShort(15_000_000)).toBe('1,500만 원');
    expect(formatAmountShort(0)).toBe('0원');
  });
  it('원 단위 병기', () => {
    expect(formatAmountFull(500_000_000)).toBe('5억 원 (500,000,000원)');
    expect(formatAmountFull(0)).toBe('0원');
    expect(formatAmountFull(null)).toBe('—');
  });
});

describe('값 표기', () => {
  it('점수/기간/차등점수제', () => {
    expect(formatScore(4)).toBe('4점');
    expect(formatScore(null)).toBe('—');
    expect(formatPeriod('3년')).toBe('3년');
    expect(formatPeriod(null)).toBe('—');
    expect(formatDifferential(false)).toBe('미적용');
    expect(formatDifferential(true)).toBe('적용');
  });
});

describe('날짜', () => {
  const now = new Date(2026, 9, 17, 12, 0);
  it('포맷', () => {
    const d = new Date(2026, 9, 20, 9, 5).toISOString();
    expect(formatDateTime(d)).toBe('2026/10/20 09:05');
    expect(formatDate(d)).toBe('2026/10/20');
    expect(formatDate(undefined)).toBe('—');
  });
  it('마감 임박/경과', () => {
    expect(isDueSoon(new Date(2026, 9, 19).toISOString(), now)).toBe(true);
    expect(isDueSoon(new Date(2026, 9, 25).toISOString(), now)).toBe(false);
    expect(isDueSoon(new Date(2026, 9, 16).toISOString(), now)).toBe(false);
    expect(isPast(new Date(2026, 9, 16).toISOString(), now)).toBe(true);
  });
});
