import { describe, expect, it } from 'vitest';
import { compact, parseKoreanAmount, parseYears } from '../../src/core/extraction/normalize';

describe('compact', () => {
  it('공백/널/전각 콜론을 정규화한다', () => {
    expect(compact('차등점수제 : 미적용')).toBe('차등점수제:미적용');
    expect(compact('차등\u0000점수제：미적용')).toBe('차등점수제:미적용');
  });
});

describe('parseKoreanAmount', () => {
  it.each([
    ['5억원', 500000000],
    ['5억 5천만원', 550000000],
    ['500,000,000원', 500000000],
    ['3천만원', 30000000],
    ['1.5억원', 150000000],
    ['15억원', 1500000000],
    ['이상', null],
  ])('%s', (s, v) => {
    expect(parseKoreanAmount(s)).toBe(v);
  });
});

describe('parseYears', () => {
  it('연수를 읽는다', () => {
    expect(parseYears('5년')).toBe(5);
    expect(parseYears('최근 3년간')).toBe(3);
  });
});
