import { missing, type FieldValue } from '../../core/types/common';
import type { JobError } from '../../core/types/job';
import type { NoticeFieldKey } from '../../core/types/notice';
import { toIsoKst } from '../../core/model/dates';
import { ALL_FIELD_KEYS, type FieldMap } from '../../core/model/notice-fields';
import type { NewAttachment } from '../../engine/jobs/attachments';
import { fetchJsonOp, redactKey, type ApiItem, type FetchNoticeResult, type G2bContext } from './openapi';

// 추정: 실측(S0) 전. 사전규격 OpenAPI의 엔드포인트/operation/파라미터/필드명은 모두 추정값이다.
export const PRESPEC_API_BASE = 'https://apis.data.go.kr/1230000/ao/HrcspSsstndrdInfoService/';
// 추정: 실측(S0) 전
export const PRESPEC_OPERATIONS = ['getPublicPrcureThngInfoServc', 'getPublicPrcureThngInfoThng', 'getPublicPrcureThngInfoCnstwk', 'getPublicPrcureThngInfoFrgcpt'] as const;

type FieldType = 'text' | 'date' | 'num';

/** 추정: 실측(S0) 전. 사전규격 API 필드 매핑은 이 표 한 곳에만 둔다. */
export const PRESPEC_MAP: {
  regNoParam: string;
  latestBy: string;
  fields: Array<{ key: NoticeFieldKey; api: string; type: FieldType; note?: string }>;
  attachUrl: string;
  attachName: string;
  attachMax: number;
} = {
  /** 번호 조회 파라미터명이자 응답의 번호 필드 */
  regNoParam: 'bfSpecRgstNo',
  /** 같은 번호가 여러 건일 때 최신을 고르는 기준 필드 */
  latestBy: 'rcptDt',
  fields: [
    { key: 'specRegNo', api: 'bfSpecRgstNo', type: 'text' },
    { key: 'specName', api: 'prdctClsfcNoNm', type: 'text' }, // 추정: 미확인
    { key: 'bizDivision', api: 'bsnsDivNm', type: 'text' },
    { key: 'assignedBudget', api: 'asignBdgtAmt', type: 'num' },
    { key: 'registeredAt', api: 'rcptDt', type: 'date' },
    { key: 'opinionCloseAt', api: 'opninRgstClseDt', type: 'date' },
    { key: 'officerName', api: 'ofclNm', type: 'text' },
    { key: 'officerTel', api: 'ofclTelNo', type: 'text' },
    { key: 'relatedBidNo', api: 'bidNtceNo', type: 'text' },
    // basic 표시 필드 중복 채움
    { key: 'noticeNo', api: 'bfSpecRgstNo', type: 'text' },
    { key: 'title', api: 'prdctClsfcNoNm', type: 'text' },
    { key: 'orderingOrg', api: 'orderInsttNm', type: 'text' },
    { key: 'demandOrg', api: 'rlDminsttNm', type: 'text' },
    { key: 'postedAt', api: 'rcptDt', type: 'date' },
    { key: 'budgetAmount', api: 'asignBdgtAmt', type: 'num', note: '배정예산' },
  ],
  attachUrl: 'specDocFileUrl', // `${attachUrl}${1..N}`
  attachName: 'specDocFileNm', // `${attachName}${1..N}`
  attachMax: 10,
};

const str = (item: ApiItem, k: string): string => (item[k] ?? '').toString().trim();

const err = (code: string, message: string, retryable = false, key?: string): { ok: false; error: JobError } => ({
  ok: false,
  error: { code, message: redactKey(message, key), step: 'fetch_basic', retryable },
});

export async function fetchPrespec(regNo: string, ctx: G2bContext): Promise<FetchNoticeResult> {
  const key = ctx.serviceKey?.trim();
  if (!key) return err('G2B_KEY_MISSING', '나라장터 서비스키가 설정되지 않았습니다.');
  const now = ctx.now ?? (() => new Date());
  for (const operation of PRESPEC_OPERATIONS) {
    if (ctx.signal?.aborted) return err('JOB_CANCELLED', '작업이 취소되었습니다.');
    const qs = new URLSearchParams({ serviceKey: key, numOfRows: '10', pageNo: '1', type: 'json', inqryDiv: '2', [PRESPEC_MAP.regNoParam]: regNo });
    const r = await fetchJsonOp(`${PRESPEC_API_BASE}${operation}?${qs.toString()}`, operation, ctx);
    if (!r.ok) return r;
    // 서버가 번호 필터를 무시할 수 있으므로 번호가 같은 항목만 남긴다.
    const same = r.items.filter((i) => str(i, PRESPEC_MAP.regNoParam) === regNo);
    if (same.length === 0) continue;
    const pick = [...same].sort((a, b) => str(b, PRESPEC_MAP.latestBy).localeCompare(str(a, PRESPEC_MAP.latestBy)))[0]!;
    return { ok: true, item: pick, operation, fetchedAt: now().toISOString() };
  }
  return err('G2B_NOT_FOUND', `사전규격을 찾지 못했습니다: ${regNo}`);
}

export function mapPrespecItem(item: ApiItem, fetchedAt: string): FieldMap {
  const out: FieldMap = {};
  for (const k of ALL_FIELD_KEYS) out[k] = missing();
  for (const f of PRESPEC_MAP.fields) {
    const raw = str(item, f.api);
    const source = { kind: 'api' as const, ref: f.api, fetchedAt };
    let v: FieldValue<unknown>;
    if (f.type === 'text') {
      v = raw === '' ? missing<string>() : { value: raw, raw, status: 'verified', source };
    } else if (f.type === 'date') {
      const iso = toIsoKst(raw);
      v = iso === null ? { ...missing<string>(), ...(raw ? { raw } : {}) } : { value: iso, raw, status: 'verified', source };
    } else {
      const n = Number(raw.replace(/,/g, ''));
      v = raw === '' || !Number.isFinite(n) ? missing<number>() : { value: n, raw, status: 'verified', source };
    }
    out[f.key] = f.note && v.value !== null ? { ...v, note: f.note } : v;
  }
  return out;
}

export function listPrespecAttachments(item: ApiItem): NewAttachment[] {
  const out: NewAttachment[] = [];
  for (let i = 1; i <= PRESPEC_MAP.attachMax; i++) {
    const url = str(item, `${PRESPEC_MAP.attachUrl}${i}`);
    if (url === '') continue;
    out.push({ originalName: str(item, `${PRESPEC_MAP.attachName}${i}`) || `규격서${i}`, url, expectedSize: null });
  }
  return out;
}
