import { describe, expect, it } from 'vitest';
import { buildTextBlocks, displayLine, evidenceSpan } from '../../src/ui/review/text-view';

const doc = [
  '머리 문단',          // 0
  '[표 3]',             // 1
  '[셀 0 0] 구분',      // 2
  '[셀 0 1 cs2] 서류',  // 3
  '[셀 1 0 rs2] 민간',  // 4
  '[셀 1 1] 유',        // 5
  '[셀 1 2] ①발주처',   // 6
  '②계약서',            // 7 셀 안 줄바꿈
  '[셀 2 1] 무',        // 8
  '[셀 2 2]',           // 9
  '꼬리 1',             // 10
  '꼬리 2',             // 11
  '뒤 문단',            // 12
  '[p 2]',              // 13
  '끝',                 // 14
];

describe('buildTextBlocks', () => {
  const blocks = buildTextBlocks(doc);
  it('표를 행/셀로 묶고 셀 사이 평문은 앞 셀에 붙인다', () => {
    const t = blocks.find((b) => b.kind === 'table');
    expect(t).toMatchObject({ start: 1, end: 11 });
    if (t?.kind !== 'table') throw new Error();
    expect(t.rows.map((r) => r.length)).toEqual([2, 3, 2]);
    expect(t.rows[0]![1]).toMatchObject({ colSpan: 2, lines: [3] });
    expect(t.rows[1]![0]).toMatchObject({ rowSpan: 2 });
    expect(t.rows[1]![2]!.lines).toEqual([6, 7]);
    expect(t.rows[2]![1]!.lines).toEqual([9, 10, 11]); // 마지막 셀 뒤 2줄까지
  });
  it('표 뒤 3번째 평문부터는 일반 줄, 쪽 표시는 page 블록', () => {
    expect(blocks.filter((b) => b.kind !== 'table')).toEqual([
      { kind: 'line', i: 0 }, { kind: 'line', i: 12 }, { kind: 'page', i: 13, page: '2' }, { kind: 'line', i: 14 },
    ]);
  });
  it('셀 순서가 뒤로 가면 다른 표로 나눈다', () => {
    const b = buildTextBlocks(['[셀 0 0] a', '[셀 0 1] b', '[셀 0 0] c']);
    expect(b.map((x) => x.kind)).toEqual(['table', 'table']);
  });
});

describe('displayLine', () => {
  it('태그를 뗀다', () => {
    expect(displayLine('[셀 8 1 rs2] 민간부문')).toBe('민간부문');
    expect(displayLine('[표 3]')).toBe('');
    expect(displayLine('평문')).toBe('평문');
  });
});

describe('evidenceSpan', () => {
  const ls = ['가', '※ 유사사업 : 다음 중 각 항목에', '해당하는 수행실적 중 5억원 이상인 사업', '다음'];
  it('원문이 걸친 줄 전체', () => {
    expect(evidenceSpan(ls, 2, '※ 유사사업 : 다음 중 각 항목에 해당하는 수행실적 중 5억원 이상인 사업')).toEqual([1, 2]);
  });
  it('기준 줄이 어긋나도 원문 앞부분으로 찾는다', () => {
    expect(evidenceSpan(ls, 4, '해당하는 수행실적 중 5억원')).toEqual([2, 2]);
  });
  it('원문이 없으면 기준 줄, 둘 다 없으면 null', () => {
    expect(evidenceSpan(ls, 1, '없는 문장입니다 정말로')).toEqual([0, 0]);
    expect(evidenceSpan(ls, undefined, undefined)).toBeNull();
  });
});
