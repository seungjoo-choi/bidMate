import { describe, expect, it } from 'vitest';
import { VARIABLES, variablesFor } from '../../src/core/templates/variables';
import { findVariableQuery, matchVariables } from '../../src/entrypoints/dashboard/templates/variable-suggest';

describe('findVariableQuery', () => {
  it('커서 바로 앞의 { 를 찾는다', () => {
    expect(findVariableQuery('안녕 {', 4)).toEqual({ start: 3, query: '' });
    expect(findVariableQuery('안녕 {입찰', 6)).toEqual({ start: 3, query: '입찰' });
  });
  it('닫힌 변수나 공백이 끼면 null', () => {
    expect(findVariableQuery('{공고명} 입니다', 9)).toBeNull();
    expect(findVariableQuery('{공고 명', 5)).toBeNull();
    expect(findVariableQuery('괄호 없음', 5)).toBeNull();
  });
  it('커서 뒤 글자는 보지 않는다', () => {
    expect(findVariableQuery('{공고}', 3)).toEqual({ start: 0, query: '공고' });
  });
});

describe('matchVariables', () => {
  it('빈 입력어면 해당 종류 전체', () => {
    expect(matchVariables('', 'bid')).toHaveLength(variablesFor('bid').length);
  });
  it('bid에서는 사전규격 변수가 나오지 않는다', () => {
    const names = matchVariables('', 'bid').map((d) => d.name);
    const prespecOnly = VARIABLES.filter((d) => !d.kinds.includes('bid')).map((d) => d.name);
    expect(prespecOnly.length).toBeGreaterThan(0);
    for (const n of prespecOnly) expect(names).not.toContain(n);
  });
  it('prespec에서는 공용 변수와 사전규격 변수만 나온다', () => {
    const got = matchVariables('', 'prespec');
    expect(got.length).toBeGreaterThan(0);
    expect(got.every((d) => d.kinds.includes('prespec'))).toBe(true);
    expect(got.map((d) => d.name)).toEqual(variablesFor('prespec').map((d) => d.name));
  });
  it('시작 일치를 포함 일치보다 앞에 둔다', () => {
    const names = matchVariables('입찰').map((d) => d.name);
    expect(names.slice(0, 2)).toEqual(['입찰시작일', '입찰마감일']);
  });
  it('영문은 대소문자를 가리지 않는다', () => {
    expect(matchVariables('url').map((d) => d.name)).toContain('공고URL');
  });
  it('없으면 빈 배열', () => {
    expect(matchVariables('없는변수')).toEqual([]);
  });
});
