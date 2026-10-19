import { describe, expect, it } from 'vitest';
import { basicFacts, evalFacts } from '../../src/core/model/notice-summary';
import { emptyNotice } from '../../src/core/model/notice-fields';
import type { Job } from '../../src/core/types/job';
import type { Notice } from '../../src/core/types/notice';
import { extOf, statusChip, summaryView } from '../../src/entrypoints/sidepanel/summary-view';

const mk = (kind?: 'bid' | 'prespec'): Notice =>
  emptyNotice('N-000', { noticeNo: 'R26BK1', round: '000', kind, origin: 'g2b' }, 'folder/x', '2026-10-19T05:31:00Z');
const now = new Date(2026, 9, 19, 9, 0);
const close = new Date(2026, 9, 27, 10, 0).toISOString();
const input = (n: Notice, ev = evalFacts(n, null)) => ({ facts: basicFacts(n), eval: ev, notice: n });
const job = (status: Job['status']): Job => ({ id: 'j', type: 'collect', status, steps: [], attempt: 1, createdAt: '', updatedAt: '', errors: [] });

describe('summaryView', () => {
  it('bid: 핵심 3칸 순서와 입찰마감만 강조, null은 -', () => {
    const n = mk();
    n.schedule.bidCloseAt = { value: close, status: 'verified' };
    n.basic.estimatedPrice = { value: 1_284_000_000, status: 'verified' };
    n.basic.awardMethod = { value: '적격심사', status: 'verified' };
    n.basic.contractMethod = { value: '제한경쟁', status: 'verified' };
    n.basic.round = { value: '000', status: 'verified' };
    const v = summaryView(input(n), now);
    expect(v.kindLabel).toBe('입찰공고');
    expect(v.key3.map((c) => c.label)).toEqual(['입찰마감', '추정가격', '낙찰방법']);
    expect(v.key3.map((c) => !!c.hot)).toEqual([true, false, false]);
    expect(v.key3[0]).toMatchObject({ value: 'D-8' });
    expect(v.key3[1]).toMatchObject({ value: '12억 8,400만 원' });
    expect(v.key3[2]).toMatchObject({ value: '적격심사', sub: '제한경쟁' });
    expect(v.noticeNo).toBe('R26BK1-000');
    const empty = summaryView(input(mk()), now);
    expect(empty.key3[0]!.value).toBe('-');
    expect(empty.key3[1]!.value).toBe('-');
    expect(empty.basic.map((r) => r.label)).toEqual(['발주기관', '수요기관', '공동도급', '참가자격', '사업기간', '개찰']);
    expect(empty.basic.every((r) => r.value === '-')).toBe(true);
  });
  it('prespec: 의견등록마감/배정예산/사업구분, 평가 기준 null', () => {
    const n = mk('prespec');
    n.prespec.opinionCloseAt = { value: close, status: 'verified' };
    n.prespec.assignedBudget = { value: 500_000_000, status: 'verified' };
    n.prespec.bizDivision = { value: '용역', status: 'verified' };
    const ev = { ...evalFacts(n, null), extractionStatus: 'needs_review' as const, reviewCount: 2 };
    const v = summaryView(input(n, ev), now);
    expect(v.kindLabel).toBe('사전규격');
    expect(v.key3.map((c) => c.label)).toEqual(['의견등록마감', '배정예산', '사업구분']);
    expect(v.key3[0]!.value).toBe('D-8');
    expect(v.key3[2]!.value).toBe('용역');
    expect(v.evaluation).toBeNull();
  });
  it('평가 기준: 추출 미실행이면 null, 실행됐으면 6행과 확인 필요', () => {
    const n = mk();
    expect(summaryView(input(n), now).evaluation).toBeNull();
    n.evaluation.performanceScore = { value: 15, status: 'verified' };
    n.evaluation.performancePeriod = { value: '5년', status: 'needs_review' };
    const ev = { ...evalFacts(n, null), extractionStatus: 'needs_review' as const, reviewCount: 2 };
    const e = summaryView(input(n, ev), now).evaluation!;
    expect(e.reviewCount).toBe(2);
    expect(e.rows.map((r) => r.label)).toEqual(['실적', '경영상태', '신인도', '실적 기간', '실적 최소금액', '차등점수']);
    expect(e.rows[0]).toMatchObject({ value: '15점', check: false });
    expect(e.rows[3]).toMatchObject({ value: '5년', check: true });
    expect(e.rows[1]!.value).toBe('-');
  });
  it('첨부: 형식 배지, 크기, 저장 건수, 문제 표시', () => {
    const n = mk();
    const base = { index: 0, url: '', savedName: null, expectedSize: null, attempts: 1 };
    n.attachments = [
      { ...base, id: 'a', originalName: '공고문.pdf', savedSize: 412 * 1024, status: 'saved' },
      { ...base, id: 'b', originalName: '과업.hwpx', savedSize: null, expectedSize: 1_800_000, status: 'failed' },
      { ...base, id: 'c', originalName: '도면.zip', savedSize: 14_200_000, status: 'saved' },
      { ...base, id: 'd', originalName: '내역.xlsx', savedSize: 96 * 1024, status: 'saved' },
    ];
    const a = summaryView(input(n), now).attachments;
    expect(a.title).toBe('첨부 3/4');
    expect(a.files.map((f) => f.ext)).toEqual(['pdf', 'hwp', 'zip', 'xls']);
    expect(a.files[0]).toMatchObject({ extLabel: 'PDF', size: '412KB' });
    expect(a.files[1]).toMatchObject({ problem: '실패', size: '1.7MB' });
    expect(extOf('메모.txt')).toEqual({ ext: 'etc', label: 'TXT' });
  });
  it('액션 정보와 개인정보 미포함', () => {
    const n = mk('prespec');
    n.prespec.officerName = { value: '홍길동', status: 'verified' };
    n.prespec.officerTel = { value: '010-1234-5678', status: 'verified' };
    const ev = { ...evalFacts(n, null), reviewCount: 3 };
    const v = summaryView(input(n, ev), now);
    expect(v.actions).toEqual({ noticeId: 'N-000', folder: 'folder/x', reviewCount: 3 });
    expect(JSON.stringify(v)).not.toMatch(/홍길동|010-1234/);
  });
});

describe('statusChip', () => {
  const collect = (status: 'collected' | 'partial' | 'failed') => ({ status, collectedAt: new Date(2026, 9, 19, 14, 31).toISOString() });
  it('수집 중 잡이 있으면 수집 중(파랑)', () => {
    expect(statusChip(job('running'), collect('collected'))).toEqual({ tone: 'run', text: '수집 중' });
  });
  it('잡 없이 저장된 결과: 완료 초록, 일부 실패 주황, 실패 빨강', () => {
    expect(statusChip(null, collect('collected'))).toEqual({ tone: 'ok', text: '수집 완료, 10/19 14:31' });
    expect(statusChip(null, collect('partial'))?.tone).toBe('warn');
    expect(statusChip(null, collect('failed'))?.tone).toBe('danger');
    expect(statusChip(null, null)).toBeNull();
  });
  it('종결 잡이 저장 결과보다 우선', () => {
    expect(statusChip(job('partial'), collect('collected'))?.tone).toBe('warn');
    expect(statusChip(job('failed'), null)).toEqual({ tone: 'danger', text: '실패' });
  });
});
