import { describe, expect, it } from 'vitest';
import { followNextCheckAt, followStartAt, isKstWeekday, kstParts, nextKstSlot } from '../../src/core/results/schedule';

const kst = (s: string): number => Date.parse(`${s}+09:00`);
const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17];
const MIN = 60_000;

describe('schedule', () => {
  it('kstParts: UTC 경계에서 KST 날짜가 넘어간다', () => {
    const p = kstParts(Date.parse('2026-10-19T15:30:00Z')); // 월 24:30 UTC가 아니라 KST 화 00:30
    expect(p).toMatchObject({ dow: 2, hour: 0, minute: 30 });
    expect(p.dayStartMs).toBe(kst('2026-10-20T00:00:00'));
    expect(isKstWeekday(kst('2026-10-24T12:00:00'))).toBe(false); // 토
  });

  it('nextKstSlot', () => {
    expect(nextKstSlot(kst('2026-10-23T17:30:00'), HOURS)).toBe(kst('2026-10-26T09:00:00')); // 금 -> 월
    expect(nextKstSlot(kst('2026-10-21T12:10:00'), HOURS)).toBe(kst('2026-10-21T13:00:00'));
    expect(nextKstSlot(kst('2026-10-24T11:00:00'), HOURS)).toBe(kst('2026-10-26T09:00:00')); // 토
    expect(nextKstSlot(kst('2026-10-21T10:00:00'), HOURS)).toBe(kst('2026-10-21T11:00:00')); // 정각은 다음 칸
  });

  it('followStartAt: 둘 중 늦은 값, 없으면 null', () => {
    expect(followStartAt('2026-10-20T10:00:00+09:00', '2026-10-20T14:00:00+09:00')).toBe(new Date(kst('2026-10-20T14:00:00')).toISOString());
    expect(followStartAt(null, '2026-10-20T14:00:00+09:00')).toBe(new Date(kst('2026-10-20T14:00:00')).toISOString());
    expect(followStartAt(null, null)).toBeNull();
  });

  it('followNextCheckAt 규칙', () => {
    const startAt = new Date(kst('2026-10-21T10:00:00')).toISOString();
    const s = kst('2026-10-21T10:00:00');
    expect(followNextCheckAt({ status: 'won', startAt }, s)).toBeNull();
    expect(followNextCheckAt({ status: 'waiting', startAt }, s - 60 * MIN)).toBe(s + 10 * MIN);
    expect(followNextCheckAt({ status: 'waiting', startAt }, s + 5 * 60 * MIN + 59 * MIN)).toBe(s + 5 * 60 * MIN + 59 * MIN + 10 * MIN);
    expect(followNextCheckAt({ status: 'waiting', startAt }, s + 6 * 60 * MIN)).toBe(kst('2026-10-21T17:00:00')); // 16:00 다음 정시
    expect(followNextCheckAt({ status: 'ranked', startAt }, kst('2026-10-23T17:01:00'))).toBe(kst('2026-10-26T10:00:00'));
    expect(followNextCheckAt({ status: 'ranked', startAt }, kst('2026-10-21T11:00:00'))).toBe(kst('2026-10-21T14:00:00'));
  });
});
