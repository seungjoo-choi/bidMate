// 주의: 이 함수는 chrome.scripting.executeScript({ func })로 직렬화되어 페이지에서 실행되는 자기완결 함수다.
// 함수 바깥(모듈 스코프) 값·헬퍼·import 참조 금지(타입 import만 허용). 인자는 JSON 가능 값만.
import type { NwPageFetchResult, NwRawUser } from './contacts-types';

export async function fetchContactsInPage(domainId: string, pageSize: number, maxPages: number): Promise<NwPageFetchResult> {
  const collected: NwRawUser[] = [];
  const seen = new Set<unknown>();
  let totalCount = 0;
  let hasTotal = false;
  let pages = 0;
  for (let page = 1; page <= maxPages; page++) {
    // 응답마다 Set-Cookie로 토큰이 갱신되므로 매 요청 직전에 다시 읽는다.
    const m = /(?:^|;\s*)XSRF-TOKEN=([^;]*)/.exec(document.cookie);
    const xsrf: Record<string, string> = {};
    if (m && m[1]) {
      let token = m[1];
      try { token = decodeURIComponent(token); } catch { /* 원문 사용 */ }
      xsrf['X-Xsrf-Token'] = token;
    }
    let res: Response;
    try {
      res = await fetch('/v2/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...xsrf },
        body: JSON.stringify({ type: 'USER', page, maxResults: pageSize, filter: {}, domainId, includedSubOrgUnit: false }),
        credentials: 'same-origin',
        signal: AbortSignal.timeout(15000),
      });
    } catch (e) {
      return { ok: false, code: 'NW_API_ERROR', detail: e instanceof Error ? e.message : String(e) };
    }
    if (res.status === 401 || res.status === 403 || res.redirected) return { ok: false, code: 'NW_NOT_LOGGED_IN', status: res.status };
    if (!(res.headers.get('content-type') ?? '').includes('json')) return { ok: false, code: 'NW_NOT_LOGGED_IN', status: res.status };
    if (!res.ok) return { ok: false, code: 'NW_API_ERROR', status: res.status };
    let body: { totalCount?: unknown; results?: unknown };
    try {
      body = await res.json();
    } catch (e) {
      return { ok: false, code: 'NW_BAD_RESPONSE', status: res.status, detail: e instanceof Error ? e.message : String(e) };
    }
    if (!body || !Array.isArray(body.results)) return { ok: false, code: 'NW_BAD_RESPONSE', status: res.status };
    pages++;
    if (typeof body.totalCount === 'number') { totalCount = body.totalCount; hasTotal = true; }
    const results = body.results as Array<Record<string, unknown>>;
    if (results.length === 0) break;
    for (const u of results) {
      if (u?.id != null) {
        if (seen.has(u.id)) continue;
        seen.add(u.id);
      }
      collected.push({ id: u?.id, name: u?.name, email: u?.email, orgUnitName: u?.orgUnitName, orgUnits: u?.orgUnits, positionName: u?.positionName });
    }
    if (hasTotal && collected.length >= totalCount) break;
  }
  return { ok: true, totalCount: hasTotal ? totalCount : collected.length, results: collected, pages };
}
