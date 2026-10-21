import { isNaNote, isNotApplicable, isNotApplicableField, naNoteOf } from '../extraction/review-count';
import { parseKoreanAmount, parseYears } from '../extraction/normalize';
import { formatAmountShort } from '../model/format';
import type { FieldStatus, FieldValue } from '../types/common';
import type { Extraction, ExtractedItem, ExtractionKey, ExtractionStatus } from '../types/extraction';
import type { Notice } from '../types/notice';
import { compareAmountOf, type DateOnly, type PerformanceRecord } from '../types/performance';

export type CriterionState = 'known' | 'unknown'; /* known = verified 또는 userEdited 값 있음 */
export interface Criterion<T> { value: T | null; state: CriterionState; status: ExtractionStatus | FieldValue<unknown>['status']; note?: string }
export interface Criteria {
  postedAt: DateOnly | null;
  periods: Array<Criterion<number>>; /* 연수. 충돌이면 후보별 1개씩(최대 4), 아니면 1개 */
  amounts: Array<Criterion<number>>; /* 원. 같은 규칙 */
  condition: { text: string | null; present: boolean };
}

const NOT_FOUND = '문서에서 찾지 못함';
const CONFLICT = '문서 간 값이 다름';
const MAX_CANDIDATES = 4;
const MAX_LINES = 6;

// 범위 밖 값은 해석 실패로 본다. 0원이나 "2023년" 같은 값이 known으로 들어가 거짓 충족이 나는 것을 막는다.
const MAX_YEARS = 30;
const validYears = (n: number | null): number | null => (n !== null && Number.isInteger(n) && n >= 1 && n <= MAX_YEARS ? n : null);
const validAmount = (n: number | null): number | null => (n !== null && Number.isFinite(n) && n >= 1 ? n : null);
const toYears = (v: unknown): number | null => {
  if (typeof v === 'number') return validYears(v);
  if (typeof v !== 'string') return null;
  const y = parseYears(v);
  if (y !== null) return validYears(y);
  return /^\s*\d+\s*$/.test(v) ? validYears(Number(v)) : null;
};
const toAmount = (v: unknown): number | null => {
  if (typeof v === 'number') return validAmount(v);
  return typeof v === 'string' ? validAmount(parseKoreanAmount(v)) : null;
};

function criteriaFromItem<T>(item: ExtractedItem<unknown> | undefined, conv: (v: unknown) => T | null): Array<Criterion<T>> {
  if (!item) return [{ value: null, state: 'unknown', status: 'not_run', note: NOT_FOUND }];
  const edited = item.userEdited;
  if (!edited && isNotApplicable(item)) return [{ value: null, state: 'unknown', status: item.status, note: naNoteOf(item) }];
  if (edited && edited.value !== null && edited.value !== undefined) {
    const v = conv(edited.value);
    return [v === null
      ? { value: null, state: 'unknown', status: item.status, note: '값을 해석하지 못함' }
      : { value: v, state: 'known', status: item.status }];
  }
  if (item.reason === 'conflict' && item.candidates && item.candidates.length >= 2) {
    return item.candidates.slice(0, MAX_CANDIDATES).map((cand) => {
      const v = conv(cand.value);
      return { value: v, state: 'unknown' as const, status: item.status, note: v === null ? '값을 해석하지 못함' : CONFLICT };
    });
  }
  if (item.value === null || item.value === undefined) {
    return [{ value: null, state: 'unknown', status: item.status, note: NOT_FOUND }];
  }
  const v = conv(item.value);
  if (v === null) return [{ value: null, state: 'unknown', status: item.status, note: '값을 해석하지 못함' }];
  return [{ value: v, state: item.status === 'verified' ? 'known' : 'unknown', status: item.status }];
}

function criterionFromField<T>(f: FieldValue<unknown>, conv: (v: unknown) => T | null): Criterion<T> {
  if (isNotApplicableField(f)) return { value: null, state: 'unknown', status: f.status, note: f.note };
  if (f.value === null || f.value === undefined) return { value: null, state: 'unknown', status: f.status, note: NOT_FOUND };
  const v = conv(f.value);
  if (v === null) return { value: null, state: 'unknown', status: f.status, note: '값을 해석하지 못함' };
  const known = (f.status as FieldStatus) === 'verified' || f.status === 'user_edited';
  return { value: v, state: known ? 'known' : 'unknown', status: f.status };
}

const dateOf = (v: unknown): DateOnly | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

/** extraction이 있으면 items에서, 없으면 notice.evaluation에서 만든다. userEdited 값 우선. */
export function criteriaOf(notice: Notice, extraction: Extraction | null): Criteria {
  const ev = notice.evaluation;
  const postedAt = dateOf(notice.basic.postedAt.value);
  const item = (key: ExtractionKey) => extraction?.items[key];
  let periods: Array<Criterion<number>>;
  let amounts: Array<Criterion<number>>;
  let condText: unknown;
  if (extraction) {
    periods = criteriaFromItem(item('performancePeriod'), toYears);
    amounts = criteriaFromItem(item('performanceMinAmount'), toAmount);
    const c = item('performanceCondition');
    condText = c?.userEdited && c.userEdited.value !== null ? c.userEdited.value : c?.value;
  } else {
    periods = [criterionFromField(ev.performancePeriod, toYears)];
    amounts = [criterionFromField(ev.performanceMinAmount, toAmount)];
    condText = ev.performanceCondition.value;
  }
  const text = typeof condText === 'string' && condText.trim() !== '' ? condText.trim() : null;
  return { postedAt, periods, amounts, condition: { text, present: text !== null } };
}

