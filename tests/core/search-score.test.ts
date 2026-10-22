import { describe, expect, it } from 'vitest';
import { questionTerms, scoreUnit } from '../../src/core/search/score';

describe('questionTerms', () => {
  it('끝의 조사·의문 어미를 떼고 불용어 항은 버린다', () => {
    const qt = questionTerms('사업기간은 언제까지인가요?');
    expect(qt.terms).toEqual(['사업기간']);
  });
  it('bigram은 질문 전체(정규화) 기준', () => {
    const qt = questionTerms('입찰 보증금');
    expect(qt.bigrams.has('입찰')).toBe(true);
    expect(qt.bigrams.has('찰보')).toBe(true);
    expect(qt.bigrams.has('보증')).toBe(true);
  });
  it('1자 어미는 남는 길이가 3자 이상일 때만 뗀다(예정가·공급가·사전협의 보존)', () => {
    expect(questionTerms('예정가 공급가 사전협의').terms).toEqual(['예정가', '공급가', '사전협의']);
    expect(questionTerms('입찰보증금이 얼마인가요').terms).toEqual(['입찰보증금']);
    expect(questionTerms('사업기간은 언제까지인가요?').terms).toEqual(['사업기간']);
  });
  it('1자 어미도 남는 길이가 2자 이상이면 뗀다', () => {
    expect(questionTerms('기간은 언제야').terms).toContain('기간');
    expect(questionTerms('금액이 얼마야').terms).toContain('금액');
    expect(questionTerms('자격은 뭐야').terms).toContain('자격');
  });
  it('2자 미만 항은 버린다', () => {
    expect(questionTerms('가 나').terms).toEqual([]);
  });
});

describe('scoreUnit', () => {
  const qt = questionTerms('입찰보증금 면제');
  it('항 적중 가중치가 bigram 겹침보다 크다', () => {
    const termHit = scoreUnit('입찰보증금을납부한다' + 'x'.repeat(40), qt);
    const bigramOnly = scoreUnit('보증서류' + 'x'.repeat(40), qt);
    expect(termHit).toBeGreaterThan(bigramOnly);
    expect(bigramOnly).toBeGreaterThan(0);
  });
  it('적중이 없으면 0(짧은 줄이어도 머리글 가산 없음)', () => {
    expect(scoreUnit('zzzz', qt)).toBe(0);
  });
  it('짧은 줄(30자 이하)은 머리글 가산 1', () => {
    const short = scoreUnit('입찰보증금면제', qt);
    const long = scoreUnit('입찰보증금면제' + 'x'.repeat(40), qt);
    expect(short - long).toBe(1);
  });
});
