import { describe, expect, it } from 'vitest';
import type { EvalRaw } from '../../src/adapters/g2b/eval-api';
import { bidderTotals, columnMax, decompose, exchangeRatio, gradeDistribution, gradeLevel, heatmap, itemGaps, judgeProfiles, leaveOneOut, pickDuel, priceWeightOf, reversalDistance, totalRanks, verifyPriceFormula, verifyTechAdjust } from '../../src/core/evaluation/analyze';
import { mapEvalRaw } from '../../src/core/evaluation/map';
import type { EvalOfficialRow, EvalRecord } from '../../src/core/types/evaluation';
import raw from '../fixtures/eval-raw-sample.json';

const XCORE = '5978600662';
const WEBP = '1198633696';
const row = (o: Partial<EvalOfficialRow> & { bizNo: string }): EvalOfficialRow => ({ rank: null, bidAmount: null, priceScore: null, techScore: null, totalScore: null, techRaw: null, ...o });
const SAMPLE_ROWS: EvalOfficialRow[] = [
  row({ bizNo: XCORE, rank: 1, bidAmount: 291990000, priceScore: 9.7949, techScore: 90, totalScore: 99.7949, techRaw: 85.245 }),
  row({ bizNo: WEBP, rank: 2, bidAmount: 286000000, priceScore: 10, techScore: 84.135, totalScore: 94.135, techRaw: 79.38 }),
];
function sample(rows: EvalOfficialRow[] | null = SAMPLE_ROWS): EvalRecord {
  const r = mapEvalRaw(raw as unknown as EvalRaw, { noticeNo: 'R26BK01631407', round: '000' }, '2026-10-19T00:00:00.000Z');
  if (!r.ok) throw new Error(r.message);
  return { ...r.record, official: rows ? { fetchedAt: 't', rows } : null };
}
const seqOf = (rec: EvalRecord, biz: string) => rec.bidders.find((b) => b.bizNo === biz)!.seq;
const close = (a: number | null, b: number) => {
  expect(a).not.toBeNull();
  expect(Math.abs((a as number) - b)).toBeLessThan(1e-6);
};

describe('공식 검증', () => {
  it('샘플은 가격과 기술 공식이 모두 맞는다', () => {
    const rec = sample();
    expect(priceWeightOf(rec)).toBe(10);
    expect(verifyPriceFormula(rec)).toEqual({ ok: true });
    expect(verifyTechAdjust(rec)).toEqual({ ok: true });
  });
  it('공식이 맞지 않으면 ok false와 이유', () => {
    const bad = sample([SAMPLE_ROWS[0]!, { ...SAMPLE_ROWS[1]!, priceScore: 9.5, techScore: 80 }]);
    expect(verifyPriceFormula(bad).ok).toBe(false);
    expect(verifyPriceFormula(bad).reason).toBeTruthy();
    expect(verifyTechAdjust(bad).ok).toBe(false);
  });
  it('official이 없거나 값이 비면 false, techWeight가 없으면 priceWeightOf null', () => {
    expect(verifyPriceFormula(sample(null)).ok).toBe(false);
    expect(verifyTechAdjust(sample(null)).ok).toBe(false);
    expect(verifyPriceFormula(sample([SAMPLE_ROWS[0]!])).ok).toBe(false);
    expect(verifyPriceFormula(sample([SAMPLE_ROWS[0]!, { ...SAMPLE_ROWS[1]!, bidAmount: null }])).ok).toBe(false);
    expect(verifyTechAdjust(sample([SAMPLE_ROWS[0]!, { ...SAMPLE_ROWS[1]!, techRaw: null }])).ok).toBe(false);
    const rec = { ...sample(), techWeight: null };
    expect(priceWeightOf(rec)).toBeNull();
    expect(verifyPriceFormula(rec).ok).toBe(false);
    expect(verifyTechAdjust(rec).ok).toBe(false);
  });
});

