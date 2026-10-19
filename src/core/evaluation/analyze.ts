import type { EvalItem, EvalRecord } from '../types/evaluation';
import { normalizeBizNo } from './company';

export interface TotalsOpts { excludeJudges?: Set<number> }
export interface BidderTotal {
  seq: number;
  /** judge index 순서. 제외했거나 점수가 없는 위원은 null */
  byJudge: Array<number | null>;
  mean: number | null; median: number | null; min: number | null; max: number | null; sd: number | null;
  /** 유효 위원이 3명 미만이면 null. 최고와 최저를 1개씩 뺀 평균 */
  trimmedMean: number | null;
}

/** 부동소수 누적 오차로 동점이 깨지지 않도록 모든 합계와 파생값을 소수 6자리로 맞춘다. */
const q = (x: number): number => Math.round(x * 1e6) / 1e6 || 0; // -0은 0으로
const qn = (x: number | null): number | null => (x === null ? null : q(x));
const nums = (xs: Array<number | null>): number[] => xs.filter((x): x is number => x !== null);
const avg = (xs: Array<number | null>): number | null => {
  const v = nums(xs);
  return v.length === 0 ? null : q(v.reduce((a, b) => a + b, 0) / v.length);
};

/** opts의 제외 위원에 시스템이 제외한 위원(judge.excluded)을 합친다. */
function skippedJudges(rec: EvalRecord, opts: TotalsOpts = {}): Set<number> {
  const out = new Set<number>(opts.excludeJudges ?? []);
  for (const j of rec.judges) if (j.excluded) out.add(j.index);
  return out;
}
const isExcludedBidder = (rec: EvalRecord, seq: number): boolean => rec.bidders.find((b) => b.seq === seq)?.excluded === true;

function ourSeqOf(rec: EvalRecord, ourBizNo: string | null): number | null {
  const biz = normalizeBizNo(ourBizNo ?? '');
  if (biz.length !== 10) return null;
  return rec.bidders.find((b) => b.bizNo === biz)?.seq ?? null;
}

const leafOf = (rec: EvalRecord): EvalItem[] => rec.items.filter((i) => i.leaf);

/** 업체별 위원 합계(leaf 점수 합)와 통계. 평균은 null 칸을 제외한다. */
export function bidderTotals(rec: EvalRecord, opts: TotalsOpts = {}): BidderTotal[] {
  const leaf = new Set(leafOf(rec).map((i) => i.no));
  const skip = skippedJudges(rec, opts);
  const sums = new Map<string, number>();
  for (const s of rec.scores) {
    if (!leaf.has(s.i)) continue;
    const k = `${s.b}|${s.j}`;
    sums.set(k, (sums.get(k) ?? 0) + s.s);
  }
  return rec.bidders.map((b) => {
    const byJudge = rec.judges.map((j) => (skip.has(j.index) ? null : qn(sums.get(`${b.seq}|${j.index}`) ?? null)));
    const v = nums(byJudge).sort((x, y) => x - y);
    if (v.length === 0) return { seq: b.seq, byJudge, mean: null, median: null, min: null, max: null, sd: null, trimmedMean: null };
    const mean = q(v.reduce((a, c) => a + c, 0) / v.length);
    const mid = Math.floor(v.length / 2);
    return {
      seq: b.seq, byJudge, mean,
      median: q(v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2),
      min: v[0]!, max: v[v.length - 1]!,
      sd: q(Math.sqrt(v.reduce((a, c) => a + (c - mean) ** 2, 0) / v.length)),
      trimmedMean: v.length < 3 ? null : q(v.slice(1, -1).reduce((a, c) => a + c, 0) / (v.length - 2)),
    };
  });
}

/** 내림차순 순위. 동점은 같은 순위(1,2,2,4). null은 순위 null. */
export function rankOf(values: Array<{ seq: number; value: number | null }>): Map<number, number | null> {
  const out = new Map<number, number | null>();
  for (const a of values) {
    out.set(a.seq, a.value === null ? null : 1 + values.filter((b) => b.value !== null && q(b.value) > q(a.value as number)).length);
  }
  return out;
}

