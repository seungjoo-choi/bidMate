import { kindOf } from '../model/ids';
import type { IndexEntry } from '../types/index-file';

export type StatsPeriod = number | 'all';
export interface ResultStatsInput { entries: IndexEntry[]; period: StatsPeriod; now: Date }
export interface ResultStats {
  period: StatsPeriod;
  /** 투찰 건이 1건 이상 있는 연도 내림차순. 올해(now 기준)는 항상 포함 */
  years: number[];
  counts: { bids: number; won: number; lost: number; pending: number; winRate: number | null };
  amounts: { bidTotal: number; wonTotal: number; amountWinRate: number | null; missingBid: number; missingWon: number };
  ranks: { first: number; second: number; thirdOrBelow: number; unknown: number; avgBidders: number | null };
  /** 연도: 12개(1~12월, 비어도 0). 전체: 투찰이 있는 연도별 1개(key 'YYYY') 오름차순 */
  monthly: Array<{ key: string; label: string; bids: number; won: number; bidAmount: number; wonAmount: number }>;
  byOrg: Array<{ org: string; bids: number; won: number; lost: number; winRate: number | null; bidAmount: number; wonAmount: number }>;
  excluded: { waiting: number; notParticipated: number; noBid: number; expiredNoRank: number };
}

type R = NonNullable<IndexEntry['result']>;

/** 투찰 여부. won, lost, 또는 rank가 있는 ranked/expired. */
export function isBid(r: IndexEntry['result'] | undefined): boolean {
  if (!r) return false;
  if (r.status === 'won' || r.status === 'lost') return true;
  return (r.status === 'ranked' || r.status === 'expired') && r.rank !== undefined;
}

/** amount ?? ourAmount */
export function wonAmountOf(r: NonNullable<IndexEntry['result']>): number | undefined {
  return r.amount ?? r.ourAmount;
}

interface Item { e: IndexEntry; r: R; at: Date }

/** 입찰공고 중 result.openingAt이 유효한 항목. */
function itemsOf(entries: IndexEntry[]): Item[] {
  const out: Item[] = [];
  for (const e of entries) {
    if (kindOf(e) !== 'bid') continue;
    const r = e.result;
    if (!r?.openingAt) continue;
    const at = new Date(r.openingAt);
    if (Number.isNaN(at.getTime())) continue;
    out.push({ e, r, at });
  }
  return out;
}

const bidYears = (items: Item[]): Set<number> => new Set(items.filter((i) => isBid(i.r)).map((i) => i.at.getFullYear()));

/** 올해 투찰 1건 이상이면 올해, 아니면 투찰이 있는 가장 최근 연도, 그것도 없으면 올해 */
export function defaultPeriod(entries: IndexEntry[], now: Date): StatsPeriod {
  const years = bidYears(itemsOf(entries));
  const cur = now.getFullYear();
  if (years.has(cur)) return cur;
  return years.size > 0 ? Math.max(...years) : cur;
}

const ratio = (n: number, d: number): number | null => (d > 0 ? n / d : null);

interface Agg { bids: number; won: number; lost: number; bidAmount: number; wonAmount: number }
const emptyAgg = (): Agg => ({ bids: 0, won: 0, lost: 0, bidAmount: 0, wonAmount: 0 });
function addTo(a: Agg, r: R): void {
  a.bids++;
  if (r.status === 'won') a.won++;
  if (r.status === 'lost') a.lost++;
  if (r.ourAmount !== undefined) a.bidAmount += r.ourAmount;
  if (r.status === 'won') a.wonAmount += wonAmountOf(r) ?? 0;
}

export function computeResultStats(input: ResultStatsInput): ResultStats {
  const { entries, period, now } = input;
  const all = itemsOf(entries);
  const years = [...new Set([...bidYears(all), now.getFullYear()])].sort((a, b) => b - a);
  const inPeriod = all.filter((i) => period === 'all' || i.at.getFullYear() === period);

  const excluded = { waiting: 0, notParticipated: 0, noBid: 0, expiredNoRank: 0 };
  const bids: Item[] = [];
  for (const i of inPeriod) {
    if (isBid(i.r)) { bids.push(i); continue; }
    switch (i.r.status) {
      case 'waiting': excluded.waiting++; break;
      case 'not_participated': excluded.notParticipated++; break;
      case 'no_bid': excluded.noBid++; break;
      case 'expired': excluded.expiredNoRank++; break;
    }
  }

  const total = emptyAgg();
  let pending = 0;
  let missingBid = 0;
  let missingWon = 0;
  let wonNum = 0;
  let lostDen = 0;
  const rk = { first: 0, second: 0, thirdOrBelow: 0, unknown: 0 };
  let biddersSum = 0;
  let biddersCnt = 0;
  for (const { r } of bids) {
    addTo(total, r);
    if (r.status === 'ranked' || r.status === 'expired') pending++;
    if (r.ourAmount === undefined) missingBid++;
    if (r.status === 'won') {
      const w = wonAmountOf(r);
      if (w === undefined) missingWon++; else wonNum += w;
    }
    if (r.status === 'lost' && r.ourAmount !== undefined) lostDen += r.ourAmount;
    if (r.rank === undefined) rk.unknown++;
    else if (r.rank === 1) rk.first++;
    else if (r.rank === 2) rk.second++;
    else rk.thirdOrBelow++;
    if (r.bidders !== undefined) { biddersSum += r.bidders; biddersCnt++; }
  }

  let monthly: ResultStats['monthly'];
  if (period === 'all') {
    const by = new Map<number, Agg>();
    for (const { r, at } of bids) {
      const y = at.getFullYear();
      const a = by.get(y) ?? emptyAgg();
      addTo(a, r);
      by.set(y, a);
    }
    monthly = [...by.keys()].sort((a, b) => a - b).map((y) => {
      const a = by.get(y)!;
      return { key: String(y), label: `${y}년`, bids: a.bids, won: a.won, bidAmount: a.bidAmount, wonAmount: a.wonAmount };
    });
  } else {
    const aggs = Array.from({ length: 12 }, emptyAgg);
    for (const { r, at } of bids) addTo(aggs[at.getMonth()]!, r);
    monthly = aggs.map((a, m) => ({ key: `${period}-${String(m + 1).padStart(2, '0')}`, label: `${m + 1}월`, bids: a.bids, won: a.won, bidAmount: a.bidAmount, wonAmount: a.wonAmount }));
  }

  const orgs = new Map<string, Agg>();
  for (const { e, r } of bids) {
    const org = e.orderingOrg?.trim() || '기관 미상';
    const a = orgs.get(org) ?? emptyAgg();
    addTo(a, r);
    orgs.set(org, a);
  }
  const byOrg = [...orgs.entries()]
    .map(([org, a]) => ({ org, bids: a.bids, won: a.won, lost: a.lost, winRate: ratio(a.won, a.won + a.lost), bidAmount: a.bidAmount, wonAmount: a.wonAmount }))
    .sort((x, y) => y.bids - x.bids || y.won - x.won || x.org.localeCompare(y.org, 'ko'));

  return {
    period,
    years,
    counts: { bids: total.bids, won: total.won, lost: total.lost, pending, winRate: ratio(total.won, total.won + total.lost) },
    amounts: { bidTotal: total.bidAmount, wonTotal: total.wonAmount, amountWinRate: ratio(wonNum, wonNum + lostDen), missingBid, missingWon },
    ranks: { ...rk, avgBidders: biddersCnt > 0 ? Math.round((biddersSum / biddersCnt) * 10) / 10 : null },
    monthly,
    byOrg,
    excluded,
  };
}
