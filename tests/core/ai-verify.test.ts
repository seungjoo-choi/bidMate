import { describe, expect, it } from 'vitest';
import { quoteStrength, locateQuote, normalizeForMatch, verifySuggestions, type VerifyContext, type VerifyFile } from '../../src/core/ai/verify';
import type { RawAiItem } from '../../src/core/ai/parse';

const TEXT = [
  '[p 1]', '서문입니다', '[p 2]', '평가항목',
  '[표 1]', '[셀 0 0] 신 용 평 가', '[셀 0 1] 10점', '[셀 1 0] 수행실적', '[셀 1 1] 최근 5년간 5억원 이상 실적',
  '차등점수제를 적용한다',
].join('\n');
const f1: VerifyFile = { attachmentId: 'a1', sourceFile: 'a1.hwp', name: '제안요청서.hwp', docKind: 'rfp', text: TEXT };
const f2: VerifyFile = { attachmentId: 'a2', sourceFile: 'a2.pdf', name: '평가기준.pdf', docKind: 'eval_criteria', text: '[p 7]\n경영상태 평가 15점' };
const item = (o: Partial<RawAiItem> & { key: string }): RawAiItem => ({ value: null, quote: '', file: null, page: null, ...o });
const ctx = (over: Partial<VerifyContext> = {}): VerifyContext => ({
  files: [f1, f2], baseline: {}, requested: ['credibilityScore', 'managementScore', 'performanceScore', 'performancePeriod', 'performanceMinAmount', 'performanceCondition', 'differentialScoring'],
  provider: 'gemini', promptVersion: '1.0.0', ...over,
});

describe('normalizeForMatch / locateQuote', () => {
  it('셀 태그·공백·|·표/쪽 태그 차이를 무시한다', () => {
    expect(normalizeForMatch('[셀 0 1 rs2] 신 용 | 평가')).toBe('신용평가');
    expect(normalizeForMatch('[표 3]')).toBe('');
    expect(normalizeForMatch('[p 4]')).toBe('');
    expect(locateQuote(TEXT, '신용평가 | 10점')).not.toBeNull();
    expect(locateQuote(TEXT, '신용   평가')).not.toBeNull();
  });
  it('줄(1부터)과 쪽을 계산한다', () => {
    expect(locateQuote(TEXT, '수행실적')).toMatchObject({ line: 8, endLine: 8, page: 2, partial: false });
    expect(locateQuote(TEXT, '서문입니다')).toMatchObject({ line: 2, page: 1, partial: false });
    expect(locateQuote('쪽 없음 줄', '쪽 없음')).toMatchObject({ line: 1, page: null, partial: false });
  });
  it('미매치는 null', () => {
    expect(locateQuote(TEXT, '존재하지않는문장')).toBeNull();
    expect(locateQuote(TEXT, '   ')).toBeNull();
  });
  it('50자 넘는 quote가 실패하면 앞 50자로 재시도(partial)', () => {
    const head = '가'.repeat(50);
    const text = `${head}진짜뒤\n다른줄`;
    expect(locateQuote(text, `${head}틀린뒤`)).toMatchObject({ line: 1, page: null, partial: true });
    expect(locateQuote(text, `${head.slice(1)}나`.repeat(2))).toBeNull();
  });
});

