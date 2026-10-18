import type { DocBlock, DocCell, DocModel, DocTable } from '../doc/model';

const compact = (s: string) => s.replace(/\s+/g, '');
const ANSWER_LABEL = /^(답변|회신|답|A\.)$/i;
const QUESTION_LABEL = /^(\d+\.?|질의|질문|문의|Q\.?)$/i;

/**
 * 질의답변 표에서 질문 행을 뺀다. 질문 칸의 "실적 인정범위 확대 요청" 같은 문구가 근거로 잡히지 않게 하려는 것이다.
 * 첫 열 라벨이 "답변/회신" 같은 행이 있는 표에서만, 라벨이 번호나 "질의/질문"인 행(rowSpan 포함)을 뺀다.
 * 답변 행이 없는 표는 구조를 모르므로 그대로 둔다. 셀 객체는 그대로 공유하므로 renderText로 채운 loc.line이 유지된다.
 */
export function answersOnly(doc: DocModel): DocModel {
  return { ...doc, blocks: doc.blocks.map(filterBlock) };
}

function filterBlock(b: DocBlock): DocBlock {
  if (b.kind !== 'table') return b;
  const labels = b.cells.filter((c) => c.c === 0);
  if (!labels.some((c) => ANSWER_LABEL.test(compact(c.text)))) return b;
  const drop = new Set<number>();
  for (const l of labels) {
    if (!QUESTION_LABEL.test(compact(l.text))) continue;
    for (let r = l.r; r < l.r + Math.max(1, l.rowSpan); r++) drop.add(r);
  }
  if (drop.size === 0) return b;
  const cells: DocCell[] = b.cells.filter((c) => !drop.has(c.r));
  return { ...b, cells } satisfies DocTable;
}
