import type { OpKind } from '../../core/types/org';
import { fetchJsonOp, redactKey, type ApiItem, type G2bContext } from './openapi';

const ORG_API_ROOT = 'https://apis.data.go.kr/1230000/';
/** 추정값. 실측 전까지 probe 도구에서 이름을 덮어쓸 수 있다. {Kind}는 kind로 치환한다. */
export const ORG_OPS = { noticeSearch: 'getBidPblancListInfo{Kind}PPSSrch', awardSearch: 'getScsbidListSttus{Kind}PPSSrch' } as const;
export const ORG_PARAMS = { inqryDiv: '1', begin: 'inqryBgnDt', end: 'inqryEndDt', org: 'dminsttCd', dateFormat: 'YYYYMMDDHHMM', windowDays: 30 } as const;
export const ORG_FIELDS = { rate: 'sucsfbidRate', estimatedPrice: 'presmptPrce', participants: 'prtcptCnum' } as const;

const SERVICE_OF = { notice: 'ad/BidPublicInfoService/', award: 'as/ScsbidInfoService/' } as const;

export interface OrgProbePart {
  ok: boolean;
  count: number;
  keys: string[];
  sample: Array<Record<string, string>>;
  ms: number;
  error?: string;
}
export interface OrgProbeResult {
  notice: OrgProbePart & { op: string };
  award: OrgProbePart & { op: string };
}

export interface OrgProbeParams { orgCode: string; kind: OpKind; from: string; to: string; noticeOp?: string; awardOp?: string }

const opName = (template: string, kind: OpKind): string => template.replace('{Kind}', kind);

async function probePart(service: string, op: string, p: OrgProbeParams, ctx: G2bContext): Promise<OrgProbePart & { op: string }> {
  const key = ctx.serviceKey?.trim() ?? '';
  const qs = new URLSearchParams({
    serviceKey: key, type: 'json', numOfRows: '100', pageNo: '1',
    inqryDiv: ORG_PARAMS.inqryDiv, [ORG_PARAMS.begin]: p.from, [ORG_PARAMS.end]: p.to, [ORG_PARAMS.org]: p.orgCode,
  });
  const t0 = Date.now();
  let r: Awaited<ReturnType<typeof fetchJsonOp>>;
  try {
    r = await fetchJsonOp(`${ORG_API_ROOT}${service}${op}?${qs.toString()}`, op, ctx);
  } catch (e) {
    return { op, ok: false, count: 0, keys: [], sample: [], ms: Date.now() - t0, error: redactKey(e instanceof Error ? e.message : String(e), key) };
  }
  const ms = Date.now() - t0;
  if (!r.ok) return { op, ok: false, count: 0, keys: [], sample: [], ms, error: redactKey(`${r.error.code}: ${r.error.message}`, key) };
  const items: ApiItem[] = r.items;
  const keys = [...new Set(items.flatMap((i) => Object.keys(i)))].sort();
  return { op, ok: true, count: items.length, keys, sample: items.slice(0, 3), ms };
}

/** 기관 기간 검색 1창만 호출해 응답 형태를 돌려준다(공고 1회 + 낙찰 1회, 저장 없음). */
export async function probeOrg(p: OrgProbeParams, ctx: G2bContext): Promise<OrgProbeResult> {
  const noticeOp = opName(p.noticeOp?.trim() || ORG_OPS.noticeSearch, p.kind);
  const awardOp = opName(p.awardOp?.trim() || ORG_OPS.awardSearch, p.kind);
  const notice = await probePart(SERVICE_OF.notice, noticeOp, p, ctx);
  const award = await probePart(SERVICE_OF.award, awardOp, p, ctx);
  return { notice, award };
}
