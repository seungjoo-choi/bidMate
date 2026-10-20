import { missing, type FieldValue } from '../../core/types/common';
import type { JobError } from '../../core/types/job';
import type { Attachment, NoticeFieldKey, NoticeRef } from '../../core/types/notice';
import { parseG2bLink } from './link';
import { toIsoKst } from '../../core/model/dates';
import { parseJointVenture } from '../../core/model/joint-venture';
import { ALL_FIELD_KEYS, type FieldMap } from '../../core/model/notice-fields';

export const API_BASE = 'https://apis.data.go.kr/1230000/ad/BidPublicInfoService/';
export const OPERATIONS = ['getBidPblancListInfoServc', 'getBidPblancListInfoThng', 'getBidPblancListInfoCnstwk', 'getBidPblancListInfoFrgcpt'] as const;

export type ApiItem = Record<string, string>;

export interface G2bContext {
  serviceKey?: string;
  fetch: typeof fetch;
  timeoutMs?: number;
  /** 잡 취소 신호. abort되면 JOB_CANCELLED를 반환한다. */
  signal?: AbortSignal;
  now?: () => Date;
}

export type FetchNoticeResult =
  | { ok: true; item: ApiItem; operation: string; fetchedAt: string }
  | { ok: false; error: JobError };

/** 오류 메시지/로그에 키가 남지 않도록 serviceKey 파라미터와 키 원문을 가린다. */
export function redactKey(text: string, key?: string): string {
  let out = text.replace(/(service[_]?key=)[^&\s"'#]*/gi, '$1***');
  if (key) {
    for (const k of new Set([key, encodeURIComponent(key)])) out = out.split(k).join('***');
  }
  return out;
}

const err = (code: string, message: string, retryable = false, key?: string): { ok: false; error: JobError } => ({
  ok: false,
  error: { code, message: redactKey(message, key), step: 'fetch_basic', retryable },
});

type Parsed =
  | { kind: 'items'; items: ApiItem[] }
  | { kind: 'error'; code: string; message: string };

function normalizeItems(raw: unknown): ApiItem[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as ApiItem[];
  if (typeof raw === 'object') {
    const inner = (raw as { item?: unknown }).item;
    if (inner !== undefined) return normalizeItems(inner);
    return [raw as ApiItem];
  }
  return [];
}

export function parseResponse(text: string): Parsed {
  let json: Record<string, any>;
  try {
    json = JSON.parse(text);
  } catch {
    if (/SERVICE_KEY_IS_NOT_REGISTERED_ERROR|SERVICE_KEY_IS_NULL/.test(text)) return { kind: 'error', code: 'G2B_KEY_INVALID', message: '서비스키가 등록되지 않았거나 비어 있습니다.' };
    return { kind: 'error', code: 'G2B_API_ERROR', message: `API 응답을 해석할 수 없습니다: ${text.slice(0, 120)}` };
  }
  const svc = json.OpenAPI_ServiceResponse?.cmmMsgHeader;
  if (svc) {
    const msg = String(svc.errMsg ?? '');
    if (/SERVICE_KEY_IS_NOT_REGISTERED_ERROR|SERVICE_KEY_IS_NULL/.test(msg)) {
      return { kind: 'error', code: 'G2B_KEY_INVALID', message: `서비스키 오류: ${msg}` };
    }
    return { kind: 'error', code: 'G2B_API_ERROR', message: `API 오류: ${msg} ${svc.returnAuthMsg ?? ''}`.trim() };
  }
  const errBody = json['nkoneps.com.response.ResponseError'];
  const response = json.response ?? errBody;
  const header = response?.header;
  if (!header) return { kind: 'error', code: 'G2B_API_ERROR', message: 'API 응답 형식이 올바르지 않습니다.' };
  if (String(header.resultCode) !== '00') {
    return { kind: 'error', code: 'G2B_API_ERROR', message: `API 오류 ${header.resultCode}: ${header.resultMsg ?? ''}`.trim() };
  }
  return { kind: 'items', items: normalizeItems(response.body?.items) };
}

const pad3 = (s: string): string => s.padStart(3, '0');

/** operation 1회 호출: fetch + 타임아웃 + 외부 취소 합성 + 응답 해석. 호출자는 items만 다룬다. */
export async function fetchJsonOp(url: string, operation: string, ctx: G2bContext): Promise<{ ok: true; items: ApiItem[] } | { ok: false; error: JobError }> {
  const key = ctx.serviceKey?.trim();
  const cancelled = () => err('JOB_CANCELLED', '작업이 취소되었습니다.', false);
  // operation별 타이머 abort와 외부 취소 신호를 하나의 컨트롤러로 합친다.
  const ac = new AbortController();
  const onExternal = () => ac.abort();
  ctx.signal?.addEventListener('abort', onExternal);
  const timer = setTimeout(() => ac.abort(), ctx.timeoutMs ?? 15_000);
  const aborted = new Promise<never>((_, rej) => ac.signal.addEventListener('abort', () => rej(new Error('요청이 중단되었습니다.'))));
  aborted.catch(() => undefined);
  let text: string;
  let status: number;
  try {
    ({ text, status } = await Promise.race([
      (async () => {
        const res = await ctx.fetch(url, { signal: ac.signal, credentials: 'omit' });
        return { text: await res.text(), status: res.status };
      })(),
      aborted,
    ]));
  } catch (e) {
    if (ctx.signal?.aborted) return cancelled();
    return err('G2B_NETWORK', `네트워크 오류 또는 시간 초과 (${operation}): ${e instanceof Error ? e.message : String(e)}`, true, key);
  } finally {
    clearTimeout(timer);
    ctx.signal?.removeEventListener('abort', onExternal);
  }
  if (status < 200 || status >= 300) {
    if (!text.trim().startsWith('{')) {
      if (/SERVICE_KEY_IS_NOT_REGISTERED_ERROR|SERVICE_KEY_IS_NULL/.test(text)) return err('G2B_KEY_INVALID', '서비스키가 등록되지 않았거나 비어 있습니다.', false, key);
      return err('G2B_API_ERROR', `HTTP ${status} (${operation})`, status >= 500, key);
    }
  }
  const parsed = parseResponse(text);
  if (parsed.kind === 'error') return err(parsed.code, parsed.message, false, key);
  return { ok: true, items: parsed.items };
}

export async function fetchNotice(noticeNo: string, round: string | undefined, ctx: G2bContext): Promise<FetchNoticeResult> {
  const key = ctx.serviceKey?.trim();
  if (!key) return err('G2B_KEY_MISSING', '나라장터 서비스키가 설정되지 않았습니다.');
  const now = ctx.now ?? (() => new Date());
  for (const operation of OPERATIONS) {
    if (ctx.signal?.aborted) return err('JOB_CANCELLED', '작업이 취소되었습니다.', false);
    const qs = new URLSearchParams({ serviceKey: key, numOfRows: '10', pageNo: '1', type: 'json', inqryDiv: '2', bidNtceNo: noticeNo });
    const url = `${API_BASE}${operation}?${qs.toString()}`;
    const r = await fetchJsonOp(url, operation, ctx);
    if (!r.ok) return r;
    const parsed = r;
    if (parsed.items.length === 0) continue;
    let pick: ApiItem | undefined;
    if (round !== undefined) {
      pick = parsed.items.find((i) => pad3(String(i.bidNtceOrd ?? '')) === pad3(round));
    } else {
      pick = [...parsed.items].sort((a, b) => Number(b.bidNtceOrd ?? 0) - Number(a.bidNtceOrd ?? 0))[0];
    }
    if (!pick) continue;
    return { ok: true, item: pick, operation, fetchedAt: now().toISOString() };
  }
  return err('G2B_NOT_FOUND', `공고를 찾지 못했습니다: ${noticeNo}${round !== undefined ? `-${round}` : ''}`);
}

// ---------- 매핑 ----------
const str = (item: ApiItem, k: string): string => (item[k] ?? '').toString().trim();

export { toIsoKst };

function toNumber(s: string): number | null {
  const n = Number(s.replace(/,/g, ''));
  return s !== '' && Number.isFinite(n) ? n : null;
}

export function mapApiItem(item: ApiItem, fetchedAt: string): FieldMap {
  const src = (ref: string, kind: 'api' | 'derived' = 'api') => ({ kind, ref, fetchedAt });
  const text = (apiKey: string): FieldValue<string> => {
    const raw = str(item, apiKey);
    return raw === '' ? missing() : { value: raw, raw, status: 'verified', source: src(apiKey) };
  };
  const date = (apiKey: string): FieldValue<string> => {
    const raw = str(item, apiKey);
    const iso = toIsoKst(raw);
    return iso === null ? { ...missing<string>(), ...(raw ? { raw } : {}) } : { value: iso, raw, status: 'verified', source: src(apiKey) };
  };
  const num = (apiKey: string): FieldValue<number> => {
    const raw = str(item, apiKey);
    const n = toNumber(raw);
    return n === null ? missing() : { value: n, raw, status: 'verified', source: src(apiKey) };
  };

  const out: FieldMap = {};
  for (const k of ALL_FIELD_KEYS) out[k] = missing();
  const set = (k: NoticeFieldKey, v: FieldValue<unknown>) => { out[k] = v; };

  set('noticeNo', text('bidNtceNo'));
  set('round', text('bidNtceOrd'));
  set('title', text('bidNtceNm'));
  set('postedAt', date('bidNtceDt'));
  set('noticeType', text('ntceKindNm'));
  set('orderingOrg', text('ntceInsttNm'));
  set('demandOrg', text('dminsttNm'));
  set('estimatedPrice', num('presmptPrce'));
  set('contractMethod', text('cntrctCnclsMthdNm'));
  set('awardMethod', text('sucsfbidMthdNm'));
  set('priceMethod', text('prearngPrceDcsnMthdNm'));
  set('registrationDeadline', date('bidQlfctRgstDt'));
  set('bidStartAt', date('bidBeginDt'));
  set('bidCloseAt', date('bidClseDt'));
  set('openingAt', date('opengDt'));
  set('specRegNo', text('bfSpecRgstNo'));   // 연계 사전규격 등록번호(사전규격 응답 매핑은 bid에 적용하지 않는다)

  // 예산: 추정가격 + VAT, 없으면 배정예산
  const price = toNumber(str(item, 'presmptPrce'));
  const vat = toNumber(str(item, 'VAT'));
  if (price !== null && vat !== null) {
    set('budgetAmount', { value: price + vat, raw: `${str(item, 'presmptPrce')}+${str(item, 'VAT')}`, status: 'verified', source: src('presmptPrce+VAT', 'derived') });
  } else {
    const b = num('asignBdgtAmt');
    set('budgetAmount', b.value === null ? b : { ...b, note: '배정예산' });
  }

  // 공동수급
  const jv = str(item, 'cmmnSpldmdMethdNm');
  if (jv !== '') {
    const b = parseJointVenture(jv);
    set('jointVentureAllowed', b === null
      ? { value: null, raw: jv, status: 'needs_review', source: src('cmmnSpldmdMethdNm'), note: '공동수급 여부를 판단하지 못함' }
      : { value: b, raw: jv, status: 'verified', source: src('cmmnSpldmdMethdNm') });
  }

  // 평가방법
  const method = str(item, 'sucsfbidMthdNm');
  const tech = str(item, 'techAbltEvlRt');
  const prc = str(item, 'bidPrceEvlRt');
  if (method !== '') {
    if (tech !== '' && prc !== '') {
      const v = `${method} (기술 ${tech} : 가격 ${prc})`;
      set('evalMethod', { value: v, raw: v, status: 'verified', source: src('sucsfbidMthdNm+techAbltEvlRt/bidPrceEvlRt', 'derived') });
    } else {
      set('evalMethod', text('sucsfbidMthdNm'));
    }
  }
  return out;
}

export function sourceUrlOf(item: ApiItem, fetchedAt: string): FieldValue<string> {
  const raw = str(item, 'bidNtceDtlUrl');
  return raw === '' ? missing() : { value: raw, raw, status: 'verified', source: { kind: 'api', ref: 'bidNtceDtlUrl', fetchedAt } };
}

export function isCorrectionOf(item: ApiItem): boolean {
  const ord = str(item, 'bidNtceOrd');
  return (ord !== '' && ord !== '000') || str(item, 'ntceKindNm').includes('정정');
}

export function listAttachments(item: ApiItem): Array<Pick<Attachment, 'originalName' | 'url' | 'expectedSize' | 'mimeHint'>> {
  const out: Array<Pick<Attachment, 'originalName' | 'url' | 'expectedSize'>> = [];
  for (let i = 1; i <= 10; i++) {
    const name = str(item, `ntceSpecFileNm${i}`);
    const url = str(item, `ntceSpecDocUrl${i}`);
    if (name !== '' && url !== '') out.push({ originalName: name, url, expectedSize: null });
  }
  return out;
}

// 화면 표기는 'R26BK01722175 - 000'처럼 하이픈 앞뒤에 공백이 있다(실측).
const NO_RE = /^\s*(R\d{2}[A-Z]{2}\d{8})(?:\s*-\s*(\d{3}))?\s*$/;

export function resolveRef(text: string): NoticeRef | null {
  const t = text.trim();
  const l = parseG2bLink(t);
  if (l?.kind === 'bid') return { noticeNo: l.id, ...(l.round ? { round: l.round } : {}), detailUrl: t, origin: 'g2b' };
  const m = NO_RE.exec(t);
  if (m) return { noticeNo: m[1]!, ...(m[2] ? { round: m[2] } : {}), origin: 'g2b' };
  return null;
}
