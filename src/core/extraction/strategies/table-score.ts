import { Grid, allTables } from '../../doc/grid';
import { compact } from '../normalize';
import type { Rule } from '../rules/schema';
import { expandTerm, type Prepared, type RawHit, type Synonyms } from './common';

type R = Extract<Rule, { strategy: 'table-score' }>;

const GRADE_LABEL = /AAA|AA[+0\-－]|BBB|BB[+0\-－]|CCC|A[123][+0\-－](?!\d)|에준하는등급/;

/** 표의 배점 열에서 라벨 행의 점수를 읽는다. 헤더 행은 데이터로 쓰지 않고, 라벨은 그 행에서 시작하는 셀(ownCells)만 본다.
 *  0점은 배점이 아니며("0점 처리"), 라벨 칸에 신용등급 기호가 있는 행은 등급별 점수표의 행이라 버린다. */
export function tableScore(p: Prepared, rule: R, syn: Synonyms): RawHit[] {
  const labelRe = new RegExp(expandTerm(rule.label, syn));
  const headerRe = new RegExp(expandTerm(rule.scoreHeader, syn));
  const excludeRe = rule.excludeLabel ? new RegExp(expandTerm(rule.excludeLabel, syn)) : null;
  const out: RawHit[] = [];
  for (const t of allTables(p.doc)) {
    const hits: RawHit[] = [];
    const g = new Grid(t);
    const header = g.headerRow();
    const sc = header.cells.find((c) => headerRe.test(compact(c.text)))?.c;
    if (sc === undefined) continue;
    for (let r = header.r + 1; r < g.rows; r++) {
      // 라벨 후보: 점수 열 왼쪽, 그 행에서 시작하는 셀, compact 40자 이하(긴 설명 셀 제외)
      const labelCell = g.ownCells(r).find((c) => {
        if (c.c >= sc) return false;
        const ct = compact(c.text);
        return ct.length <= 40 && labelRe.test(ct) && !(excludeRe && excludeRe.test(ct));
      });
      if (!labelCell) continue;
      // 제외어는 라벨 칸과, 이 행에만 있는 짧은 칸(한 행 한 열, 40자 이하)에서 본다
      // ("신용도 | 입찰참가제한 업무정지 등 | 2"는 이름만 신용도이고 내용은 제재 이력이다).
      // 여러 행에 걸친 분류 칸과 긴 설명 칸은 우연히 상대 항목 낱말을 담을 수 있어 보지 않는다.
      if (excludeRe) {
        const rowLabel = g.ownCells(r)
          .filter((c) => c.c < sc && (c === labelCell || (c.rowSpan === 1 && c.colSpan === 1 && compact(c.text).length <= 40)))
          .map((c) => c.text).join('');
        if (excludeRe.test(compact(rowLabel))) continue;
      }
      const scoreCell = g.at(r, sc);
      if (!scoreCell) continue;
      // 라벨 칸에 신용등급 기호(AAA, BBB+, A2- 등)나 "…에 준하는 등급"이 있으면 등급별 점수표의 행이다.
      // 설명 칸의 "회사채 AAA~BBB- 등급별 차등"은 정상 배점 행일 수 있으므로 라벨 칸만 본다.
      if (GRADE_LABEL.test(compact(labelCell.text))) continue;
      // "6 5 4 3 2 1"처럼 숫자가 여러 개인 칸은 등급별 점수 나열이다(공백을 지우면 654321이 된다).
      if (/\d\s+\d/.test(scoreCell.text.trim())) continue;
      const m = /^(\d+(?:\.\d+)?)점?(?:\(.{0,10}\)|만점)?$/.exec(compact(scoreCell.text));
      if (!m || Number(m[1]) === 0) continue;
      hits.push({
        value: Number(m[1]), raw: scoreCell.text, location: `표${t.index} r${r}c${sc}`,
        page: scoreCell.loc.page, sheet: scoreCell.loc.sheet, line: scoreCell.loc.line,
        evidence: scoreCell.text, context: g.rowText(r),
      });
    }
    out.push(...hits);
  }
  return out;
}
