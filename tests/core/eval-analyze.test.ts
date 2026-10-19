import { describe, expect, it } from 'vitest';
import type { EvalRaw } from '../../src/adapters/g2b/eval-api';
import { bidderTotals, cumulative, itemGaps, judgeProfiles, leaveOneOut, officialCompare, rankOf, sheetGroups } from '../../src/core/evaluation/analyze';
import { mapEvalRaw } from '../../src/core/evaluation/map';
import type { EvalRecord } from '../../src/core/types/evaluation';
import raw from '../fixtures/eval-raw-sample.json';

const BIZ = { 1: '1111111111', 2: '2222222222', 3: '3333333333' } as const;

function mk(opts: { id?: string; at?: string | null; bidders: number[]; judges: number; items: string[]; scores: Array<[number, number, string, number]>; official?: EvalRecord['official'] }): EvalRecord {
  return {
    schemaVersion: 1, noticeId: opts.id ?? 'R26BK00000001-000', noticeNo: 'R26BK00000001', round: '000', evalNo: 'E', title: '합성', orgName: '',
    evalKindName: null, techMethodName: null, techWeight: null, excludeBestWorst: null, status: 'final', evaluatedAt: opts.at === undefined ? '2026-02-01 10:00:00' : opts.at,
    bidders: opts.bidders.map((s) => ({ seq: s, bizNo: BIZ[s as 1 | 2 | 3], name: `업체${s}`, order: s, excluded: false })),
    judges: Array.from({ length: opts.judges }, (_, i) => ({ index: i + 1, key: `K${i + 1}`, excluded: false, completed: true })),
    items: opts.items.map((n, i) => ({ no: n, parentNo: null, sheetNo: i === 0 ? 'S1' : 'S2', depth: 2, names: [n === 'I1' ? 'A' : 'B', 'x'], maxScore: 10, method: null, leaf: true })),
    scores: opts.scores.map(([b, j, i, s]) => ({ b, j, i, s })),
    official: opts.official ?? null, warnings: [], collectedAt: 't', firstCollectedAt: 't',
  };
}

// 업체1: 17,19,16 / 업체2: 15,15,15 / 업체3: 15,15,15 (항목 I1, I2)
const MAIN_SCORES: Array<[number, number, string, number]> = [
  [1, 1, 'I1', 9], [1, 1, 'I2', 8], [1, 2, 'I1', 10], [1, 2, 'I2', 9], [1, 3, 'I1', 8], [1, 3, 'I2', 8],
  [2, 1, 'I1', 7], [2, 1, 'I2', 8], [2, 2, 'I1', 8], [2, 2, 'I2', 7], [2, 3, 'I1', 7], [2, 3, 'I2', 8],
  [3, 1, 'I1', 8], [3, 1, 'I2', 7], [3, 2, 'I1', 7], [3, 2, 'I2', 8], [3, 3, 'I1', 8], [3, 3, 'I2', 7],
];
const main = (o: Partial<Parameters<typeof mk>[0]> = {}) => mk({ bidders: [1, 2, 3], judges: 3, items: ['I1', 'I2'], scores: MAIN_SCORES, ...o });
const close = (a: number | null, b: number) => {
  expect(a).not.toBeNull();
  expect(Math.abs((a as number) - b)).toBeLessThan(1e-6);
};

