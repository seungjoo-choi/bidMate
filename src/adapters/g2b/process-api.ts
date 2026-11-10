import type { JobError } from '../../core/types/job';
import type { ISODate } from '../../core/types/common';
import type { ContractProcess, ProcessContract, ProcessRound, ProcessWinner } from '../../core/types/process';
import { normalizeBizNo } from '../../core/evaluation/company';
import { toIsoKst } from '../../core/model/dates';
import { fetchJsonOp, redactKey, type ApiItem, type G2bContext } from './openapi';

export const PROCESS_API_BASE = 'https://apis.data.go.kr/1230000/ao/CntrctProcssIntgOpenService/';
export const PROCESS_OPS = ['getCntrctProcssIntgOpenServc', 'getCntrctProcssIntgOpenThng', 'getCntrctProcssIntgOpenCnstwk', 'getCntrctProcssIntgOpenFrgcpt'] as const;   // 4개 모두 실측(2026-11-09): 없는 이름은 HTTP 400 NO_OPENAPI_SERVICE_ERROR

export type ProcessFetchResult = { ok: true; items: ApiItem[]; op: string | null; fetchedAt: ISODate } | { ok: false; error: JobError };

const pad3 = (s: string): string => s.padStart(3, '0');
const str = (item: ApiItem, k: string): string => (item[k] ?? '').toString().trim();
const nz = (s: string | undefined): string | null => {
  const t = (s ?? '').trim();
  return t === '' ? null : t;
};
const toNum = (s: string | undefined): number | null => {
  const t = (s ?? '').replace(/,/g, '').trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const toDate = (s: string | undefined): ISODate | null => {
  const t = (s ?? '').trim();
  return t === '' ? null : toIsoKst(t);
};
const toDateOnly = (s: string | undefined): ISODate | null => {
  const t = (s ?? '').trim();
  return t === '' ? null : toIsoKst(t) ?? toIsoKst(`${t} 00:00`);
};

const err = (code: string, message: string, retryable = false, key?: string): { ok: false; error: JobError } => ({
  ok: false,
  error: { code, message: redactKey(message, key), step: 'fetch_basic', retryable },
});

export async function fetchProcess(noticeNo: string, ops: readonly string[], ctx: G2bContext): Promise<ProcessFetchResult> {
  const key = ctx.serviceKey?.trim();
  if (!key) return err('G2B_KEY_MISSING', '나라장터 서비스키가 설정되지 않았습니다.');
  const now = ctx.now ?? (() => new Date());
  for (const op of ops) {
    if (ctx.signal?.aborted) return err('JOB_CANCELLED', '작업이 취소되었습니다.');
    const qs = new URLSearchParams({ serviceKey: key, inqryDiv: '1', bidNtceNo: noticeNo, type: 'json', numOfRows: '50', pageNo: '1' });
    const r = await fetchJsonOp(`${PROCESS_API_BASE}${op}?${qs.toString()}`, op, ctx);
    if (!r.ok) return r;
    // 서버가 번호 필터를 무시할 수 있으므로 번호가 같은 항목만 남긴다.
    const same = r.items.filter((i) => str(i, 'bidNtceNo') === noticeNo);
    if (same.length === 0) continue;
    return { ok: true, items: same, op, fetchedAt: now().toISOString() };
  }
  return { ok: true, items: [], op: null, fetchedAt: now().toISOString() };
}

/** `[a^b],[c^d]` 형태를 항목×칸 배열로 분리한다. */
export function parseCaretList(raw: string): string[][] {
  const t = (raw ?? '').trim();
  if (t === '') return [];
  const inner = t.replace(/^\[/, '').replace(/\]$/, '');
  return inner.split('],[').map((e) => e.split('^').map((c) => c.trim()));
}

const seqOf = (cell: string | undefined, idx: number): number => {
  const t = (cell ?? '').trim();
  return /^\d+$/.test(t) ? Number(t) : idx + 1;
};

function mapWinners(raw: string): ProcessWinner[] {
  // 칸: 순번^업체명^사업자번호^대표자명^낙찰금액^낙찰률^참가업체수^개찰일시 (대표자명 index 3은 버린다)
  return parseCaretList(raw).map((c, i): ProcessWinner => ({
    seq: seqOf(c[0], i),
    name: c[1] ?? '',
    bizNo: normalizeBizNo(c[2] ?? ''),
    amount: toNum(c[4]),
    rate: toNum(c[5]),
    bidders: toNum(c[6]),
    openedAt: toDate(c[7]),
  }));
}

function mapContracts(raw: string): ProcessContract[] {
  // 칸: 순번^계약번호^계약명^계약기관^수요기관^계약방법^계약금액^계약일자
  return parseCaretList(raw)
    .map((c, i): ProcessContract => ({
      seq: seqOf(c[0], i),
      contractNo: c[1] ?? '',
      name: c[2] ?? '',
      contractOrg: nz(c[3]),
      demandOrg: nz(c[4]),
      method: nz(c[5]),
      amount: toNum(c[6]),
      contractedAt: toDateOnly(c[7]),
    }))
    .filter((c) => c.contractNo !== '');
}

export function mapProcess(items: ApiItem[]): ContractProcess | null {
  if (items.length === 0) return null;
  const first = items[0]!;
  const byRound = new Map<string, ApiItem>();
  for (const it of items) {
    const r = pad3(str(it, 'bidNtceOrd'));
    if (!byRound.has(r)) byRound.set(r, it);
  }
  const rounds: ProcessRound[] = [...byRound.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([round, it]) => ({
      noticeNo: str(it, 'bidNtceNo'),
      round,
      title: nz(it.bidNtceNm),
      postedAt: toDate(it.bidNtceDt),
      demandOrg: nz(it.bidDminsttNm),
      bidMethod: nz(it.bidMthdNm),
      winners: mapWinners(str(it, 'bidwinrInfoList')),
      contracts: mapContracts(str(it, 'cntrctInfoList')),
    }));
  const orderNo = str(first, 'orderPlanNo');
  const specNo = str(first, 'bfSpecRgstNo');
  return {
    orderPlan: orderNo === '' ? null : { no: orderNo, untyNo: nz(first.orderPlanUntyNo), name: nz(first.orderBizNm), org: nz(first.orderInsttNm), ym: nz(first.orderYm) },
    prespec: specNo === '' ? null : { regNo: specNo, name: nz(first.bfSpecBizNm), demandOrg: nz(first.bfSpecDminsttNm), noticeOrg: nz(first.bfSpecNtceInsttNm), opinionCloseAt: toDate(first.opninRgstClseDt) },
    procurementMethod: nz(first.prcrmntMethdNm),
    contractMethod: nz(first.cntrctCnclsMthdNm),
    rounds,
  };
}
