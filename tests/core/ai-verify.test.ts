import { describe, expect, it } from 'vitest';
import { quoteStrength, locateQuote, normalizeForMatch, sameValue, verifySuggestions, type VerifyContext, type VerifyFile } from '../../src/core/ai/verify';
import { coerceValue, type RawAiItem } from '../../src/core/ai/parse';

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

describe('웹 AI 복사 보정', () => {
  const rfp: VerifyFile = {
    attachmentId: 'a3', sourceFile: 'a3.hwp', name: '2. 제안요청서.hwp', docKind: 'rfp',
    text: ['[셀 2 0 rs5] 회사 유사사업 수행실적', '[셀 2 1 rs5] (해당 사업규모* 대비)', '국내외', '유사사업 수행실적** 비율', '* 25억원', '** 이행완료 기준', '[셀 2 2] 100% 이상'].join('\n'),
  };
  it('줄 앞 글머리표(* → -) 차이를 무시한다', () => {
    expect(normalizeForMatch('- 25억원')).toBe(normalizeForMatch('* 25억원'));
    expect(locateQuote(rfp.text, '- 25억원')).toMatchObject({ line: 5 });
  });
  it('AI가 억 단위를 잘못 환산하면 인용 원문의 단위 금액으로 고치고 경고한다', () => {
    const r = verifySuggestions([item({ key: 'performanceMinAmount', value: 25_000_000, quote: '- 25억원', file: '2. 제안요청서.hwp' })], ctx({ files: [rfp] }));
    expect(r.rejected).toEqual([]);
    expect(r.suggestions.performanceMinAmount).toMatchObject({ value: 2_500_000_000, valueInQuote: true, verdict: 'new' });
    expect(r.warnings.some((w) => w.includes('원문 금액'))).toBe(true);
  });
  it('항목명 줄까지 이은 여러 줄 인용도 찾는다', () => {
    const r = verifySuggestions([item({ key: 'performanceMinAmount', value: 2_500_000_000, quote: '유사사업 수행실적** 비율\n* 25억원' })], ctx({ files: [rfp] }));
    expect(r.suggestions.performanceMinAmount).toMatchObject({ value: 2_500_000_000, valueInQuote: true });
  });
  it('인용 원문에 단위 금액이 둘 이상이면 고치지 않는다(valueInQuote false)', () => {
    const two: VerifyFile = { ...rfp, text: '실적 인정 기준 10억원 또는 20억원 이상' };
    const r = verifySuggestions([item({ key: 'performanceMinAmount', value: 1_000_000, quote: '실적 인정 기준 10억원 또는 20억원 이상' })], ctx({ files: [two] }));
    expect(r.suggestions.performanceMinAmount?.value).toBe(1_000_000);
    expect(r.suggestions.performanceMinAmount?.valueInQuote).toBe(false);
  });
});

describe('금액 자릿수 보정 범위', () => {
  it('자릿수 차이가 아닌 다른 금액(3억 vs 원문 5억)은 고치지 않는다', () => {
    const r = verifySuggestions([item({ key: 'performanceMinAmount', value: 300_000_000, quote: '수행실적 | 최근 5년간 5억원 이상 실적' })], ctx());
    expect(r.suggestions.performanceMinAmount).toMatchObject({ value: 300_000_000, valueInQuote: false });
  });
});

