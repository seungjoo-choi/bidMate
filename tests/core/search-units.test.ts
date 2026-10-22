import { describe, expect, it } from 'vitest';
import { buildUnits } from '../../src/core/search/units';

describe('buildUnits', () => {
  it('문단 줄은 line 유닛', () => {
    const u = buildUnits(['첫 줄', '둘째 줄']);
    expect(u).toHaveLength(2);
    expect(u[0]).toMatchObject({ kind: 'line', start: 0, end: 0, lines: [0], norm: '첫줄' });
    expect(u[1]).toMatchObject({ kind: 'line', start: 1, lines: [1] });
  });

  it('[표 1]과 셀 3개 2행은 row 유닛 2개, 이어진 줄 포함', () => {
    const lines = [
      '[표 1]',
      '[셀 0 0] 구분',
      '[셀 0 1] 내용',
      '[셀 1 0] 자격',
      '이어진 줄',
      '[셀 1 1] 실적',
    ];
    const u = buildUnits(lines);
    expect(u).toHaveLength(2);
    expect(u[0]).toMatchObject({ kind: 'row', lines: [1, 2], norm: '구분내용' });
    expect(u[1]).toMatchObject({ kind: 'row', start: 3, end: 5, lines: [3, 4, 5], norm: '자격이어진줄실적' });
    expect(u[1]!.map.map((m) => m.line)).toEqual([3, 3, 4, 4, 4, 4, 5, 5]);
  });

  it('[p 3] 줄과 빈 줄은 유닛이 없다', () => {
    expect(buildUnits(['[p 3]', '', '   ', '본문'])).toHaveLength(1);
  });
});
