import { describe, expect, it } from 'vitest';
import { Grid, allTables } from '../../src/core/doc/grid';
import { renderText } from '../../src/core/doc/render-text';
import type { DocCell, DocModel, DocTable } from '../../src/core/doc/model';

const cell = (r: number, c: number, text: string, extra: Partial<DocCell> = {}): DocCell => ({
  r, c, rowSpan: 1, colSpan: 1, text, blocks: [], loc: { block: 0 }, ...extra,
});

function nested(): DocTable {
  return { kind: 'table', index: 1, rows: 1, cols: 1, cells: [cell(0, 0, '안')], loc: { block: 0 } };
}
function outer(): DocTable {
  return {
    kind: 'table', index: 0, rows: 3, cols: 4, loc: { block: 1 },
    cells: [
      cell(0, 0, '구분'), cell(0, 1, '평가부문'), cell(0, 2, '평가항목'), cell(0, 3, '배점'),
      cell(1, 0, '정량', { rowSpan: 2 }), cell(1, 1, 'A'), cell(1, 2, 'B', { blocks: [nested()] }), cell(1, 3, '4'),
      cell(2, 1, 'C'), cell(2, 2, 'D'), cell(2, 3, '6'),
    ],
  };
}
const model = (t: DocTable): DocModel => ({
  format: 'hwp5', blocks: [{ kind: 'p', text: '서문', loc: { block: 0 } }, t], warnings: [], stats: { chars: 0, tables: 2, ms: 0 },
});

describe('Grid', () => {
  const g = new Grid(outer());
  it('at은 병합 영역의 소유 셀을 반환한다', () => {
    expect(g.at(2, 0)).toBe(g.at(1, 0));
    expect(g.at(2, 0)?.text).toBe('정량');
    expect(g.at(2, 3)?.text).toBe('6');
  });
  it('ownCells(2)에는 c0이 없다', () => {
    expect(g.ownCells(2).map((x) => x.c)).toEqual([1, 2, 3]);
  });
  it('headerRow: 기본은 0행', () => {
    expect(g.headerRow().r).toBe(0);
    expect(g.rowText(0)).toBe('구분 | 평가부문 | 평가항목 | 배점');
  });
  it('headerRow: 0행이 colSpan=cols 단일 셀이면 1행', () => {
    const t: DocTable = {
      kind: 'table', index: 0, rows: 2, cols: 2, loc: { block: 0 },
      cells: [cell(0, 0, '제목', { colSpan: 2 }), cell(1, 0, 'h1'), cell(1, 1, 'h2')],
    };
    expect(new Grid(t).headerRow().r).toBe(1);
  });
  it('allTables는 중첩 표를 포함한다', () => {
    const tables = allTables(model(outer()));
    expect(tables.map((t) => t.index)).toEqual([0, 1]);
  });
});

describe('renderText', () => {
  it('표/셀 태그를 쓰고 loc.line을 채운다', () => {
    const doc = model(outer());
    const text = renderText(doc);
    expect(text).toContain('[표 0]');
    expect(text).toContain('[셀 1 0 rs2]');
    const lines = text.split('\n');
    const t = doc.blocks[1] as DocTable;
    expect(lines[t.loc.line!]).toBe('[표 0]');
    expect(lines[t.cells[4]!.loc.line!]).toBe('[셀 1 0 rs2] 정량');
    expect((doc.blocks[0] as { loc: { line?: number } }).loc.line).toBe(0);
  });
});