describe('performanceCondition 글머리표', () => {
  const cond: VerifyFile = { attachmentId: 'a4', sourceFile: 'a4.hwp', name: '공고.hwp', docKind: 'rfp', text: '실적 인정 조건\n공공기관 발주 유사용역 실적\n- 단, 공동수급은 지분율만 인정' };
  it('여러 줄 값의 2번째 줄 글머리표가 원문과 같으면 통과', () => {
    const value = '공공기관 발주 유사용역 실적\n- 단, 공동수급은 지분율만 인정';
    const r = verifySuggestions([item({ key: 'performanceCondition', value, quote: value })], ctx({ files: [cond] }));
    expect(r.rejected).toEqual([]);
  });
  it('한 줄로 이어 붙인 값도 통과', () => {
    const value = '공공기관 발주 유사용역 실적 - 단, 공동수급은 지분율만 인정';
    const r = verifySuggestions([item({ key: 'performanceCondition', value, quote: '공공기관 발주 유사용역 실적\n- 단, 공동수급은 지분율만 인정' })], ctx({ files: [cond] }));
    expect(r.rejected).toEqual([]);
  });
  it('웹 AI가 기호를 바꾼 값(- → *)도 통과', () => {
    const value = '공공기관 발주 유사용역 실적\n* 단, 공동수급은 지분율만 인정';
    const r = verifySuggestions([item({ key: 'performanceCondition', value, quote: value })], ctx({ files: [cond] }));
    expect(r.rejected).toEqual([]);
  });
});

describe('표 행·긴 문단 인용 대조', () => {
  const row: VerifyFile = {
    attachmentId: 'a5', sourceFile: 'a5.hwp', name: '제안요청서.hwp', docKind: 'rfp',
    text: ['[표 1]', '[셀 0 0] 평가부문', '[셀 1 1] 경영상태', '[셀 1 2] - 신용평가등급 : 참여사 전체의 신용평가 등급으로 평가한다.', '※ 공동수급의 경우 지분율을 곱해 합산', '[셀 1 3] 4', '[셀 2 1] 회사 유사사업'].join('\n'),
  };
  it('셀 안 줄바꿈(태그 없는 줄)이 낀 표 한 행 인용을 찾는다', () => {
    const q = '경영상태 | - 신용평가등급 : 참여사 전체의 신용평가 등급으로 평가한다.\n※ 공동수급의 경우 지분율을 곱해 합산\n4';
    expect(locateQuote(row.text, q)).toMatchObject({ line: 3, endLine: 6 });
    const r = verifySuggestions([item({ key: 'managementScore', value: 4, quote: q })], ctx({ files: [row] }));
    expect(r.suggestions.managementScore).toMatchObject({ value: 4, valueInQuote: true });
  });
  it('다른 행으로 넘어가는 4줄 이상 짧은 인용은 거부한다', () => {
    expect(locateQuote(row.text, '경영상태\n신용평가등급\n4\n회사유사사업')).toBeNull();
  });
  it('긴 문단 인용(정규화 60자 이상)은 3줄을 넘어도 찾는다', () => {
    const para = ['※ 유사사업 : 다음 중 각 항목에 해당하는 수행실적 중 일정 금액 이상인 사업', '- 국내외 대민 정보서비스 제공형 시스템 구축, SW 개발', '- 국내외 농업 분야의 공공기관 대상 시스템 구축', '(단, 단순 기자재 공급, 감리, 연수 실적은 불포함)'];
    expect(locateQuote(['서문', ...para, '끝'].join('\n'), para.join('\n'))).toMatchObject({ line: 2, endLine: 5 });
  });
  it('짧은 인용은 여전히 3줄까지만', () => {
    expect(locateQuote('가나\n다라\n마바\n사아', '가나다라마바사아')).toBeNull();
  });
});

