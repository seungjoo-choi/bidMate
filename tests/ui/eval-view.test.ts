import { describe, expect, it } from 'vitest';
import type { Decomposition, ReversalDistance } from '../../src/core/evaluation/analyze';
import { evalErrorText } from '../../src/core/evaluation/error-text';
import {
  barOf, basisNotes, chaserSigned, dateOnly, DASH, duelTitle, excludedNote, exchangeLines, f1, f2, FORMULA_MISMATCH, formatAmount, gradeShare, looText, MINUS, parseView, partNote, priceBox, rankLabel, reversalText, signed, toneOf,
} from '../../src/entrypoints/dashboard/evaluations/eval-view';

const dec = (o: Partial<Decomposition> = {}): Decomposition => ({
  totalDiff: 5.6599, techDiff: 5.865, priceDiff: -0.2051, bidCutPct: 2.05, priceFormulaOk: true, techAdjustOk: true, chaserPriceMaxed: true, cutNeededPct: 58.65, priceCutToWinPct: null, ...o,
});
const rev = (o: Partial<ReversalDistance> = {}): ReversalDistance => ({
  validJudges: 8, relation: 'behind', gapSum: 46.2, behindCount: 20, top3Recovery: 10, top3Ratio: 0.22, local: false, maxItemScore: 6, stepsNeeded: 77, cellsOfMax: 40, ...o,
});

describe('숫자 포맷', () => {
  it('f1, f2, signed는 null을 줄표로, 음수는 − 문자로', () => {
    expect([f1(84.14), f2(84.1), f2(null)]).toEqual(['84.1', '84.10', DASH]);
    expect(signed(5.865)).toBe('+5.87');
    expect(signed(-0.2051)).toBe(`${MINUS}0.21`);
    expect(signed(0)).toBe('0.00');
    expect(signed(-0.001)).toBe('0.00');
    expect(signed(-3.04, 1)).toBe(`${MINUS}3.0`);
    expect(signed(null)).toBe(DASH);
    expect(chaserSigned(5.6599)).toBe(`${MINUS}5.66`);
    expect(chaserSigned(0)).toBe('0.00');
  });
  it('toneOf, barOf', () => {
    expect([toneOf(1), toneOf(-1), toneOf(0.001), toneOf(null)]).toEqual(['win', 'lose', 'even', 'even']);
    expect(barOf(-0.075, 0.15)).toEqual({ side: 'lose', widthPct: 25 });
    expect(barOf(0.5, 0.15)).toEqual({ side: 'win', widthPct: 50 });
    expect(barOf(0, 0.15)).toEqual({ side: 'none', widthPct: 0 });
    expect(barOf(null, 0.15).side).toBe('none');
  });
  it('금액, 순위, 날짜, 보기 값', () => {
    expect(formatAmount(291990000)).toBe('291,990,000원');
    expect(formatAmount(null)).toBe(DASH);
    expect(rankLabel(2)).toBe('2위');
    expect(dateOnly('2026-08-18 10:51:08')).toBe('2026/08/18');
    expect(dateOnly(null)).toBeNull();
    expect([parseView('ours'), parseView('all'), parseView('x'), parseView(null)]).toEqual(['ours', 'all', null, null]);
  });
});

