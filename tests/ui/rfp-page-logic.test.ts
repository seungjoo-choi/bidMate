import { describe, expect, it } from 'vitest';
import { base64ToBytes, bytesToBase64, checkUploadFile, coreTitle, titleSimilarity, filterEntries, filterFacets, noticeYear, orgFacets, orgLabel, orgOf, recommend, yearFacets } from '../../src/entrypoints/dashboard/rfp/rfp-page-logic';
import type { IndexEntry } from '../../src/core/types/index-file';

const entry = (noticeId: string, title: string, orderingOrg: string): IndexEntry => ({ noticeId, title, orderingOrg } as IndexEntry);

describe('recommend', () => {
  it('같은 사업명 → 같은 기관 → 유사도 순, 무관한 공고는 제외', () => {
    const list = [
      entry('a', '통합민원시스템 유지관리 용역', '다른기관'),
      entry('b', '전혀 상관없는 청소 용역 입찰', '△△공단'),
      entry('c', '통합민원시스템 기능개선 및 유지관리 용역', '△△공단'),
      entry('d', '완전히 다른 물품 구매 계약', '□□시'),
      entry('base', '2026년 통합민원시스템 기능개선 및 유지관리 용역', '△△공단'),
    ];
    const r = recommend(list, { noticeId: 'base', title: '2026년 통합민원시스템 기능개선 및 유지관리 용역', org: '△△공단' });
    expect(r.map((x) => x.entry.noticeId)).toEqual(['c', 'a', 'b']);
    expect(r[0]!.sameOrg).toBe(true);
    expect(r[1]!.sameName).toBe(true);
    expect(r[1]!.sim).toBeGreaterThanOrEqual(0.3);
  });
  it('기준이 없으면 빈 목록', () => {
    expect(recommend([entry('a', 't', 'o')], undefined)).toEqual([]);
  });
});

describe('checkUploadFile', () => {
  it('허용 확장자는 통과', () => {
    expect(checkUploadFile('제안요청서.HWP', 1000).ok).toBe(true);
    expect(checkUploadFile('a.docx', 1000).ok).toBe(true);
  });
  it('다른 확장자·확장자 없음 거부', () => {
    expect(checkUploadFile('a.xlsx', 1000).ok).toBe(false);
    expect(checkUploadFile('noext', 1000).ok).toBe(false);
  });
  it('20MB 초과 거부', () => {
    expect(checkUploadFile('a.pdf', 20 * 1024 * 1024).ok).toBe(true);
    expect(checkUploadFile('a.pdf', 20 * 1024 * 1024 + 1).ok).toBe(false);
  });
});

describe('base64', () => {
  it('청크 경계를 넘는 바이트도 왕복', () => {
    const bytes = new Uint8Array(0x8000 * 2 + 17).map((_, i) => (i * 31) % 256);
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
  });
});

describe('연도·기관 필터', () => {
  const e = (noticeNo: string, collectedAt: string, orderingOrg: string): IndexEntry => ({ noticeId: noticeNo, noticeNo, collectedAt, orderingOrg, title: noticeNo } as IndexEntry);
  const list = [e('R26BK01631407', '2026-10-21T00:00:00Z', '조달청'), e('R25BK00000001', '2026-01-02T00:00:00Z', '조달청'), e('20251234567', '2025-03-01T00:00:00Z', '한국국제협력단')];
  it('공고번호 앞자리로 연도, 아니면 수집일 연도', () => {
    expect(noticeYear(list[0]!)).toBe(2026);
    expect(noticeYear(list[1]!)).toBe(2025);
    expect(noticeYear(list[2]!)).toBe(2025);
  });
  it('선택지는 연도 최신순, 기관 많은 순', () => {
    expect(yearFacets(list)).toEqual([{ year: 2026, count: 1 }, { year: 2025, count: 2 }]);
    expect(orgFacets(list).map((o) => o.org)).toEqual(['조달청', '한국국제협력단']);
  });
  it('연도·기관을 함께 거른다(빈 값은 전체)', () => {
    expect(filterFacets(list, { year: '2025', org: '' }).map((x) => x.noticeNo)).toEqual(['R25BK00000001', '20251234567']);
    expect(filterFacets(list, { year: '2025', org: '조달청' }).map((x) => x.noticeNo)).toEqual(['R25BK00000001']);
    expect(filterFacets(list, { year: '', org: '' })).toHaveLength(3);
  });
});

