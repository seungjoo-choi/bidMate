import { Grid, allTables } from '../../doc/grid';
import { compact } from '../normalize';
import type { Rule } from '../rules/schema';
import { expandTerm, type Prepared, type RawHit, type Synonyms } from './common';

type R = Extract<Rule, { strategy: 'bonus-table' }>;

/** 가점/감점 라벨이 1열에 있고 배점 칸에 숫자가 있는 표를 찾아 "가점 6항목, 감점 2항목" 형태로 요약한다.
 *  합계 배점은 표에 없으므로 숫자는 만들지 않는다. 라벨은 완전 일치만 인정하고, 배점 칸이 모두 비어 있는 표(자가진단표)는 버린다. */
export function bonusTable(p: Prepared, rule: R, syn: Synonyms): RawHit[] {
  const headerRe = new RegExp(expandTerm(rule.scoreHeader, syn));
  const labelRe = new RegExp('^' + expandTerm(rule.rowLabel, syn) + '$');
  const out: RawHit[] = [];
  for (const t of allTables(p.doc)) {
    const g = new Grid(t);
    const header = g.headerRow();
    const sc = header.cells.find((c) => headerRe.test(compact(c.text)))?.c;
    if (sc === undefined) continue;
    const labels: Array<{ cell: ReturnType<Grid['ownCells']>[number]; text: string }> = [];
    for (let r = header.r + 1; r < g.rows; r++) {
      for (const cell of g.ownCells(r)) {
        if (cell.c >= sc) continue;
        const ct = compact(cell.text);
        if (ct.length <= 10 && labelRe.test(ct)) labels.push({ cell, text: ct });
      }
    }
    if (labels.length === 0) continue;
    const hasNumber = labels.some(({ cell }) => {
      for (let r = cell.r; r < Math.min(cell.r + cell.rowSpan, g.rows); r++) {
        if (/\d/.test(g.at(r, sc)?.text ?? '')) return true;
      }
      return false;
    });
    if (!hasNumber) continue;
    const first = labels[0]!.cell;
    // 병합 없이 행마다 같은 라벨을 적은 표도 라벨별 합계로 묶는다.
    const counts = new Map<string, number>();
    for (const { cell, text } of labels) counts.set(text, (counts.get(text) ?? 0) + cell.rowSpan);
    const value = [...counts].map(([text, n]) => `${text} ${n}항목`).join(', ');
    const firstRow = g.rowText(first.r);
    out.push({
      value, raw: value, location: `표${t.index} r${first.r}c${first.c}`,
      page: first.loc.page, sheet: first.loc.sheet, line: first.loc.line,
      evidence: firstRow, context: `${g.rowText(header.r)}\n${firstRow}`,
    });
  }
  return out;
}
