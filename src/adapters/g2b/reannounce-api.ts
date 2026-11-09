import type { JobError } from '../../core/types/job';
import type { ISODate } from '../../core/types/common';
import type { OpKind } from '../../core/types/org';
import { toIsoKst } from '../../core/model/dates';
import { normalizeTitle } from '../../core/results/reannounce';
import { KST_OFFSET_MS } from '../../core/results/schedule';
import { ORG_OPS, ORG_PARAMS } from './org-api';
import { fetchJsonOp, g2bDetailOf, type ApiItem, type G2bContext } from './openapi';

const BASE = 'https://apis.data.go.kr/1230000/ad/BidPublicInfoService/';

/** 공고번호 조회 응답에서 확인된 필드명. 기간 검색 응답에 없으면 실측 후 교체 */
export const REANNOUNCE_FIELDS = { prevNo: 'befBidBbancNo', reFlag: 'reNtceYn', no: 'bidNtceNo', ord: 'bidNtceOrd', title: 'bidNtceNm', postedAt: 'bidNtceDt' } as const;
/** 한도 초과로 확인된 오류 코드 또는 g2bMsg 조각. 실측 전 빈 배열(비활성) */
export const REANNOUNCE_STOP_CODES: readonly string[] = [];

export interface ReannounceHit { noticeNo: string; round: string; title: string; postedAt: ISODate | null; matchedBy: 'prevNo' | 'title' }


/** YYYYMMDDHHMM (KST) */
export function formatKstCompact(ms: number): string {
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 16).replace(/[-T:]/g, '');
}

const str = (v: unknown): string => String(v ?? '').trim();
const postedOf = (i: ApiItem): ISODate | null => {
  const d = str(i[REANNOUNCE_FIELDS.postedAt]);
  return d === '' ? null : toIsoKst(d) ?? toIsoKst(`${d} 00:00`);
};
const postedMs = (i: ApiItem): number => {
  const p = postedOf(i);
  const n = p ? Date.parse(p) : NaN;
  return Number.isFinite(n) ? n : -Infinity;
};

export function matchReannounce(items: ApiItem[], prevNoticeNo: string, prevTitle: string): ReannounceHit | null {
  const F = REANNOUNCE_FIELDS;
  const others = items.filter((i) => str(i[F.no]) !== prevNoticeNo);
  const newest = (xs: ApiItem[]): ApiItem => xs.reduce((a, b) => (postedMs(b) > postedMs(a) ? b : a));
  const byPrev = others.filter((i) => str(i[F.prevNo]) === prevNoticeNo);
  const want = normalizeTitle(prevTitle);
  const byTitle = others.filter((i) => str(i[F.reFlag]).toUpperCase() === 'Y' && normalizeTitle(str(i[F.title])) === want);
  const pick = byPrev.length > 0 ? { item: newest(byPrev), by: 'prevNo' as const } : byTitle.length > 0 ? { item: newest(byTitle), by: 'title' as const } : null;
  if (!pick) return null;
  const i = pick.item;
  return { noticeNo: str(i[F.no]), round: str(i[F.ord]) || '000', title: str(i[F.title]), postedAt: postedOf(i), matchedBy: pick.by };
}

export function isStopError(err: JobError): boolean {
  if (REANNOUNCE_STOP_CODES.length === 0) return false;
  const msg = g2bDetailOf(err).g2bMsg ?? '';
  return REANNOUNCE_STOP_CODES.some((c) => err.code === c || msg.includes(c) || err.message.includes(c));
}

const nowIso = (ctx: G2bContext): ISODate => (ctx.now ?? (() => new Date()))().toISOString();

export async function searchReannounce(
  p: { prevNoticeNo: string; prevTitle: string; orgCode: string; opKinds: readonly OpKind[]; fromMs: number; toMs: number },
  ctx: G2bContext,
): Promise<{ ok: true; hit: ReannounceHit | null; opKind: OpKind | null; calls: number; fetchedAt: ISODate } | { ok: false; error: JobError; calls: number }> {
  const key = ctx.serviceKey?.trim();
  if (!key) return { ok: false, error: { code: 'G2B_KEY_MISSING', message: '나라장터 서비스키가 설정되지 않았습니다.', step: 'fetch_basic', retryable: false }, calls: 0 };
  let calls = 0;
  for (const kind of p.opKinds) {
    const op = ORG_OPS.noticeSearch.replace('{Kind}', kind);
    const qs = new URLSearchParams({
      serviceKey: key, type: 'json', numOfRows: '100', pageNo: '1',
      inqryDiv: ORG_PARAMS.inqryDiv, [ORG_PARAMS.begin]: formatKstCompact(p.fromMs), [ORG_PARAMS.end]: formatKstCompact(p.toMs), [ORG_PARAMS.org]: p.orgCode,
    });
    calls++;
    const r = await fetchJsonOp(`${BASE}${op}?${qs.toString()}`, op, ctx);
    if (!r.ok) return { ok: false, error: r.error, calls };
    const hit = matchReannounce(r.items, p.prevNoticeNo, p.prevTitle);
    if (hit) return { ok: true, hit, opKind: kind, calls, fetchedAt: nowIso(ctx) };
  }
  return { ok: true, hit: null, opKind: null, calls, fetchedAt: nowIso(ctx) };
}