describe('bidderTotals와 rankOf', () => {
  it('합계, 통계, 순위(동점 1,2,2)', () => {
    const t = bidderTotals(main());
    expect(t[0]!.byJudge).toEqual([17, 19, 16]);
    close(t[0]!.mean, 52 / 3);
    expect(t[0]!.median).toBe(17);
    expect([t[0]!.min, t[0]!.max]).toEqual([16, 19]);
    close(t[0]!.sd, Math.sqrt(((17 - 52 / 3) ** 2 + (19 - 52 / 3) ** 2 + (16 - 52 / 3) ** 2) / 3));
    expect(t[0]!.trimmedMean).toBe(17);
    expect(t[1]!.sd).toBe(0);
    const ranks = rankOf(t.map((x) => ({ seq: x.seq, value: x.mean })));
    expect([...ranks.values()]).toEqual([1, 2, 2]);
  });

  it('rankOf: 1,2,2,4와 null', () => {
    const r = rankOf([{ seq: 1, value: 9 }, { seq: 2, value: 8 }, { seq: 3, value: 8 }, { seq: 4, value: 1 }, { seq: 5, value: null }]);
    expect([...r.values()]).toEqual([1, 2, 2, 4, null]);
  });

  it('위원 제외: 해당 칸 null, 유효 위원 2명이면 trimmedMean null', () => {
    const t = bidderTotals(main(), { excludeJudges: new Set([3]) });
    expect(t[0]!.byJudge).toEqual([17, 19, null]);
    expect(t[0]!.mean).toBe(18);
    expect(t[0]!.trimmedMean).toBeNull();
  });

  it('점수 칸이 비면 평균에서 제외하고, 점수가 하나도 없는 위원은 null', () => {
    const scores = MAIN_SCORES.filter(([b, j]) => !(b === 3 && j === 3)); // 업체3의 위원3 전부 없음
    const t = bidderTotals(main({ scores }));
    expect(t[2]!.byJudge).toEqual([15, 15, null]);
    expect(t[2]!.mean).toBe(15);
    const partial = bidderTotals(main({ scores: MAIN_SCORES.filter(([b, j, i]) => !(b === 3 && j === 3 && i === 'I2')) }));
    expect(partial[2]!.byJudge[2]).toBe(8);
  });
});

describe('judgeProfiles', () => {
  it('bias, spread, topSeq, agreesWithConsensus, ourDelta', () => {
    const p = judgeProfiles(main(), BIZ[2]);
    close(p[0]!.bias, -1 / 9);
    close(p[1]!.bias, 5 / 9);
    expect([p[0]!.spread, p[1]!.spread, p[2]!.spread]).toEqual([2, 4, 1]);
    expect(p.map((x) => x.topSeq)).toEqual([1, 1, 1]);
    expect(p.every((x) => x.agreesWithConsensus)).toBe(true);
    close(p[0]!.ourDelta, 0);
    expect(p[0]!.key).toBe('K1');
  });
  it('우리 회사가 없으면 ourDelta는 null', () => {
    expect(judgeProfiles(main(), '9999999999').every((x) => x.ourDelta === null)).toBe(true);
    expect(judgeProfiles(main(), null)[0]!.bias).not.toBeNull();
  });
});

describe('itemGaps', () => {
  it('gap 오름차순과 값', () => {
    const g = itemGaps(main(), BIZ[2]);
    expect(g.map((x) => x.itemNo)).toEqual(['I1', 'I2']);
    close(g[0]!.gap, 22 / 3 - 9);
    close(g[0]!.gapRatio, (22 / 3 - 9) / 10);
    expect(g[0]!.byJudgeOurs).toEqual([7, 8, 7]);
    expect(itemGaps(main(), BIZ[1]).map((x) => x.itemNo)).toEqual(['I2', 'I1']);
  });
  it('우리 회사가 없으면 our 값은 전부 null', () => {
    const g = itemGaps(main(), '9999999999');
    expect(g.every((x) => x.ourMean === null && x.gap === null && x.gapRatio === null && x.bestOtherMean === null)).toBe(true);
  });
  it('null 칸은 평균에서 제외한다', () => {
    const g = itemGaps(main({ scores: MAIN_SCORES.filter(([b, j, i]) => !(b === 3 && j === 3 && i === 'I2')) }), BIZ[1]);
    const i2 = g.find((x) => x.itemNo === 'I2')!;
    expect(i2.byBidder.find((b) => b.seq === 3)!.mean).toBe(7.5);
  });
});

describe('leaveOneOut', () => {
  it('위원을 빼면 순위가 바뀌는지', () => {
    // 업체1: 10,10,4(평균 8), 업체2: 7,7,7(평균 7)
    const rec = mk({ bidders: [1, 2], judges: 3, items: ['I1'], scores: [[1, 1, 'I1', 10], [1, 2, 'I1', 10], [1, 3, 'I1', 4], [2, 1, 'I1', 7], [2, 2, 'I1', 7], [2, 3, 'I1', 7]] });
    const r = leaveOneOut(rec, BIZ[2]);
    expect(r.map((x) => x.firstChanged)).toEqual([true, true, false]);
    expect(r[0]!.ranks.get(2)).toBe(1);
    expect(r[0]!.ourRankDelta).toBe(-1);
    expect(r[2]!.ourRankDelta).toBe(0);
    expect(leaveOneOut(rec, null)[0]!.ourRankDelta).toBeNull();
  });
});

