export interface NaverworksComposeInput { to: string[]; cc: string[]; subject: string }

/** 작성 팝업 경로. 이 경로만 주소 채움(to/cc/subject)을 지원한다. */
export const NAVERWORKS_COMPOSE_POPUP = '/write/popup';

const encEmail = (v: string) => encodeURIComponent(v).replace(/%40/g, '@');

function recipients(list: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const v = raw.trim();
    const key = v.toLowerCase();
    if (!v || seen.has(key)) continue;
    seen.add(key);
    out.push(encEmail(v));
  }
  return out.join(',');
}

/**
 * 네이버웍스 작성 팝업 주소에 받는 사람, 참조, 제목을 넣는다. 작성 팝업 경로가 아니면 null.
 * 실측(2026-10-19, 사용자): to/cc는 쉼표 구분, subject 지원. 본문 파라미터는 확인되지 않아 넣지 않는다.
 * 기존 쿼리(srvid, orderType 등)는 순서대로 유지하고 to 자리에 to, cc, subject를 둔다.
 */
export function buildNaverworksComposeUrl(base: string, i: NaverworksComposeInput): string | null {
  let u: URL;
  try { u = new URL(base); } catch { return null; }
  if (u.pathname !== NAVERWORKS_COMPOSE_POPUP) return null;
  const fill = [`to=${recipients(i.to)}`];
  const cc = recipients(i.cc);
  if (cc) fill.push(`cc=${cc}`);
  if (i.subject) fill.push(`subject=${encodeURIComponent(i.subject)}`);

  const out: string[] = [];
  let placed = false;
  for (const p of u.search.slice(1).split('&')) {
    if (!p) continue;
    const k = p.split('=')[0];
    if (k === 'cc' || k === 'subject') continue;
    if (k === 'to') { if (!placed) out.push(...fill); placed = true; continue; }
    out.push(p);
  }
  if (!placed) out.push(...fill);
  return `${u.origin}${u.pathname}?${out.join('&')}${u.hash}`;
}
