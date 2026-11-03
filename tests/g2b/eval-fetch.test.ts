import { describe, expect, it } from 'vitest';
import { EVAL_ENDPOINTS, parseG2bJson, pickEvalRaw } from '../../src/adapters/g2b/eval-api';
import { fetchEvalRaw } from '../../src/adapters/g2b/eval-fetch';

// 모두 합성 데이터. 실제 응답 값은 쓰지 않는다.
const ok = (o: Record<string, unknown>) => ({ ErrorCode: 0, ErrorMsg: '', ...o });
const OPEN = ok({ result: { etcData: { evlNo: 'E-TEST-1', epropoEvalYn: 'Y', isNego: true } } });
const BASE = ok({ dlEvlBaseInfoM: { evlNm: '시험 평가', techEvlAlptRt: '80', evlPgstNm: '확정', evlUseEvstCnt: 1, evlPicNm: 'SECRET-PIC' } });
const TARGETS = ok({ dlEvlTrgtL: [
  { evlTrgtSqno: 1, bzmnRegNo: '1234567890', etpsNm: '가짜업체A', prsntnOdr: 1, evlExclYn: 'N', etpsPicNm: 'SECRET-A', etpsTlphNo: 'SECRET-TEL' },
  { evlTrgtSqno: 2, bzmnRegNo: '2345678901', etpsNm: '가짜업체B', prsntnOdr: 2, evlExclYn: 'N' },
] });
const MEMBERS = ok({ dlElmbL: [
  { elmbHashVal: 'h1', elmbNo: 'M01', evlExclYn: 'N', evlCmptnYn: 'Y', elmbNm: 'SECRET-NAME', elmbNmHashVal: 'SECRET-NH', elmbIdEncrVal: 'SECRET-ENC' },
  { elmbHashVal: 'h2', elmbNo: 'M02', evlExclYn: 'N', evlCmptnYn: 'Y' },
] });
const item = (no: string, sheet: string) => ({ evstNo: sheet, evlPritmNo: no, upEvlPritmNo: null, evlPritmNmDepth1: '항목', alptScr: 10, evlPritmRsltApprMthdNm: '평균', prsrHashVal: 'SECRET-PRSR' });
const itemsOf = (sheets: string[]) => ok({ dlEvlFlfmtCrstL: sheets.map((s, i) => item(`I${i}`, s)) });
const SCORES = ok({ dlDtlsPritmEvlRslL: [{ evlTrgtSqno: 1, elmbHashVal: 'h1', evlPritmNo: 'I0', evlScr: '9.5', rvsoEvlHistScr: null, evlPicNm: 'SECRET-EP' }] });

interface Call { url: string; headers: Record<string, string>; body: Record<string, Record<string, unknown>>; credentials?: string; method?: string }

function fakeFetch(routes: Record<string, (n: number) => { status?: number; body: unknown }>) {
  const calls: Call[] = [];
  const counts: Record<string, number> = {};
  const fn = (async (url: string, init: RequestInit) => {
    const path = url.replace('https://www.g2b.go.kr', '');
    counts[path] = (counts[path] ?? 0) + 1;
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string), credentials: init.credentials, method: init.method });
    const r = routes[path]!(counts[path]!);
    const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, text: async () => text } as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const P = Object.fromEntries(Object.entries(EVAL_ENDPOINTS).map(([k, v]) => [k, v.path])) as Record<keyof typeof EVAL_ENDPOINTS, string>;
const happy = (sheets = ['S1']) => ({
  [P.open]: () => ({ body: OPEN }), [P.base]: () => ({ body: BASE }), [P.targets]: () => ({ body: TARGETS }),
  [P.members]: () => ({ body: MEMBERS }), [P.items]: () => ({ body: itemsOf(sheets) }), [P.scores]: () => ({ body: SCORES }),
});
const REF = { noticeNo: 'R26BK00000001', round: '001' };