/** 제외된 업체는 순위에서 빼고 rank를 null로 한다. */
const meanRanks = (rec: EvalRecord, t: BidderTotal[]) => rankOf(t.map((x) => ({ seq: x.seq, value: isExcludedBidder(rec, x.seq) ? null : x.mean })));
/** 위원 평균 기준 순위(제외 업체는 null). 화면 표시용 */
export function totalRanks(rec: EvalRecord, totals: BidderTotal[]): Map<number, number | null> {
  return meanRanks(rec, totals);
}
/** 위원별 열 최고 합계(제외 위원, 제외 업체는 빼고 비교 업체가 2곳 미만이면 null) */
export function columnMax(rec: EvalRecord, totals: BidderTotal[]): Array<number | null> {
  return rec.judges.map((_, ji) => {
    const vs = nums(totals.filter((t) => !isExcludedBidder(rec, t.seq)).map((t) => t.byJudge[ji] ?? null));
    return vs.length < 2 ? null : Math.max(...vs);
  });
}
/** 순위 1인 업체가 하나일 때만 그 seq */
const uniqueTop = (ranks: Map<number, number | null>): number | null => {
  const tops = [...ranks].filter(([, r]) => r === 1);
  return tops.length === 1 ? tops[0]![0] : null;
};

export interface JudgeProfile {
  index: number; key: string | null;
  bias: number | null; spread: number | null; topSeq: number | null;
  agreesWithConsensus: boolean | null; ourDelta: number | null;
  /** duel을 주고 우리 회사가 그 안에 있을 때: 이 위원이 준 우리 합계 - 상대 합계 */
  duelGap: number | null;
}

export function judgeProfiles(rec: EvalRecord, ourBizNo: string | null, opts: TotalsOpts = {}, duel: Duel | null = null): JudgeProfile[] {
  const totals = bidderTotals(rec, opts);
  const consensusTop = uniqueTop(meanRanks(rec, totals));
  const our = ourSeqOf(rec, ourBizNo);
  return rec.judges.map((j, ji) => {
    const mine = totals.map((t) => ({ seq: t.seq, v: t.byJudge[ji]!, mean: t.mean })).filter((x) => x.v !== null && !isExcludedBidder(rec, x.seq)); // 제외 업체는 점수가 비정상일 수 있어 성향 계산에서도 뺀다
    if (mine.length === 0) return { index: j.index, key: j.key, bias: null, spread: null, topSeq: null, agreesWithConsensus: null, ourDelta: null, duelGap: null };
    const vs = mine.map((x) => x.v as number);
    const topSeq = uniqueTop(rankOf(mine.map((x) => ({ seq: x.seq, value: x.v }))));
    const ourRow = mine.find((x) => x.seq === our);
    const rival = duel && our !== null ? (duel.lead === our ? duel.chase : duel.chase === our ? duel.lead : null) : null;
    const rivalV = rival === null ? null : (totals.find((t) => t.seq === rival)?.byJudge[ji] ?? null);
    const ourV = our === null ? null : (totals.find((t) => t.seq === our)?.byJudge[ji] ?? null);
    return {
      index: j.index, key: j.key,
      bias: avg(mine.map((x) => (x.mean === null ? null : q((x.v as number) - x.mean)))),
      spread: q(Math.max(...vs) - Math.min(...vs)),
      topSeq,
      agreesWithConsensus: topSeq === null || consensusTop === null ? null : topSeq === consensusTop,
      ourDelta: ourRow && ourRow.mean !== null ? q((ourRow.v as number) - ourRow.mean) : null,
      duelGap: ourV !== null && rivalV !== null ? q(ourV - rivalV) : null,
    };
  });
}

export interface ItemGap {
  itemNo: string; names: string[]; maxScore: number | null;
  byBidder: Array<{ seq: number; mean: number | null }>;
  ourMean: number | null; bestOtherMean: number | null; gap: number | null; gapRatio: number | null;
  byJudgeOurs: Array<number | null>;
}

