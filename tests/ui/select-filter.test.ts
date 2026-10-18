import { describe, expect, it } from 'vitest';
import { matchesQuery, toChosung } from '../../src/ui/components/select-filter';

describe('toChosung', () => {
  it('한글 음절만 초성으로 바꾼다', () => {
    expect(toChosung('입찰마감일')).toBe('ㅇㅊㅁㄱㅇ');
    expect(toChosung('공고URL')).toBe('ㄱㄱURL');
  });
});

describe('matchesQuery', () => {
  it('빈 검색어는 모두 통과', () => {
    expect(matchesQuery('공고명', '')).toBe(true);
  });
  it('부분 일치, 대소문자와 공백 무시', () => {
    expect(matchesQuery('입찰 마감일', '마감')).toBe(true);
    expect(matchesQuery('공고URL', 'url')).toBe(true);
    expect(matchesQuery('입찰 마감일', '입찰마감')).toBe(true);
  });
  it('자음만 입력하면 초성으로 비교', () => {
    expect(matchesQuery('입찰마감일', 'ㅇㅊ')).toBe(true);
    expect(matchesQuery('입찰마감일', 'ㄱㄱ')).toBe(false);
  });
  it('없으면 false', () => {
    expect(matchesQuery('공고명', '수요')).toBe(false);
  });
});