describe('officialCompare와 sheetGroups', () => {
  it('bizNo로 공식 결과를 매칭한다', () => {
    const rec = main({ official: { fetchedAt: 't', rows: [{ bizNo: BIZ[1], rank: 1, bidAmount: 1, priceScore: 10, techScore: 80, totalScore: 90, techRaw: 85 }] } });
    const c = officialCompare(rec);
    expect(c[0]).toMatchObject({ matched: true, rank: 1, totalScore: 90, techRaw: 85 });
    close(c[0]!.judgeMean, 52 / 3);
    expect(c[1]).toMatchObject({ matched: false, rank: null });
  });
  it('평가표별로 묶는다', () => {
    expect(sheetGroups(main()).map((g) => [g.sheetNo, g.items.length])).toEqual([['S1', 1], ['S2', 1]]);
  });
});

describe('cumulative', () => {
  const a = main({ id: 'R26BK00000001-000', at: '2026-02-01 10:00:00' });
  const b = main({ id: 'R26BK00000002-000', at: '2026-01-01 10:00:00' });
  it('타임라인은 평가일 순, 전적과 약점과 위원 집계', () => {
    const c = cumulative([a, b], BIZ[2]);
    expect(c.timeline.map((t) => t.noticeId)).toEqual(['R26BK00000002-000', 'R26BK00000001-000']);
    expect(c.timeline[0]).toMatchObject({ ourRank: 2, bidderCount: 3, judgeCount: 3 });
    close(c.timeline[0]!.topMean, 52 / 3);
    expect(c.competitors).toEqual([
      { bizNo: BIZ[1], name: '업체1', met: 2, wins: 0, losses: 2, ties: 0 },
      { bizNo: BIZ[3], name: '업체3', met: 2, wins: 0, losses: 0, ties: 2 },
    ]);
    expect(c.itemWeakness.map((w) => [w.name, w.count])).toEqual([['A', 2], ['B', 2]]);
    expect(c.judges.map((j) => [j.key, j.count])).toEqual([['K1', 2], ['K2', 2], ['K3', 2]]);
    close(c.judges[0]!.meanBias, -1 / 9);
  });
  it('우리 회사가 없으면 our 값은 null이고 전적은 비어 있다', () => {
    const c = cumulative([a], '9999999999');
    expect(c.timeline[0]!.ourRank).toBeNull();
    expect(c.timeline[0]!.ourMean).toBeNull();
    expect(c.competitors).toEqual([]);
    expect(c.itemWeakness).toEqual([]);
  });
});

describe('fixture', () => {
  const r = mapEvalRaw(raw as EvalRaw, { noticeNo: 'R26BK01631407', round: '000' }, 't');
  if (!r.ok) throw new Error(r.message);
  const rec = r.record;
  it('byJudge가 S2 검증값과 같다', () => {
    const t = bidderTotals(rec);
    const round = (xs: Array<number | null>) => xs.map((x) => Math.round((x as number) * 10) / 10);
    expect(round(t.find((x) => x.seq === rec.bidders.find((b) => b.bizNo === '5978600662')!.seq)!.byJudge)).toEqual([84.1, 88.7, 85.5, 82.4, 80.8, 84, 87.4, 84.9]);
    expect(round(t.find((x) => x.seq === rec.bidders.find((b) => b.bizNo === '1198633696')!.seq)!.byJudge)).toEqual([79, 80.4, 75.3, 79.4, 75.3, 81, 84.1, 77.1]);
  });
  it('우리 회사 기준 첫 항목 gap은 0 이상(역전 항목 없음)', () => {
    const g = itemGaps(rec, '5978600662');
    expect(g[0]!.gap).not.toBeNull();
    expect(g[0]!.gap as number).toBeGreaterThanOrEqual(0);
  });
});

