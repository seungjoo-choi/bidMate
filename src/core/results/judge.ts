import type { AwardResult, FailingResult, OpeningResult, OpeningRow, AwardRow } from '../../adapters/g2b/award-api';
import { normalizeBizNo } from '../evaluation/company';
import type { ISODate } from '../types/common';
import { RESULT_TERMINAL, type ResultEntry, type ResultStatus } from '../types/result';
import { RESULT_BACKOFF_MS, RESULT_TRACK_DAYS } from './limits';

export type JudgeEvent = 'rank' | 'final' | 'expired';
export interface JudgeInput {
  /** 우리 사업자번호(숫자 10자리) */
  ourBizNo: string;
  now: Date;
  prev: ResultEntry;
  opening: OpeningResult;
  /** 2단계를 호출하지 않았으면 null */
  award: AwardResult | null;
  /** 유찰 목록 조회 결과. 호출하지 않았으면 null/생략, ok false면 무시 */
  failing?: FailingResult | null;
}
export interface JudgeOutput { entry: ResultEntry; event?: JudgeEvent }

const DAY_MS = 86_400_000;
const FINAL_STATUSES: ReadonlySet<ResultStatus> = new Set<ResultStatus>(['won', 'lost', 'not_participated', 'no_bid']);

/** attempts(1 이상)번째 실패/미확정 뒤 기다릴 시간. 30분, 2시간, 6시간, 24시간, 이후 24시간. */
export function backoffMs(attempts: number): number {
  const i = Math.min(Math.max(attempts, 1) - 1, RESULT_BACKOFF_MS.length - 1);
  return RESULT_BACKOFF_MS[i]!;
}

/** rbidNo가 있는 행이 있으면 가장 큰 rbidNo 묶음만 남긴다. */
export function latestBundle<T extends { rbidNo: string | null }>(rows: T[]): T[] {
  const nums = rows.map((r) => (r.rbidNo === null ? NaN : Number(r.rbidNo))).filter((n) => Number.isFinite(n));
  if (nums.length === 0) return rows;
  const max = Math.max(...nums);
  return rows.filter((r) => r.rbidNo !== null && Number(r.rbidNo) === max);
}

/** 숫자로 바꿀 수 있는 rbidNo 중 최대값. 없으면 null. */
export function maxRbid(rows: Array<{ rbidNo: string | null }>): number | null {
  const nums = rows.map((r) => (r.rbidNo === null ? NaN : Number(r.rbidNo))).filter((n) => Number.isFinite(n));
  return nums.length === 0 ? null : Math.max(...nums);
}

/** 점수가 높을수록 좋은 순위인지. 순위 필드가 없을 때 점수로 순위를 채우는 방향(S0 실측에서 바뀔 수 있음). */
export const SCORE_RANK_DESC = true;

/** 순위가 전부 없고 점수만 있으면 점수로 순위를 채운다(동점은 같은 순위). 최신 묶음을 고른 뒤에 적용한다. */
export function fillScoreRanks(rows: OpeningRow[]): OpeningRow[] {
  if (rows.length === 0 || !rows.every((r) => r.rank === null) || !rows.some((r) => r.totalScore !== null)) return rows;
  return rows.map((r) => {
    if (r.totalScore === null) return r;
    const better = rows.filter((o) => o.totalScore !== null && (SCORE_RANK_DESC ? o.totalScore > r.totalScore! : o.totalScore < r.totalScore!)).length;
    return { ...r, rank: 1 + better };
  });
}

const hasRank = (r: OpeningRow): boolean => r.rank !== null || r.totalScore !== null;

function eventOf(prev: ResultStatus, next: ResultStatus): JudgeEvent | undefined {
  if (next === prev) return undefined;
  if (next === 'ranked' && prev === 'waiting') return 'rank';
  if (FINAL_STATUSES.has(next)) return 'final';
  if (next === 'expired') return 'expired';
  return undefined;
}

type Decision = Pick<ResultEntry, 'status'> & Partial<Pick<ResultEntry, 'rank' | 'bidders' | 'winnerBizNo' | 'winnerName' | 'awardedAt' | 'amount' | 'ourAmount'>>;

const amtOf = (mine: OpeningRow | undefined): Pick<Decision, 'ourAmount'> => (mine && mine.bidAmount !== null ? { ourAmount: mine.bidAmount } : {});

