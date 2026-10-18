import type { DocBlock, DocCell, DocTable } from '../../core/doc/model';
import type { DocParser } from './types';
import { openZip } from './zip';
import { MAX_TABLE_AREA, MAX_TABLE_COLS, MAX_TABLE_ROWS } from '../../core/doc/limits';
import {
  attr, defaultParseXml, descendants, elChildren, guard, parseXmlChecked, runParse, utf8, type ParseXml,
} from './xml-util';

export const XLSX_MAX_CELLS = 20000;

export interface XlsxOptions { parseXml?: ParseXml; maxCells?: number }

/** A1 표기 -> 0-based {r, c} */
export function parseA1(ref: string): { r: number; c: number } | undefined {
  const m = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(ref.trim());
  if (!m) return undefined;
  let c = 0;
  for (const ch of m[1]!.toUpperCase()) c = c * 26 + (ch.charCodeAt(0) - 64);
  return { r: Number(m[2]) - 1, c: c - 1 };
}

/** rels Target을 zip 내 절대 경로로 정규화한다(xl/ 기준). */
export function resolveTarget(t: string): string {
  const parts = (t.startsWith('/') ? t.slice(1) : `${t.startsWith('..') ? 'xl/_rels' : 'xl'}/${t}`).split('/');
  const out: string[] = [];
  for (const seg of parts) {
    if (seg === '..') out.pop();
    else if (seg !== '.' && seg !== '') out.push(seg);
  }
  return out.join('/');
}

export function createXlsxParser(opts: XlsxOptions = {}): DocParser {
  const parseXml = opts.parseXml ?? defaultParseXml;
  const maxCells = opts.maxCells ?? XLSX_MAX_CELLS;
  return {
    id: 'xlsx',
    format: 'xlsx',
    async parse(input) {
      return runParse(input, 'xlsx', () => {
        const zip = openZip(input.bytes);
        const read = (p: string) => parseXmlChecked(parseXml, utf8(zip.read(p)));
        const warnings: string[] = [];
        const wb = read('xl/workbook.xml');
        const rels = read('xl/_rels/workbook.xml.rels');
        const target = new Map<string, string>();
        for (const r of descendants(rels.documentElement, 'Relationship')) {
          const id = attr(r, 'Id');
          const t = attr(r, 'Target');
          if (id && t) target.set(id, resolveTarget(t));
        }
        let shared: string[] = [];
        try {
          const ss = read('xl/sharedStrings.xml');
          shared = descendants(ss.documentElement, 'si').map((si) =>
            descendants(si, 't').map((t) => t.textContent ?? '').join(''));
        } catch (e) {
          if (!/엔트리가 없습니다/.test((e as Error).message)) throw e;
        }
        const blocks: DocBlock[] = [];
        const sheets = descendants(wb.documentElement, 'sheet');
        sheets.forEach((sh, idx) => {
          guard(input);
          const name = attr(sh, 'name') ?? `Sheet${idx + 1}`;
          const path = target.get(attr(sh, 'id') ?? '');
          if (!path) { warnings.push(`시트 '${name}': 관계를 찾을 수 없어 건너뜀`); return; }
          const sx = read(path);
          blocks.push(buildSheet(sx.documentElement, name, idx, shared, maxCells, warnings, () => guard(input)));
        });
        if (blocks.length === 0) throw new Error('xlsx: 시트가 없습니다');
        return { blocks, warnings, tables: blocks.length };
      });
    },
  };
}

