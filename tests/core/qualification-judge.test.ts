import { describe, expect, it } from 'vitest';
import { emptyNotice } from '../../src/core/model/notice-fields';
import { criteriaOf, judge, type Criteria, type Criterion } from '../../src/core/qualification/judge';
import type { Extraction, ExtractedItem, ExtractionKey } from '../../src/core/types/extraction';
import type { Notice } from '../../src/core/types/notice';
import type { PerformanceRecord } from '../../src/core/types/performance';

const ev = { attachmentId: 'a', sourceFile: 'f', location: 'l', evidence: 'e', ruleId: 'r', docKind: 'notice' } as never;
const notice = (): Notice => {
  const n = emptyNotice('N-00', { noticeNo: 'N', origin: 'manual' }, 'f', '2026-09-11T00:00:00Z');
  n.basic.postedAt = { value: '2026-09-11', status: 'verified' };
  return n;
};
const extraction = (items: Partial<Record<ExtractionKey, ExtractedItem<unknown>>>): Extraction => ({
  schemaVersion: 2, noticeId: 'N-00', jobId: 'j', extractedAt: '2026-09-11T00:00:00Z', rulesVersion: '1', status: 'verified',
  items: items as Extraction['items'], extras: {}, files: [], warnings: [],
});
const verified = (value: unknown): ExtractedItem<unknown> => ({ value, status: 'verified' });

const perf = (id: string, endAt: string | undefined, amount: number, share?: number): PerformanceRecord => ({
  id, title: `사업${id}`, client: '공단', amount, startAt: '2020-01-01', ...(endAt ? { endAt } : {}), ...(share ? { share } : {}),
  source: 'manual', updatedAt: '2026-01-01T00:00:00Z',
});
const known = (value: number): Criterion<number> => ({ value, state: 'known', status: 'verified' });
const crit = (over: Partial<Criteria> = {}): Criteria => ({
  postedAt: '2026-09-11', periods: [known(3)], amounts: [known(500000000)], condition: { text: null, present: false }, ...over,
});

describe('criteriaOf', () => {
  it('verified 값은 known 1개씩', () => {
    const c = criteriaOf(notice(), extraction({ performancePeriod: verified('3년'), performanceMinAmount: verified(500000000) }));
    expect(c.postedAt).toBe('2026-09-11');
    expect(c.periods).toEqual([{ value: 3, state: 'known', status: 'verified' }]);
    expect(c.amounts).toEqual([{ value: 500000000, state: 'known', status: 'verified' }]);
  });
  it('userEdited 우선', () => {
    const item: ExtractedItem<unknown> = { value: '3년', status: 'needs_review', userEdited: { value: '5년', editedAt: 'x' } };
    const c = criteriaOf(notice(), extraction({ performancePeriod: item, performanceMinAmount: verified(1) }));
    expect(c.periods[0]).toMatchObject({ value: 5, state: 'known' });
  });
  it('conflict + candidates 2개는 unknown 2개', () => {
    const item: ExtractedItem<unknown> = {
      value: null, status: 'needs_review', reason: 'conflict',
      candidates: [{ value: '3년', evidence: ev }, { value: '5년', evidence: ev }],
    };
    const c = criteriaOf(notice(), extraction({ performancePeriod: item, performanceMinAmount: verified(1) }));
    expect(c.periods.map((p) => [p.value, p.state])).toEqual([[3, 'unknown'], [5, 'unknown']]);
  });
  it('not_found는 value null unknown과 note', () => {
    const item: ExtractedItem<unknown> = { value: null, status: 'needs_review', reason: 'not_found' };
    const c = criteriaOf(notice(), extraction({ performancePeriod: verified('3년'), performanceMinAmount: item }));
    expect(c.amounts[0]).toMatchObject({ value: null, state: 'unknown', note: '문서에서 찾지 못함' });
  });
  it('extraction null이면 notice 필드 사용, 최근 3년간 문자열도 3', () => {
    const n = notice();
    n.evaluation.performancePeriod = { value: '최근 3년간', status: 'verified' };
    n.evaluation.performanceMinAmount = { value: 500000000, status: 'user_edited' };
    n.evaluation.performanceCondition = { value: '동종 사업', status: 'verified' };
    const c = criteriaOf(n, null);
    expect(c.periods[0]).toMatchObject({ value: 3, state: 'known' });
    expect(c.amounts[0]).toMatchObject({ value: 500000000, state: 'known' });
    expect(c.condition).toEqual({ text: '동종 사업', present: true });
  });
});

