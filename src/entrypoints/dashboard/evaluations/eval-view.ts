import type { ReversalDistance, Decomposition, ExchangeRatio } from '../../../core/evaluation/analyze';

/** 평가분석 화면의 표시 포맷. 지표 계산은 core/evaluation/analyze.ts에서 하고 여기서는 문자열과 단계만 정한다. */
export const MINUS = '−';
export const DASH = '—';

const fixed = (x: number, d: number): string => (Math.round(x * 10 ** d) / 10 ** d).toFixed(d);
export const f1 = (x: number | null): string => (x === null ? DASH : fixed(x, 1));
export const f2 = (x: number | null): string => (x === null ? DASH : fixed(x, 2));

/** 부호를 붙인다(0은 부호 없음). 음수 기호는 MINUS 문자 */
export function signed(x: number | null, digits: 1 | 2 = 2): string {
  if (x === null) return DASH;
  const body = fixed(Math.abs(x), digits);
  if (Number(body) === 0) return body;
  return (x > 0 ? '+' : MINUS) + body;
}

export type Tone = 'win' | 'lose' | 'even';
/** 양수는 이긴 쪽, 음수는 진 쪽 */
export const toneOf = (x: number | null, eps = 0.005): Tone => (x === null || Math.abs(x) < eps ? 'even' : x > 0 ? 'win' : 'lose');

/** 가운데 기준 막대. ratio가 full이면 한쪽 끝까지(50%) 간다. */
export function barOf(ratio: number | null, full: number): { side: 'win' | 'lose' | 'none'; widthPct: number } {
  if (ratio === null || ratio === 0) return { side: 'none', widthPct: 0 };
  return { side: ratio > 0 ? 'win' : 'lose', widthPct: Math.round(Math.min(Math.abs(ratio) / full, 1) * 500) / 10 };
}

export const formatAmount = (x: number | null): string => (x === null ? DASH : `${x.toLocaleString('ko-KR')}원`);
export const rankLabel = (r: number | null): string => (r === null ? DASH : `${r}위`);
/** `2026-08-18 10:51:08` 같은 값에서 날짜만 */
export const dateOnly = (s: string | null): string | null => (s ? s.slice(0, 10) : null);
export const judgeLabel = (index: number): string => `위원 ${index}`;

export function excludedNote(indices: number[]): string {
  return `${[...indices].sort((a, b) => a - b).map(judgeLabel).join(', ')} 제외 중. 평균, 순위, 격차, 히트맵 모두 재계산`;
}

/** 공고 감지 후 주문한 보기. 저장된 값이 올바르지 않으면 null */
export const parseView = (s: string | null): 'ours' | 'all' | null => (s === 'ours' || s === 'all' ? s : null);
export const VIEW_KEY = 'bidmate.evalView';

export function duelTitle(leadName: string, chaseName: string, ours: 'won' | 'lost' | 'none', leadRank: number | null = null, chaseRank: number | null = null): string {
  const r = (n: number | null) => (n === null ? '' : `(${n}위)`);
  return `${leadName}${r(leadRank)} 대 ${chaseName}${r(chaseRank)}${ours === 'won' ? ', 우리가 이긴 공고' : ours === 'lost' ? ', 우리가 진 공고' : ''}`;
}

/** 쫓는 쪽 입장의 부호(lead - chase 차이를 뒤집는다) */
export const chaserSigned = (diff: number): string => signed(diff === 0 ? 0 : -diff);

export function partNote(chaserName: string, d: Decomposition): string {
  const cut = fixed(Math.abs(d.bidCutPct), 1);
  const bid = Number(cut) === 0 ? '투찰가 동일' : d.bidCutPct > 0 ? `투찰가 ${cut}% 낮음` : `투찰가 ${cut}% 높음`;
  const amt = f2(Math.abs(d.priceDiff));
  const price = d.priceDiff === 0 ? '가격점수 동일' : d.priceDiff > 0 ? `가격점수 ${amt}점 뒤짐` : d.bidCutPct > 0 ? `가격점수는 ${amt}점만 앞섬` : `가격점수 ${amt}점 앞섬`;
  return `${chaserName} 기준: ${bid}, ${price}`;
}

/** 소수 3자리까지 쓰되 끝의 0은 2자리까지만 줄인다(0.075, 0.10) */
const trim = (x: number, d = 3): string => fixed(x, d).replace(/(\.\d\d)0+$/, '$1');

export function exchangeLines(e: ExchangeRatio): { cut: string; grade: string | null; equal: string | null } {
  return {
    cut: `가격 +${trim(e.pricePerCut)}점`,
    grade: e.gradeStep === null ? null : `+${trim(e.gradeStep)}점`,
    equal: e.cutEquivalent === null ? null : `투찰가 약 ${trim(e.cutEquivalent)}% 인하와 같음`,
  };
}
export const gradeStepLabel = (maxItemScore: number): string => `${maxItemScore}점 항목, 위원 1명 1등급 상승`;

export interface PriceBox { tone: 'warn' | 'info'; head: string; body: string }

/** verify가 모두 통과했을 때의 교환 판정 상자 */
export function priceBox(d: Decomposition, chaserName: string): PriceBox {
  if (d.techDiff <= 0) {
    const base = `종합 차이 ${f2(d.totalDiff)}점은 가격점수에서 발생`;
    return { tone: 'info', head: '기술 우위 공고', body: d.priceCutToWinPct !== null ? `${base}. 투찰가 약 ${trim(d.priceCutToWinPct, 2)}% 추가 인하 시 역전 가능` : base };
  }
  const need = d.cutNeededPct === null ? DASH : `${trim(d.cutNeededPct, 2)}%`;
  return d.chaserPriceMaxed
    ? { tone: 'warn', head: '가격으로는 역전 불가', body: `${chaserName} 가격점수 이미 만점. 기술 ${f2(d.techDiff)}점을 메우려면 투찰가를 1위보다 약 ${need} 낮춰야 함` }
    : { tone: 'info', head: '가격으로 메울 수 있는 격차', body: `기술 격차 ${f2(d.techDiff)}점 = 투찰가 약 ${need} 인하` };
}

