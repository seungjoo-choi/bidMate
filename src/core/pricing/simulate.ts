import type { EvalRecord } from '../types/evaluation';
import type { Notice } from '../types/notice';
import { verifyPriceFormula } from '../evaluation/analyze';

export interface SimInput { priceWeight: number; base: number; rivalRate: number; lowerLimitRate?: number; ourRate?: number; techGap?: number /* 우리 − 경쟁 */ }
export interface SimRow { rate: number; amount: number; ourScore: number; rivalScore: number; diff: number; excluded: boolean; isRival: boolean }
export interface SimResult {
  rows: SimRow[];
  custom: SimRow | null;
  pricePerCut: number;
  breakEven: { rate: number | null; amount: number | null; excluded: boolean; impossible: boolean; note?: string } | null;
  warnings: string[];
}

const q = (x: number): number => Math.round(x * 1e4) / 1e4 || 0; // 소수 4자리, -0은 0으로

function makeRow(i: SimInput, rate: number, isRival: boolean): SimRow {
  const W = i.priceWeight;
  const L = i.rivalRate;
  let ourScore: number;
  let rivalScore: number;
  if (rate >= L) { ourScore = q(W * L / rate); rivalScore = W; } else { ourScore = W; rivalScore = q(W * rate / L); }
  return {
    rate, amount: Math.round(i.base * rate / 100), ourScore, rivalScore, diff: q(ourScore - rivalScore),
    excluded: i.lowerLimitRate !== undefined && rate < i.lowerLimitRate, isRival,
  };
}

export function simulate(i: SimInput): SimResult {
  const warnings: string[] = [];
  const W = i.priceWeight;
  const L = i.rivalRate;
  const pricePerCut = Number.isFinite(W) ? W / 100 : 0;
  if (!(W > 0)) warnings.push('가격 배점이 0 이하입니다');
  if (!(i.base > 0)) warnings.push('분모 금액이 0 이하입니다');
  if (!(L > 0 && L <= 200)) warnings.push('경쟁 최저 투찰률이 범위(0 초과 200 이하)를 벗어났습니다');
  if (warnings.length > 0) return { rows: [], custom: null, pricePerCut, breakEven: null, warnings };

  if (i.lowerLimitRate !== undefined && i.lowerLimitRate > L) warnings.push('경쟁 최저 투찰률이 낙찰하한율보다 낮습니다. 분포 값을 확인하세요');

  const rates: number[] = [];
  for (let k = 0; k <= 40; k++) rates.push(80 + k * 0.5);
  if (!rates.includes(L)) rates.push(L);
  rates.sort((a, b) => a - b);
  const rows = rates.map((r) => makeRow(i, r, r === L));
  const custom = i.ourRate !== undefined && i.ourRate > 0 ? makeRow(i, i.ourRate, i.ourRate === L) : null;

  let breakEven: SimResult['breakEven'] = null;
  const G = i.techGap;
  if (G !== undefined && Number.isFinite(G)) {
    let rate: number | null = null;
    let impossible = false;
    let note: string | undefined;
    if (G >= 0) {
      if (G >= W) note = '어떤 투찰률도 우세';
      else rate = q(L * W / (W - G));
    } else if (-G >= W) {
      impossible = true;
    } else {
      const r = q(L * (W + G) / W);
      if (r <= 0) impossible = true; else rate = r;
    }
    breakEven = rate === null
      ? { rate: null, amount: null, excluded: false, impossible, ...(note ? { note } : {}) }
      : {
        rate, amount: Math.round(i.base * rate / 100), impossible: false,
        excluded: i.lowerLimitRate !== undefined && rate < i.lowerLimitRate,
      };
  }
  return { rows, custom, pricePerCut, breakEven, warnings };
}

/** 공고의 가격 배점. API 값 우선, 없으면 평가방법 문자열("... 가격 10")에서 보정 */
export function priceEvalRateOf(n: Notice): { value: number; source: 'api' | 'evalMethod' } | null {
  const api = n.evaluation?.priceEvalRate?.value;
  if (typeof api === 'number' && Number.isFinite(api)) return { value: api, source: 'api' };
  const em = n.evaluation?.evalMethod;
  const str = typeof em?.value === 'string' && em.value !== '' ? em.value : em?.raw;
  if (typeof str === 'string') {
    const m = /가격\s*(\d+(?:\.\d+)?)/.exec(str);
    if (m) return { value: Number(m[1]), source: 'evalMethod' };
  }
  return null;
}

/** 분모 기본값은 추정가격만(budgetAmount는 부가세 포함이라 사용 금지) */
export function defaultBaseOf(n: Notice): number | null {
  const v = n.basic?.estimatedPrice?.value;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function formulaVerification(records: EvalRecord[]): { ok: number; total: number } {
  let ok = 0;
  let total = 0;
  for (const rec of records) {
    if (!rec.official) continue;
    total++;
    if (verifyPriceFormula(rec).ok) ok++;
  }
  return { ok, total };
}
