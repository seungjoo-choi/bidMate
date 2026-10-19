import type { JobError } from '../../core/types/job';
import type { EvalOfficialRow } from '../../core/types/evaluation';
import { fetchJsonOp, type ApiItem, type G2bContext } from './openapi';

const BASE = 'https://apis.data.go.kr/1230000/as/ScsbidInfoService/';
const OPERATION = 'getOpengResultListInfoOpengCompt';

const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const t = String(v).replace(/,/g, '').trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** 개찰결과 목록을 공식 결과 행으로 바꾼다. 사업자번호는 숫자만 남긴다. */
export function mapOfficialRows(items: ApiItem[], round?: string): EvalOfficialRow[] {
  const pad = (v: unknown) => String(v ?? '').trim().padStart(3, '0');
  return items
    .filter((i) => round === undefined || String(i.bidNtceOrd ?? '').trim() === '' || pad(i.bidNtceOrd) === pad(round))
    .map((i) => ({
    bizNo: String(i.prcbdrBizno ?? '').replace(/\D/g, ''),
    rank: toNum(i.opengRank),
    bidAmount: toNum(i.bidprcAmt),
    priceScore: toNum(i.bidPrceEvlVal),
    techScore: toNum(i.techEvlVal),
    totalScore: toNum(i.totalEvlAmtVal),
    techRaw: toNum(i.techEvlNaturVal),
  })).filter((r) => r.bizNo !== '');
}

export type OfficialResult = { ok: true; rows: EvalOfficialRow[]; fetchedAt: string } | { ok: false; error: JobError };

export async function fetchOfficialResult(noticeNo: string, round: string, ctx: G2bContext): Promise<OfficialResult> {
  const key = ctx.serviceKey?.trim();
  if (!key) return { ok: false, error: { code: 'G2B_KEY_MISSING', message: '나라장터 서비스키가 설정되지 않았습니다.', step: 'fetch_basic', retryable: false } };
  const qs = new URLSearchParams({ serviceKey: key, inqryDiv: '4', bidNtceNo: noticeNo, type: 'json', numOfRows: '100', pageNo: '1' });
  const r = await fetchJsonOp(`${BASE}${OPERATION}?${qs.toString()}`, OPERATION, ctx);
  if (!r.ok) return r;
  return { ok: true, rows: mapOfficialRows(r.items, round), fetchedAt: (ctx.now ?? (() => new Date()))().toISOString() };
}