export const FORMULA_MISMATCH = '점수 공식이 달라 교환비 계산 생략';
export const NO_OFFICIAL = '공식 결과 없음';
export const PARTIAL_OFFICIAL = '공식 점수 일부 누락';
export const JUDGE_BASIS_NOTE = '공식 순위 일부 누락, 위원 평균 순위로 비교';

export interface ReversalText { verdict: string; tone: 'info' | 'warn'; local: boolean | null; behindLine: string; top3Line: string; stepsLine: string | null; advice: string | null }

/** 위원 점수 기준 문구. 공식 점수(종합, 가격)는 말하지 않는다. */
export function reversalText(r: ReversalDistance, itemCount: number, hasDecomposition = false): ReversalText {
  const behindLine = `세부항목 ${itemCount}개 중 ${r.behindCount}개에서 뒤짐`;
  if (r.relation === 'tie') {
    return { verdict: '위원 합계 동점', tone: 'info', local: null, behindLine, stepsLine: null, top3Line: '선택한 위원 기준 위원 합계 동일', advice: '격차 큰 항목부터 보강' };
  }
  if (r.relation === 'ahead') {
    return {
      verdict: '위원 점수 우위', tone: 'info', local: null, behindLine, stepsLine: null,
      top3Line: `선택한 위원 기준 위원 합계 ${f2(Math.abs(r.gapSum))}점 앞섬`,
      advice: hasDecomposition ? '실제 순위 차이는 공식 결과 칸 참고' : null,
    };
  }
  const top3Pct = r.top3Ratio === null ? null : Math.round(r.top3Ratio * 100);
  return {
    local: r.local, tone: r.local ? 'info' : 'warn', behindLine,
    verdict: r.local ? '국지적 열세' : '전반적 열세',
    top3Line: r.local ? '격차 큰 3개 항목만 따라잡아도 역전' : `격차 큰 3개 항목을 따라잡아도 격차의 ${top3Pct ?? 0}%만 회복`,
    stepsLine: r.stepsNeeded === null || r.maxItemScore === null
      ? null
      : `${r.maxItemScore}점 항목만으로는 등급 상승 ${r.stepsNeeded}회 필요 (해당 칸 ${r.cellsOfMax}개)`,
    advice: r.local
      ? '일부 항목만 보강하면 역전 가능. 격차 큰 항목부터'
      : r.stepsNeeded !== null && r.cellsOfMax !== null && r.stepsNeeded > r.cellsOfMax
        ? `${r.maxItemScore}점 항목 전부를 한 등급씩 올려도 부족. 제안서 전반, 특히 배점 큰 대항목의 완성도 개선 필요`
        : '여러 항목에서 조금씩 뒤짐. 배점 큰 대항목부터 전체 완성도 개선 필요',
  };
}

/** 이 위원을 빼면 문구 */
export function looText(o: { excluded: boolean; ours: boolean; firstChanged: boolean; rankDelta: number | null }): { text: string; strong: boolean } {
  if (o.excluded) return { text: '제외됨', strong: false };
  if (!o.ours) return o.firstChanged ? { text: '1위가 바뀜', strong: true } : { text: '변화 없음', strong: false };
  const d = o.rankDelta;
  if (d === null) return { text: DASH, strong: false };
  if (d === 0) return o.firstChanged ? { text: '1위가 바뀜', strong: true } : { text: '순위 그대로', strong: false };
  return { text: d < 0 ? `우리 ${Math.abs(d)}계단 상승` : `우리 ${d}계단 하락`, strong: true };
}

/** 히트맵 칸 색 단계 클래스(테마 토큰). 0=100%, 1=90%, 2=80%, 3=그 미만 */
export const HEAT_CLASS = ['bg-primary text-primary-ink', 'bg-primary/45 text-ink', 'bg-primary/15 text-ink', 'bg-warn-wash text-ink'] as const;
export const GRADE_SEG_CLASS = ['bg-primary', 'bg-primary/45', 'bg-primary/15', 'bg-warn/40'] as const;
export const GRADE_NAMES = ['100%', '90%', '80%', '80% 미만'] as const;

/** 등급 분포 한 줄의 칸 비율(%)과 만점 비율 */
export function gradeShare(counts: readonly number[]): { pct: number[]; full: string } {
  const total = counts.reduce((a, b) => a + b, 0) || 1;
  return { pct: counts.map((c) => (c / total) * 100), full: `${Math.round(((counts[0] ?? 0) / total) * 100)}%` };
}

/** 승부 분해 머리에 붙이는 안내. gapSumAll은 위원 제외 없이 계산한 위원 합계 차이 */
export function basisNotes(p: { excludedCount: number; dec: Decomposition | null; gapSumAll: number }): string[] {
  const out: string[] = [];
  if (p.excludedCount > 0) out.push('위원 제외는 역전 거리, 등급 분포, 합계 표에만 반영. 공식 점수 분해는 전체 위원 기준');
  if (p.dec && p.dec.techDiff !== 0 && p.gapSumAll !== 0 && Math.sign(p.dec.techDiff) !== Math.sign(p.gapSumAll)) {
    out.push('공식 기술점수와 위원 합계의 방향이 다름. 공식 기술점수에 위원 점수 외 항목이 포함됐을 수 있음(미확인)');
  }
  return out;
}
