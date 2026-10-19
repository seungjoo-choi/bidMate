import type { NoticeRef } from '../../core/types/notice';

export type G2bLinkKind = 'bid' | 'prespec' | 'orderplan';
export interface G2bLink { kind: G2bLinkKind; id: string; round?: string; url: string } // url = 정규화 URL

export const G2B_ORIGIN = 'https://www.g2b.go.kr';
/** 버튼을 만들 수 있는 종류. 발주계획은 파서가 인식만 한다. */
export const COLLECTIBLE_KINDS: ReadonlySet<G2bLinkKind> = new Set<G2bLinkKind>(['bid', 'prespec']);

const PARAMS: Array<{ kind: G2bLinkKind; id: string; round?: string }> = [
  { kind: 'bid', id: 'bidPbancNo', round: 'bidPbancOrd' },
  { kind: 'prespec', id: 'bfSpecRegNo' },
  { kind: 'orderplan', id: 'oderPlanNo' },
];
const ID_RE = /^R\d{2}[A-Z]{2}\d{8}$/;
const PATH_RE = /^\/[A-Za-z0-9_./-]*$/;

export function parseG2bLink(href: string): G2bLink | null {
  let u: URL;
  try { u = new URL(href); } catch { return null; }
  if (u.origin !== G2B_ORIGIN) return null;
  if (!PATH_RE.test(u.pathname)) return null;
  for (const p of PARAMS) {
    const id = u.searchParams.get(p.id);
    if (id === null) continue;
    if (!ID_RE.test(id)) return null;
    const rawRound = p.round ? u.searchParams.get(p.round) : null;
    const round = rawRound !== null && /^\d+$/.test(rawRound) ? rawRound.padStart(3, '0') : undefined;
    const q = new URLSearchParams({ [p.id]: id });
    if (p.round && round) q.set(p.round, round);
    return { kind: p.kind, id, ...(round ? { round } : {}), url: `${G2B_ORIGIN}${u.pathname}?${q.toString()}` };
  }
  return null;
}

/** 상세화면을 열 URL. 입찰공고(bid)만 대상이며, 검증을 통과한 g2b URL만 반환한다. */
export function detailUrlOf(ref: Pick<NoticeRef, 'kind' | 'noticeNo' | 'round' | 'detailUrl'>): string | null {
  if (ref.kind && ref.kind !== 'bid') return null;
  if (ref.detailUrl) {
    const l = parseG2bLink(ref.detailUrl);
    if (l?.kind === 'bid' && l.id === ref.noticeNo) return l.url;
  }
  const q = new URLSearchParams({ bidPbancNo: ref.noticeNo });
  if (ref.round) q.set('bidPbancOrd', ref.round);
  const l = parseG2bLink(`${G2B_ORIGIN}/link/PNPE027_01/single/?${q.toString()}`);
  return l && l.kind === 'bid' ? l.url : null;
}

/** 회차는 "1"/"001"처럼 자릿수가 다를 수 있어 앞의 0을 떼고 비교한다. */
export const sameRound = (a: string, b: string): boolean => a.trim().replace(/^0+/, '') === b.trim().replace(/^0+/, '');

export function linkToNoticeRef(link: G2bLink, origin: NoticeRef['origin']): NoticeRef | null {
  if (link.kind === 'prespec') return { kind: 'prespec', noticeNo: link.id, detailUrl: link.url, origin };
  if (link.kind !== 'bid') return null; // 발주계획은 버튼을 만들지 않는다
  return { noticeNo: link.id, ...(link.round ? { round: link.round } : {}), detailUrl: link.url, origin };
}
