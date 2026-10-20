import { describe, expect, it } from 'vitest';
import type { IndexEntry } from '../../src/core/types/index-file';
import type { ResultStatus } from '../../src/core/types/result';
import { computeResultStats, defaultPeriod, isBid, wonAmountOf } from '../../src/core/results/stats';

type R = NonNullable<IndexEntry['result']>;
const NOW = new Date(2026, 9, 20, 12, 0);
let seq = 0;
const e = (status: ResultStatus, openingAt: string | undefined, o: Partial<R> = {}, x: Partial<IndexEntry> = {}): IndexEntry => {
  seq++;
  return { noticeId: `N${seq}-000`, noticeNo: `N${seq}`, round: '000', title: 't', orderingOrg: '기관A', folder: 'f', result: { status, ...(openingAt ? { openingAt } : {}), ...o }, ...x } as unknown as IndexEntry;
};
const at = (y: number, m: number, d = 10) => new Date(y, m - 1, d, 10, 0).toISOString();
const stats = (entries: IndexEntry[], period: number | 'all' = 2026) => computeResultStats({ entries, period, now: NOW });

describe('computeResultStats 대상', () => {
  it('투찰 판정 7상태', () => {
    expect(isBid(undefined)).toBe(false);
    const ok = (s: ResultStatus, rank?: number) => isBid({ status: s, ...(rank !== undefined ? { rank } : {}) });
    expect([ok('won'), ok('lost'), ok('ranked', 1), ok('expired', 2)]).toEqual([true, true, true, true]);
    expect([ok('waiting'), ok('not_participated'), ok('no_bid'), ok('ranked'), ok('expired')]).toEqual([false, false, false, false, false]);
  });

  it('excluded 계수, 사전규격과 openingAt 없는 항목 제외', () => {
    const s = stats([
      e('won', at(2026, 1)), e('lost', at(2026, 1)), e('ranked', at(2026, 1), { rank: 1 }), e('expired', at(2026, 1), { rank: 3 }),
      e('waiting', at(2026, 1)), e('not_participated', at(2026, 1)), e('no_bid', at(2026, 1)), e('expired', at(2026, 1)),
      e('won', at(2026, 1), {}, { kind: 'prespec' }), e('won', undefined),
      e('waiting', at(2025, 1)),
    ]);
    expect(s.counts).toMatchObject({ bids: 4, won: 1, lost: 1, pending: 2 });
    expect(s.excluded).toEqual({ waiting: 1, notParticipated: 1, noBid: 1, expiredNoRank: 1 });
  });
});

describe('computeResultStats 지표', () => {
  it('winRate: ranked 제외, won+lost 0이면 null', () => {
    const s = stats([e('won', at(2026, 1)), e('lost', at(2026, 1)), e('lost', at(2026, 1)), e('ranked', at(2026, 1), { rank: 1 })]);
    expect(s.counts.winRate).toBeCloseTo(1 / 3);
    expect(stats([e('ranked', at(2026, 1), { rank: 1 })]).counts.winRate).toBeNull();
  });

  it('amountWinRate: 값 없는 건은 양쪽 제외, ranked 미포함', () => {
    const s = stats([
      e('won', at(2026, 1), { amount: 100 }),
      e('won', at(2026, 1)),
      e('lost', at(2026, 1), { ourAmount: 300 }),
      e('lost', at(2026, 1)),
      e('ranked', at(2026, 1), { rank: 1, ourAmount: 9999 }),
    ]);
    expect(s.amounts.amountWinRate).toBeCloseTo(100 / 400);
    expect(stats([e('lost', at(2026, 1))]).amounts.amountWinRate).toBeNull();
  });

  it('wonAmountOf 대체와 missingBid/missingWon', () => {
    expect(wonAmountOf({ status: 'won', amount: 5, ourAmount: 7 })).toBe(5);
    expect(wonAmountOf({ status: 'won', ourAmount: 7 })).toBe(7);
    expect(wonAmountOf({ status: 'won' })).toBeUndefined();
    const s = stats([e('won', at(2026, 1), { ourAmount: 70 }), e('won', at(2026, 1)), e('lost', at(2026, 1), { ourAmount: 30 }), e('lost', at(2026, 1))]);
    expect(s.amounts).toMatchObject({ bidTotal: 100, wonTotal: 70, missingBid: 2, missingWon: 1 });
  });

  it('ranks와 avgBidders', () => {
    const s = stats([
      e('won', at(2026, 1), { rank: 1, bidders: 3 }), e('lost', at(2026, 1), { rank: 2, bidders: 4 }),
      e('lost', at(2026, 1), { rank: 5, bidders: 4 }), e('lost', at(2026, 1)),
    ]);
    expect(s.ranks).toEqual({ first: 1, second: 1, thirdOrBelow: 1, unknown: 1, avgBidders: 3.7 });
    expect(stats([e('lost', at(2026, 1))]).ranks.avgBidders).toBeNull();
  });
});

