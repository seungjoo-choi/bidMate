import { describe, expect, it } from 'vitest';
import { containment, dice, normalizeText, numberTokens, stripFormat } from '../../../src/core/rfp/normalize';

describe('normalizeText', () => {
  it('줄머리 글머리를 떼고 끝 마침표를 지운다', () => {
    expect(normalizeText('ㅇ 시스템을 구축한다.')).toBe('시스템을 구축한다');
    expect(normalizeText('o 시스템을 구축한다')).toBe('시스템을 구축한다');
    expect(normalizeText('- 시스템을 구축한다')).toBe('시스템을 구축한다');
    expect(normalizeText('□ 시스템을 구축한다')).toBe('시스템을 구축한다');
  });
  it('여러 줄은 줄마다 글머리를 뗀다', () => {
    expect(normalizeText('ㅇ 가나다\n- 라마바')).toBe('가나다\n라마바');
  });
});

describe('stripFormat', () => {
  it('띄어쓰기·문장부호 차이를 지운다', () => {
    expect(stripFormat('시스템 의 무 , 이행.')).toBe(stripFormat('시스템의무 이행'));
  });
});

describe('dice', () => {
  it('같은 문자열은 1', () => {
    expect(dice('사용자 로그인 기능', '사용자 로그인 기능')).toBe(1);
  });
  it('전혀 다른 문자열은 0에 가깝다', () => {
    expect(dice('사용자 로그인 기능', '백업 저장소 구축')).toBeLessThan(0.2);
  });
  it('공백만 다르면 1', () => {
    expect(dice('사용자 로그인 기능', '사용자로그인기능')).toBe(1);
  });
});

describe('containment', () => {
  it('짧은 문장이 긴 문장에 포함되면 ≥0.9', () => {
    const part = '시스템은 사용자 인증을 지원해야 한다';
    const whole = '본 사업의 시스템은 사용자 인증을 지원해야 한다. 또한 접근 이력을 기록하고 관리자에게 보고해야 한다.';
    expect(containment(part, whole)).toBeGreaterThanOrEqual(0.9);
  });
});

describe('numberTokens', () => {
  it('숫자+단위 토큰', () => {
    const t = numberTokens('응답 3초, 1,000명');
    expect(t.has('3초')).toBe(true);
    expect(t.has('1000명')).toBe(true);
  });
});
