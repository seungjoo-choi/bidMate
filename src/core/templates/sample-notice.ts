import { emptyNotice, setFields } from '../model/notice-fields';
import type { FieldValue } from '../types/common';
import type { Notice } from '../types/notice';

const src = { kind: 'user' as const, ref: 'sample', fetchedAt: '2026-10-01T00:00:00.000Z' };
const ok = <T,>(value: T): FieldValue<T> => ({ value, status: 'verified', source: src });
const local = (y: number, m: number, d: number, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).toISOString();

/** 템플릿 미리보기용 표본 공고. 모든 필드 verified, 첨부 2개, 확인 필요 1개. */
export function sampleNotice(): Notice {
  const n = emptyNotice('SAMPLE-00', { noticeNo: 'SAMPLE', round: '00', origin: 'manual' }, 'notices/SAMPLE-00', local(2026, 10, 15, 9));
  setFields(n, {
    noticeNo: ok('R26BK00000000'), round: ok('00'), title: ok('2026년 정보시스템 고도화 사업'),
    postedAt: ok(local(2026, 10, 15, 9)), noticeType: ok('일반'),
    orderingOrg: ok('한국정보기관'), demandOrg: ok('한국정보기관'),
    budgetAmount: ok(500_000_000), estimatedPrice: ok(454_545_455),
    projectPeriod: ok('계약일로부터 6개월'), contractMethod: ok('협상에 의한 계약'),
    awardMethod: ok('협상에 의한 계약 체결'), priceMethod: ok('복수예비가격'),
    jointVentureAllowed: ok(true), eligibility: ok('소프트웨어사업자'),
    registrationDeadline: ok(local(2026, 10, 20, 17)), bidStartAt: ok(local(2026, 10, 15, 9)),
    bidCloseAt: ok(local(2026, 10, 22, 14)), proposalPeriod: ok('2026/10/23 10:00 ~ 2026/10/27 14:00'),
    proposalEvalAt: ok(local(2026, 10, 30, 10)), openingAt: ok(local(2026, 10, 22, 15)),
    evalMethod: ok('기술 90 : 가격 10'), differentialScoring: ok(true),
    credibilityScore: ok(2), managementScore: ok(5),
    performanceScore: { value: 10, status: 'needs_review', source: src },
    performancePeriod: ok('3년'), performanceMinAmount: ok(250_000_000), performanceCondition: ok('유사 사업 수행실적'),
  });
  n.sourceUrl = ok('https://www.g2b.go.kr/pt/menu/selectSubFrame.do?bidno=SAMPLE');
  n.attachments = [
    { id: 'att1', index: 0, originalName: '공고문.hwp', savedName: '공고문.hwp', url: '', expectedSize: 1000, savedSize: 1000, status: 'saved', attempts: 1 },
    { id: 'att2', index: 1, originalName: '제안요청서.pdf', savedName: '제안요청서.pdf', url: '', expectedSize: 2000, savedSize: 2000, status: 'saved', attempts: 1 },
  ];
  n.collect = { status: 'collected', collectedAt: local(2026, 10, 15, 9), lastJobId: '', errors: [] };
  return n;
}

/** 사전규격 템플릿 미리보기용 표본. prespec 필드 verified, basic 표시 필드도 채움, 첨부 2개. */
export function samplePrespecNotice(): Notice {
  const n = emptyNotice('R26BD00000000', { kind: 'prespec', noticeNo: 'R26BD00000000', origin: 'manual' }, 'notices/2026/R26BD00000000_sample', local(2026, 10, 15, 9));
  setFields(n, {
    specRegNo: ok('R26BD00000000'), specName: ok('2027년 정보시스템 고도화 사업'), bizDivision: ok('용역'),
    assignedBudget: ok(500_000_000), registeredAt: ok(local(2026, 10, 15, 9)), opinionCloseAt: ok(local(2026, 10, 20, 18)),
    officerName: ok('홍길동'), officerTel: ok('044-000-0000'), relatedBidNo: ok(''),
    noticeNo: ok('R26BD00000000'), title: ok('2027년 정보시스템 고도화 사업'),
    orderingOrg: ok('한국정보기관'), demandOrg: ok('한국정보기관'),
    postedAt: ok(local(2026, 10, 15, 9)), budgetAmount: ok(500_000_000),
  });
  n.sourceUrl = ok('https://www.g2b.go.kr/sample-prespec');
  n.attachments = [
    { id: 'att1', index: 0, originalName: '규격서.hwp', savedName: '규격서.hwp', url: '', expectedSize: 1000, savedSize: 1000, status: 'saved', attempts: 1 },
    { id: 'att2', index: 1, originalName: '과업내용서(안).pdf', savedName: '과업내용서(안).pdf', url: '', expectedSize: 2000, savedSize: 2000, status: 'saved', attempts: 1 },
  ];
  n.collect = { status: 'collected', collectedAt: local(2026, 10, 15, 9), lastJobId: '', errors: [] };
  return n;
}
