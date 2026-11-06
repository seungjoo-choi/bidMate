import type { JobError } from '../../core/types/job';
import { normalizeBizNo } from '../../core/evaluation/company';
import { toIsoKst } from '../../core/model/dates';
import type { ISODate } from '../../core/types/common';
import { fetchJsonOp, type ApiItem, type G2bContext } from './openapi';

const BASE = 'https://apis.data.go.kr/1230000/as/ScsbidInfoService/';
const OPENING_OP = 'getOpengResultListInfoOpengCompt';

export const AWARD_OPS = ['getScsbidListSttusServc', 'getScsbidListSttusThng', 'getScsbidListSttusCnstwk', 'getScsbidListSttusFrgcpt'] as const;

export type RawResult = { ok: true; items: ApiItem[] } | { ok: false; error: JobError };

async function fetchRaw(op: string, inqryDiv: string, numOfRows: string, noticeNo: string, ctx: G2bContext): Promise<RawResult> {
  const key = ctx.serviceKey?.trim();
  if (!key) return { ok: false, error: { code: 'G2B_KEY_MISSING', message: '나라장터 서비스키가 설정되지 않았습니다.', step: 'fetch_basic', retryable: false } };
  const qs = new URLSearchParams({ serviceKey: key, inqryDiv, bidNtceNo: noticeNo, type: 'json', numOfRows, pageNo: '1' });
  return fetchJsonOp(`${BASE}${op}?${qs.toString()}`, op, ctx);
}

/** 1단계 개찰결과 원본 항목(S0 probe용). */
export function fetchOpeningRaw(noticeNo: string, ctx: G2bContext): Promise<RawResult> {
  return fetchRaw(OPENING_OP, '4', '999', noticeNo, ctx);
}

/** 2단계 낙찰정보 원본 항목(S0 probe용). */
export function fetchAwardRaw(noticeNo: string, op: (typeof AWARD_OPS)[number] | string, ctx: G2bContext): Promise<RawResult> {
  return fetchRaw(op, '4', '100', noticeNo, ctx);
}

/** 유찰 목록 후보 오퍼레이션(S0 probe용). 실측에서 오류면 이름을 바꿔 재실측 */
export const FAILING_OPS = ['getOpengResultListInfoFailing'] as const;
/** 실측 전 ''(비활성). 실측 후 확인된 이름으로 교체하면 유찰 목록 규칙이 활성화된다 */
export const FAILING_OP = '';
/** 유찰 목록 응답 필드명. 실측 후 교체. reason은 유찰 사유 필드명(없으면 '') */
export const FAILING_FIELDS = { rbidNo: 'rbidNo', round: 'bidNtceOrd', at: 'opengDt', reason: '' } as const;

/** 유찰 목록 원본 항목(S0 probe용). */
export function fetchFailingRaw(noticeNo: string, op: string, ctx: G2bContext): Promise<RawResult> {
  return fetchRaw(op, '4', '100', noticeNo, ctx);
}

/** 응답 필드명 한 곳. 빈 문자열이면 해당 규칙은 비활성(S0 실측 전 미확인 항목). */
export const AWARD_FIELDS = {
  openingBizNo: 'prcbdrBizno',
  openingRank: 'opengRank',
  openingScore: 'totalEvlAmtVal',
  openingRbidNo: 'rbidNo',
  openingAmount: 'bidprcAmt',
  /** 1단계 낙찰 플래그. 'Y'면 낙찰. 미확인 */
  openingWon: '',
  /** 1단계 유찰 식별 필드. 'Y'면 유찰. 미확인 */
  openingNoBid: '',
  /** 1단계 개찰결과 구분명. 값에 openingNoBidMark가 포함되면 유찰 */
  openingResultDiv: 'opengRsltDivNm',
  openingNoBidMark: '유찰',
  awardBizNo: 'bidwinnrBizno',
  awardName: 'bidwinnrNm',
  awardAmount: 'sucsfbidAmt',
  awardDate: 'fnlSucsfDate',
  awardRbidNo: 'rbidNo',
} as const;

export interface OpeningRow { bizNo: string; rank: number | null; totalScore: number | null; rbidNo: string | null; bidAmount: number | null; won: boolean | null; noBid: boolean | null }
export interface AwardRow { bizNo: string; name: string | null; amount: number | null; awardedAt: ISODate | null; rbidNo: string | null }

const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const t = String(v).replace(/,/g, '').trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const strOf = (v: unknown): string | null => {
  const t = String(v ?? '').trim();
  return t === '' ? null : t;
};
const flagOf = (item: ApiItem, field: string): boolean | null => {
  if (!field) return null;
  const t = strOf(item[field]);
  return t === null ? null : t.toUpperCase() === 'Y';
};

