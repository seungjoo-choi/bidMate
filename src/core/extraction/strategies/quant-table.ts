import { Grid, allTables } from '../../doc/grid';
import type { DocCell } from '../../doc/model';
import { compact } from '../normalize';
import { formatQuantValue, type QuantCat } from '../quant-table';
import type { Rule } from '../rules/schema';
import { expandTerm, type Prepared, type RawHit, type Synonyms } from './common';

type R = Extract<Rule, { strategy: 'quant-table' }>;

const NOT_QUANT_CAPTION = /자가진단|서식|별지|증빙|제출|기준표|등급/;
// "정량/정성 배점"처럼 정성이 단독으로 붙은 제목도 결합 표다.
const COMBINED = /정성|기술평가|가격평가/;
const TOTAL_ROW = /^(합계|계|소계|총계)$/;
const SCORE = /^(\d+(?:\.\d+)?)점?(?:\(.{0,10}\)|만점)?$/;

/** 정량평가 표를 찾아 "<합계>:<범주들>" 값으로 요약한다. 합계 배점과 행 배점 합이 맞는 완결된 표만 인정한다. */
export function quantTable(p: Prepared, rule: R, syn: Synonyms): RawHit[] {
  const headerRe = new RegExp(expandTerm(rule.scoreHeader, syn));
  const titleSrc = expandTerm(rule.title, syn);
  const titleRe = new RegExp(titleSrc);
  const labelStartRe = new RegExp('^' + titleSrc);
  const perfRe = new RegExp(expandTerm(rule.perfLabel, syn));
  const credRe = new RegExp(expandTerm(rule.credLabel, syn));
  const mgmtRe = new RegExp(expandTerm(rule.mgmtLabel, syn));
  const out: RawHit[] = [];
  for (const t of allTables(p.doc)) {
    const g = new Grid(t);
    if (t.rows > g.rows || t.cols > g.cols) continue; // 잘린 표
    const header = g.headerRow();
    const scoreCols = header.cells.filter((c) => headerRe.test(compact(c.text))).map((c) => c.c);
    const sc = scoreCols[0];
    if (sc === undefined) continue;

    // 정량 식별: 양식 B(라벨 칸)가 양식 A(제목)보다 우선
    let start = -1;
    let end = -1;
    let titleText = '';
    let labelCell: DocCell | undefined;
    for (let r = header.r + 1; r < g.rows && !labelCell; r++) {
      // 첫 칸이 더 긴 묶음 칸("기술능력평가" 세로 병합)이면 둘째 칸의 정량 라벨도 인정한다.
      labelCell = g.ownCells(r).find((c) => (c.c === 0 || (c.c === 1 && (g.at(r, 0)?.rowSpan ?? 1) > c.rowSpan)) && labelStartRe.test(compact(c.text)));
    }
    if (labelCell) {
      start = labelCell.r;
      end = Math.min(labelCell.r + labelCell.rowSpan, g.rows);
      titleText = compact(labelCell.text);
    } else if (t.caption) {
      const cap = compact(t.caption);
      // "정량평가 및 정성평가 기준"처럼 제목에 다른 평가가 함께 있으면 결합 표다.
      if (titleRe.test(cap) && !NOT_QUANT_CAPTION.test(cap) && !COMBINED.test(cap)) {
        let combined = false;
        for (let r = header.r + 1; r < g.rows; r++) {
          if (g.ownCells(r).some((c) => c.c === 0 && COMBINED.test(compact(c.text)))) { combined = true; break; }
        }
        if (!combined) { start = header.r + 1; end = g.rows; titleText = cap; }
      }
    }
    if (start < 0 || start >= end) continue;

    // 범위 안 행 목록(합계 행 포함)
    const rowsIn: number[] = [];
    for (let r = start; r < end; r++) rowsIn.push(r);
    const firstText = (r: number) => g.ownCells(r).find((c) => compact(c.text) !== '')?.text ?? '';
    const isTotalRow = (r: number) => TOTAL_ROW.test(compact(firstText(r)));

    // 합계 N
    let total: number | undefined;
    // "정량평가 20점" 또는 라벨 칸의 "정량평가 (10)", "정량 (10)"
    const tm = /정량(?:적)?(?:평가)?[^\d]{0,12}(\d+(?:\.\d+)?)점/.exec(titleText) ?? /^정량(?:적)?(?:평가)?\((\d+(?:\.\d+)?)점?\)$/.exec(titleText);
    if (tm) total = Number(tm[1]);
    else {
      const tr = rowsIn.find(isTotalRow);
      if (tr !== undefined) {
        const m = SCORE.exec(compact(g.at(tr, sc)?.text ?? ''));
        if (m) total = Number(m[1]);
      }
    }
    if (total === undefined) continue;

    // 행 배점 합(rowSpan으로 반복되는 셀은 한 번만, 합계 행 제외)
    let sum = 0;
    let numRows = 0;
    const seenScore = new Set<DocCell>();
    for (const r of rowsIn) {
      if (isTotalRow(r)) continue;
      const cell = g.at(r, sc);
      if (!cell || seenScore.has(cell)) continue;
      seenScore.add(cell);
      const m = SCORE.exec(compact(cell.text));
      if (!m) continue;
      sum += Number(m[1]);
      numRows++;
    }
    if (numRows === 0 || sum !== total) continue;

    // 범주: 배점 열을 뺀 모든 칸(배점 열이 둘인 계층 표에서 오른쪽 세부 항목도 본다)
    const cats = new Set<QuantCat>();
    // 범주 판정에서 빼는 열은 첫 배점 열과, 범위 안 칸이 모두 배점 숫자(또는 빈 칸)인 열뿐이다.
    // "평가방법(점수산정)"처럼 머리글만 배점 동의어인 설명 열은 범주 판정에 남긴다.
    const scoreColSet = new Set(scoreCols.filter((c) => c === sc || rowsIn.every((r) => {
      const ct = compact(g.at(r, c)?.text ?? '');
      return ct === '' || SCORE.test(ct) || isTotalRow(r);
    })));
    const seenLeft = new Set<DocCell>();
    const labels: string[] = [];
    for (const r of rowsIn) {
      if (isTotalRow(r)) continue;
      let rowLabel: string | undefined;
      let rowKnown = false;
      let rowShort = false;
      for (let c = 0; c < g.cols; c++) {
        if (scoreColSet.has(c)) continue;
        const cell = g.at(r, c);
        if (!cell || seenLeft.has(cell)) continue;
        seenLeft.add(cell);
        const ct = compact(cell.text);
        if (ct === '') continue;
        let known = false;
        if (perfRe.test(ct)) { cats.add('perf'); known = true; }
        if (credRe.test(ct)) { cats.add('cred'); known = true; }
        if (mgmtRe.test(ct)) { cats.add('mgmt'); known = true; }
        // 어느 범주도 아닌 짧은 라벨 칸(양식 B의 정량평가 라벨 칸은 제목이므로 제외)
        const firstKnown = known && !rowKnown;
        if (known) rowKnown = true;
        else if (ct.length <= 30 && cell !== labelCell && !labelStartRe.test(ct)) rowShort = true;
        if ((rowLabel === undefined || firstKnown) && ct.length <= 30 && cell !== labelCell && !labelStartRe.test(ct)) rowLabel = cell.text.replace(/\s+/g, '');
      }
      // 어느 범주도 못 찾은 행에 짧은 라벨이 있으면 다른 항목 행이다(범주 칸과 같은 행의 대분류 라벨은 보지 않는다).
      if (!rowKnown && rowShort) cats.add('other');
      const sCell = g.at(r, sc);
      labels.push(`${rowLabel ?? ''} ${sCell ? sCell.text.replace(/\s+/g, '') : ''}`.trim());
    }

    // 범주를 하나도 못 읽은 표는 근거가 될 수 없다(모든 항목이 해당 없음이 되는 것 방지).
    // "수행능력", "기술인력"처럼 아는 범주가 하나도 없는 표는 실적을 다른 이름으로 부를 수 있어 근거로 쓰지 않는다.
    if (!cats.has('perf') && !cats.has('cred') && !cats.has('mgmt')) continue;
    const first = g.at(rowsIn[0]!, sc);
    const raw = `정량평가 ${total}점: ${labels.join(', ')}`.slice(0, 300);
    const context = [g.rowText(header.r), ...rowsIn.map((r) => g.rowText(r))].join('\n').slice(0, 400);
    out.push({
      value: formatQuantValue({ total, cats }), raw, location: `표${t.index} r${rowsIn[0]}c${sc}`,
      page: first?.loc.page, sheet: first?.loc.sheet, line: first?.loc.line,
      evidence: raw, context,
    });
  }
  return out;
}