describe('표 행 판정 경계(리뷰 반영)', () => {
  it('표 마지막 행 전체의 짧은 인용은 뒤에 일반 문단이 와도 정확 일치로 허용', () => {
    const text = ['[표 1]', '[셀 3 0] 신용등급', '[셀 3 1] 15', '다음 문단은 표 밖 설명입니다'].join('\n');
    expect(locateQuote(text, '신용등급 | 15', { exactOnly: true })).toMatchObject({ line: 2, endLine: 3 });
  });
  it('셀 태그 뒤 이어진 줄은 최대 6줄까지만 같은 행으로 본다', () => {
    const text = ['[표 1]', '[셀 0 0] 가', ...Array.from({ length: 8 }, (_, i) => `줄${i}`)].join('\n');
    expect(locateQuote(text, '가줄0줄1줄2줄3줄4')).not.toBeNull();
    expect(locateQuote(text, '줄5줄6줄7')).not.toBeNull(); // 3줄 이내는 원래 허용
    expect(locateQuote(text, '줄4줄5줄6줄7')).toBeNull(); // 6줄을 넘은 뒤는 행으로 묶지 않음(짧은 4줄)
  });
  it('앞 50자만 맞는 partial 검색은 긴 범위(4줄 이상)를 허용하지 않는다', () => {
    const lines = Array.from({ length: 6 }, (_, i) => `${'가나다라마바사아자차'.slice(0, 9)}${i}`);
    const quote = `${lines.join('')}틀린꼬리부분입니다`;
    expect(locateQuote(lines.join('\n'), quote)).toBeNull();
  });
  it('| 뒤 "-2점"의 부호는 지우지 않는다', () => {
    expect(normalizeForMatch('감점 | -2점')).not.toBe(normalizeForMatch('감점 | 2점'));
    expect(normalizeForMatch('감점 | - 2점')).toBe(normalizeForMatch('감점 | 2점'));
  });
});

describe('글머리·행 조각 경계(재리뷰 반영)', () => {
  it('공백 없는 글머리("-항목", "※참고")도 지우되 숫자 부호는 둔다', () => {
    expect(normalizeForMatch('-항목')).toBe(normalizeForMatch('- 항목'));
    expect(normalizeForMatch('※참고')).toBe(normalizeForMatch('※ 참고'));
    expect(normalizeForMatch('-2점')).not.toBe(normalizeForMatch('2점'));
  });
  it('셀 안 이어진 줄에서 시작하는 조각은 정확 일치(한 행 전체)로 보지 않는다', () => {
    const text = ['[표 1]', '[셀 2 1] 가나', '다라', '마바', '사아'].join('\n');
    expect(locateQuote(text, '마바\n사아', { exactOnly: true })).toBeNull();
    expect(locateQuote(text, '가나\n다라\n마바\n사아', { exactOnly: true })).not.toBeNull();
  });
});

describe('행 압축 인용(셀 중간 줄 생략)', () => {
  const text = ['[표 1]', '[셀 1 1] 경영상태', '[셀 1 2] - 신용평가등급 : 참여사 전체의 신용평가 등급으로 평가한다.', '※ 공동수급의 경우 지분율을 곱해 합산', '[셀 1 3] 4', '[셀 2 1] 회사 유사사업', '[셀 2 3] 6'].join('\n');
  it('중간 줄을 뺀 `셀 | 셀 | 셀` 인용을 같은 행에서 찾는다', () => {
    const q = '경영상태 | - 신용평가등급 : 참여사 전체의 신용평가 등급으로 평가한다. | 4';
    expect(locateQuote(text, q)).toMatchObject({ line: 2, endLine: 5, partial: false });
    const f: VerifyFile = { attachmentId: 'a6', sourceFile: 'a6.hwp', name: '제안요청서.hwp', docKind: 'rfp', text };
    expect(verifySuggestions([item({ key: 'managementScore', value: 4, quote: q })], ctx({ files: [f] })).suggestions.managementScore).toMatchObject({ value: 4, valueInQuote: true });
  });
  it('조각이 다른 행에 걸치면 찾지 않는다', () => {
    expect(locateQuote(text, '경영상태 | 신용평가등급 | 6')).toBeNull();
  });
});

describe('v2 원문 표기 값 변환', () => {
  it('기간 "5년 이내"·"최근 5년", 금액 "5억원 이상"', () => {
    expect(coerceValue('performancePeriod', '5년 이내')).toEqual({ ok: true, value: '5년' });
    expect(coerceValue('performancePeriod', '최근 5년')).toEqual({ ok: true, value: '5년' });
    expect(coerceValue('performanceMinAmount', '5억원 이상')).toEqual({ ok: true, value: 500_000_000 });
  });
});