function buildSheet(
  root: Element, name: string, index: number, shared: string[], maxCells: number, warnings: string[], g: () => void,
): DocTable {
  const loc = { sheet: name, block: index };
  const map = new Map<string, DocCell>();
  let count = 0;
  let truncated = false;
  let outOfRange = false;
  let seqR = -1;
  outer: for (const row of descendants(root, 'row')) {
    g();
    const rr = Number(attr(row, 'r'));
    seqR = Number.isFinite(rr) && rr > 0 ? rr - 1 : seqR + 1;
    let seqC = -1;
    for (const c of elChildren(row).filter((e) => e.localName === 'c')) {
      const pos = parseA1(attr(c, 'r') ?? '') ?? { r: seqR, c: seqC + 1 };
      seqC = pos.c;
      if (++count > maxCells) { truncated = true; break outer; }
      if (pos.r < 0 || pos.c < 0 || pos.r >= MAX_TABLE_ROWS || pos.c >= MAX_TABLE_COLS) { outOfRange = true; continue; }
      const t = attr(c, 't');
      const v = elChildren(c).find((e) => e.localName === 'v')?.textContent ?? '';
      let text: string;
      if (t === 's') text = shared[Number(v)] ?? '';
      else if (t === 'inlineStr') {
        const is = elChildren(c).find((e) => e.localName === 'is');
        text = is ? descendants(is, 't').map((x) => x.textContent ?? '').join('') : '';
      } else text = v;
      map.set(`${pos.r},${pos.c}`, { r: pos.r, c: pos.c, rowSpan: 1, colSpan: 1, text, blocks: [], loc: { ...loc } });
    }
  }
  if (truncated) warnings.push(`시트 '${name}': 셀이 ${maxCells}개를 넘어 이후는 읽지 않음`);

  if (outOfRange) warnings.push(`시트 '${name}': 행/열 상한(${MAX_TABLE_ROWS}x${MAX_TABLE_COLS}) 밖 셀을 버림`);

  let maxR = 0;
  let maxC = 0;
  for (const x of map.values()) { maxR = Math.max(maxR, x.r); maxC = Math.max(maxC, x.c); }
  const merges: { r1: number; c1: number; r2: number; c2: number }[] = [];
  for (const mc of descendants(root, 'mergeCell')) {
    g();
    const [a, b] = (attr(mc, 'ref') ?? '').split(':');
    const p1 = parseA1(a ?? '');
    const p2 = parseA1(b ?? a ?? '');
    if (!p1 || !p2 || p1.r < 0 || p1.c < 0 || p2.r < 0 || p2.c < 0) continue;
    const r1 = Math.min(p1.r, p2.r), c1 = Math.min(p1.c, p2.c);
    let r2 = Math.max(p1.r, p2.r), c2 = Math.max(p1.c, p2.c);
    // 읽은 셀 범위/표 상한으로 자른다(사각형 자체는 순회하지 않는다)
    r2 = Math.min(r2, Math.max(maxR, r1), MAX_TABLE_ROWS - 1);
    c2 = Math.min(c2, Math.max(maxC, c1), MAX_TABLE_COLS - 1);
    if (r1 > r2 || c1 > c2) continue;
    if ((r2 - r1 + 1) * (c2 - c1 + 1) > MAX_TABLE_AREA) {
      warnings.push(`시트 '${name}': 병합 영역 ${attr(mc, 'ref')}이 상한을 넘어 1x1로 줄임`);
      r2 = r1; c2 = c1;
    }
    merges.push({ r1, c1, r2, c2 });
  }
  if (merges.length > 0) {
    const origin = new Set<string>();
    for (const m of merges) {
      const k = `${m.r1},${m.c1}`;
      if (!map.has(k)) map.set(k, { r: m.r1, c: m.c1, rowSpan: 1, colSpan: 1, text: '', blocks: [], loc: { ...loc } });
      origin.add(k);
    }
    for (const m of merges) {
      g();
      const owner = map.get(`${m.r1},${m.c1}`)!;
      owner.rowSpan = m.r2 - m.r1 + 1;
      owner.colSpan = m.c2 - m.c1 + 1;
    }
    for (const [k, x] of [...map]) {
      g();
      if (origin.has(k)) continue;
      if (merges.some((m) => x.r >= m.r1 && x.r <= m.r2 && x.c >= m.c1 && x.c <= m.c2)) map.delete(k);
    }
  }
  const cells = [...map.values()].sort((x, y) => x.r - y.r || x.c - y.c);
  let rows = Math.max(0, ...cells.map((x) => x.r + x.rowSpan));
  const cols = Math.max(0, ...cells.map((x) => x.c + x.colSpan));
  if (rows * cols > MAX_TABLE_AREA) {
    warnings.push(`시트 '${name}': 면적이 상한 ${MAX_TABLE_AREA}를 넘어 행 수를 줄임`);
    rows = Math.max(1, Math.floor(MAX_TABLE_AREA / cols));
    for (let i = cells.length - 1; i >= 0 && cells[i]!.r >= rows; i--) cells.pop();
    for (const x of cells) x.rowSpan = Math.min(x.rowSpan, rows - x.r);
  }
  return { kind: 'table', index, rows, cols, cells, loc };
}

export const xlsxParser: DocParser = createXlsxParser();