describe('pickDuel과 decompose', () => {
  it('우리 회사가 2위면 lead=1위, chase=우리', () => {
    const rec = sample();
    expect(pickDuel(rec, WEBP)).toEqual({ lead: seqOf(rec, XCORE), chase: seqOf(rec, WEBP), leadRank: 1, chaseRank: 2, basis: 'official' });
  });
  it('우리 회사가 1위면 lead=우리, 우리 회사가 없으면 1위와 2위', () => {
    const rec = sample();
    expect(pickDuel(rec, XCORE)).toMatchObject({ lead: seqOf(rec, XCORE), chase: seqOf(rec, WEBP) });
    expect(pickDuel(rec, null)).toMatchObject({ lead: seqOf(rec, XCORE), chase: seqOf(rec, WEBP) });
  });
  it('official이 없으면 위원 평균 순위(basis judges)', () => {
    const rec = sample(null);
    const d = pickDuel(rec, null)!;
    expect(d.basis).toBe('judges');
    expect(d.lead).toBe(seqOf(rec, XCORE)); // 위원 평균 엑스코어 84.9 대 웹프라자 79.1
  });
  it('업체가 2개 미만이면 null', () => {
    const rec = sample();
    expect(pickDuel({ ...rec, bidders: rec.bidders.slice(0, 1) }, null)).toBeNull();
  });
  it('decompose: 샘플 값', () => {
    const rec = sample();
    const d = decompose(rec, pickDuel(rec, WEBP)!)!;
    close(d.techDiff, 5.865);
    close(d.priceDiff, -0.2051);
    close(d.totalDiff, 5.6599);
    close(d.bidCutPct, (1 - 286000000 / 291990000) * 100);
    expect(d).toMatchObject({ priceFormulaOk: true, techAdjustOk: true, chaserPriceMaxed: true });
    close(d.cutNeededPct, 58.65);
  });
  it('decompose: 공식 행이 없으면 null, 가격 공식이 틀리면 cutNeededPct null', () => {
    const rec = sample();
    const duel = pickDuel(rec, WEBP)!;
    expect(decompose(sample(null), duel)).toBeNull();
    const bad = sample([SAMPLE_ROWS[0]!, { ...SAMPLE_ROWS[1]!, priceScore: 9.5 }]);
    const d = decompose(bad, duel)!;
    expect(d.priceFormulaOk).toBe(false);
    expect(d.cutNeededPct).toBeNull();
  });
});

describe('reversalDistance', () => {
  it('샘플: gapSum 46.2, local false, stepsNeeded 77, cellsOfMax 40', () => {
    const rec = sample();
    const r = reversalDistance(rec, pickDuel(rec, WEBP)!);
    close(r.gapSum, 46.2);
    expect(r.local).toBe(false);
    expect(r.validJudges).toBe(8);
    expect(r.maxItemScore).toBe(6);
    expect(r.stepsNeeded).toBe(77);
    expect(r.cellsOfMax).toBe(40);
    expect(r.top3Ratio).toBeGreaterThan(0);
    expect(r.top3Ratio).toBeLessThan(1);
    expect(r.behindCount).toBeGreaterThan(0);
  });
  it('위원 제외 시 유효 위원과 gapSum이 줄어든다', () => {
    const rec = sample();
    const r = reversalDistance(rec, pickDuel(rec, WEBP)!, { excludeJudges: new Set([1]) });
    expect(r.validJudges).toBe(7);
    expect(r.gapSum).toBeLessThan(46.2);
    expect(r.cellsOfMax).toBe(35);
  });
  it('등급 방식이 아니면 등급 값은 null', () => {
    const rec = sample();
    const noGrade = { ...rec, items: rec.items.map((i, k) => (k === 0 ? { ...i, method: '점수' } : i)) };
    const r = reversalDistance(noGrade, pickDuel(rec, WEBP)!);
    expect([r.maxItemScore, r.stepsNeeded, r.cellsOfMax]).toEqual([null, null, null]);
  });
  it('쫓는 쪽이 위원 합계에서 앞서면 relation ahead, 나머지 판정은 null', () => {
    const rec = sample();
    const d = pickDuel(rec, WEBP)!;
    const r = reversalDistance(rec, { ...d, lead: d.chase, chase: d.lead });
    expect(r.gapSum).toBeLessThan(0);
    expect(r.relation).toBe('ahead');
    expect([r.top3Recovery, r.top3Ratio, r.local, r.stepsNeeded]).toEqual([null, null, null, null]);
    expect(reversalDistance(rec, d).relation).toBe('behind');
  });
});

