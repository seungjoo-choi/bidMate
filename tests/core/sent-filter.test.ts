import { describe, expect, it } from 'vitest';
import { dayEdge, filterSent, rangeOf } from '../../src/core/dashboard/sent-filter';
import type { SentIndexEntry } from '../../src/core/types/compose';

const e = (id: string, sentAt: string, over: Partial<SentIndexEntry> = {}): SentIndexEntry => ({
  id, noticeId: `n-${id}`, noticeNo: `2026-${id}`, round: '000', title: `공고 ${id}`, orderingOrg: '기관A', folder: 'f',
  sentAt, source: 'manual', subject: `제목 ${id}`, toCount: 1, ccCount: 0, attachmentCount: 0, ...over,
});
const base = { query: '', source: 'all' as const, includeVoided: true };

describe('filterSent', () => {
  const list = [
    e('1', '2026-10-01T00:00:00.000Z'),
    e('2', '2026-10-10T00:00:00.000Z', { source: 'auto', orderingOrg: 'Seoul Office' }),
    e('3', '2026-10-05T00:00:00.000Z', { voidedAt: '2026-10-06T00:00:00.000Z', title: '특별 용역' }),
  ];
  it('sentAt 내림차순', () => {
    expect(filterSent(list, base).map((x) => x.id)).toEqual(['2', '3', '1']);
  });
  it('기간 경계는 from/to 포함', () => {
    const from = Date.parse('2026-10-05T00:00:00.000Z');
    const to = Date.parse('2026-10-10T00:00:00.000Z');
    expect(filterSent(list, { ...base, from, to }).map((x) => x.id)).toEqual(['2', '3']);
    expect(filterSent(list, { ...base, from: to + 1 })).toEqual([]);
    expect(filterSent(list, { ...base, to: from - 1 }).map((x) => x.id)).toEqual(['1']);
  });
  it('검색은 대소문자 무시 부분 일치', () => {
    expect(filterSent(list, { ...base, query: 'seoul' }).map((x) => x.id)).toEqual(['2']);
    expect(filterSent(list, { ...base, query: '특별' }).map((x) => x.id)).toEqual(['3']);
    expect(filterSent(list, { ...base, query: '2026-1' }).map((x) => x.id)).toEqual(['1']);
    expect(filterSent(list, { ...base, query: '제목 3' }).map((x) => x.id)).toEqual(['3']);
  });
  it('출처 필터', () => {
    expect(filterSent(list, { ...base, source: 'auto' }).map((x) => x.id)).toEqual(['2']);
    expect(filterSent(list, { ...base, source: 'manual' }).map((x) => x.id)).toEqual(['3', '1']);
  });
  it('취소 포함 여부', () => {
    expect(filterSent(list, { ...base, includeVoided: false }).map((x) => x.id)).toEqual(['2', '1']);
  });
});

describe('rangeOf', () => {
  const now = new Date(2026, 9, 20, 14, 30);
  it('7일/30일은 now 기준', () => {
    expect(rangeOf('7d', '', '', now)).toEqual({ from: now.getTime() - 7 * 86_400_000 });
    expect(rangeOf('30d', '', '', now)).toEqual({ from: now.getTime() - 30 * 86_400_000 });
  });
  it('이번 달은 1일 0시', () => {
    expect(rangeOf('month', '', '', now)).toEqual({ from: new Date(2026, 9, 1).getTime() });
  });
  it('전체는 제한 없음', () => {
    expect(rangeOf('all', '', '', now)).toEqual({});
  });
  it('직접 입력 to는 하루 끝까지 포함', () => {
    const r = rangeOf('custom', '2026-10-01', '2026-10-10', now);
    expect(r.from).toBe(new Date(2026, 9, 1).getTime());
    expect(r.to).toBe(new Date(2026, 9, 10, 23, 59, 59, 999).getTime());
    const late = e('9', new Date(2026, 9, 10, 23, 59, 0).toISOString());
    expect(filterSent([late], { ...base, ...r })).toHaveLength(1);
  });
  it('빈 값/잘못된 값은 undefined', () => {
    expect(dayEdge('', true)).toBeUndefined();
    expect(dayEdge('abc', false)).toBeUndefined();
  });
});