describe('computeResultStats 월별과 기관별', () => {
  it('월 귀속은 로컬 기준(연말 경계), 연도는 12칸 0 채움', () => {
    const s = stats([
      e('won', new Date(2026, 11, 31, 23, 30).toISOString(), { ourAmount: 10 }),
      e('lost', new Date(2026, 0, 1, 0, 30).toISOString(), { ourAmount: 20 }),
      e('lost', new Date(2025, 11, 31, 23, 30).toISOString()),
    ]);
    expect(s.monthly).toHaveLength(12);
    expect(s.monthly[0]).toMatchObject({ key: '2026-01', label: '1월', bids: 1, bidAmount: 20 });
    expect(s.monthly[11]).toMatchObject({ key: '2026-12', label: '12월', bids: 1, won: 1, bidAmount: 10, wonAmount: 10 });
    expect(s.monthly[5]).toMatchObject({ bids: 0, won: 0, bidAmount: 0, wonAmount: 0 });
  });

  it('전체는 투찰이 있는 연도별 버킷 오름차순', () => {
    const s = stats([e('won', at(2026, 3)), e('lost', at(2024, 3)), e('waiting', at(2025, 3))], 'all');
    expect(s.monthly.map((m) => [m.key, m.label, m.bids])).toEqual([['2024', '2024년', 1], ['2026', '2026년', 1]]);
    expect(s.counts.bids).toBe(2);
  });

  it('byOrg 정렬과 기관 미상', () => {
    const s = stats([
      e('lost', at(2026, 1), {}, { orderingOrg: '나기관' }), e('won', at(2026, 1), {}, { orderingOrg: '나기관' }),
      e('won', at(2026, 1), {}, { orderingOrg: '가기관' }), e('lost', at(2026, 1), {}, { orderingOrg: '다기관' }),
      e('lost', at(2026, 1), {}, { orderingOrg: '  ' }),
    ]);
    expect(s.byOrg.map((o) => o.org)).toEqual(['나기관', '가기관', '기관 미상', '다기관']);
    expect(s.byOrg[0]).toMatchObject({ bids: 2, won: 1, lost: 1, winRate: 0.5 });
  });
});

describe('defaultPeriod와 years', () => {
  it('세 분기', () => {
    expect(defaultPeriod([e('won', at(2026, 1)), e('won', at(2024, 1))], NOW)).toBe(2026);
    expect(defaultPeriod([e('won', at(2025, 1)), e('lost', at(2024, 1)), e('waiting', at(2026, 1))], NOW)).toBe(2025);
    expect(defaultPeriod([e('waiting', at(2026, 1))], NOW)).toBe(2026);
  });

  it('years는 투찰 연도 내림차순이고 올해를 항상 포함', () => {
    expect(stats([e('won', at(2024, 1)), e('lost', at(2025, 1))]).years).toEqual([2026, 2025, 2024]);
    expect(stats([e('won', at(2026, 1)), e('lost', at(2024, 1))]).years).toEqual([2026, 2024]);
  });
});