describe('judge', () => {
  it('경계 포함 met, 하루 이르면 기간 탈락', () => {
    expect(judge(crit(), [perf('1', '2023-09-11', 700000000)]).verdict).toBe('met');
    const j = judge(crit(), [perf('1', '2023-09-10', 700000000)]);
    expect(j.verdict).toBe('possibly_short');
    expect(j.lines[0]!.matched).toHaveLength(0);
  });
  it('지분율 적용 비교 금액 미달', () => {
    const j = judge(crit(), [perf('1', '2025-01-01', 700000000, 70)]);
    expect(j.lines[0]!.matched).toHaveLength(0);
    expect(j.verdict).toBe('possibly_short');
  });
  it('진행 중 실적만 있으면 possibly_short + inProgress', () => {
    const j = judge(crit(), [perf('1', undefined, 900000000)]);
    expect(j.verdict).toBe('possibly_short');
    expect(j.inProgress).toBe(1);
  });
  it('조건 원문이 있으면 review, matched는 채움', () => {
    const j = judge(crit({ condition: { text: '동종', present: true } }), [perf('1', '2025-01-01', 700000000)]);
    expect(j.verdict).toBe('review');
    expect(j.lines[0]!.matched).toHaveLength(1);
    expect(j.conditionText).toBe('동종');
  });
  it('period unknown이거나 postedAt null이면 review', () => {
    const p = [perf('1', '2025-01-01', 700000000)];
    expect(judge(crit({ periods: [{ ...known(3), state: 'unknown' }] }), p).verdict).toBe('review');
    expect(judge(crit({ postedAt: null }), p).verdict).toBe('review');
  });
  it('total 0이면 no_data', () => {
    expect(judge(crit(), [])).toMatchObject({ verdict: 'no_data', lines: [], total: 0 });
  });
  it('충돌 2후보는 2줄, 한 줄이 met이면 전체 met', () => {
    const c = crit({ periods: [known(1), known(5)] });
    const j = judge(c, [perf('1', '2022-01-01', 700000000)]);
    expect(j.lines).toHaveLength(2);
    expect(j.lines.map((l) => l.verdict)).toEqual(['possibly_short', 'met']);
    expect(j.verdict).toBe('met');
  });
  it('matched는 비교 금액 내림차순', () => {
    const j = judge(crit(), [perf('1', '2025-01-01', 600000000), perf('2', '2025-01-01', 900000000), perf('3', '2025-01-01', 700000000)]);
    expect(j.lines[0]!.matched.map((m) => m.p.id)).toEqual(['2', '3', '1']);
  });
  it('reasons 문구', () => {
    const j = judge(crit({ condition: { text: '동종', present: true } }), [perf('1', '2025-01-01', 700000000)]);
    expect(j.lines[0]!.reasons).toEqual([
      '인정기간 3년: 기준일 2026-09-11 기준 2023-09-11 이후 완료 실적 1건',
      '인정금액 5억 원 이상: 비교 금액(계약금액 × 지분율) 충족 1건',
      '인정조건 원문이 있어 사람이 확인해야 합니다',
    ]);
    const u = judge(crit({
      periods: [{ value: null, state: 'unknown', status: 'needs_review', note: '문서에서 찾지 못함' }],
      amounts: [{ ...known(500000000), state: 'unknown' }],
    }), [perf('1', '2025-01-01', 700000000)]);
    expect(u.lines[0]!.reasons).toEqual([
      '인정기간: 확인 필요 (문서에서 찾지 못함)',
      '인정금액 5억 원 이상: 비교 금액(계약금액 × 지분율) 충족 1건 (추출값 확인 필요)',
    ]);
  });
});

describe('criteriaOf 값 범위와 기준일', () => {
  it('금액 0, 연수 2023, 소수 연수는 unknown', () => {
    const n = notice();
    const c = criteriaOf(n, extraction({ performanceMinAmount: verified(0), performancePeriod: verified('2023년') }));
    expect(c.amounts[0]).toMatchObject({ value: null, state: 'unknown' });
    expect(c.periods[0]).toMatchObject({ value: null, state: 'unknown' });
    expect(criteriaOf(n, extraction({ performancePeriod: verified(2.5) })).periods[0]?.state).toBe('unknown');
  });
  it('게시일 +09:00 ISO는 KST 날짜로 자른다', () => {
    const n = notice();
    n.basic.postedAt = { value: '2026-09-11T10:00:00+09:00', status: 'verified' };
    const c = criteriaOf(n, extraction({ performancePeriod: verified('3년'), performanceMinAmount: verified(500000000) }));
    expect(c.postedAt).toBe('2026-09-11');
    expect(judge(c, [perf('a', '2023-09-11', 700000000)]).verdict).toBe('met');
  });
});