describe('fetchEvalRaw', () => {
  it('6단계를 순서대로 호출하고 본문과 옵션을 맞춘다', async () => {
    const f = fakeFetch(happy());
    const r = await fetchEvalRaw(REF, { fetch: f.fn });
    expect(r.ok).toBe(true);
    expect(f.calls.map((c) => c.url.replace('https://www.g2b.go.kr', ''))).toEqual([P.open, P.base, P.targets, P.members, P.items, P.scores]);
    expect(f.calls[0]!.body.dlSrchOnbsRsltBidInM).toMatchObject({ bidPbancNo: 'R26BK00000001', bidPbancOrd: '001', bidClsfNo: '1', prcmBsneSeCd: '03' });
    expect(f.calls[1]!.body).toEqual({ dlSrchEvlInfoM: { evlNo: 'E-TEST-1' } });
    expect(f.calls[2]!.body.dlSrchEvlTrgtM).toMatchObject({ evlNo: 'E-TEST-1', evstNo: '', evlExclYn: 'N' });
    expect(f.calls[5]!.body.dSrchEvstEvlM).toMatchObject({ evlNo: 'E-TEST-1', evstNo: 'S1' });
    for (const c of f.calls) {
      expect(c.method).toBe('POST');
      expect(c.credentials).toBe('same-origin');
      expect(c.headers.Accept).toBe('application/json');
      expect(c.headers['Menu-Info']).toBeTruthy();
      expect(c.headers.submissionid).toBeTruthy();
      expect(c.headers.Referer).toBeUndefined();
    }
    if (r.ok) {
      expect(r.raw.targets).toHaveLength(2);
      expect(r.raw.members).toHaveLength(2);
      expect(r.raw.scores).toEqual([{ evlTrgtSqno: 1, elmbHashVal: 'h1', evlPritmNo: 'I0', evlScr: 9.5, rvsoEvlHistScr: null }]);
      expect(r.raw.base?.techEvlAlptRt).toBe(80);
      expect(r.warnings).toEqual([]);
    }
  });

  it('round가 없으면 1번 본문에 000', async () => {
    const f = fakeFetch(happy());
    await fetchEvalRaw({ noticeNo: REF.noticeNo }, { fetch: f.fn });
    expect(f.calls[0]!.body.dlSrchOnbsRsltBidInM!.bidPbancOrd).toBe('000');
  });

  it('evlNo가 없거나 빈 문자열이면 EVAL_NO_RESULT', async () => {
    for (const evlNo of [undefined, '']) {
      const f = fakeFetch({ ...happy(), [P.open]: () => ({ body: ok({ result: { etcData: { evlNo } } }) }) });
      const r = await fetchEvalRaw(REF, { fetch: f.fn });
      expect(r).toMatchObject({ ok: false, error: { code: 'EVAL_NO_RESULT', step: 1 } });
      expect(f.calls).toHaveLength(1);
    }
  });

  it('1번이 HTTP 422면 bidClsfNo 0으로 한 번 더 부른다', async () => {
    const no422 = { status: 422, body: { ErrorCode: 1, ErrorMsg: '개찰결과 데이터가 존재하지 않습니다.' } };
    const f = fakeFetch({ ...happy(), [P.open]: (n) => (n === 1 ? no422 : { body: OPEN }) });
    const r = await fetchEvalRaw(REF, { fetch: f.fn });
    expect(r.ok).toBe(true);
    expect(f.calls.slice(0, 2).map((c) => c.body.dlSrchOnbsRsltBidInM?.bidClsfNo)).toEqual(['1', '0']);
    const g = fakeFetch({ ...happy(), [P.open]: () => no422 });
    expect(await fetchEvalRaw(REF, { fetch: g.fn })).toMatchObject({ ok: false, error: { code: 'EVAL_API_ERROR', step: 1, httpStatus: 422 } });
    expect(g.calls).toHaveLength(2);
  });

  it('422가 아닌 1번 오류는 다시 부르지 않는다', async () => {
    const f = fakeFetch({ ...happy(), [P.open]: () => ({ status: 500, body: { ErrorCode: 1, ErrorMsg: 'x' } }) });
    await fetchEvalRaw(REF, { fetch: f.fn });
    expect(f.calls).toHaveLength(1);
  });

  it('evlNo가 없고 평가시스템 미사용(evlSysUtztnYn N)이면 EVAL_NO_SYSTEM', async () => {
    const f = fakeFetch({ ...happy(), [P.open]: () => ({ body: ok({ result: { etcData: { evlNo: null }, bidInfo: { evlSysUtztnYn: 'N' } } }) }) });
    expect(await fetchEvalRaw(REF, { fetch: f.fn })).toMatchObject({ ok: false, error: { code: 'EVAL_NO_SYSTEM', step: 1 } });
    expect(f.calls).toHaveLength(1);
  });

  it('HTML 응답이면 EVAL_NOT_LOGGED_IN', async () => {
    const f = fakeFetch({ ...happy(), [P.open]: () => ({ body: '<!DOCTYPE html><html><body>x</body></html>' }) });
    expect(await fetchEvalRaw(REF, { fetch: f.fn })).toMatchObject({ ok: false, error: { code: 'EVAL_NOT_LOGGED_IN', step: 1 } });
  });

  it('HTTP 403이거나 ErrorCode -801이면 EVAL_NOT_LOGGED_IN', async () => {
    const forbidden = { status: 403, body: { ErrorCode: -801, ErrorMsg: '접근 권한이 존재하지 않습니다.' } };
    const f = fakeFetch({ ...happy(), [P.open]: () => forbidden });
    expect(await fetchEvalRaw(REF, { fetch: f.fn })).toMatchObject({ ok: false, error: { code: 'EVAL_NOT_LOGGED_IN', step: 1 } });
    const g = fakeFetch({ ...happy(), [P.targets]: () => ({ body: { ErrorCode: -801, ErrorMsg: 'x' } }) });
    expect(await fetchEvalRaw(REF, { fetch: g.fn })).toMatchObject({ ok: false, error: { code: 'EVAL_NOT_LOGGED_IN', step: 3 } });
    const h = fakeFetch({ ...happy(), [P.open]: () => ({ status: 401, body: 'denied' }) });
    expect(await fetchEvalRaw(REF, { fetch: h.fn })).toMatchObject({ ok: false, error: { code: 'EVAL_NOT_LOGGED_IN', step: 1 } });
  });

  it('JSON이 아니고 로그인 흔적도 없으면 EVAL_API_ERROR', async () => {
    const f = fakeFetch({ ...happy(), [P.open]: () => ({ status: 500, body: 'boom' }) });
    expect(await fetchEvalRaw(REF, { fetch: f.fn })).toMatchObject({ ok: false, error: { code: 'EVAL_API_ERROR', step: 1 } });
  });

  it('ErrorCode가 0이 아니면 EVAL_API_ERROR(ErrorMsg 포함)', async () => {
    const f = fakeFetch({ ...happy(), [P.targets]: () => ({ body: { ErrorCode: 9, ErrorMsg: '오류 메시지' } }) });
    const r = await fetchEvalRaw(REF, { fetch: f.fn });
    expect(r).toMatchObject({ ok: false, error: { code: 'EVAL_API_ERROR', step: 3 } });
    if (!r.ok) expect(r.error.message).toContain('오류 메시지');
  });

  it('2번이 실패하면 base null과 경고로 계속 진행한다', async () => {
    const f = fakeFetch({ ...happy(), [P.base]: () => ({ body: { ErrorCode: 1, ErrorMsg: 'x' } }) });
    const r = await fetchEvalRaw(REF, { fetch: f.fn });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.raw.base).toBeNull(); expect(r.warnings).toHaveLength(1); expect(r.raw.targets).toHaveLength(2); }
  });

  it('evstNo가 2종이면 6번을 2회 호출하고 이어 붙인다', async () => {
    const f = fakeFetch(happy(['S1', 'S2']));
    const r = await fetchEvalRaw(REF, { fetch: f.fn });
    const six = f.calls.filter((c) => c.url.endsWith(P.scores));
    expect(six.map((c) => c.body.dSrchEvstEvlM!.evstNo)).toEqual(['S1', 'S2']);
    if (r.ok) expect(r.raw.scores).toHaveLength(2);
  });

  it('withoutIdHeaders면 Menu-Info와 submissionid가 없다', async () => {
    const f = fakeFetch(happy());
    await fetchEvalRaw(REF, { fetch: f.fn, withoutIdHeaders: true });
    for (const c of f.calls) {
      expect(c.headers['Menu-Info']).toBeUndefined();
      expect(c.headers.submissionid).toBeUndefined();
      expect(c.headers.Accept).toBe('application/json');
    }
  });
});

