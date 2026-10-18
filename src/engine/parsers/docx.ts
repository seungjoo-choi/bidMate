import type { DocCell, DocLoc, DocTable } from '../../core/doc/model';
import { MAX_TABLE_AREA, MAX_TABLE_COLS, MAX_TABLE_ROWS } from '../../core/doc/limits';
import type { DocParser } from './types';
import { openZip } from './zip';
import {
  attr, cellContent, defaultParseXml, elChildren, extractBlocks, guard,
  parseXmlChecked, runParse, utf8, type BlockCtx, type ParseXml,
} from './xml-util';

export function createDocxParser(parseXml: ParseXml = defaultParseXml): DocParser {
  return {
    id: 'docx',
    format: 'docx',
    async parse(input) {
      return runParse(input, 'docx', () => {
        const xml = parseXmlChecked(parseXml, utf8(openZip(input.bytes).read('word/document.xml')));
        guard(input);
        const counter = { n: 0 };
        const warnings: string[] = [];
        const ctx: BlockCtx = {
          pTag: 'p', tblTag: 'tbl', textTag: 't', counter,
          makeTable: (tbl, index, loc, caption) => makeTable(tbl, index, loc, caption, ctx, () => guard(input), warnings),
        };
        const blocks = extractBlocks(xml.documentElement, ctx, () => guard(input));
        return { blocks, warnings, tables: counter.n };
      });
    },
  };
}

function makeTable(
  tbl: Element, index: number, loc: DocLoc, caption: string | undefined, ctx: BlockCtx, g: () => void, warnings: string[],
): DocTable {
  const cells: DocCell[] = [];
  const open = new Map<number, DocCell>(); // 열 시작 위치 -> 진행 중인 vMerge 시작 셀
  let trs = elChildren(tbl).filter((e) => e.localName === 'tr');
  let clipped = false;
  if (trs.length > MAX_TABLE_ROWS) { trs = trs.slice(0, MAX_TABLE_ROWS); clipped = true; }
  let cols = 0;
  trs.forEach((tr, r) => {
    let c = 0;
    for (const tc of elChildren(tr).filter((e) => e.localName === 'tc')) {
      const pr = elChildren(tc).find((e) => e.localName === 'tcPr');
      const gs = pr ? elChildren(pr).find((e) => e.localName === 'gridSpan') : undefined;
      const vm = pr ? elChildren(pr).find((e) => e.localName === 'vMerge') : undefined;
      const rawSpan = Math.max(1, Number(attr(gs, 'val')) || 1);
      const colSpan = Math.min(MAX_TABLE_COLS, rawSpan);
      if (rawSpan > colSpan) clipped = true;
      if (c >= MAX_TABLE_COLS) { clipped = true; continue; }
      if (vm) {
        const v = attr(vm, 'val');
        if (v !== 'restart') {
          const owner = open.get(c);
          if (owner) {
            owner.rowSpan++;
            c += colSpan;
            continue;
          }
        }
      }
      const { text, blocks } = cellContent(tc, ctx, g);
      const cloc: DocLoc = { block: loc.block };
      const cs = Math.min(colSpan, MAX_TABLE_COLS - c);
      if (cs < colSpan) clipped = true;
      const cell: DocCell = { r, c, rowSpan: 1, colSpan: cs, text, blocks, loc: cloc };
      cells.push(cell);
      if (vm && attr(vm, 'val') === 'restart') open.set(c, cell);
      else open.delete(c);
      c += colSpan;
    }
    cols = Math.max(cols, c);
  });
  let rows = trs.length;
  cols = Math.min(cols, MAX_TABLE_COLS);
  if (rows * cols > MAX_TABLE_AREA) {
    clipped = true;
    rows = Math.max(1, Math.floor(MAX_TABLE_AREA / cols));
    for (let i = cells.length - 1; i >= 0; i--) if (cells[i]!.r >= rows) cells.splice(i, 1);
    for (const x of cells) x.rowSpan = Math.min(x.rowSpan, rows - x.r);
  }
  if (clipped) warnings.push(`표 ${index}: 행/열/span이 상한으로 잘림`);
  const t: DocTable = { kind: 'table', index, rows, cols, cells, loc };
  if (caption) t.caption = caption;
  return t;
}

export const docxParser: DocParser = createDocxParser();