describe('수요기관 기준', () => {
  const d = (noticeId: string, title: string, orderingOrg: string, demandOrg?: string): IndexEntry => ({ noticeId, noticeNo: noticeId, title, orderingOrg, demandOrg } as IndexEntry);
  const list = [d('a', '청소 용역', '조달청', '△△공단'), d('b', '경비 용역', '조달청', '△△공단'), d('c', '급식 용역', '조달청')];
  it('수요기관이 있으면 수요기관으로 묶고 없으면 공고기관', () => {
    expect(orgOf(list[0]!)).toBe('△△공단');
    expect(orgOf(list[2]!)).toBe('조달청');
    expect(orgFacets(list)).toEqual([{ org: '△△공단', count: 2 }, { org: '조달청', count: 1 }]);
    expect(filterFacets(list, { year: '', org: '△△공단' }).map((x) => x.noticeId)).toEqual(['a', 'b']);
  });
  it('검색은 수요기관도 대상으로 한다', () => {
    expect(filterEntries(list, '공단').map((x) => x.noticeId)).toEqual(['a', 'b']);
  });
  it('추천의 같은 기관도 수요기관 기준', () => {
    const r = recommend(list, { noticeId: 'a', title: '무관한 제목 xyz', org: '△△공단' });
    expect(r.map((x) => x.entry.noticeId)).toEqual(['b']);
    expect(r[0]!.sameOrg).toBe(true);
  });
  it('표시 문구: 다르면 수요·공고 함께, 같거나 없으면 하나', () => {
    expect(orgLabel(list[0]!)).toBe('수요 △△공단 · 공고 조달청');
    expect(orgLabel(list[2]!)).toBe('조달청');
    expect(orgLabel(d('x', 't', '조달청', '조달청'))).toBe('조달청');
  });
});

describe('공고명 유사 추천', () => {
  it('연도·흔한 사업 용어를 뺀 핵심 사업명', () => {
    expect(coreTitle('2026년 축산물원패스 기능 고도화 사업')).toBe('축산물원패스');
    expect(coreTitle('전자출하시스템 활성화 및 유지보수 사업')).toBe('전자출하');
    expect(coreTitle('2027년 출연연 통합업무정보시스템(NFIS) 운영·유지관리 사업')).toBe('출연연통합업무정보nfis');
  });
  it('핵심 사업명이 같으면 같은 사업명, 띄어쓰기 달라도 같음', () => {
    expect(titleSimilarity('축산물원패스 기능 고도화 사업', '2025년 축산물 원패스 유지관리 용역').sameName).toBe(true);
    expect(titleSimilarity('축산물원패스 기능 고도화 사업', '전자출하시스템 활성화 및 유지보수 사업').sameName).toBe(false);
  });
  it('같은 사업명이 같은 기관보다 먼저 추천된다', () => {
    const e = (noticeId: string, title: string, orderingOrg: string): IndexEntry => ({ noticeId, title, orderingOrg } as IndexEntry);
    const list = [e('org', '국가 축산 통계 플랫폼 운영', '축산물품질평가원'), e('name', '2025년 축산물 원패스 유지관리', '조달청'), e('none', '필리핀 낙농개량체계 구축', '한국국제협력단')];
    const r = recommend(list, { noticeId: 'base', title: '축산물원패스 기능 고도화 사업', org: '축산물품질평가원' });
    expect(r.map((x) => x.entry.noticeId)).toEqual(['name', 'org']);
    expect(r[0]!.sameName).toBe(true);
  });
});
