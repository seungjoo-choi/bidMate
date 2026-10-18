import { describe, expect, it } from 'vitest';
import rules from '../../src/core/extraction/rules/default-rules.json';
import { compact, parseKoreanAmount } from '../../src/core/extraction/normalize';

// 리뷰어가 실측한 오탐/누락 사례를 고정한다(compact 텍스트 기준, 첫 매치 채택).
const pat = (id: string, key: 'pattern' | 'anchor') => {
  const r = (rules.rules as Array<Record<string, unknown>>).find((x) => x.id === id)!;
  return new RegExp(r[key] as string);
};

describe('diff.enum', () => {
  const re = pat('diff.enum', 'pattern');
  const map = (rules.rules as Array<Record<string, unknown>>).find((x) => x.id === 'diff.enum')!.map as Record<string, boolean>;
  const val = (s: string) => { const m = re.exec(compact(s)); return m ? map[m.groups!.v!] : undefined; };
  it.each([
    ['차등점수제 : 미적용', false],
    ['차등점수제 적용 여부 : 미적용', false],
    ['차등점수제 미적용, 단 가격평가는 적용', false],
    ['차등점수제 해당없음(협상에 의한 계약 적용)', false],
    ['차등점수제 적용 제외', false],
    ['차등점수제 적용하지 않음', false],
    ['차등점수제: 적용 (중소기업 우대)', true],
    ['차등점수제 적용', true],
    ['차등점수제(적용/미적용) : 적용', true],
    ['차등점수제(적용/미적용) : 미적용', false],
    // 축산물품질평가원 공고 실측
    ['정성평가 시 차등 점수제(배점3점) 적용', true],
    ['제안서 정성평가 시 차등점수제(배점3점) 적용(적용근거 : 조달청 협상에 의한 계약 제안서평가 세부기준 제9조제10항)', true],
    ['본 사업 기술평가는 차등점수제(2점)를 적용하지 않음', false],
    ['「협상에 의한 계약체결 기준」제7조제6항에 따른 차등점수제를 미적용한 사업임', false],
    ['지침」 제4조제5항에 따른 차등점수제를 적용한 사업임', true],
    ['※ 차등점수제 적용 사업으로, 원점수 기준의 순위별 점수차가', true],
    ['기술평가 시 차등 점수제(2점)를 부여하여 평가', true],
    ['「소프트웨어 기술성 평가기준 지침」에 따라 차등점수(3점)를 부여하여 평가함', true],
    ['[차등점수제 적용] 기술평가 순위별 점수차는 3점을 적용함', true],
    // 여러 기관 공고 실측(정확도 점검)
    ['- 본 사업은 차등점수제 심사대상이 아닙니다.', false],
    ['차등점수제 적용대상이 아님', false],
    ['차등점수제(순위 간 점수차 2점)을 적용하여 평가합니다.', true],
    ['온라인(발표)평가, 하도급 가능, 차등점수제(2.5점) 적용, 원가절감의적정성 미실시', true],
  ])('%s → %s', (s, v) => expect(val(s)).toBe(v));
  it('선택하지 않은 서식 문구(적용/미적용)는 후보가 아니다', () => {
    expect(val('차등점수제(적용/미적용)')).toBeUndefined();
  });
  it('조건문의 부정형과 대상 여부 서식은 후보가 아니다(리뷰 지적)', () => {
    expect(val('차등점수제 적용대상이 아닌 경우 일반 배점 적용')).toBeUndefined();
    expect(val('차등점수제 대상이 아닌 사업은 제외')).toBeUndefined();
    expect(val('차등점수제 적용 대상 여부: 대상이아님')).toBeUndefined();
  });
  it('"적용 시"로 시작하는 낱말(적용시킨다, 적용 시행)은 막지 않는다', () => {
    expect(val('차등점수제를 적용시킨다')).toBe(true);
    expect(val('차등점수제 적용 시행')).toBe(true);
  });
  it('조건문(적용한 경우)은 후보가 아니다', () => {
    expect(val('최종 기술능력평가 점수에서 0.1점 감점합니다. (차등점수제를 적용한 경우 원 기술점수에서 0.1점 감점)')).toBeUndefined();
  });
  it('값 없이 차등점수를 언급만 한 문장은 후보가 아니다', () => {
    expect(val('협상적격 여부 판단은 차등점수가 아닌 원 기술능력평가점수를 기준으로 함')).toBeUndefined();
    expect(val('원점수 기준의 순위별 점수차가 차등점수차보다 큰 경우')).toBeUndefined();
    expect(val('제안서 평가결과(차등점수제에 따른 기술능력평가점수)')).toBeUndefined();
  });
  it('서식 제목과 부정문은 적용으로 읽지 않는다', () => {
    expect(val('차등점수제 적용 여부(적용/미적용)')).toBeUndefined();
    expect(val('차등점수제 적용여부')).toBeUndefined();
    expect(val('차등점수를 부여하지 않음')).toBe(false);
    expect(val('차등점수제를 적용하지 아니한다')).toBe(false);
  });
});

