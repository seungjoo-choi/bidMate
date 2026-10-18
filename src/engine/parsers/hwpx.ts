import type { DocCell, DocLoc, DocTable } from '../../core/doc/model';
import { MAX_TABLE_AREA, MAX_TABLE_COLS, MAX_TABLE_ROWS } from '../../core/doc/limits';
import type { DocParser } from './types';
import { openZip } from './zip';
import {
  cellContent, defaultParseXml, elChildren, extractBlocks, guard, intAttr,
  parseXmlChecked, runParse, utf8, type BlockCtx, type ParseXml,
} from './xml-util';

export function createHwpxParser(parseXml: ParseXml = defaultParseXml): DocParser {
  return {
    id: 'hwpx',
    format: 'hwpx',
    async parse(input) {
      return runParse(input, 'hwpx', () => {
        const zip = openZip(input.bytes);
        const names = zip.entries
          .map((e) => e.path)
          .map((p) => ({ p, m: /^Contents\/section(\d+)\.xml$/i.exec(p) }))
          .filter((x) => x.m)
          .map((x) => ({ p: x.p, n: Number(x.m![1]) }))
          .sort((a, b) => a.n - b.n);
        if (names.length === 0) throw new Error('hwpx: Contents/section*.xml이 없습니다');
        const counter = { n: 0 };
        const warnings: string[] = [];
        const blocks: ReturnType<typeof extractBlocks> = [];
        for (const { p, n } of names) {
          guard(input);
          const xml = parseXmlChecked(parseXml, utf8(zip.read(p)));
          const ctx: BlockCtx = {
            pTag: 'p', tblTag: 'tbl', textTag: 't', counter, section: n,
            makeTable: (tbl, index, loc, caption) => makeTable(tbl, index, loc, caption, ctx, () => guard(input), warnings),
          };
          blocks.push(...extractBlocks(xml.documentElement, ctx, () => guard(input)));
        }
        // 섹션을 합치면 loc.block이 섹션 내 번호이므로 전체 번호로 다시 매긴다.
        const renumber = (list: typeof blocks, i0: number | undefined): void => {
          list.forEach((b, i) => {
            const n = i0 ?? i;
            b.loc.block = n;
            if (b.kind === 'table') for (const c of b.cells) { c.loc.block = n; renumber(c.blocks, undefined); }
          });
        };
        renumber(blocks, undefined);
        return { blocks, warnings, tables: counter.n };
      });
    },
  };
}

function makeTable(
  tbl: Element, index: number, loc: DocLoc, caption: string | undefined, ctx: BlockCtx, g: () => void, warnings: string[],
): DocTable {
  const cells: DocCell[] = [];
  let seqR = 0;
  for (const tr of elChildren(tbl).filter((e) => e.localName === 'tr')) {
    let seqC = 0;
    for (const tc of elChildren(tr).filter((e) => e.localName === 'tc')) {
      const addr = elChildren(tc).find((e) => e.localName === 'cellAddr');
      const span = elChildren(tc).find((e) => e.localName === 'cellSpan');
      const r = intAttr(addr, 'rowAddr', seqR);
      const c = intAttr(addr, 'colAddr', seqC);
      let rowSpan = Math.min(MAX_TABLE_ROWS, Math.max(1, intAttr(span, 'rowSpan', 1)));
      let colSpan = Math.min(MAX_TABLE_COLS, Math.max(1, intAttr(span, 'colSpan', 1)));
      if (rowSpan * colSpan > MAX_TABLE_AREA) { rowSpan = 1; colSpan = 1; warnings.push(`표 ${index}: 셀 병합 면적이 상한을 넘어 1x1로 줄임`); }
      if (r >= MAX_TABLE_ROWS || c >= MAX_TABLE_COLS) { warnings.push(`표 ${index}: 행/열 상한을 넘는 셀을 버림`); continue; }
      const { text, blocks } = cellContent(tc, ctx, g);
      const cloc: DocLoc = { block: loc.block };
      if (loc.section !== undefined) cloc.section = loc.section;
      cells.push({ r, c, rowSpan, colSpan, text, blocks, loc: cloc });
      seqC = c + colSpan;
    }
    seqR++;
  }
  const rawRows = Math.max(intAttr(tbl, 'rowCnt', 0), ...cells.map((x) => x.r + x.rowSpan), 0);
  const rawCols = Math.max(intAttr(tbl, 'colCnt', 0), ...cells.map((x) => x.c + x.colSpan), 0);
  let rows = Math.min(rawRows, MAX_TABLE_ROWS);
  const cols = Math.min(rawCols, MAX_TABLE_COLS);
  if (rows < rawRows || cols < rawCols) warnings.push(`표 ${index}: 행/열이 상한(${MAX_TABLE_ROWS}x${MAX_TABLE_COLS})으로 잘림`);
  if (rows * cols > MAX_TABLE_AREA) {
    warnings.push(`표 ${index}: 면적이 상한 ${MAX_TABLE_AREA}를 넘어 행 수를 줄임`);
    rows = Math.max(1, Math.floor(MAX_TABLE_AREA / cols));
    for (let i = cells.length - 1; i >= 0; i--) if (cells[i]!.r >= rows) cells.splice(i, 1);
  }
  for (const x of cells) {
    x.rowSpan = Math.min(x.rowSpan, rows - x.r);
    x.colSpan = Math.min(x.colSpan, cols - x.c);
  }
  const t: DocTable = { kind: 'table', index, rows, cols, cells, loc };
  if (caption) t.caption = caption;
  return t;
}

export const hwpxParser: DocParser = createHwpxParser();