describe('행 조각 대조 안전장치(리뷰 반영)', () => {
  const text = ['[표 1]', '[셀 3 0] 신용평가등급', '[셀 3 1] 14', '[셀 3 2] 16'].join('\n');
  const f: VerifyFile = { attachmentId: 'a7', sourceFile: 'a7.hwp', name: '제안요청서.hwp', docKind: 'rfp', text };
  it('행 조각으로 찾았는데 값이 원문 행에 없으면 거부한다("14" 속 "4")', () => {
    const r = verifySuggestions([item({ key: 'managementScore', value: 4, quote: '신용평가등급 | 4 | 6' })], ctx({ files: [f] }));
    expect(r.suggestions.managementScore).toBeUndefined();
    expect(r.rejected.map((x) => x.key)).toEqual(['managementScore']);
  });
  it('단위 없는 "5 이내"는 기간으로 받지 않는다', () => {
    expect(coerceValue('performancePeriod', '5 이내')).not.toEqual({ ok: true, value: '5년' });
    expect(coerceValue('performancePeriod', '5')).toEqual({ ok: true, value: '5년' });
  });
});

describe('variants 검증', () => {
  const v = (condition: string, value: unknown, quote: string) => ({ condition, value, quote });
  it('통과한 variant만 남기고 실패는 <key>#<i>로 rejected, value null이면 multi', () => {
    const r = verifySuggestions([item({ key: 'performanceMinAmount', variants: [
      v('A', '5억원', '수행실적 | 최근 5년간 5억원 이상 실적'), v('B', '9억원', '문서에 전혀 없는 문장입니다 정말로'),
    ] })], ctx());
    const s = r.suggestions.performanceMinAmount!;
    expect(s).toMatchObject({ verdict: 'multi', value: null });
    expect(s.variants).toHaveLength(1);
    expect(s.variants![0]).toMatchObject({ condition: 'A', value: 500_000_000, valueInQuote: true });
    expect(r.rejected).toEqual([expect.objectContaining({ key: 'performanceMinAmount#1', reason: 'quote_not_found' })]);
  });
  it('모든 variant가 실패하면 none', () => {
    const r = verifySuggestions([item({ key: 'credibilityScore', variants: [v('A', 10, '없는 문장입니다 정말로 10점')] })], ctx());
    expect(r.suggestions.credibilityScore!.verdict).toBe('none');
    expect(r.suggestions.credibilityScore!.variants).toBeUndefined();
  });
  it('값이 있는 항목에 variants를 함께 붙이고 variant 값은 coerce한다', () => {
    const r = verifySuggestions([item({ key: 'credibilityScore', value: 10, quote: '신용평가 | 10점', variants: [v('B', '10점', '신용평가 | 10점')] })], ctx());
    expect(r.suggestions.credibilityScore).toMatchObject({ verdict: 'new', value: 10, variants: [{ value: 10 }] });
  });
  it('ruleRelation: 후보 일치 / 다름 / 후보 없음 / candidates 미지정이면 필드 없음', () => {
    const it1 = () => [item({ key: 'credibilityScore', value: 10, quote: '신용평가 | 10점' })];
    const rel = (candidates?: VerifyContext['candidates'], items = it1()) =>
      verifySuggestions(items, ctx({ candidates })).suggestions.credibilityScore!.ruleRelation;
    expect(rel({ credibilityScore: [5, 10] })).toBe('in_candidates');
    expect(rel({ credibilityScore: [5] })).toBe('differs_from_candidates');
    expect(rel({ credibilityScore: [] })).toBe('no_candidates');
    expect(rel(undefined)).toBeUndefined();
    const multi = [item({ key: 'credibilityScore', variants: [v('A', 10, '신용평가 | 10점')] })];
    expect(rel({ credibilityScore: [10] }, multi)).toBe('in_candidates');
    const two = [item({ key: 'credibilityScore', value: 10, quote: '신용평가 | 10점', variants: [v('A', 15, '경영상태 평가 15점')] })];
    expect(rel({ credibilityScore: [10] }, two)).toBe('differs_from_candidates');
  });
});

