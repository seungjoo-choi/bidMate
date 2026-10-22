import type { DocBlock, DocCell, DocModel, DocTable } from '../../core/doc/model';
import { renderText } from '../../core/doc/render-text';
import { DETAIL_TEXT_MAX_CHARS } from '../../core/search/constants';
import { defaultIsVisible, MAIN_FRAME_SELECTOR, type VisibleFn } from './detail-page';

/** 나라장터 상세화면 DOM → DocModel/텍스트(읽기 전용). DOM을 인자로 받는 순수 함수만 둔다. */
export interface PageTextOpts { isVisible?: VisibleFn }

const norm = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();
const BLOCK_SEL = 'div,p,li,h1,h2,h3,h4,h5,h6,label,dt,dd,section';
const SKIP_SEL = 'button,script,style,[aria-hidden="true"]';
const FIELD_SEL = 'input[title], textarea';
const SHOW_ELEMENT = 1;
const SHOW_TEXT = 4;

/** 셀 텍스트: 안에 input이 있으면 value, 없으면 textContent(공백 정규화). 중첩 표는 textContent로 평탄화된다. */
function cellText(cell: Element): string {
  const input = cell.querySelector('input');
  return norm(input ? input.value : cell.textContent);
}

function readTable(table: Element, index: number, vis: VisibleFn): DocTable | null {
  const cells: DocCell[] = [];
  const occupied = new Set<string>();
  let r = 0;
  let cols = 0;
  for (const tr of Array.from(table.querySelectorAll('tr'))) {
    if (tr.closest('table') !== table || !vis(tr)) continue;
    let c = 0;
    for (const td of Array.from(tr.children)) {
      if (!/^(TD|TH)$/i.test(td.tagName)) continue;
      while (occupied.has(`${r},${c}`)) c++;
      const rowSpan = Math.max(1, Number(td.getAttribute('rowspan')) || 1);
      const colSpan = Math.max(1, Number(td.getAttribute('colspan')) || 1);
      for (let i = 0; i < rowSpan; i++) for (let j = 0; j < colSpan; j++) occupied.add(`${r + i},${c + j}`);
      cells.push({ r, c, rowSpan, colSpan, text: vis(td) ? cellText(td) : '', blocks: [], loc: { block: 0 } });
      c += colSpan;
    }
    cols = Math.max(cols, c);
    r++;
  }
  if (cells.length === 0) return null;
  return { kind: 'table', index, rows: r, cols, cells, loc: { block: 0 } };
}

/** 상세화면 mainFrame을 DocModel로 읽는다. 루트가 없으면 null. */
export function readPageDoc(doc: Document, opts: PageTextOpts = {}): DocModel | null {
  const root = doc.querySelector(MAIN_FRAME_SELECTOR);
  if (!root) return null;
  const vis = opts.isVisible ?? defaultIsVisible;
  const t0 = Date.now();
  const consumed = new Set<Node>();
  const skipped = (el: Element) => !!el.closest(SKIP_SEL) || !vis(el);

  // 최상위 표를 먼저 소비해 표 안 텍스트가 문단으로 다시 들어가지 않게 한다.
  const tableAt = new Map<Element, DocTable | null>();
  let tableCount = 0;
  for (const t of Array.from(root.querySelectorAll('table'))) {
    if (t.parentElement?.closest('table')) continue;
    const w = doc.createTreeWalker(t, SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) consumed.add(n);
    for (const f of Array.from(t.querySelectorAll(FIELD_SEL))) consumed.add(f);
    const dt = skipped(t) ? null : readTable(t, tableCount + 1, vis);
    if (dt) tableCount++;
    tableAt.set(t, dt);
  }

  // 문서 순서대로 표와 문단을 만든다. 같은 블록 조상의 텍스트는 한 문단으로 묶는다.
  const order: Array<{ table: DocTable } | { host: Element; parts: string[] }> = [];
  const add = (n: Node, v: string) => {
    const el = n.nodeType === 1 ? (n as Element) : n.parentElement;
    const host = el?.closest(BLOCK_SEL) ?? root;
    // 직전 항목이 같은 블록의 문단일 때만 이어 붙인다(사이에 자식 블록·표가 끼면 새 문단).
    const last = order[order.length - 1];
    if (last && 'parts' in last && last.host === host) last.parts.push(v);
    else order.push({ host, parts: [v] });
  };
  const w = doc.createTreeWalker(root, SHOW_ELEMENT | SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (consumed.has(n)) continue;
    if (n.nodeType === 1) {
      const el = n as Element;
      if (tableAt.has(el)) { const dt = tableAt.get(el); if (dt) order.push({ table: dt }); continue; }
      if (!el.matches(FIELD_SEL)) continue;
      consumed.add(el);
      if (skipped(el)) continue;
      const v = norm((el as HTMLInputElement).value);
      if (v) add(el, v);
      continue;
    }
    consumed.add(n);
    const parent = n.parentElement;
    if (!parent || skipped(parent)) continue;
    const v = norm(n.textContent);
    if (v) add(n, v);
  }

  const blocks: DocBlock[] = order.map((o) => ('table' in o ? o.table : { kind: 'p', text: o.parts.join(' '), loc: { block: 0 } }));
  blocks.forEach((b, i) => { b.loc.block = i; });
  const chars = blocks.reduce((s, b) => s + (b.kind === 'p' ? b.text.length : b.cells.reduce((x, c) => x + c.text.length, 0)), 0);
  return { format: 'txt', blocks, warnings: [], stats: { chars, tables: tableCount, ms: Date.now() - t0 } };
}

/** 상세화면 전문(render-text 형식). 상한을 넘으면 뒤를 자르고 truncated로 알린다. 루트가 없거나 내용이 없으면 null. */
export function readPageText(doc: Document, opts: PageTextOpts = {}): { text: string; truncated: boolean } | null {
  const model = readPageDoc(doc, opts);
  if (!model || model.blocks.length === 0) return null;
  const text = renderText(model);
  if (!text) return null;
  return text.length > DETAIL_TEXT_MAX_CHARS ? { text: text.slice(0, DETAIL_TEXT_MAX_CHARS), truncated: true } : { text, truncated: false };
}