describe('relation tie와 pickDuel 위원 제외', () => {
  it('위원 평균 동점(judges basis)이면 relation tie', () => {
    const base = sample(null);
    const x = seqOf(base, XCORE);
    const w = seqOf(base, WEBP);
    const scores = [
      ...base.scores.filter((s) => s.b === x),
      ...base.scores.filter((s) => s.b === x).map((s) => ({ ...s, b: w })),
    ];
    const rec = { ...base, scores };
    const duel = pickDuel(rec, null)!;
    expect(duel.basis).toBe('judges');
    const r = reversalDistance(rec, duel);
    expect(r.relation).toBe('tie');
    expect([r.local, r.top3Recovery, r.top3Ratio, r.stepsNeeded]).toEqual([null, null, null, null]);
  });
  it('공식 순위가 일부 없으면 judges basis', () => {
    expect(pickDuel(sample([SAMPLE_ROWS[0]!, { ...SAMPLE_ROWS[1]!, rank: null }]), null)!.basis).toBe('judges');
  });
  it('judges basis에서는 위원 제외로 쌍이 뒤집히고 official basis에서는 opts를 무시한다', () => {
    const base = sample(null);
    const x = seqOf(base, XCORE);
    const rec = { ...base, scores: base.scores.map((s) => (s.b === x && s.j === 1 ? { ...s, s: 0 } : s)) };
    expect(pickDuel(rec, null)!.lead).toBe(seqOf(rec, WEBP));
    expect(pickDuel(rec, null, { excludeJudges: new Set([1]) })!.lead).toBe(x);
    const off = sample();
    expect(pickDuel(off, null, { excludeJudges: new Set([1]) })).toEqual(pickDuel(off, null));
  });
});

describe('gradeDistribution과 itemGaps 위원 제외', () => {
  it('대항목별 칸 수 합은 leaf 수 x 유효 위원 수', () => {
    const rec = sample();
    const g = gradeDistribution(rec, seqOf(rec, WEBP));
    expect(g).toHaveLength(5);
    const cells = g.reduce((t, x) => t + x.counts.reduce((a, b) => a + b, 0), 0);
    expect(cells).toBe(24 * 8);
    const g2 = gradeDistribution(rec, seqOf(rec, WEBP), { excludeJudges: new Set([1, 2]) });
    expect(g2.reduce((t, x) => t + x.counts.reduce((a, b) => a + b, 0), 0)).toBe(24 * 6);
    expect(g[0]!.maxScore).toBeGreaterThan(0);
  });
  it('단계 경계: 100%, 90%, 80%, 미만', () => {
    const rec = sample();
    const first = rec.items[0]!;
    const seq = seqOf(rec, WEBP);
    const small: EvalRecord = {
      ...rec, items: [{ ...first, maxScore: 10, names: ['G'] }], judges: rec.judges.slice(0, 4),
      scores: [10, 9, 8, 7.9].map((s, k) => ({ b: seq, j: k + 1, i: first.no, s })),
    };
    expect(gradeDistribution(small, seq)).toEqual([{ group: 'G', maxScore: 10, counts: [1, 1, 1, 1] }]);
  });
  it('itemGaps excludeJudges는 평균에서 그 위원을 뺀다', () => {
    const rec = sample();
    const all = itemGaps(rec, WEBP)[0]!;
    const ex = itemGaps(rec, WEBP, { excludeJudges: new Set([1, 2, 3, 4, 5, 6, 7]) }).find((g) => g.itemNo === all.itemNo)!;
    const lastOurs = ex.byJudgeOurs[7];
    expect(ex.byJudgeOurs.slice(0, 7).every((v) => v === null)).toBe(true);
    expect(ex.ourMean).toBe(lastOurs);
  });
});

describe('순위 표시와 가격으로만 이긴 공고', () => {
  it('3업체에서 우리가 3위면 leadRank 1, chaseRank 3', () => {
    const base = sample();
    const rec: EvalRecord = {
      ...base,
      bidders: [...base.bidders, { seq: 9, bizNo: '3333333333', name: '셋째', order: 3, excluded: false }],
      official: { fetchedAt: 't', rows: [...SAMPLE_ROWS, row({ bizNo: '3333333333', rank: 3 })] },
    };
    expect(pickDuel(rec, '3333333333')).toMatchObject({ lead: seqOf(rec, XCORE), chase: 9, leadRank: 1, chaseRank: 3, basis: 'official' });
    expect(pickDuel(rec, null)).toMatchObject({ leadRank: 1, chaseRank: 2 });
  });
  it('lead가 가격으로만 이기면 priceCutToWinPct, cutNeededPct null', () => {
    const rows = [
      row({ bizNo: WEBP, rank: 1, bidAmount: 286000000, priceScore: 10, techScore: 90, totalScore: 100, techRaw: 80 }),
      row({ bizNo: XCORE, rank: 2, bidAmount: 291990000, priceScore: 9.7949, techScore: 90, totalScore: 99.7949, techRaw: 80 }),
    ];
    const rec = sample(rows);
    const duel = pickDuel(rec, XCORE)!;
    expect(duel.lead).toBe(seqOf(rec, WEBP));
    const d = decompose(rec, duel)!;
    expect(d.techDiff).toBe(0);
    expect(d.cutNeededPct).toBeNull();
    close(d.priceCutToWinPct, 2.051);
    expect(d.bidCutPct).toBeLessThan(0);
    const bad = decompose(sample([rows[0]!, { ...rows[1]!, priceScore: 9 }]), duel)!;
    expect(bad.priceCutToWinPct).toBeNull();
  });
});