/** leaf 항목별로 우리 평균과 가장 높은 경쟁사 평균의 차이. gap 오름차순(null은 뒤). */
export function itemGaps(rec: EvalRecord, ourBizNo: string | null, opts: TotalsOpts = {}): ItemGap[] {
  const our = ourSeqOf(rec, ourBizNo);
  const skip = skippedJudges(rec, opts);
  const cell = new Map<string, number>();
  for (const s of rec.scores) cell.set(`${s.b}|${s.j}|${s.i}`, s.s);
  const out = leafOf(rec).map((it): ItemGap => {
    const byBidder = rec.bidders.map((b) => ({ seq: b.seq, mean: avg(rec.judges.map((j) => (skip.has(j.index) ? null : (cell.get(`${b.seq}|${j.index}|${it.no}`) ?? null)))) }));
    const ourMean = our === null ? null : (byBidder.find((x) => x.seq === our)?.mean ?? null);
    const others = nums(byBidder.filter((x) => x.seq !== our && !isExcludedBidder(rec, x.seq)).map((x) => x.mean));
    const bestOtherMean = our === null || others.length === 0 ? null : Math.max(...others);
    const gap = ourMean !== null && bestOtherMean !== null ? q(ourMean - bestOtherMean) : null;
    return {
      itemNo: it.no, names: it.names, maxScore: it.maxScore, byBidder, ourMean, bestOtherMean, gap,
      gapRatio: gap !== null && it.maxScore ? q(gap / it.maxScore) : null,
      byJudgeOurs: rec.judges.map((j) => (our === null || skip.has(j.index) ? null : (cell.get(`${our}|${j.index}|${it.no}`) ?? null))),
    };
  });
  return out
    .map((g, i) => ({ g, i }))
    .sort((a, b) => (a.g.gap === null ? 1 : 0) - (b.g.gap === null ? 1 : 0) || (a.g.gap ?? 0) - (b.g.gap ?? 0) || a.i - b.i)
    .map((x) => x.g);
}

export interface LeaveOneOut { judgeIndex: number; ranks: Map<number, number | null>; firstChanged: boolean; ourRankDelta: number | null }

/** 위원 한 명씩 뺀 평균 기준 순위. 1위 집합이 바뀌면 firstChanged. */
export function leaveOneOut(rec: EvalRecord, ourBizNo: string | null, opts: TotalsOpts = {}): LeaveOneOut[] {
  const our = ourSeqOf(rec, ourBizNo);
  const base = meanRanks(rec, bidderTotals(rec, opts));
  const topSet = (r: Map<number, number | null>) => [...r].filter(([, v]) => v === 1).map(([k]) => k).sort().join(',');
  return rec.judges.map((j) => {
    const ranks = meanRanks(rec, bidderTotals(rec, { excludeJudges: new Set([...(opts.excludeJudges ?? []), j.index]) }));
    const a = our === null ? null : (base.get(our) ?? null);
    const b = our === null ? null : (ranks.get(our) ?? null);
    return { judgeIndex: j.index, ranks, firstChanged: topSet(base) !== topSet(ranks), ourRankDelta: a !== null && b !== null ? b - a : null };
  });
}

export interface OfficialCompareRow {
  seq: number; bizNo: string; name: string; judgeMean: number | null;
  techRaw: number | null; techScore: number | null; priceScore: number | null; totalScore: number | null; rank: number | null; matched: boolean;
}

export function officialCompare(rec: EvalRecord): OfficialCompareRow[] {
  const totals = bidderTotals(rec);
  return rec.bidders.map((b) => {
    const row = rec.official?.rows.find((r) => r.bizNo === b.bizNo);
    return {
      seq: b.seq, bizNo: b.bizNo, name: b.name, judgeMean: totals.find((t) => t.seq === b.seq)?.mean ?? null,
      techRaw: row?.techRaw ?? null, techScore: row?.techScore ?? null, priceScore: row?.priceScore ?? null,
      totalScore: row?.totalScore ?? null, rank: row?.rank ?? null, matched: !!row,
    };
  });
}

export function sheetGroups(rec: EvalRecord): Array<{ sheetNo: string; items: EvalItem[] }> {
  const m = new Map<string, EvalItem[]>();
  for (const it of rec.items) {
    const list = m.get(it.sheetNo);
    if (list) list.push(it); else m.set(it.sheetNo, [it]);
  }
  return [...m].map(([sheetNo, items]) => ({ sheetNo, items }));
}

const PRICE_EPS = 0.0005;

/** 가격 배점. 기술 배점이 숫자일 때만 100에서 뺀 값 */
export function priceWeightOf(rec: EvalRecord): number | null {
  return typeof rec.techWeight === 'number' && Number.isFinite(rec.techWeight) ? q(100 - rec.techWeight) : null;
}

export interface FormulaCheck { ok: boolean; reason?: string }

