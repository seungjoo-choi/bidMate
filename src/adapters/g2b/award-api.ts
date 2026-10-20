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
  return items
    .map((i): OpeningRow => ({
      bizNo: normalizeBizNo(String(i[F.openingBizNo] ?? '')),
      rank: toNum(i[F.openingRank]),
      totalScore: toNum(i[F.openingScore]),
      rbidNo: strOf(F.openingRbidNo ? i[F.openingRbidNo] : null),
      bidAmount: toNum(i[F.openingAmount]),
      won: flagOf(i, F.openingWon),
      noBid: flagOf(i, F.openingNoBid),
    }))
    .filter((r) => r.bizNo !== '');
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

export type OpeningResult = { ok: true; rows: OpeningRow[]; fetchedAt: ISODate } | { ok: false; error: JobError };
export type AwardResult = { ok: true; rows: AwardRow[]; op: string | null; fetchedAt: ISODate } | { ok: false; error: JobError };

const nowIso = (ctx: G2bContext): ISODate => (ctx.now ?? (() => new Date()))().toISOString();

export async function fetchOpening(noticeNo: string, ctx: G2bContext): Promise<OpeningResult> {
  const r = await fetchOpeningRaw(noticeNo, ctx);
  if (!r.ok) return r;
  return { ok: true, rows: mapOpeningRows(r.items), fetchedAt: nowIso(ctx) };
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