describe('공고 잎 검증', () => {
  const NT = '[p 1]\n공고일시 : 2026. 10. 21.(수) 14:00\n공동수급 : 공동이행방식 허용\n예정가격 결정방법 : 복수예비가격 추첨';
  const nf: VerifyFile = { attachmentId: 'n1', sourceFile: 'n1.hwp', name: '공고문.hwp', docKind: 'notice', text: NT };
  const nctx = (over: Partial<VerifyContext> = {}): VerifyContext => ctx({ files: [nf], requested: ['postedAt', 'jointVentureAllowed', 'priceMethod'], ...over });

  it('datetime: 기준값과 분 단위가 같으면 match, raw 기록', () => {
    const r = verifySuggestions([item({ key: 'postedAt', value: '2026. 10. 21.(수) 14:00', quote: '공고일시 : 2026. 10. 21.(수) 14:00' })], nctx({ baseline: { postedAt: '2026-10-21T14:00:30+09:00' } }));
    expect(r.rejected).toEqual([]);
    expect(r.suggestions.postedAt).toMatchObject({ value: '2026-10-21T14:00:00+09:00', verdict: 'match', valueInQuote: true, raw: '2026. 10. 21.(수) 14:00' });
  });
  it('text: 포함 관계면 match', () => {
    const r = verifySuggestions([item({ key: 'priceMethod', value: '복수예비가격 추첨', quote: '예정가격 결정방법 : 복수예비가격 추첨' })], nctx({ baseline: { priceMethod: '복수예비가격' } }));
    expect(r.suggestions.priceMethod).toMatchObject({ verdict: 'match' });
  });
  it('joint: 값 true, raw 기록, 인용에 관련 단어가 없으면 거부', () => {
    const ok = verifySuggestions([item({ key: 'jointVentureAllowed', value: '공동이행방식 허용', quote: '공동수급 : 공동이행방식 허용' })], nctx());
    expect(ok.suggestions.jointVentureAllowed).toMatchObject({ value: true, raw: '공동이행방식 허용', verdict: 'new', valueInQuote: true });
    const bad = verifySuggestions([item({ key: 'jointVentureAllowed', value: '공동이행방식 허용', quote: '예정가격 결정방법 : 복수예비가격 추첨' })], nctx());
    expect(bad.suggestions.jointVentureAllowed).toMatchObject({ valueInQuote: false });
    const short = verifySuggestions([item({ key: 'jointVentureAllowed', value: '공동이행방식 허용', quote: '복수예비가격' })], nctx());
    expect(short.suggestions).toEqual({});
    expect(short.rejected[0]).toMatchObject({ key: 'jointVentureAllowed' });
  });
});

describe('sameValue', () => {
  it('문서 잎 text(실적 인정조건)는 포함 관계여도 다른 값', () => {
    expect(sameValue('performanceCondition', '유사 용역 실적', '유사 용역 실적(하도급 제외)')).toBe(false);
    expect(sameValue('performanceCondition', '유사 용역 실적', '유사용역 실적')).toBe(true);
  });
  it('공고 잎 text는 포함 관계(짧은 쪽 4자 이상)면 같은 값', () => {
    expect(sameValue('evalMethod', '협상에 의한 계약', '협상에 의한 계약(기술 80, 가격 20)')).toBe(true);
    expect(sameValue('evalMethod', '협상', '협상에 의한 계약')).toBe(false);
  });
  it('datetime은 분 단위 같으면 같은 값', () => {
    expect(sameValue('postedAt', '2026-10-21T14:00:00+09:00', '2026-10-21T05:00:30Z')).toBe(true);
  });
});