/** 공개 API 가격점수가 `가격배점 x 최저 투찰가 / 투찰가` 공식과 맞는지 */
export function verifyPriceFormula(rec: EvalRecord): FormulaCheck {
  const pw = priceWeightOf(rec);
  if (pw === null) return { ok: false, reason: '기술 배점을 알 수 없어 가격 공식을 확인 불가' };
  const rows = rec.official?.rows ?? [];
  if (rows.length < 2) return { ok: false, reason: '공식 결과가 2개 업체 이상 없어 가격 공식을 확인 불가' };
  const amounts: number[] = [];
  for (const r of rows) {
    if (r.bidAmount === null || r.priceScore === null || r.bidAmount <= 0) return { ok: false, reason: '투찰금액 또는 가격점수가 없어 가격 공식을 확인 불가' };
    amounts.push(r.bidAmount);
  }
  const lowest = Math.min(...amounts);
  for (const r of rows) {
    if (Math.abs(pw * lowest / (r.bidAmount as number) - (r.priceScore as number)) > PRICE_EPS) return { ok: false, reason: '가격점수가 최저가 비례 공식과 불일치' };
  }
  return { ok: true };
}

/** 공개 API 기술점수가 차등보정(1위를 만점으로 올리고 전원 같은 폭 이동)과 맞는지 */
export function verifyTechAdjust(rec: EvalRecord): FormulaCheck {
  const w = rec.techWeight;
  if (typeof w !== 'number' || !Number.isFinite(w)) return { ok: false, reason: '기술 배점을 알 수 없어 기술 보정을 확인 불가' };
  const rows = rec.official?.rows ?? [];
  if (rows.length === 0) return { ok: false, reason: '공식 결과가 없어 기술 보정을 확인 불가' };
  const raws: number[] = [];
  for (const r of rows) {
    if (r.techRaw === null || r.techScore === null) return { ok: false, reason: '기술 원점수 또는 기술점수가 없어 기술 보정을 확인 불가' };
    raws.push(r.techRaw);
  }
  const top = Math.max(...raws);
  for (const r of rows) {
    if (Math.abs((r.techRaw as number) + (w - top) - (r.techScore as number)) > PRICE_EPS) return { ok: false, reason: '기술점수가 차등보정 공식과 불일치' };
  }
  return { ok: true };
}

export interface Duel { lead: number; chase: number; leadRank: number | null; chaseRank: number | null; basis: 'official' | 'judges' }

/** 승부를 가를 두 업체(bidder seq). 공식 순위가 있으면 그것(opts 무시), 없으면 위원 평균 순위(opts의 제외 위원 반영). */
export function pickDuel(rec: EvalRecord, ourBizNo: string | null, opts: TotalsOpts = {}): Duel | null {
  const live = rec.bidders.filter((b) => !b.excluded);
  if (live.length < 2) return null;
  const off = new Map(live.map((b) => [b.seq, rec.official?.rows.find((r) => r.bizNo === b.bizNo)?.rank ?? null] as const));
  const useOfficial = live.every((b) => off.get(b.seq) !== null);
  const rankMap = useOfficial ? off : meanRanks(rec, bidderTotals(rec, opts));
  const ranked = live.filter((b) => rankMap.get(b.seq) != null).sort((a, b) => (rankMap.get(a.seq) as number) - (rankMap.get(b.seq) as number) || a.seq - b.seq);
  if (ranked.length < 2) return null;
  const basis = useOfficial ? 'official' : 'judges';
  const our = ourSeqOf(rec, ourBizNo);
  const first = ranked[0]!.seq;
  const mk = (lead: number, chase: number): Duel => ({ lead, chase, leadRank: rankMap.get(lead) ?? null, chaseRank: rankMap.get(chase) ?? null, basis });
  if (our !== null && ranked.some((b) => b.seq === our)) {
    if (our === first) return mk(our, ranked[1]!.seq);
    return mk(first, our);
  }
  return mk(first, ranked[1]!.seq);
}

export interface Decomposition {
  totalDiff: number; techDiff: number; priceDiff: number; bidCutPct: number;
  priceFormulaOk: boolean; techAdjustOk: boolean; chaserPriceMaxed: boolean; cutNeededPct: number | null;
  /** 기술은 앞서거나 같았는데 가격으로 진 공고에서, 이기려면 투찰가를 더 낮췄어야 하는 비율(%) */
  priceCutToWinPct: number | null;
}