export type Verdict = 'met' | 'possibly_short' | 'review' | 'no_data';
export interface MatchedPerformance { p: PerformanceRecord; compareAmount: number; periodOk: boolean | null; amountOk: boolean | null }
export interface JudgeLine {
  period: Criterion<number> | null; amount: Criterion<number> | null;
  matched: MatchedPerformance[]; /* periodOk !== false && amountOk !== false 인 완료 실적, compareAmount 내림차순 */
  verdict: Verdict;
  reasons: string[];
}
export interface Judgement { verdict: Verdict; lines: JudgeLine[]; inProgress: number; conditionText: string | null; total: number }

/** 기준일에서 N년 전 날짜. 2월 29일이 없는 해는 2월 28일로 맞춘다. */
function yearsBefore(date: DateOnly, years: number): DateOnly {
  const y = Number(date.slice(0, 4)) - years;
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

export function judge(criteria: Criteria, performances: PerformanceRecord[]): Judgement {
  const total = performances.length;
  const conditionText = criteria.condition.text;
  const inProgress = performances.filter((p) => !p.endAt).length;
  if (total === 0) return { verdict: 'no_data', lines: [], inProgress: 0, conditionText, total: 0 };

  const periods: Array<Criterion<number> | null> = criteria.periods.length > 0 ? criteria.periods : [null];
  const amounts: Array<Criterion<number> | null> = criteria.amounts.length > 0 ? criteria.amounts : [null];
  const done = performances.filter((p) => p.endAt);
  const { postedAt } = criteria;

  const lines: JudgeLine[] = [];
  outer: for (const period of periods) {
    for (const amount of amounts) {
      if (lines.length >= MAX_LINES) break outer;
      const from = postedAt !== null && period?.value != null ? yearsBefore(postedAt, period.value) : null;
      const matched: MatchedPerformance[] = [];
      let periodCount = 0;
      let amountCount = 0;
      for (const p of done) {
        const periodOk = from !== null ? p.endAt! >= from && p.endAt! <= postedAt! : null;
        const compareAmount = compareAmountOf(p);
        const amountOk = amount?.value != null ? compareAmount >= amount.value : null;
        if (periodOk === true) periodCount++;
        if (amountOk === true) amountCount++;
        if (periodOk !== false && amountOk !== false) matched.push({ p, compareAmount, periodOk, amountOk });
      }
      matched.sort((a, b) => b.compareAmount - a.compareAmount);

      const reasons: string[] = [];
      const suffix = (c: Criterion<number>) => (c.state === 'unknown' && c.value !== null ? ' (추출값 확인 필요)' : '');
      if (period) {
        if (period.value === null) reasons.push(isNaNote(period.note) ? `인정기간: 해당 없음(${period.note})` : `인정기간: 확인 필요 (${period.note ?? '추출값 없음'})`);
        else if (postedAt === null) reasons.push(`공고게시일이 없어 기간을 판정할 수 없음${suffix(period)}`);
        else reasons.push(`인정기간 ${period.value}년: 기준일 ${postedAt} 기준 ${from} 이후 완료 실적 ${periodCount}건${suffix(period)}`);
      }
      if (amount) {
        if (amount.value === null) reasons.push(isNaNote(amount.note) ? `인정금액: 해당 없음(${amount.note})` : `인정금액: 확인 필요 (${amount.note ?? '추출값 없음'})`);
        else reasons.push(`인정금액 ${formatAmountShort(amount.value)} 이상: 비교 금액(계약금액 × 지분율) 충족 ${amountCount}건${suffix(amount)}`);
      }
      if (criteria.condition.present) reasons.push('인정조건 원문이 있어 사람이 확인해야 합니다');

      let verdict: Verdict;
      const bothNull = (period === null || period.value === null) && (amount === null || amount.value === null);
      if (criteria.condition.present) verdict = 'review';
      else if (period?.state === 'unknown' || amount?.state === 'unknown' || postedAt === null) verdict = 'review';
      else if (bothNull) verdict = 'review';
      else verdict = matched.length >= 1 ? 'met' : 'possibly_short';
      lines.push({ period, amount, matched, verdict, reasons });
    }
  }

  let verdict: Verdict;
  if (criteria.condition.present) verdict = 'review';
  else if (lines.some((l) => l.verdict === 'met')) verdict = 'met';
  else if (lines.every((l) => l.verdict === 'possibly_short')) verdict = 'possibly_short';
  else verdict = 'review';
  return { verdict, lines, inProgress, conditionText, total };
}