describe('부동소수 오차와 동점', () => {
  it('항목 합계 순서가 달라 합계 단계에서 오차가 나는 두 업체는 동점이다', () => {
    // 30.1+20.2+34.0 = 84.3, 34.2+30.1+20.0 = 84.30000000000001 (정규화 없이는 갈린다)
    const scores: Array<[number, number, string, number]> = [];
    for (const j of [1, 2, 3]) {
      scores.push([1, j, 'I1', 30.1], [1, j, 'I2', 20.2], [1, j, 'I3', 34.0], [2, j, 'I1', 34.2], [2, j, 'I2', 30.1], [2, j, 'I3', 20.0]);
    }
    const t = bidderTotals(mk({ bidders: [1, 2], judges: 3, items: ['I1', 'I2', 'I3'], scores }));
    expect(t[0]!.byJudge).toEqual(t[1]!.byJudge);
    expect(t[0]!.mean).toBe(t[1]!.mean);
    expect([...rankOf(t.map((x) => ({ seq: x.seq, value: x.mean }))).values()]).toEqual([1, 1]);
  });

  it('-0은 0으로 정규화된다', () => {
    const rec = mk({ bidders: [1], judges: 2, items: ['I1'], scores: [[1, 1, 'I1', 5], [1, 2, 'I1', 5]] });
    expect(Object.is(judgeProfiles(rec, BIZ[1])[0]!.bias, 0)).toBe(true);
    expect(Object.is(bidderTotals(mk({ bidders: [1], judges: 1, items: ['I1'], scores: [[1, 1, 'I1', -1e-17]] }))[0]!.byJudge[0], 0)).toBe(true);
  });

  it('timeline의 업체와 위원 수는 제외된 쪽을 세지 않고, 우리 업체가 제외된 공고는 약점 누적에서 뺀다', () => {
    const rec = main();
    rec.judges[2]!.excluded = true;
    rec.bidders[2]!.excluded = true;
    expect(cumulative([rec], BIZ[2]).timeline[0]).toMatchObject({ bidderCount: 2, judgeCount: 2 });
    const ours = main();
    ours.bidders[1]!.excluded = true; // 업체2(우리)가 제외
    expect(cumulative([ours], BIZ[2]).itemWeakness).toEqual([]);
    expect(cumulative([main()], BIZ[2]).itemWeakness.length).toBe(2);
  });

  it('위원 합계가 부동소수로 갈리는 사례: rankOf 동점, topSeq null, agrees null, 전적 무승부', () => {
    const rec = mk({ bidders: [1, 2], judges: 1, items: ['I1', 'I2', 'I3'], scores: [
      [1, 1, 'I1', 30.1], [1, 1, 'I2', 20.2], [1, 1, 'I3', 34.0],
      [2, 1, 'I1', 34.2], [2, 1, 'I2', 30.1], [2, 1, 'I3', 20.0],
    ] });
    const t = bidderTotals(rec);
    expect(t[0]!.byJudge[0]).toBe(t[1]!.byJudge[0]);
    expect([...rankOf(t.map((x) => ({ seq: x.seq, value: x.byJudge[0]! }))).values()]).toEqual([1, 1]);
    const p = judgeProfiles(rec, BIZ[2])[0]!;
    expect(p.topSeq).toBeNull();
    expect(p.agreesWithConsensus).toBeNull();
    expect(cumulative([rec], BIZ[2]).competitors).toEqual([{ bizNo: BIZ[1], name: '업체1', met: 1, wins: 0, losses: 0, ties: 1 }]);
  });
});