function decide(input: JudgeInput, ours: string, rows: OpeningRow[], awardRows: AwardRow[], fetchedAt: string): Decision {
  const { prev, now } = input;
  // 2. 낙찰 업체 사업자번호가 있으면 우리 여부로 won/lost
  const winner = awardRows[0];
  if (winner) {
    if (ours !== '' && winner.bizNo === ours) {
      const mine = rows.find((r) => r.bizNo === ours);
      return { status: 'won', ...(mine?.rank != null ? { rank: mine.rank } : {}), ...amtOf(mine), ...(rows.length > 0 ? { bidders: rows.length } : {}), winnerBizNo: winner.bizNo, ...(winner.name ? { winnerName: winner.name } : {}), awardedAt: winner.awardedAt ?? fetchedAt, ...(winner.amount !== null ? { amount: winner.amount } : {}) };
    }
    const mine = rows.find((r) => r.bizNo === ours);
    return { status: 'lost', ...(mine?.rank != null ? { rank: mine.rank } : {}), ...amtOf(mine), winnerBizNo: winner.bizNo, ...(winner.name ? { winnerName: winner.name } : {}), ...(winner.awardedAt ? { awardedAt: winner.awardedAt } : {}), ...(winner.amount !== null ? { amount: winner.amount } : {}) };
  }
  const mine = rows.find((r) => r.bizNo === ours);
  // 3. 1단계 낙찰 플래그(필드 확인 전에는 won이 항상 null이라 비활성)
  if (mine?.won === true) return { status: 'won', ...(mine.rank !== null ? { rank: mine.rank } : {}), ...amtOf(mine), bidders: rows.length, awardedAt: fetchedAt };
  // 4. 유찰: 1단계 행의 유찰 표기, 또는 유찰 목록 건수가 있고 재입찰 번호가 1단계 최신 묶음 이상
  const noBidByRow = rows.some((r) => r.noBid === true);
  const f = input.failing && input.failing.ok ? input.failing.rows : [];
  const fMax = maxRbid(f);
  const rMax = maxRbid(rows);
  const noBidByList = f.length > 0 && (rows.length === 0 || fMax === null || rMax === null || fMax >= rMax);
  const bidders = rows.filter((r) => r.bizNo !== '').length; // 사업자번호 없는 유찰 표기 행은 투찰 업체가 아님
  if (noBidByRow || noBidByList) return { status: 'no_bid', ...(bidders > 0 ? { bidders } : {}) };
  // 5~7
  const ranked = rows.filter(hasRank);
  let d: Decision;
  if (ranked.length === 0) d = { status: 'waiting', bidders: rows.length };
  else if (!mine) d = { status: 'not_participated', bidders: rows.length };
  else d = { status: 'ranked', ...(mine.rank !== null ? { rank: mine.rank } : {}), ...amtOf(mine), bidders: rows.length };
  // 8. 120일 초과
  if ((d.status === 'waiting' || d.status === 'ranked') && now.getTime() - Date.parse(prev.openingAt) > RESULT_TRACK_DAYS * DAY_MS) {
    return { status: 'expired', ...(d.rank !== undefined ? { rank: d.rank } : {}), ...(d.ourAmount !== undefined ? { ourAmount: d.ourAmount } : {}), ...(d.bidders !== undefined ? { bidders: d.bidders } : {}) };
  }
  return d;
}

/** 순수 판정. 저장소/네트워크에 접근하지 않는다. */
export function judge(input: JudgeInput): JudgeOutput {
  const { prev, now, opening, award } = input;
  const nowIso = now.toISOString();
  const fail = (error: { code: string; message: string }): JudgeOutput => {
    const attempts = prev.attempts + 1;
    return { entry: { ...prev, attempts, checkedAt: nowIso, lastError: { code: error.code, message: error.message }, nextCheckAt: new Date(now.getTime() + backoffMs(attempts)).toISOString() } };
  };
  // 1. 오류: 상태 유지
  if (!opening.ok) return fail(opening.error);
  if (award && !award.ok) return fail(award.error);

  const ours = normalizeBizNo(input.ourBizNo);
  const rows = fillScoreRanks(latestBundle(opening.rows));
  const awardRows = award && award.ok ? latestBundle(award.rows) : [];
  const fetchedAt = award && award.ok ? award.fetchedAt : opening.fetchedAt;
  const d = decide(input, ours, rows, awardRows, fetchedAt);

  const { lastError: _drop, rank: _r, bidders: _b, winnerBizNo: _w, winnerName: _n, awardedAt: _a, amount: _m, ourAmount: _o, ...base } = prev;
  const terminal = RESULT_TERMINAL.has(d.status);
  const attempts = terminal ? 0 : prev.attempts + 1;
  const listOp = award && award.ok && award.op ? award.op : prev.listOp;
  const entry: ResultEntry = {
    ...base,
    ...d,
    ...(listOp ? { listOp } : {}),
    checkedAt: nowIso,
    attempts,
    nextCheckAt: terminal ? prev.nextCheckAt : new Date(now.getTime() + backoffMs(attempts)).toISOString(),
  };
  const event = eventOf(prev.status, d.status);
  return { entry, ...(event ? { event } : {}) };
}

/** 백필 전용. 상태를 바꾸지 않고 ourAmount(있으면 bidders)만 채우고 amountCheckedAt을 찍는다. */
export function applyOurAmount(prev: ResultEntry, rows: OpeningRow[], ourBizNo: string, checkedAt: ISODate): ResultEntry {
  const ours = normalizeBizNo(ourBizNo);
  const bundle = fillScoreRanks(latestBundle(rows));
  const mine = ours === '' ? undefined : bundle.find((r) => r.bizNo === ours);
  return {
    ...prev,
    ...(mine && mine.bidAmount !== null ? { ourAmount: mine.bidAmount } : {}),
    ...(prev.bidders === undefined && bundle.length > 0 ? { bidders: bundle.length } : {}),
    amountCheckedAt: checkedAt,
  };
}

/** 1단계 판정 결과로 2단계 호출이 필요한지 정한다(judge를 award=null로 먼저 돌린 결과를 넘긴다). */
export function shouldFetchAward(prev: ResultEntry, opening: OpeningResult, preliminary: ResultEntry, ourBizNo: string): boolean {
  if (!opening.ok) return false;
  if (preliminary.status === 'ranked' || prev.status === 'ranked') return true;
  const ours = normalizeBizNo(ourBizNo);
  const rows = latestBundle(opening.rows);
  if (preliminary.status === 'expired' && rows.some((r) => r.bizNo === ours)) return true;
  return rows.length === 0 && !!prev.listOp;
}
