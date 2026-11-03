import { EVAL_BODIES, EVAL_ENDPOINTS, EVAL_ENDPOINT_URL, parseG2bJson, pickEvalRaw, type EvalEndpointKey, type EvalRaw } from './eval-api';

export interface EvalFetchCtx {
  fetch: typeof fetch;
  /** 호출당 제한(기본 15초) */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** 진단용: Menu-Info와 submissionid 헤더를 빼고 호출한다. */
  withoutIdHeaders?: boolean;
  now?: () => Date;
}

export type EvalFetchResult =
  | { ok: true; raw: EvalRaw; warnings: string[] }
  | { ok: false; error: { code: string; message: string; step: number; endpoint?: string; httpStatus?: number; g2bMsg?: string } };

const CALL_MS = 15_000;
const TOTAL_MS = 60_000;

interface StepExtra { endpoint: string; httpStatus?: number; g2bMsg?: string }

class StepError extends Error {
  constructor(public code: string, message: string, public step: number, public extra: StepExtra = { endpoint: '' }) { super(message); }
}

const STEP: Record<EvalEndpointKey, number> = { open: 1, base: 2, targets: 3, members: 4, items: 5, scores: 6 };

/** 나라장터 탭 안에서 같은 출처 fetch로 평가 데이터를 읽어 허용 목록(EvalRaw)으로 추린다. */
export async function fetchEvalRaw(ref: { noticeNo: string; round?: string }, ctx: EvalFetchCtx): Promise<EvalFetchResult> {
  const startedAt = Date.now();
  const callMs = ctx.timeoutMs ?? CALL_MS;

  const call = async (key: EvalEndpointKey, body: unknown): Promise<Record<string, unknown>> => {
    const step = STEP[key];
    const endpoint = EVAL_ENDPOINTS[key].path;
    const left = TOTAL_MS - (Date.now() - startedAt);
    if (left <= 0) throw new StepError('EVAL_TIMEOUT', '전체 시간 제한(60초)을 넘었습니다.', step, { endpoint });
    if (ctx.signal?.aborted) throw new StepError('EVAL_CANCELLED', '취소되었습니다.', step, { endpoint });
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    ctx.signal?.addEventListener('abort', onAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ac.abort(); }, Math.min(callMs, left));
    const ep = EVAL_ENDPOINTS[key];
    const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json;charset=UTF-8' };
    if (!ctx.withoutIdHeaders) { headers['Menu-Info'] = ep.menuInfo; headers.submissionid = ep.submissionid; }
    try {
      const res = await ctx.fetch(EVAL_ENDPOINT_URL(key), { method: 'POST', credentials: 'same-origin', headers, body: JSON.stringify(body), signal: ac.signal });
      const text = await res.text();
      // 쿠키 없는 호출은 HTTP 403 + ErrorCode -801로 응답한다(실측). 상태와 무관하게 -801이면 로그인(권한) 필요로 본다.
      const loginErr = (g2bMsg?: string) => new StepError('EVAL_NOT_LOGGED_IN', '나라장터 로그인(권한)이 필요합니다.', step, { endpoint, httpStatus: res.status, ...(g2bMsg ? { g2bMsg } : {}) });
      if (res.status === 401 || res.status === 403) throw loginErr();
      const parsed = parseG2bJson(text);
      const msg = parsed.ok && typeof parsed.json.ErrorMsg === 'string' ? parsed.json.ErrorMsg.trim() : '';
      const extra: StepExtra = { endpoint, httpStatus: res.status, g2bMsg: msg || undefined };
      if (parsed.ok && Number(parsed.json.ErrorCode) === -801) throw loginErr(msg);
      if (!parsed.ok) throw new StepError(parsed.code, parsed.code === 'EVAL_NOT_LOGGED_IN' ? '나라장터에 로그인되어 있지 않습니다.' : `응답을 해석하지 못했습니다(HTTP ${res.status}).`, step, extra);
      if (!res.ok) throw new StepError('EVAL_API_ERROR', `HTTP ${res.status}${msg ? `: ${msg}` : ''}`, step, extra);
      const code = Number(parsed.json.ErrorCode);
      if (code !== 0) {
        throw new StepError('EVAL_API_ERROR', `ErrorCode ${Number.isFinite(code) ? code : '?'}${msg ? `: ${msg}` : ''}`, step, extra);
      }
      return parsed.json;
    } catch (e) {
      if (e instanceof StepError) throw e;
      if (ctx.signal?.aborted) throw new StepError('EVAL_CANCELLED', '취소되었습니다.', step, { endpoint });
      if (timedOut) throw new StepError('EVAL_TIMEOUT', '응답 시간 초과', step, { endpoint });
      throw new StepError('EVAL_API_ERROR', e instanceof Error ? e.message : String(e), step, { endpoint });
    } finally {
      clearTimeout(timer);
      ctx.signal?.removeEventListener('abort', onAbort);
    }
  };

  const warnings: string[] = [];
  try {
    const round = ref.round ?? '000';
    let open: Record<string, unknown>;
    try {
      open = await call('open', EVAL_BODIES.open(ref.noticeNo, round, '1'));
    } catch (e) {
      // 분류번호가 맞지 않으면 "개찰결과 데이터가 존재하지 않습니다"(HTTP 422)로 답한다.
      if (!(e instanceof StepError && e.extra.httpStatus === 422)) throw e;
      open = await call('open', EVAL_BODIES.open(ref.noticeNo, round, '0'));
    }
    const preview = pickEvalRaw({ open, base: null, targets: {}, members: {}, items: {}, scores: [] }, '');
    const evlNo = preview.open.evlNo;
    if (!evlNo) {
      const bidInfo = (open.result as { bidInfo?: { evlSysUtztnYn?: unknown } } | null | undefined)?.bidInfo;
      if (bidInfo?.evlSysUtztnYn === 'N') return { ok: false, error: { code: 'EVAL_NO_SYSTEM', message: '나라장터 평가시스템을 쓰지 않은 공고입니다.', step: 1 } };
      return { ok: false, error: { code: 'EVAL_NO_RESULT', message: '평가 결과가 없는 공고입니다.', step: 1 } };
    }

    let base: unknown | null = null;
    try { base = await call('base', EVAL_BODIES.base(evlNo)); }
    catch (e) {
      if (e instanceof StepError && (e.code === 'EVAL_NOT_LOGGED_IN' || e.code === 'EVAL_CANCELLED')) throw e;
      warnings.push(`평가 기본정보를 가져오지 못했습니다(${e instanceof Error ? e.message : String(e)}).`);
    }
    const targets = await call('targets', EVAL_BODIES.targets(evlNo));
    const members = await call('members', EVAL_BODIES.members(evlNo));
    const items = await call('items', EVAL_BODIES.items(evlNo));

    const evstNos = [...new Set(pickEvalRaw({ open, base: null, targets: {}, members: {}, items, scores: [] }, '').items.map((i) => i.evstNo))];
    const scores: unknown[] = [];
    for (const evstNo of evstNos) scores.push(await call('scores', EVAL_BODIES.scores(evlNo, evstNo)));

    const raw = pickEvalRaw({ open, base, targets, members, items, scores }, (ctx.now?.() ?? new Date()).toISOString());
    return { ok: true, raw, warnings };
  } catch (e) {
    if (e instanceof StepError) {
      const { endpoint, httpStatus, g2bMsg } = e.extra;
      return { ok: false, error: { code: e.code, message: e.message, step: e.step, ...(endpoint ? { endpoint } : {}), ...(httpStatus !== undefined ? { httpStatus } : {}), ...(g2bMsg ? { g2bMsg } : {}) } };
    }
    return { ok: false, error: { code: 'EVAL_API_ERROR', message: e instanceof Error ? e.message : String(e), step: 1 } };
  }
}