describe('perf.amount', () => {
  const re = pat('perf.amount', 'pattern');
  const amt = (s: string) => { const m = re.exec(compact(s)); return m ? parseKoreanAmount(m.groups!.v!) : null; };
  it.each([
    ['500,000,000원 이상', 500000000],
    ['5억5천만원 이상', 550000000],
    ['1억 2,000만원 이상', 120000000],
    ['1,000만원 이상', 10000000],
    ['5,000,000원이상', 5000000],
    ['0.5억원이상', 50000000],
    ['20억원 미만, 5억원 이상', 500000000],
    ['3천만원 이상', 30000000],
    ['단일 실적 1억원 이상(부가세포함)인 업체', 100000000],
  ])('%s → %s', (s, v) => expect(amt(s)).toBe(v));
  it('이상이 없으면 매치 없음', () => expect(amt('15억원')).toBeNull());
  it('괄호나 /건이 끼어도 읽는다', () => {
    expect(amt('단일건당 1억원 (VAT 포함) 이상 실적')).toBe(100000000);
    expect(amt('1억원(부가가치세 포함)/건 이상 유사 실적')).toBe(100000000);
  });
  it('추정가격 같은 공고 자체 금액은 실적 금액이 아니고, "이상: N건"은 금액으로 읽는다(리뷰 지적)', () => {
    expect(amt('추정가격 100억원 이상인 공사는 이행실적 평가')).toBeNull();
    expect(amt('추정가격 10억원, 유사실적 5억원 이상')).toBe(500000000);
    expect(amt('추정가격 5억원 미만 사업은 실적 1억원 이상')).toBe(100000000);
    expect(amt('실적금액: 1억원 이상: 1건 이상')).toBe(100000000);
    expect(amt('단일 계약금액 1억원 이상')).toBe(100000000);
  });
  it('줄 끝 점수와 물결 구간도 금액 구간 행이다', () => {
    expect(amt('5천만원 이상 10')).toBeNull();
    expect(amt('4천만원 이상 ~ 5천만원 미만 8')).toBeNull();
  });
  it('이상 뒤에 번호나 건수가 와도 금액은 읽는다', () => {
    expect(amt('5억원 이상 1) 계약서 사본')).toBe(500000000);
    expect(amt('3억원 이상 2,3건 이상')).toBe(300000000);
    expect(amt('1억원 이상: 3,000건')).toBe(100000000);
    expect(amt('1억원 이상 : 1,500 건 이상')).toBe(100000000);
  });
  it('금액 구간별 점수표 행은 최소 인정금액이 아니다', () => {
    expect(amt('① 용역금액 10억원 이상 : 3')).toBeNull();
    expect(amt('10억원 이상 3점')).toBeNull();
    expect(amt('5억원 이상 : 3, 3억원 이상 : 2')).toBeNull();
    // 공백을 지우면 "5, 100억"이 "5,100억"이 되므로 뒤에 금액 단위가 오면 천 단위 숫자로 보지 않는다(리뷰 지적).
    expect(amt('50억원 이상: 5, 100억원 이상: 10')).toBeNull();
    expect(amt('10억원 이상: 2, 500억원 이상: 3')).toBeNull();
    expect(amt('1억원 이상: 3, 500만원 미만: 2')).toBeNull();
  });
});

describe('perf.condition anchor', () => {
  const re = pat('perf.condition', 'anchor');
  it.each([
    ['※ 유사사업 : 정보시스템 구축', true],
    ['유사사업의 정의 및 범위', true],
    ['※ 유사사업 정의(예시)', true],
    ['유사사업 정의 - 아래 각 호', true],
    ['실적인정 대상', true],
    ['제시된 유사사업 정의에 부합되는 실적', false],
    // 축산물품질평가원 공고 실측
    ['- 유사용역의 정의 : 소프트웨어 개발 또는 소프트웨어 개발이 포함된 구축 업무에 한함', true],
    ['※ 유사사업은 정보시스템 및 서비스와 관련된 ISP, ISMP 사업으로 규정함', true],
    ['유사사업 범위 : 외부기관 정보 연계사업, 내부 업무시스템 통합 관련 정보화사업', true],
    ['4. 실적 인정 범위는 제안요청서에 정하되, 수행실적은 제5호에 따라 제출된 실적을 기준으로 평가한다.', false],
    ['3. 실적 인정 범위와 제9조제8항제3호 나목에 따라 실적평가를 제외하는 경우', false],
    ['최근 3년간 유사사업 수행실적 합산', false],
    ['핵심인력에 대한 자격, 경력, 유사사업 참여 실적을 제시하여야 함', false],
    // 여러 기관 공고 실측
    ['*유사사업: 결제, 금융 시스템 개발 구축 및 운영 유지관리 실적만 인정', true],
    ['※ 유사사업 인정범위 : 의료정보시스템 구축(또는 운영 또는 유지보수) 용역 사업', true],
    ['※ 유사실적 : 공고일 기준 최근 3년 이내 준공한 의료정보시스템 구축 용역 분야 사업', true],
    ['▷ 실적 인정범위는 본 과업이 포함된 실적(정보시스템 개발사업)은 100%', true],
    ['4. 실적 인정 범위는 제안요청서(수요기관)에 정하되, 수행실적은 제5호에 따라', false],
    ['1. 유사사업 수행실적 : 7건', false],
  ])('%s → %s', (s, v) => expect(re.test(compact(s))).toBe(v));
});