export function mapOpeningRows(items: ApiItem[]): OpeningRow[] {
  const F = AWARD_FIELDS;
  const divField: string = F.openingResultDiv;
  return items
    .map((i): OpeningRow => ({
      bizNo: normalizeBizNo(String(i[F.openingBizNo] ?? '')),
      rank: toNum(i[F.openingRank]),
      totalScore: toNum(i[F.openingScore]),
      rbidNo: strOf(F.openingRbidNo ? i[F.openingRbidNo] : null),
      bidAmount: toNum(i[F.openingAmount]),
      won: flagOf(i, F.openingWon),
      noBid: flagOf(i, F.openingNoBid) ?? (divField !== '' && (strOf(i[divField]) ?? '').includes(F.openingNoBidMark) ? true : null),
    }))
    // 유찰 표기 행은 투찰 업체가 없어 사업자번호가 비어 올 수 있으므로 남긴다
    .filter((r) => r.bizNo !== '' || r.noBid === true);
}

export function mapAwardRows(items: ApiItem[]): AwardRow[] {
  const F = AWARD_FIELDS;
  return items
    .map((i): AwardRow => {
      const d = strOf(i[F.awardDate]);
      return {
        bizNo: normalizeBizNo(String(i[F.awardBizNo] ?? '')),
        name: strOf(i[F.awardName]),
        amount: toNum(i[F.awardAmount]),
        awardedAt: d === null ? null : toIsoKst(d) ?? toIsoKst(`${d} 00:00`),
        rbidNo: strOf(F.awardRbidNo ? i[F.awardRbidNo] : null),
      };
    })
    .filter((r) => r.bizNo !== '');
}

export interface FailingRow { rbidNo: string | null; round: string | null; at: ISODate | null; reason: string | null }
export type FailingResult = { ok: true; rows: FailingRow[]; fetchedAt: ISODate; called: boolean } | { ok: false; error: JobError };

export function mapFailingRows(items: ApiItem[]): FailingRow[] {
  const F = FAILING_FIELDS;
  return items.map((i): FailingRow => {
    const d = F.at ? strOf(i[F.at]) : null;
    return {
      rbidNo: F.rbidNo ? strOf(i[F.rbidNo]) : null,
      round: F.round ? strOf(i[F.round]) : null,
      at: d === null ? null : toIsoKst(d) ?? toIsoKst(`${d} 00:00`),
      reason: F.reason ? strOf(i[F.reason]) : null,
    };
  });
}

export type OpeningResult = { ok: true; rows: OpeningRow[]; fetchedAt: ISODate } | { ok: false; error: JobError };
export type AwardResult = { ok: true; rows: AwardRow[]; op: string | null; fetchedAt: ISODate } | { ok: false; error: JobError };

const nowIso = (ctx: G2bContext): ISODate => (ctx.now ?? (() => new Date()))().toISOString();

export async function fetchOpening(noticeNo: string, ctx: G2bContext): Promise<OpeningResult> {
  const r = await fetchOpeningRaw(noticeNo, ctx);
  if (!r.ok) return r;
  return { ok: true, rows: mapOpeningRows(r.items), fetchedAt: nowIso(ctx) };
}

/** FAILING_OP가 빈 문자열이면 호출 없이 빈 결과(called false). 그 외 유찰 목록을 1회 조회한다. */
export async function fetchFailing(noticeNo: string, ctx: G2bContext): Promise<FailingResult> {
  if (FAILING_OP === '') return { ok: true, rows: [], fetchedAt: nowIso(ctx), called: false };
  const r = await fetchFailingRaw(noticeNo, FAILING_OP, ctx);
  if (!r.ok) return r;
  return { ok: true, rows: mapFailingRows(r.items), fetchedAt: nowIso(ctx), called: true };
}

/** ops를 순서대로 호출해 첫 비어 있지 않은 응답을 쓴다. 호출 오류는 즉시 반환, 모두 비면 rows [] op null. */
export async function fetchAward(noticeNo: string, ops: readonly string[], ctx: G2bContext): Promise<AwardResult> {
  for (const op of ops) {
    const r = await fetchAwardRaw(noticeNo, op, ctx);
    if (!r.ok) return r;
    if (r.items.length === 0) continue;
    return { ok: true, rows: mapAwardRows(r.items), op, fetchedAt: nowIso(ctx) };
  }
  return { ok: true, rows: [], op: null, fetchedAt: nowIso(ctx) };
}
