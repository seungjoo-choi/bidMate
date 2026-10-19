import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchContactsInPage } from '../../src/adapters/naverworks/contacts-fetch';

const user = (id: number) => ({ id, name: `n${id}`, email: `u${id}@x.com`, orgUnitName: 'd', orgUnits: ['d'], positionName: 'p', extra: 'drop' });
const json = (body: unknown, init: { status?: number; redirected?: boolean; ct?: string } = {}) => {
  const status = init.status ?? 200;
  return {
    status, ok: status >= 200 && status < 300, redirected: init.redirected ?? false,
    headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? (init.ct ?? 'application/json;charset=UTF-8') : null) },
    json: async () => body,
  };
};
const users = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => user(from + i));

describe('fetchContactsInPage', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let cookie = '';
  beforeEach(() => {
    cookie = 'XSRF-TOKEN=t0';
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('document', { get cookie() { return cookie; } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('2페이지(150=100+50)를 합친다', async () => {
    fetchMock.mockResolvedValueOnce(json({ totalCount: 150, results: users(1, 100) }))
      .mockResolvedValueOnce(json({ totalCount: 150, results: users(101, 150) }));
    const r = await fetchContactsInPage('133918', 100, 50);
    expect(r).toMatchObject({ ok: true, totalCount: 150, pages: 2 });
    expect(r.ok && r.results).toHaveLength(150);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('매 요청마다 최신 XSRF 토큰을 읽는다', async () => {
    fetchMock.mockImplementationOnce(async () => { cookie = 'a=b; XSRF-TOKEN=t1'; return json({ totalCount: 2, results: [user(1)] }); })
      .mockResolvedValueOnce(json({ totalCount: 2, results: [user(2)] }));
    await fetchContactsInPage('1', 1, 50);
    expect(fetchMock.mock.calls[0]![1].headers['X-Xsrf-Token']).toBe('t0');
    expect(fetchMock.mock.calls[1]![1].headers['X-Xsrf-Token']).toBe('t1');
  });
  it('401은 NW_NOT_LOGGED_IN(status 포함)', async () => {
    fetchMock.mockResolvedValueOnce(json({}, { status: 401 }));
    expect(await fetchContactsInPage('1', 100, 50)).toMatchObject({ ok: false, code: 'NW_NOT_LOGGED_IN', status: 401 });
  });
  it('redirected는 NW_NOT_LOGGED_IN', async () => {
    fetchMock.mockResolvedValueOnce(json({}, { redirected: true }));
    expect(await fetchContactsInPage('1', 100, 50)).toMatchObject({ ok: false, code: 'NW_NOT_LOGGED_IN' });
  });
  it('HTML 응답은 NW_NOT_LOGGED_IN', async () => {
    fetchMock.mockResolvedValueOnce(json({}, { ct: 'text/html' }));
    expect(await fetchContactsInPage('1', 100, 50)).toMatchObject({ ok: false, code: 'NW_NOT_LOGGED_IN' });
  });
  it('500은 NW_API_ERROR', async () => {
    fetchMock.mockResolvedValueOnce(json({}, { status: 500 }));
    expect(await fetchContactsInPage('1', 100, 50)).toMatchObject({ ok: false, code: 'NW_API_ERROR', status: 500 });
  });
  it('fetch 예외는 NW_API_ERROR(detail=메시지)', async () => {
    fetchMock.mockRejectedValueOnce(new Error('boom'));
    expect(await fetchContactsInPage('1', 100, 50)).toMatchObject({ ok: false, code: 'NW_API_ERROR', detail: 'boom' });
  });
  it('results가 없으면 NW_BAD_RESPONSE', async () => {
    fetchMock.mockResolvedValueOnce(json({ totalCount: 1 }));
    expect(await fetchContactsInPage('1', 100, 50)).toMatchObject({ ok: false, code: 'NW_BAD_RESPONSE' });
  });
  it('빈 페이지에서 종료한다', async () => {
    fetchMock.mockResolvedValueOnce(json({ totalCount: 999, results: users(1, 2) }))
      .mockResolvedValueOnce(json({ totalCount: 999, results: [] }));
    const r = await fetchContactsInPage('1', 2, 50);
    expect(r).toMatchObject({ ok: true, pages: 2 });
    expect(r.ok && r.results).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('maxPages 상한에서 멈춘다', async () => {
    fetchMock.mockImplementation(async () => json({ totalCount: 9999, results: [user(Math.random())] }));
    const r = await fetchContactsInPage('1', 1, 3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(r).toMatchObject({ ok: true, pages: 3 });
  });
  it('id 중복을 제거한다', async () => {
    fetchMock.mockResolvedValueOnce(json({ totalCount: 2, results: [user(1), user(1), user(2)] }));
    const r = await fetchContactsInPage('1', 100, 50);
    expect(r.ok && r.results.map((u) => u.id)).toEqual([1, 2]);
  });
  it('totalCount가 숫자가 아니면 빈 페이지까지 받고 받은 개수를 반환한다', async () => {
    fetchMock.mockResolvedValueOnce(json({ results: users(1, 2) }))
      .mockResolvedValueOnce(json({ results: users(3, 3) }))
      .mockResolvedValueOnce(json({ results: [] }));
    const r = await fetchContactsInPage('1', 2, 50);
    expect(r).toMatchObject({ ok: true, totalCount: 3, pages: 3 });
    expect(r.ok && r.results).toHaveLength(3);
  });
  it('id가 없는 사용자는 중복 제거하지 않고 모두 유지한다', async () => {
    fetchMock.mockResolvedValueOnce(json({ totalCount: 3, results: [{ email: 'a@x.com' }, { email: 'b@x.com' }, { id: null, email: 'c@x.com' }] }));
    const r = await fetchContactsInPage('1', 100, 50);
    expect(r.ok && r.results).toHaveLength(3);
  });
  it('요청 본문·옵션과 반환 필드', async () => {
    fetchMock.mockResolvedValueOnce(json({ totalCount: 1, results: [user(1)] }));
    const r = await fetchContactsInPage('133918', 100, 50);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/v2/api/search');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('same-origin');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ type: 'USER', page: 1, maxResults: 100, filter: {}, domainId: '133918', includedSubOrgUnit: false });
    expect(r.ok && r.results[0]).toEqual({ id: 1, name: 'n1', email: 'u1@x.com', orgUnitName: 'd', orgUnits: ['d'], positionName: 'p' });
  });
});