describe('fetchEvalRaw 시간과 취소', () => {
  const hang = (signalOf: (s: AbortSignal) => void) => ((_u: string, init: RequestInit) => new Promise<Response>((_res, rej) => {
    signalOf(init.signal as AbortSignal);
    (init.signal as AbortSignal).addEventListener('abort', () => rej(new Error('aborted')));
  })) as unknown as typeof fetch;

  it('호출당 타임아웃이면 EVAL_TIMEOUT과 해당 step', async () => {
    const f = fakeFetch(happy());
    const slow = ((u: string, init: RequestInit) => (u.endsWith(P.members) ? hang(() => undefined)(u, init) : f.fn(u, init))) as typeof fetch;
    const r = await fetchEvalRaw(REF, { fetch: slow, timeoutMs: 20 });
    expect(r).toMatchObject({ ok: false, error: { code: 'EVAL_TIMEOUT', step: 4 } });
  });

  it('signal 취소면 EVAL_CANCELLED', async () => {
    const ac = new AbortController();
    const r = await fetchEvalRaw(REF, { fetch: hang(() => { setTimeout(() => ac.abort(), 5); }), signal: ac.signal });
    expect(r).toMatchObject({ ok: false, error: { code: 'EVAL_CANCELLED', step: 1 } });
  });
});

