import { describe, expect, it } from 'vitest';
import { normalizeLine, parseQuery } from '../../src/core/search/normalize';

describe('normalizeLine', () => {
  it('공백·탭을 제거한다', () => {
    expect(normalizeLine(' 실적 \t인정 기준 ').norm).toBe('실적인정기준');
  });

  it('셀 태그를 제거하고 map이 displayLine 열을 가리킨다', () => {
    const { norm, map } = normalizeLine('[셀 1 2 rs2] 텍스트 ab');
    expect(norm).toBe('텍스트ab');
    const d = '텍스트 ab';
    expect(map).toHaveLength(norm.length);
    expect(map.map((c) => d[c])).toEqual(['텍', '스', '트', 'a', 'b']);
    expect(map[3]).toBe(4);
  });

  it('| 제거, 소문자, 전각 콜론', () => {
    expect(normalizeLine('A | B：C').norm).toBe('ab:c');
  });

  it('NFC로 합치고 합쳐진 글자의 map은 첫 조각 열', () => {
    const decomposed = '가'.normalize('NFD') + ' 나'.normalize('NFD');
    const { norm, map } = normalizeLine(decomposed);
    expect(norm).toBe('가나');
    expect(map).toEqual([0, 3]);
  });

  it('짝 없는 따옴표는 제거하고 일반 항으로 처리', () => {
    const q = parseQuery('"실적 인정');
    expect(q.phrases).toEqual([]);
    expect(q.terms).toEqual(['실적', '인정']);
  });

  it('zero-width 제거', () => {
    expect(normalizeLine('a​b').norm).toBe('ab');
  });

  it('[표 k], [p N] 줄은 빈 결과', () => {
    expect(normalizeLine('[표 1]').norm).toBe('');
    expect(normalizeLine('[p 3]').norm).toBe('');
  });
});

describe('parseQuery', () => {
  it('구문과 일반 항을 섞는다', () => {
    const q = parseQuery('"실적 인정" 경영 상태');
    expect(q.phrases).toEqual(['실적인정']);
    expect(q.terms).toEqual(['경영', '상태']);
    expect(q.raw).toBe('"실적 인정" 경영 상태');
  });

  it('1자 항은 버린다', () => {
    expect(parseQuery('a 실적').terms).toEqual(['실적']);
  });

  it('전부 1자면 terms가 빈 배열', () => {
    const q = parseQuery('가 나 다');
    expect(q.terms).toEqual([]);
    expect(q.phrases).toEqual([]);
  });
});
