import { Grid, allTables } from '../../doc/grid';
import type { DocCell } from '../../doc/model';
import { compact } from '../normalize';
import type { Rule } from '../rules/schema';
import { expandTerm, type Prepared, type RawHit, type Synonyms } from './common';

type R = Extract<Rule, { strategy: 'qual-table' }>;

const TOTAL_ROW = /^(합계|계|소계|총계)$/;
const SCORE = /^(\d+(?:\.\d+)?)점?$/;
const FULL = 100;
const MIN_ROWS = 3;

/**
 * 기술평가 배점표가 정성 항목만으로 100점을 채우면 "정성평가만 있음" 근거로 요약한다.
 * 배점 열 외 어느 칸에든 정량 항목 말(quantLabel)이 있으면 근거로 쓰지 않는다(보수적으로 놓친다).
 */
export function qualTable(p: Prepared, rule: R, syn: Synonyms): RawHit[] {
  const headerRe = new RegExp(expandTerm(rule.scoreHeader, syn));
  const itemRe = new RegExp(expandTerm(rule.itemHeader, syn));
  const quantRe = new RegExp(expandTerm(rule.quantLabel, syn));
  const out: RawHit[] = [];
  for (const t of allTables(p.doc)) {
    const g = new Grid(t);
    if (t.rows > g.rows || t.cols > g.cols) continue; // 잘린 표
    const header = g.headerRow();
    const sc = header.cells.find((c) => headerRe.test(compact(c.text)))?.c;
    if (sc === undefined || !header.cells.some((c) => c.c !== sc && itemRe.test(compact(c.text)))) continue;

    const seenScore = new Set<DocCell>();
    const seenText = new Set<DocCell>();
    let sum = 0;
    let rows = 0;
    let quant = false;
    for (let r = header.r + 1; r < g.rows && !quant; r++) {
      const first = g.ownCells(r).find((c) => compact(c.text) !== '');
      if (first && TOTAL_ROW.test(compact(first.text))) continue;
      for (let c = 0; c < g.cols; c++) {
        const cell = g.at(r, c);
        if (!cell) continue;
        if (c === sc) {
          if (seenScore.has(cell)) continue;
          seenScore.add(cell);
          const m = SCORE.exec(compact(cell.text));
          if (m) { sum += Number(m[1]); rows++; }
          continue;
        }
        if (seenText.has(cell)) continue;
        seenText.add(cell);
        if (quantRe.test(compact(cell.text))) { quant = true; break; }
      }
    }
    if (quant || rows < MIN_ROWS || sum !== FULL) continue;
    const first = g.at(header.r + 1, sc);
    const raw = `기술평가 배점표 ${rows}개 항목 합계 ${sum}점(정량 항목 없음)`;
    out.push({
      value: `qual:${sum}`, raw, location: `표${t.index} r${header.r + 1}c${sc}`,
      page: first?.loc.page, sheet: first?.loc.sheet, line: first?.loc.line,
      evidence: raw, context: [g.rowText(header.r), g.rowText(header.r + 1)].join('\n').slice(0, 400),
    });
  }
  return out;
}