describe('fetchEvalRaw 실패 정보(endpoint·httpStatus·g2bMsg)', () => {
  it('HTTP 422 + ErrorMsg → EVAL_API_ERROR와 httpStatus·endpoint·g2bMsg', async () => {
    const f = fakeFetch({ ...happy(), [P.open]: () => ({ status: 422, body: { ErrorCode: 5, ErrorMsg: '검증 오류' } }) });
    const r = await fetchEvalRaw(REF, { fetch: f.fn });
    expect(r).toEqual({ ok: false, error: expect.objectContaining({ code: 'EVAL_API_ERROR', step: 1, httpStatus: 422, endpoint: EVAL_ENDPOINTS.open.path, g2bMsg: '검증 오류' }) });
  });

  it('HTTP 403 → EVAL_NOT_LOGGED_IN + httpStatus 403 + endpoint', async () => {
    const f = fakeFetch({ ...happy(), [P.open]: () => ({ status: 403, body: 'denied' }) });
    const r = await fetchEvalRaw(REF, { fetch: f.fn });
    expect(r).toMatchObject({ ok: false, error: { code: 'EVAL_NOT_LOGGED_IN', httpStatus: 403, endpoint: EVAL_ENDPOINTS.open.path } });
    if (!r.ok) expect(r.error.g2bMsg).toBeUndefined();
  });

  it('네트워크 throw → endpoint만(httpStatus 없음)', async () => {
    const boom = (async () => { throw new Error('net down'); }) as unknown as typeof fetch;
    const r = await fetchEvalRaw(REF, { fetch: boom });
    expect(r).toMatchObject({ ok: false, error: { code: 'EVAL_API_ERROR', endpoint: EVAL_ENDPOINTS.open.path } });
    if (!r.ok) { expect('httpStatus' in r.error).toBe(false); expect('g2bMsg' in r.error).toBe(false); }
  });

  it('타임아웃 → endpoint만', async () => {
    const hang = ((_u: string, init: RequestInit) => new Promise<Response>((_res, rej) => {
      (init.signal as AbortSignal).addEventListener('abort', () => rej(new Error('aborted')));
    })) as unknown as typeof fetch;
    const r = await fetchEvalRaw(REF, { fetch: hang, timeoutMs: 20 });
    expect(r).toMatchObject({ ok: false, error: { code: 'EVAL_TIMEOUT', endpoint: EVAL_ENDPOINTS.open.path } });
    if (!r.ok) expect('httpStatus' in r.error).toBe(false);
  });
});

describe('pickEvalRaw', () => {
  it('금지 키는 결과에 남지 않는다', () => {
    const raw = pickEvalRaw({ open: OPEN, base: BASE, targets: TARGETS, members: MEMBERS, items: itemsOf(['S1']), scores: [SCORES] }, '2026-01-01T00:00:00.000Z');
    const json = JSON.stringify(raw);
    expect(json).not.toContain('SECRET');
    for (const k of ['elmbNm', 'elmbLabel', 'elmbId', 'elmbNmHashVal', 'EncrVal', 'etpsPic', 'etpsTlphNo', 'evlRprsvNm', 'prsrHashVal', 'evlPic', 'rsdsRegNo']) {
      expect(json).not.toContain(k);
    }
  });
});

describe('parseG2bJson', () => {
  it('JSON 객체는 ok, 그 외는 코드를 돌려준다', () => {
    expect(parseG2bJson('{"a":1}')).toEqual({ ok: true, json: { a: 1 } });
    expect(parseG2bJson('<HTML>')).toEqual({ ok: false, code: 'EVAL_NOT_LOGGED_IN' });
    expect(parseG2bJson('Please Login')).toEqual({ ok: false, code: 'EVAL_NOT_LOGGED_IN' });
    expect(parseG2bJson('nope')).toEqual({ ok: false, code: 'EVAL_API_ERROR' });
  });
});