describe('문구', () => {
  it('excludedNote와 duelTitle', () => {
    expect(excludedNote([3, 1])).toBe('위원 1, 위원 3 제외 중. 평균, 순위, 격차, 히트맵 모두 재계산');
    expect(duelTitle('가', '나', 'lost', 1, 3)).toBe('가(1위) 대 나(3위), 우리가 진 공고');
    expect(duelTitle('가', '나', 'lost')).toBe('가 대 나, 우리가 진 공고');
    expect(duelTitle('가', '나', 'none', 1, 2)).toBe('가(1위) 대 나(2위)');
  });
  it('exchangeLines', () => {
    expect(exchangeLines({ pricePerCut: 0.1, gradeStep: 0.075, cutEquivalent: 0.75 })).toEqual({ cut: '가격 +0.10점', grade: '+0.075점', equal: '투찰가 약 0.75% 인하와 같음' });
    expect(exchangeLines({ pricePerCut: 0.1, gradeStep: null, cutEquivalent: null })).toEqual({ cut: '가격 +0.10점', grade: null, equal: null });
  });
  it('priceBox: 가격 만점이면 이길 수 없던 공고', () => {
    expect(priceBox(dec(), '웹프라자')).toMatchObject({ tone: 'warn', head: '가격으로는 역전 불가' });
    expect(priceBox(dec(), '웹프라자').body).toContain('58.65%');
    expect(priceBox(dec({ chaserPriceMaxed: false, cutNeededPct: 1.5 }), '웹프라자')).toMatchObject({ tone: 'info', head: '가격으로 메울 수 있는 격차' });
    expect(FORMULA_MISMATCH).toContain('교환비 계산 생략');
  });
  it('reversalText: 전반적 열세와 국지적 열세', () => {
    const w = reversalText(rev(), 24);
    expect(w.verdict.startsWith('전반적 열세')).toBe(true);
    expect(w.behindLine).toBe('세부항목 24개 중 20개에서 뒤짐');
    expect(w.top3Line).toBe('격차 큰 3개 항목을 따라잡아도 격차의 22%만 회복');
    expect(w.stepsLine).toBe('6점 항목만으로는 등급 상승 77회 필요 (해당 칸 40개)');
    expect(w.advice).toContain('한 등급씩 올려도 부족');
    const l = reversalText(rev({ local: true, stepsNeeded: null, maxItemScore: null, cellsOfMax: null }), 24);
    expect(l.verdict.startsWith('국지적 열세')).toBe(true);
    expect(l.stepsLine).toBeNull();
    expect(l.top3Line).toContain('역전');
  });
  it('lead가 가격으로만 이긴 공고: 기술 우위 문구', () => {
    const d = dec({ techDiff: 0, totalDiff: 0.2051, priceDiff: 0.2051, bidCutPct: -2.05, chaserPriceMaxed: false, cutNeededPct: null, priceCutToWinPct: 2.051 });
    const box = priceBox(d, '나');
    expect(box.head).toBe('기술 우위 공고');
    expect(box.body).toBe('종합 차이 0.21점은 가격점수에서 발생. 투찰가 약 2.05% 추가 인하 시 역전 가능');
    expect(priceBox(dec({ techDiff: -1, priceCutToWinPct: null }), '나').body).toBe('종합 차이 5.66점은 가격점수에서 발생');
    const ahead = rev({ relation: 'ahead', gapSum: -3.5, local: null, top3Recovery: null, top3Ratio: null, stepsNeeded: null });
    const r = reversalText(ahead, 24, true);
    expect(r).toMatchObject({ verdict: '위원 점수 우위', tone: 'info', advice: '실제 순위 차이는 공식 결과 칸 참고', stepsLine: null });
    expect(r.top3Line).toBe('선택한 위원 기준 위원 합계 3.50점 앞섬');
    expect(reversalText(ahead, 24, false).advice).toBeNull();
    const tie = reversalText(rev({ relation: 'tie', gapSum: 0, local: null, top3Recovery: null, top3Ratio: null, stepsNeeded: null }), 24, false);
    expect(tie).toMatchObject({ verdict: '위원 합계 동점', tone: 'info', top3Line: '선택한 위원 기준 위원 합계 동일', advice: '격차 큰 항목부터 보강' });
    for (const t of [r, reversalText(ahead, 24, false), tie, reversalText(rev(), 24, true), reversalText(rev({ local: true }), 24, true)]) {
      expect(JSON.stringify(t)).not.toMatch(/종합|가격/);
    }
    expect(r.behindLine).toContain('개에서 뒤짐');
  });
  it('basisNotes 네 조합', () => {
    const ex = '위원 제외는 역전 거리, 등급 분포, 합계 표에만 반영. 공식 점수 분해는 전체 위원 기준';
    const dir = '공식 기술점수와 위원 합계의 방향이 다름. 공식 기술점수에 위원 점수 외 항목이 포함됐을 수 있음(미확인)';
    expect(basisNotes({ excludedCount: 0, dec: dec(), gapSumAll: 46.2 })).toEqual([]);
    expect(basisNotes({ excludedCount: 2, dec: dec(), gapSumAll: 46.2 })).toEqual([ex]);
    expect(basisNotes({ excludedCount: 0, dec: dec({ techDiff: 5 }), gapSumAll: -3 })).toEqual([dir]);
    expect(basisNotes({ excludedCount: 1, dec: dec({ techDiff: -1 }), gapSumAll: 2 })).toEqual([ex, dir]);
    expect(basisNotes({ excludedCount: 0, dec: dec({ techDiff: 0 }), gapSumAll: 2 })).toEqual([]);
    expect(basisNotes({ excludedCount: 0, dec: null, gapSumAll: -2 })).toEqual([]);
  });
  it('partNote: 투찰가가 높았거나 같았을 때', () => {
    expect(partNote('나', dec({ bidCutPct: 2.05, priceDiff: -0.2 }))).toBe('나 기준: 투찰가 2.1% 낮음, 가격점수는 0.20점만 앞섬');
    expect(partNote('나', dec({ bidCutPct: -2.05, priceDiff: 0.2 }))).toBe('나 기준: 투찰가 2.1% 높음, 가격점수 0.20점 뒤짐');
    expect(partNote('나', dec({ bidCutPct: 0, priceDiff: 0 }))).toBe('나 기준: 투찰가 동일, 가격점수 동일');
  });
  it('looText', () => {
    expect(looText({ excluded: true, ours: true, firstChanged: false, rankDelta: 0 }).text).toBe('제외됨');
    expect(looText({ excluded: false, ours: false, firstChanged: true, rankDelta: null })).toEqual({ text: '1위가 바뀜', strong: true });
    expect(looText({ excluded: false, ours: true, firstChanged: false, rankDelta: 0 }).text).toBe('순위 그대로');
    expect(looText({ excluded: false, ours: true, firstChanged: false, rankDelta: -1 }).text).toBe('우리 1계단 상승');
    expect(looText({ excluded: false, ours: true, firstChanged: false, rankDelta: 2 }).text).toBe('우리 2계단 하락');
  });
  it('gradeShare와 evalErrorText', () => {
    const g = gradeShare([2, 1, 1, 0]);
    expect(g.full).toBe('50%');
    expect(g.pct).toEqual([50, 25, 25, 0]);
    expect(gradeShare([0, 0, 0, 0]).full).toBe('0%');
    expect(evalErrorText('EVAL_NOT_LOGGED_IN', 'x')).toContain('로그인');
    expect(evalErrorText('EVAL_NO_RESULT', 'x')).toContain('평가 결과가 없는');
    expect(evalErrorText('ETC', '원문')).toBe('원문');
  });
});
