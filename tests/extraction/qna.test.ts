import { describe, expect, it } from 'vitest';
import type { DocCell, DocModel, DocTable } from '../../src/core/doc/model';
import { answersOnly } from '../../src/core/extraction/qna';

const cell = (r: number, c: number, text: string, rowSpan = 1): DocCell => ({ r, c, rowSpan, colSpan: 1, text, blocks: [], loc: { block: 0, line: r } });
const table = (cells: DocCell[]): DocTable => ({ kind: 'table', index: 0, rows: 6, cols: 2, cells, loc: { block: 0 } });
const doc = (t: DocTable): DocModel => ({ format: 'hwp5', blocks: [t], warnings: [], stats: { chars: 0, tables: 1, ms: 0 } });
const rowsOf = (d: DocModel) => [...new Set((d.blocks[0] as DocTable).cells.map((c) => c.r))];

describe('answersOnly', () => {
  it('답변 행이 있는 표에서 번호/질의 라벨 행을 뺀다(rowSpan 포함)', () => {
    const t = table([
      cell(0, 0, 'No.'), cell(0, 1, '세부 질의 내용'),
      cell(1, 0, '1'), cell(1, 1, '실적 인정범위 확대 요청'),
      cell(2, 0, '답변'), cell(2, 1, '제안요청서 기준을 적용'),
      cell(3, 0, '질 의', 2), cell(3, 1, '질문 앞부분'), cell(4, 1, '질문 뒷부분'),
      cell(5, 0, '회신'), cell(5, 1, '원안 유지'),
    ]);
    expect(rowsOf(answersOnly(doc(t)))).toEqual([0, 2, 5]);
  });
  it('답변 라벨이 없는 표는 그대로 둔다', () => {
    const t = table([cell(0, 0, '1'), cell(0, 1, '평가 항목'), cell(1, 0, '2'), cell(1, 1, '배점')]);
    expect(answersOnly(doc(t)).blocks[0]).toBe(t);
  });
  it('남은 셀은 같은 객체라 renderText로 채운 줄 번호가 유지된다', () => {
    const answer = cell(2, 1, '답');
    const t = table([cell(1, 0, '1'), cell(1, 1, '질문'), cell(2, 0, '답변'), answer]);
    expect((answersOnly(doc(t)).blocks[0] as DocTable).cells).toContain(answer);
  });
});