describe('제외 플래그와 경계', () => {
  it('judge.excluded는 제외 위원과 같이 취급한다', () => {
    const rec = main();
    rec.judges[2]!.excluded = true;
    const t = bidderTotals(rec);
    expect(t[0]!.byJudge).toEqual([17, 19, null]);
    expect(t[0]!.mean).toBe(18);
    expect(judgeProfiles(rec, BIZ[2])[2]).toMatchObject({ bias: null, spread: null, topSeq: null, agreesWithConsensus: null, ourDelta: null });
    expect(itemGaps(rec, BIZ[2])[0]!.byJudgeOurs[2]).toBeNull();
  });

  it('bidder.excluded는 합계에는 있으나 순위, 1위 판정, 최고 경쟁사, 전적에서 빠진다', () => {
    const rec = main();
    rec.bidders[0]!.excluded = true; // 가장 높은 업체1을 제외
    expect(bidderTotals(rec)[0]!.mean).not.toBeNull();
    expect(leaveOneOut(rec, BIZ[2])[0]!.ranks.get(1)).toBeNull();
    expect(judgeProfiles(rec, BIZ[2]).map((x) => x.topSeq)).toEqual([null, null, null]); // 업체2와 3이 동점
    close(itemGaps(rec, BIZ[2])[0]!.bestOtherMean, 23 / 3); // 업체3의 I1 평균
    const c = cumulative([rec], BIZ[2]);
    expect(c.timeline[0]!.ourRank).toBe(1);
    expect(c.timeline[0]!.topMean).toBe(15);
    expect(c.competitors.map((x) => x.bizNo)).toEqual([BIZ[3]]);
  });

  it('bidder.excluded는 judgeProfiles의 bias, spread, ourDelta와 cumulative의 meanBias에서도 빠진다', () => {
    const rec = main();
    rec.bidders[0]!.excluded = true; // 업체1 제외: 남는 업체2, 3은 모든 위원에서 15
    const p = judgeProfiles(rec, BIZ[2]);
    expect(p.map((x) => x.spread)).toEqual([0, 0, 0]);
    p.forEach((x) => { close(x.bias, 0); close(x.ourDelta, 0); });
    const out = judgeProfiles(rec, BIZ[1]); // 우리 업체가 제외 대상이면 ourDelta 없음
    expect(out.every((x) => x.ourDelta === null)).toBe(true);
    close(cumulative([rec], BIZ[2]).judges[1]!.meanBias, 0);
  });

  it('모든 위원 점수가 null인 업체는 평균과 순위가 null이고 다른 업체에 영향이 없다', () => {
    const rec = mk({ bidders: [1, 2, 3], judges: 2, items: ['I1'], scores: [[1, 1, 'I1', 9], [1, 2, 'I1', 8], [2, 1, 'I1', 7], [2, 2, 'I1', 7]] });
    const t = bidderTotals(rec);
    expect(t[2]).toMatchObject({ byJudge: [null, null], mean: null, median: null, sd: null, trimmedMean: null });
    expect([...rankOf(t.map((x) => ({ seq: x.seq, value: x.mean }))).values()]).toEqual([1, 2, null]);
  });

  it('업체가 1개인 레코드', () => {
    const rec = mk({ bidders: [1], judges: 2, items: ['I1'], scores: [[1, 1, 'I1', 9], [1, 2, 'I1', 8]] });
    expect(judgeProfiles(rec, BIZ[1]).map((x) => [x.spread, x.topSeq, x.agreesWithConsensus])).toEqual([[0, 1, true], [0, 1, true]]);
    expect(itemGaps(rec, BIZ[1])[0]).toMatchObject({ bestOtherMean: null, gap: null });
    expect(leaveOneOut(rec, BIZ[1]).map((x) => x.firstChanged)).toEqual([false, false]);
    expect(cumulative([rec], BIZ[1]).competitors).toEqual([]);
  });

  it('agreesWithConsensus가 false인 위원', () => {
    const rec = mk({ bidders: [1, 2], judges: 3, items: ['I1'], scores: [
      [1, 1, 'I1', 10], [1, 2, 'I1', 10], [1, 3, 'I1', 2], [2, 1, 'I1', 9], [2, 2, 'I1', 9], [2, 3, 'I1', 9],
    ] });
    expect(judgeProfiles(rec, null).map((x) => x.agreesWithConsensus)).toEqual([false, false, true]);
  });

  it('cumulative.judges: 점수가 없는 위원은 그 공고의 count에 넣지 않는다', () => {
    const a = main({ id: 'R26BK00000001-000' });
    const b = main({ id: 'R26BK00000002-000', scores: MAIN_SCORES.filter(([, j]) => j !== 3) });
    const c = cumulative([a, b], BIZ[2]);
    const k3 = c.judges.find((j) => j.key === 'K3')!;
    expect(k3.count).toBe(1);
    expect(k3.noticeIds).toEqual(['R26BK00000001-000']);
    expect(c.judges.find((j) => j.key === 'K1')!.count).toBe(2);
  });
});