/** lead - chase 공식 점수 차이를 기술과 가격으로 나눈다. 둘 중 하나라도 공식 행이 없으면 null. */
export function decompose(rec: EvalRecord, duel: Duel): Decomposition | null {
  const bizOf = (seq: number) => rec.bidders.find((b) => b.seq === seq)?.bizNo;
  const rowOf = (seq: number) => rec.official?.rows.find((r) => r.bizNo === bizOf(seq));
  const l = rowOf(duel.lead);
  const c = rowOf(duel.chase);
  if (!l || !c) return null;
  if (l.totalScore === null || c.totalScore === null || l.techScore === null || c.techScore === null
    || l.priceScore === null || c.priceScore === null || l.bidAmount === null || c.bidAmount === null || l.bidAmount <= 0) return null;
  const pw = priceWeightOf(rec);
  const priceFormulaOk = verifyPriceFormula(rec).ok;
  const techDiff = q(l.techScore - c.techScore);
  return {
    totalDiff: q(l.totalScore - c.totalScore), techDiff, priceDiff: q(l.priceScore - c.priceScore),
    bidCutPct: q((1 - c.bidAmount / l.bidAmount) * 100),
    priceFormulaOk, techAdjustOk: verifyTechAdjust(rec).ok,
    chaserPriceMaxed: pw !== null && c.priceScore >= pw - PRICE_EPS,
    cutNeededPct: priceFormulaOk && pw && techDiff > 0 ? q(techDiff / pw * 100) : null,
    priceCutToWinPct: priceFormulaOk && pw && techDiff <= 0 && q(l.totalScore - c.totalScore) > 0 ? q(q(l.totalScore - c.totalScore) / (pw / 100)) : null,
  };
}

export interface ReversalDistance {
  validJudges: number;
  /** behind=쫓는 쪽이 위원 합계에서 뒤짐, tie=같음, ahead=앞섬. tie와 ahead에서 local, top3, stepsNeeded는 null */
  relation: 'behind' | 'tie' | 'ahead';
  gapSum: number; behindCount: number; top3Recovery: number | null; top3Ratio: number | null; local: boolean | null;
  maxItemScore: number | null; stepsNeeded: number | null; cellsOfMax: number | null;
}

/** lead가 앞선 점수를 chase가 얼마나 따라잡아야 하는지. 유효 위원(제외 안 된 위원)만 쓴다. */
export function reversalDistance(rec: EvalRecord, duel: Duel, opts: TotalsOpts = {}): ReversalDistance {
  const skip = skippedJudges(rec, opts);
  const judges = rec.judges.filter((j) => !skip.has(j.index));
  const leaf = leafOf(rec);
  const cell = new Map<string, number>();
  for (const s of rec.scores) cell.set(`${s.b}|${s.j}|${s.i}`, s.s);
  const diffs = (it: EvalItem): number[] => judges.flatMap((j) => {
    const a = cell.get(`${duel.lead}|${j.index}|${it.no}`);
    const b = cell.get(`${duel.chase}|${j.index}|${it.no}`);
    return a === undefined || b === undefined ? [] : [q(a - b)];
  });
  const perItem = leaf.map((it) => diffs(it));
  const gapSum = q(perItem.reduce((t, d) => t + d.reduce((x, y) => x + y, 0), 0));
  const behindCount = perItem.filter((d) => d.length > 0 && q(d.reduce((x, y) => x + y, 0) / d.length) > 0).length;
  const recov = perItem.map((d) => q(d.reduce((x, y) => x + Math.max(0, y), 0))).sort((a, b) => b - a);
  const top3Recovery = q(recov.slice(0, 3).reduce((x, y) => x + y, 0));
  const grade = leaf.length > 0 && leaf.every((i) => i.method === '등급' && i.maxScore !== null);
  const maxItemScore = grade ? Math.max(...leaf.map((i) => i.maxScore as number)) : null;
  const relation = gapSum > 0 ? 'behind' : gapSum === 0 ? 'tie' : 'ahead';
  const ahead = relation !== 'behind';
  return {
    validJudges: judges.length, relation, gapSum, behindCount, top3Recovery: ahead ? null : top3Recovery,
    top3Ratio: ahead ? null : Math.min(q(top3Recovery / gapSum), 1),
    local: ahead ? null : top3Recovery >= gapSum,
    maxItemScore,
    stepsNeeded: maxItemScore && !ahead ? Math.ceil(q(gapSum / (maxItemScore / 10))) : null,
    cellsOfMax: maxItemScore ? leaf.filter((i) => i.maxScore === maxItemScore).length * judges.length : null,
  };
}

