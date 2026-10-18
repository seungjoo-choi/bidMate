import { MAX_TABLE_AREA, MAX_TABLE_COLS, MAX_TABLE_ROWS } from './limits';
import type { DocCell, DocBlock, DocModel, DocTable } from './model';

/** 표를 (r,c) 좌표로 조회하기 위한 격자. 병합 영역은 소유 셀로 해석한다. */
export class Grid {
  private readonly map = new Map<number, DocCell>();
  private readonly table: DocTable;

  /** 소비자가 순회할 행/열 수. 파서가 상한을 빠뜨려도 여기서 한 번 더 막는다(최종 방어선). */
  readonly rows: number;
  readonly cols: number;

  constructor(t: DocTable) {
    this.table = t;
    this.rows = Math.min(t.rows, MAX_TABLE_ROWS);
    this.cols = Math.min(t.cols, MAX_TABLE_COLS);
    // 신뢰할 수 없는 문서 방어: 셀당/표 전체 채움 면적을 MAX_TABLE_AREA로 제한한다.
    let filled = 0;
    for (const cell of t.cells) {
      const rEnd = Math.min(cell.r + cell.rowSpan, t.rows);
      const cEnd = Math.min(cell.c + cell.colSpan, t.cols);
      if ((rEnd - cell.r) * (cEnd - cell.c) > MAX_TABLE_AREA) {
        if (filled < MAX_TABLE_AREA) { this.map.set(cell.r * t.cols + cell.c, cell); filled++; }
        continue;
      }
      for (let r = cell.r; r < rEnd; r++) {
        for (let c = cell.c; c < cEnd; c++) {
          if (filled >= MAX_TABLE_AREA) return;
          this.map.set(r * t.cols + c, cell);
          filled++;
        }
      }
    }
  }

  /** 병합 영역이면 소유 셀. */
  at(r: number, c: number): DocCell | undefined {
    if (r < 0 || c < 0 || r >= this.table.rows || c >= this.table.cols) return undefined;
    return this.map.get(r * this.table.cols + c);
  }

  /** 그 행에서 시작하는 셀만, c 오름차순. */
  ownCells(r: number): DocCell[] {
    return this.table.cells.filter((x) => x.r === r).sort((a, b) => a.c - b.c);
  }

  /** 0행. 0행이 colSpan=cols인 단일 셀이면 1행. */
  headerRow(): { r: number; cells: DocCell[] } {
    const first = this.ownCells(0);
    if (first.length === 1 && first[0]!.colSpan === this.table.cols && this.table.rows > 1) {
      return { r: 1, cells: this.ownCells(1) };
    }
    return { r: 0, cells: first };
  }

  rowText(r: number): string {
    return this.ownCells(r).map((x) => x.text).join(' | ');
  }
}

function collect(blocks: DocBlock[], out: DocTable[]): void {
  for (const b of blocks) {
    if (b.kind !== 'table') continue;
    out.push(b);
    for (const cell of b.cells) collect(cell.blocks, out);
  }
}

/** 중첩 표 포함 모든 표. */
export function allTables(doc: DocModel): DocTable[] {
  const out: DocTable[] = [];
  collect(doc.blocks, out);
  return out;
}