describe('heatmap, gradeLevel, exchangeRatio, leaveOneOut 옵션', () => {
  it('heatmap: 칸 수, lost, 제외 위원, 수정 이력', () => {
    const rec = sample();
    const web = seqOf(rec, WEBP);
    const x = seqOf(rec, XCORE);
    const h = heatmap(rec, web, { excludeJudges: new Set([2]) });
    expect(h).toHaveLength(24);
    expect(h[0]!.cells).toHaveLength(8);
    expect(h[0]!.cells[1]!.skipped).toBe(true);
    expect(h[0]!.cells[1]!.lost).toBe(false);
    const cell = rec.scores.find((s) => s.b === web && s.j === 1 && s.i === h[0]!.itemNo)!;
    const other = rec.scores.find((s) => s.b === x && s.j === 1 && s.i === h[0]!.itemNo)!;
    expect(h[0]!.cells[0]!.score).toBe(cell.s);
    expect(h[0]!.cells[0]!.lost).toBe(cell.s < other.s);
    const r = { ...rec, scores: rec.scores.map((s) => (s === cell ? { ...s, r: 1 } : s)) };
    expect(heatmap(r, web)[0]!.cells[0]!.revised).toBe(1);
    expect(h[0]!.cells[0]!.revised).toBeNull();
  });
  it('heatmap against: 지정한 업체와만 비교한다', () => {
    const rec = sample();
    const web = seqOf(rec, WEBP);
    const x = seqOf(rec, XCORE);
    const a = heatmap(rec, web, {}, x);
    const b = heatmap(rec, web);
    expect(a.map((r) => r.cells.map((c) => c.lost))).toEqual(b.map((r) => r.cells.map((c) => c.lost)));
    // 비교 대상이 없는 업체(존재하지 않는 seq)면 lost 없음
    expect(heatmap(rec, web, {}, 99).every((r) => r.cells.every((c) => !c.lost))).toBe(true);
  });
  it('columnMax, totalRanks, judgeProfiles duelGap', () => {
    const rec = sample();
    const t = bidderTotals(rec);
    const cm = columnMax(rec, t);
    expect(cm).toHaveLength(8);
    close(cm[0] ?? null, 84.1);
    expect(totalRanks(rec, t).get(seqOf(rec, XCORE))).toBe(1);
    const duel = pickDuel(rec, WEBP)!;
    const p = judgeProfiles(rec, WEBP, {}, duel);
    close(p[0]!.duelGap, 79 - 84.1);
    expect(judgeProfiles(rec, WEBP)[0]!.duelGap).toBeNull();
  });
  it('gradeLevel 경계', () => {
    expect([1, 0.995, 0.9, 0.895, 0.8, 0.795, 0.79].map(gradeLevel)).toEqual([0, 0, 1, 1, 2, 2, 3]);
  });
  it('exchangeRatio: 가격 10, 6점, 위원 8명', () => {
    const e = exchangeRatio(10, 6, 8)!;
    close(e.pricePerCut, 0.1);
    close(e.gradeStep, 0.075);
    close(e.cutEquivalent, 0.75);
    expect(exchangeRatio(0, 6, 8)).toBeNull();
    expect(exchangeRatio(10, null, 8)).toEqual({ pricePerCut: 0.1, gradeStep: null, cutEquivalent: null });
    expect(exchangeRatio(10, 6, 0)).toEqual({ pricePerCut: 0.1, gradeStep: null, cutEquivalent: null });
  });
  it('leaveOneOut: 이미 제외한 위원은 계속 제외하고 비교', () => {
    const rec = sample();
    const a = leaveOneOut(rec, WEBP);
    const b = leaveOneOut(rec, WEBP, { excludeJudges: new Set([1]) });
    expect(a).toHaveLength(8);
    expect(b[1]!.ranks.size).toBe(2);
  });
});