/** 배점 대비 비율의 4단계. 0=100%, 1=90%, 2=80%, 3=그 미만 */
export function gradeLevel(ratio: number): 0 | 1 | 2 | 3 {
  const r = q(ratio);
  return r >= 0.995 ? 0 : r >= 0.895 ? 1 : r >= 0.795 ? 2 : 3;
}

export interface GradeGroup { group: string; maxScore: number; counts: [number, number, number, number] }

/** 대항목(depth1 이름)별로 위원 x 세부항목 칸을 배점 대비 비율 4단계로 센다. */
export function gradeDistribution(rec: EvalRecord, seq: number, opts: TotalsOpts = {}): GradeGroup[] {
  const skip = skippedJudges(rec, opts);
  const cell = new Map<string, number>();
  for (const s of rec.scores) cell.set(`${s.b}|${s.j}|${s.i}`, s.s);
  const out = new Map<string, GradeGroup>();
  for (const it of leafOf(rec)) {
    const name = it.names[0]?.trim() || '기타';
    const g = out.get(name) ?? { group: name, maxScore: 0, counts: [0, 0, 0, 0] as [number, number, number, number] };
    g.maxScore = q(g.maxScore + (it.maxScore ?? 0));
    out.set(name, g);
    if (!it.maxScore) continue;
    for (const j of rec.judges) {
      if (skip.has(j.index)) continue;
      const v = cell.get(`${seq}|${j.index}|${it.no}`);
      if (v === undefined) continue;
      g.counts[gradeLevel(v / it.maxScore)]++;
    }
  }
  return [...out.values()];
}

export interface HeatCell { judge: number; score: number | null; level: 0 | 1 | 2 | 3 | null; lost: boolean; revised: number | null; skipped: boolean }
export interface HeatRow { itemNo: string; names: string[]; maxScore: number | null; cells: HeatCell[] }

/** 한 업체의 위원 x leaf 항목 칸. lost는 제외 안 된 위원이 같은 칸에서 against 업체(없으면 제외 업체를 뺀 다른 모든 업체의 최고값)보다 낮게 준 경우. */
export function heatmap(rec: EvalRecord, seq: number, opts: TotalsOpts = {}, against: number | null = null): HeatRow[] {
  const skip = skippedJudges(rec, opts);
  const cell = new Map<string, { s: number; r?: number }>();
  for (const s of rec.scores) cell.set(`${s.b}|${s.j}|${s.i}`, { s: s.s, r: s.r });
  const others = rec.bidders.filter((b) => b.seq !== seq && !b.excluded && (against === null || b.seq === against));
  return leafOf(rec).map((it) => ({
    itemNo: it.no, names: it.names, maxScore: it.maxScore,
    cells: rec.judges.map((j): HeatCell => {
      const mine = cell.get(`${seq}|${j.index}|${it.no}`);
      const otherMax = Math.max(-Infinity, ...others.flatMap((b) => { const c = cell.get(`${b.seq}|${j.index}|${it.no}`); return c ? [c.s] : []; }));
      const skipped = skip.has(j.index);
      return {
        judge: j.index, score: mine?.s ?? null, skipped,
        level: mine && it.maxScore ? gradeLevel(mine.s / it.maxScore) : null,
        lost: !!mine && !skipped && otherMax !== -Infinity && q(mine.s) < q(otherMax),
        revised: mine?.r ?? null,
      };
    }),
  }));
}

export interface ExchangeRatio { pricePerCut: number; gradeStep: number | null; cutEquivalent: number | null }

/** 투찰가 1% 인하 점수(가격배점/100), 최대 배점 항목 위원 1명 1등급 점수, 그 둘의 비율(투찰가 몇 % 인하와 같은지) */
export function exchangeRatio(priceWeight: number, maxItemScore: number | null, validJudges: number): ExchangeRatio | null {
  if (!(priceWeight > 0)) return null;
  const pricePerCut = q(priceWeight / 100);
  if (maxItemScore === null || !(maxItemScore > 0) || validJudges <= 0) return { pricePerCut, gradeStep: null, cutEquivalent: null };
  const gradeStep = q(maxItemScore / 10 / validJudges);
  return { pricePerCut, gradeStep, cutEquivalent: q(gradeStep / pricePerCut) };
}