describe('verifySuggestions', () => {
  it('셀 태그·공백 차이에도 매치하고 evidence를 만든다', () => {
    const r = verifySuggestions([item({ key: 'credibilityScore', value: 10, quote: '신용평가 | 10점', file: '제안요청서.hwp' })], ctx());
    const s = r.suggestions.credibilityScore!;
    expect(r.rejected).toEqual([]);
    expect(s.evidence).toMatchObject({ attachmentId: 'a1', sourceFile: 'a1.hwp', page: 2, line: 6, location: 'line 6', ruleId: 'ai:gemini:1.0.0', docKind: 'rfp' });
    expect(s).toMatchObject({ file: '제안요청서.hwp', page: 2, verdict: 'new', valueInQuote: true });
  });
  it('미매치 거부(quote_not_found)', () => {
    const r = verifySuggestions([item({ key: 'credibilityScore', value: 10, quote: '없는 문장입니다 정말로 10점' })], ctx());
    expect(r.suggestions).toEqual({});
    expect(r.rejected).toEqual([{ key: 'credibilityScore', reason: 'quote_not_found', value: 10, quote: '없는 문장입니다 정말로 10점' }]);
  });
  it('파일명 불일치면 다른 파일에서 찾고 warning만 남긴다', () => {
    const r = verifySuggestions([item({ key: 'managementScore', value: 15, quote: '경영상태 평가 15점', file: '엉뚱한.hwp' })], ctx());
    expect(r.suggestions.managementScore).toMatchObject({ file: '평가기준.pdf', page: 7 });
    expect(r.warnings.some((w) => w.includes('엉뚱한.hwp'))).toBe(true);
    const partialName = verifySuggestions([item({ key: 'managementScore', value: 15, quote: '경영상태 평가 15점', file: '기준.pdf' })], ctx());
    expect(partialName.suggestions.managementScore!.file).toBe('평가기준.pdf');
    expect(partialName.warnings).toEqual([]);
  });
  it('partial: 원문 앞 50자 일치 + 원문 그 줄에 값이 있으면 허용(warning)', () => {
    const long = `가나다라마바사아자차${'카'.repeat(40)}`;
    const files = [{ ...f1, text: `${long}끝 배점 15점` }];
    const r = verifySuggestions([item({ key: 'performanceScore', value: 15, quote: `${long}끝 배점 15점 그리고 다른 말`, file: '제안요청서.hwp' })], ctx({ files }));
    expect(r.suggestions.performanceScore).toMatchObject({ valueInQuote: true });
    expect(r.warnings.some((w) => w.includes('partial'))).toBe(true);
  });
  it('partial: 원문 50자+ 문장 뒤에 " 배점 15점"을 붙인 quote는 거부', () => {
    const long = `가나다라마바사아자차${'카'.repeat(40)}`;
    const files = [{ ...f1, text: `${long}끝` }];
    const r = verifySuggestions([item({ key: 'performanceScore', value: 15, quote: `${long}끝 배점 15점`, file: '제안요청서.hwp' })], ctx({ files }));
    expect(r.suggestions).toEqual({});
    expect(r.rejected.map((x) => x.reason)).toEqual(['quote_not_found']);
  });
  it('performanceCondition: partial 불가, value가 파일 텍스트에 있어야 한다', () => {
    const long = `가나다라마바사아자차${'카'.repeat(40)}`;
    const files = [{ ...f1, text: `${long}끝` }];
    const partial = verifySuggestions([item({ key: 'performanceCondition', value: `${long}끝`, quote: `${long}다른끝`, file: '제안요청서.hwp' })], ctx({ files }));
    expect(partial.rejected.map((x) => x.reason)).toEqual(['quote_not_found']);
    const noValue = verifySuggestions([item({ key: 'performanceCondition', value: '원문에 없는 조건 문장', quote: `${long}끝` })], ctx({ files }));
    expect(noValue.rejected.map((x) => x.reason)).toEqual(['quote_not_found']);
    const ok = verifySuggestions([item({ key: 'performanceCondition', value: '최근 5년간 5억원 이상 실적', quote: '최근 5년간 5억원 이상 실적' })], ctx());
    expect(ok.suggestions.performanceCondition).toBeDefined();
  });
  it('최소 근거: 글자 2자 미만은 항상 quote_too_short, 짧은 quote는 한 줄/표 한 행 전체와 같을 때만 허용', () => {
    const files = [{ ...f1, text: ['2026.10.15 공고', '배점 10점과 그 밖의 긴 설명이 이어지는 줄입니다', '[표 2]', '[셀 0 0] 신용평가', '[셀 0 1] 10', '[셀 1 0] 경영상태', '[셀 1 1] 15'].join('\n') }];
    const run = (key: string, value: unknown, quote: string) => verifySuggestions([item({ key, value, quote })], ctx({ files }));
    expect(run('performanceScore', 15, '15').rejected.map((x) => x.reason)).toEqual(['quote_too_short']);
    expect(run('performanceScore', 10, '배점 10').rejected.map((x) => x.reason)).toEqual(['quote_too_short']);
    expect(run('credibilityScore', 10, '신용평가 10').suggestions.credibilityScore).toMatchObject({ value: 10, valueInQuote: true });
    // 한 줄(셀) 전체와 같아도 짧은 인용에 값이 없으면 근거가 아니다
    expect(run('credibilityScore', 10, '신용평가').rejected.map((x) => x.reason)).toEqual(['quote_too_short']);
    expect(run('credibilityScore', null, '신용평가').suggestions.credibilityScore).toMatchObject({ verdict: 'none' });
    expect(run('credibilityScore', 10, '').rejected.map((x) => x.reason)).toEqual(['quote_missing']);
    expect(quoteStrength('15')).toBe('too_short');
    expect(quoteStrength('신용평가 | 10점')).toBe('exact_only');
    expect(quoteStrength('신용평가 10점입니다')).toBe('long');
  });
  it('평가표 행 "신용평가 | 10점" quote 허용', () => {
    const r = verifySuggestions([item({ key: 'credibilityScore', value: 10, quote: '신용평가 | 10점' })], ctx());
    expect(r.rejected).toEqual([]);
    expect(r.suggestions.credibilityScore).toMatchObject({ value: 10, valueInQuote: true, verdict: 'new' });
    const part = verifySuggestions([item({ key: 'credibilityScore', value: 10, quote: '신용평가 | 10' })], ctx());
    expect(part.rejected.map((x) => x.reason)).toEqual(['quote_too_short']);
  });
  it('줄 넘김: 3줄까지 매치, 4줄 이상은 거부, 같은 표 행 셀 5개는 허용', () => {
    const text = ['앞 줄 끝 신용평가', '15일 이내 제출', '셋째 줄 내용', '넷째 줄 내용'].join('\n');
    expect(locateQuote(text, '앞 줄 끝 신용평가 15일 이내 제출 셋째 줄 내용')).toMatchObject({ line: 1, endLine: 3 });
    expect(locateQuote(text, '앞 줄 끝 신용평가 15일 이내 제출 셋째 줄 내용 넷째 줄 내용')).toBeNull();
    const row = ['[표 1]', ...[0, 1, 2, 3, 4].map((c) => `[셀 2 ${c}] 항목${c}설명`), '[셀 3 0] 다음행설명'].join('\n');
    expect(locateQuote(row, '항목0설명 | 항목1설명 | 항목2설명 | 항목3설명 | 항목4설명')).toMatchObject({ line: 2, endLine: 6 });
    expect(locateQuote(row, '항목4설명 | 다음행설명')).toMatchObject({ line: 6, endLine: 7 });
    expect(locateQuote(row, '항목0설명 | 항목1설명 | 항목2설명 | 항목3설명 | 항목4설명 | 다음행설명')).toBeNull();
  });
  it('같은 key 중복은 첫 항목만(첫 항목이 거부돼도 두 번째는 쓰지 않음)', () => {
    const r = verifySuggestions([
      item({ key: 'credibilityScore', value: 10, quote: '없는 문장입니다 정말로' }),
      item({ key: 'credibilityScore', value: 10, quote: '신용평가 | 10점' }),
    ], ctx());
    expect(r.suggestions).toEqual({});
    expect(r.rejected.map((x) => x.reason)).toEqual(['quote_not_found']);
    expect(r.warnings.some((w) => w.includes('여러 번'))).toBe(true);
  });
  it('요청 밖 key는 unknown_key', () => {
    const r = verifySuggestions([item({ key: 'foo', value: 1, quote: '수행실적 | 최근 5년간 5억원 이상 실적' }), item({ key: 'credibilityScore', value: 1, quote: '10점' })], ctx({ requested: ['managementScore'] }));
    expect(r.rejected.map((x) => [x.key, x.reason])).toEqual([['foo', 'unknown_key'], ['credibilityScore', 'unknown_key']]);
  });
  it('bad_format: 형식 오류, quote 600자 초과', () => {
    const r = verifySuggestions([
      item({ key: 'credibilityScore', value: 5000, quote: '10점' }),
      item({ key: 'performanceCondition', value: '조건', quote: '가'.repeat(601) }),
    ], ctx());
    expect(r.rejected.map((x) => x.reason)).toEqual(['bad_format', 'bad_format']);
  });
  it('quote_missing', () => {
    const r = verifySuggestions([item({ key: 'credibilityScore', value: 10, quote: '  ' })], ctx());
    expect(r.rejected.map((x) => x.reason)).toEqual(['quote_missing']);
  });
  it('value null은 none(quote 없어도, 못 찾아도 통과)', () => {
    const r = verifySuggestions([item({ key: 'credibilityScore' }), item({ key: 'managementScore', quote: '못찾는문장' }), item({ key: 'performanceScore', quote: '수행실적 | 최근 5년간 5억원 이상 실적' })], ctx());
    expect(r.rejected).toEqual([]);
    expect(r.suggestions.credibilityScore).toMatchObject({ verdict: 'none', value: null });
    expect(r.suggestions.managementScore!.evidence).toBeUndefined();
    expect(r.suggestions.performanceScore!.evidence).toBeDefined();
  });
  it('verdict 4종: new / match / differs / none', () => {
    const r = verifySuggestions([
      item({ key: 'credibilityScore', value: 10, quote: '신용평가 | 10점' }),
      item({ key: 'performancePeriod', value: '5년', quote: '수행실적 | 최근 5년간 5억원 이상 실적' }),
      item({ key: 'performanceMinAmount', value: 500_000_000, quote: '수행실적 | 최근 5년간 5억원 이상 실적' }),
      item({ key: 'managementScore' }),
    ], ctx({ baseline: { performancePeriod: '5년', performanceMinAmount: 300_000_000 } }));
    expect(r.suggestions.credibilityScore!.verdict).toBe('new');
    expect(r.suggestions.performancePeriod!.verdict).toBe('match');
    expect(r.suggestions.performanceMinAmount).toMatchObject({ verdict: 'differs', baseline: 300_000_000 });
    expect(r.suggestions.managementScore!.verdict).toBe('none');
  });
  it('valueInQuote: 매치된 원문 줄 기준, 종류별', () => {
    const v = (key: string, value: unknown, quote: string) => verifySuggestions([item({ key, value, quote })], ctx()).suggestions[key as 'credibilityScore']!.valueInQuote;
    const q1 = '신용평가 | 10점';
    const q2 = '수행실적 | 최근 5년간 5억원 이상 실적';
    expect(v('credibilityScore', 10, q1)).toBe(true);
    // 짧은 인용(exact_only)에 값이 없으면 경고가 아니라 거부
    expect(verifySuggestions([item({ key: 'credibilityScore', value: 20, quote: q1 })], ctx()).rejected.map((x) => x.reason)).toEqual(['quote_too_short']);
    expect(v('performancePeriod', '5년', q2)).toBe(true);
    expect(v('performancePeriod', '3년', q2)).toBe(false);
    expect(v('performanceMinAmount', 500_000_000, q2)).toBe(true);
    expect(v('performanceMinAmount', 300_000_000, q2)).toBe(false);
    expect(v('differentialScoring', true, '차등점수제를 적용한다')).toBe(true);
    expect(verifySuggestions([item({ key: 'differentialScoring', value: true, quote: q1 })], ctx()).rejected.map((x) => x.reason)).toEqual(['quote_too_short']);
    expect(v('performanceCondition', '최근 5년간 5억원 이상 실적', q2)).toBe(true);
  });
  it('금액: 점이 천 단위 구분자인 표기는 후보에서 제외', () => {
    const files = [{ ...f1, text: '계약금액이 5.000.000 원 이상인 실적입니다' }];
    const r = verifySuggestions([item({ key: 'performanceMinAmount', value: 5_000_000, quote: '계약금액이 5.000.000 원 이상인 실적입니다' })], ctx({ files }));
    expect(r.suggestions.performanceMinAmount!.valueInQuote).toBe(false);
  });
});
