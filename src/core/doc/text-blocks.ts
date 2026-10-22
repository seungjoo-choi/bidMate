/** 추출 텍스트(render-text 형식)의 줄 → 블록 분해. 줄 번호(0부터)는 원 텍스트 그대로 유지한다. ui/review/text-view.ts에서 이동(동작 변경 없음). */

export const CELL_RE = /^\[셀 (\d+) (\d+)((?: (?:rs|cs)\d+)*)\] ?(.*)$/;
export const TABLE_RE = /^\[표 \d+\]/;
export const PAGE_RE = /^\[p (\d+)\]$/;
/** 표 마지막 셀 뒤 태그 없는 줄을 그 셀의 이어진 줄로 보는 최대 수(표 끝 표시가 없어 뒤 문단과 구분 불가). */
const MAX_TRAILING = 2;

export interface TextCell { r: number; c: number; rowSpan: number; colSpan: number; lines: number[] }
export type TextBlock =
  | { kind: 'line'; i: number }
  | { kind: 'page'; i: number; page: string }
  | { kind: 'table'; start: number; end: number; rows: TextCell[][] };

/** 줄의 표시용 텍스트: `[셀 …]` 태그를 떼고, `[표 k]`, `[p N]` 줄은 빈 문자열. */
export function displayLine(l: string): string {
  const m = CELL_RE.exec(l);
  if (m) return m[4]!;
  if (TABLE_RE.test(l) || PAGE_RE.test(l)) return '';
  return l;
}

function parseCell(l: string): TextCell | null {
  const m = CELL_RE.exec(l);
  if (!m) return null;
  const rs = /rs(\d+)/.exec(m[3]!);
  const cs = /cs(\d+)/.exec(m[3]!);
  return { r: Number(m[1]), c: Number(m[2]), rowSpan: rs ? Number(rs[1]) : 1, colSpan: cs ? Number(cs[1]) : 1, lines: [] };
}

/** 표는 `[표 k]` 또는 셀 줄에서 시작해, 셀 순서(r, c)가 앞으로만 가는 동안 이어진다. 셀 사이 태그 없는 줄은 앞 셀의 이어진 줄. */
export function buildTextBlocks(lines: string[]): TextBlock[] {
  const out: TextBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i]!;
    const pm = PAGE_RE.exec(l);
    if (pm) { out.push({ kind: 'page', i, page: pm[1]! }); i++; continue; }
    const isTable = TABLE_RE.test(l);
    if (!isTable && !CELL_RE.test(l)) { out.push({ kind: 'line', i }); i++; continue; }

    const start = i;
    const cells: TextCell[] = [];
    let j = isTable ? i + 1 : i;
    let pending: number[] = [];
    for (; j < lines.length; j++) {
      const lj = lines[j]!;
      if (TABLE_RE.test(lj) || PAGE_RE.test(lj)) break;
      const cell = parseCell(lj);
      if (!cell) { pending.push(j); continue; }
      const prev = cells[cells.length - 1];
      if (prev && (cell.r < prev.r || (cell.r === prev.r && cell.c <= prev.c))) break; // 다른 표(중첩 표 뒤 바깥 표 나머지 등)
      if (prev) prev.lines.push(...pending);
      else if (pending.length) break; // 표 머리 뒤 셀 없이 평문이면 표 아님
      pending = [];
      cell.lines.push(j);
      cells.push(cell);
    }
    if (!cells.length) { out.push({ kind: 'line', i }); i++; continue; }
    const tail = pending.slice(0, MAX_TRAILING);
    cells[cells.length - 1]!.lines.push(...tail);
    const end = tail.length ? tail[tail.length - 1]! : cells[cells.length - 1]!.lines[0]!;
    const byRow = new Map<number, TextCell[]>();
    for (const c of cells) byRow.set(c.r, [...(byRow.get(c.r) ?? []), c]);
    out.push({ kind: 'table', start, end, rows: [...byRow.keys()].sort((a, b) => a - b).map((r) => byRow.get(r)!) });
    i = end + 1;
  }
  return out;
}