export interface TimelineEntry {
  noticeId: string; title: string; evaluatedAt: string | null;
  ourRank: number | null; ourMean: number | null; topMean: number | null; bidderCount: number; judgeCount: number;
}
export interface ItemWeakness { name: string; count: number; meanGapRatio: number | null }
export interface JudgeAggregate { key: string; count: number; noticeIds: string[]; meanOurDelta: number | null; meanBias: number | null }
export interface CompetitorRecord { bizNo: string; name: string; met: number; wins: number; losses: number; ties: number }
export interface Cumulative {
  timeline: TimelineEntry[]; itemWeakness: ItemWeakness[]; judges: JudgeAggregate[]; competitors: CompetitorRecord[];
}

export function cumulative(records: EvalRecord[], ourBizNo: string | null): Cumulative {
  const timeline: TimelineEntry[] = [];
  const weak = new Map<string, Array<number | null>>();
  const judges = new Map<string, { ids: string[]; deltas: Array<number | null>; biases: Array<number | null> }>();
  const comps = new Map<string, CompetitorRecord>();

  for (const rec of records) {
    const totals = bidderTotals(rec);
    const ranks = meanRanks(rec, totals);
    const our = ourSeqOf(rec, ourBizNo);
    const ourTotal = totals.find((t) => t.seq === our);
    timeline.push({
      noticeId: rec.noticeId, title: rec.title, evaluatedAt: rec.evaluatedAt,
      ourRank: our === null ? null : (ranks.get(our) ?? null), ourMean: ourTotal?.mean ?? null,
      topMean: nums(totals.filter((t) => !isExcludedBidder(rec, t.seq)).map((t) => t.mean)).reduce<number | null>((m, v) => (m === null || v > m ? v : m), null),
      bidderCount: rec.bidders.filter((b) => !b.excluded).length, judgeCount: rec.judges.filter((j) => !j.excluded).length,
    });

    if (our !== null) {
      // 우리 업체가 제외된 공고는 약점 누적에서 뺀다.
      for (const g of isExcludedBidder(rec, our) ? [] : itemGaps(rec, ourBizNo)) {
        const name = g.names[0]?.trim();
        if (!name) continue;
        const list = weak.get(name) ?? [];
        list.push(g.gapRatio);
        weak.set(name, list);
      }
      const ourRank = ranks.get(our) ?? null;
      for (const b of rec.bidders) {
        if (b.seq === our || ourRank === null) continue;
        const theirs = ranks.get(b.seq) ?? null;
        if (theirs === null) continue;
        const c = comps.get(b.bizNo) ?? { bizNo: b.bizNo, name: b.name, met: 0, wins: 0, losses: 0, ties: 0 };
        c.name = b.name;
        c.met++;
        if (ourRank < theirs) c.wins++; else if (ourRank > theirs) c.losses++; else c.ties++;
        comps.set(b.bizNo, c);
      }
    }

    for (const p of judgeProfiles(rec, ourBizNo)) {
      if (!p.key || p.spread === null) continue; // 점수가 하나도 없는 위원은 제외
      const a = judges.get(p.key) ?? { ids: [], deltas: [], biases: [] };
      a.ids.push(rec.noticeId);
      a.deltas.push(p.ourDelta);
      a.biases.push(p.bias);
      judges.set(p.key, a);
    }
  }

  timeline.sort((a, b) => (a.evaluatedAt === null ? 1 : 0) - (b.evaluatedAt === null ? 1 : 0)
    || (a.evaluatedAt ?? '').localeCompare(b.evaluatedAt ?? '') || a.noticeId.localeCompare(b.noticeId));
  return {
    timeline,
    itemWeakness: [...weak].map(([name, r]) => ({ name, count: r.length, meanGapRatio: avg(r) }))
      .sort((a, b) => (a.meanGapRatio === null ? 1 : 0) - (b.meanGapRatio === null ? 1 : 0) || (a.meanGapRatio ?? 0) - (b.meanGapRatio ?? 0)),
    judges: [...judges].map(([key, a]) => ({ key, count: a.ids.length, noticeIds: a.ids, meanOurDelta: avg(a.deltas), meanBias: avg(a.biases) })),
    competitors: [...comps.values()].sort((a, b) => b.met - a.met || a.bizNo.localeCompare(b.bizNo)),
  };
}
