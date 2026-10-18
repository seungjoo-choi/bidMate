import { COLLECTIBLE_KINDS, parseG2bLink, type G2bLink } from '../g2b/link';

/** 웹메일 DOM은 읽기만 한다. */
export interface ScannedLink { anchor: HTMLAnchorElement; link: G2bLink; title?: string }

export const OWN_SELECTOR = '[data-bidmate]';
export const CELL_SELECTOR = 'td,th'; // 실측 결과에 따라 완화 가능하도록 상수
export const TITLE_HEADERS = ['사업명', '공고명', '건명'];

const EDITABLE_SELECTOR = '[contenteditable]:not([contenteditable="false"])';

export function normalizeCellText(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, 200);
}

export function readRowTitle(anchor: HTMLAnchorElement): string | undefined {
  const tr = anchor.closest('tr');
  const table = tr?.closest('table');
  if (!tr || !table) return undefined;
  const head = table.tHead?.rows[0] ?? table.rows[0];
  if (!head || head === tr) return undefined;
  const headers = Array.from(head.cells).map((c) => normalizeCellText(c.textContent ?? ''));
  const cells = Array.from(tr.cells);
  if (headers.length !== cells.length) return undefined;
  const idx = headers.findIndex((h) => TITLE_HEADERS.some((t) => h.includes(t)));
  if (idx < 0) return undefined;
  const text = normalizeCellText(cells[idx]!.textContent ?? '');
  return text === '' ? undefined : text;
}

export function scanG2bLinks(root: ParentNode): ScannedLink[] {
  const out: ScannedLink[] = [];
  for (const a of Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href*="g2b.go.kr/link/"]'))) {
    if (!a.isConnected) continue;
    const link = parseG2bLink(a.href);
    if (!link || !COLLECTIBLE_KINDS.has(link.kind)) continue;
    if (a.isContentEditable || a.closest(EDITABLE_SELECTOR)) continue;
    if (!a.closest(CELL_SELECTOR)) continue;
    if (a.closest(OWN_SELECTOR)) continue;
    out.push({ anchor: a, link, title: readRowTitle(a) });
  }
  return out;
}
