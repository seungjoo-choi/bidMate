import { describe, expect, it } from 'vitest';
import type { Criteria, Criterion, JudgeLine, Judgement, MatchedPerformance, Verdict } from '../../src/core/qualification/judge';
import type { PerformanceRecord } from '../../src/core/types/performance';
import { qualificationView } from '../../src/ui/notice-detail/qualification-view';

const crit = (value: number | null): Criterion<number> => ({ value, state: 'known', status: 'verified' });
const criteria: Criteria = { postedAt: '2026-09-11', periods: [crit(3)], amounts: [crit(500_000_000)], condition: { text: null, present: false } };
const perf = (i: number): PerformanceRecord => ({
  id: `p${i}`, title: `사업${i}`, client: `기관${i}`, amount: 600_000_000 + i, startAt: '2023-01-01', endAt: '2024-01-01', source: 'manual', updatedAt: '2026-01-01T00:00:00.000Z',
});
const matchedOf = (n: number): MatchedPerformance[] =>
  Array.from({ length: n }, (_, i) => ({ p: perf(i), compareAmount: 600_000_000 + i, periodOk: true, amountOk: true }));
const line = (matched: MatchedPerformance[], p = crit(3), a = crit(500_000_000)): JudgeLine => ({ period: p, amount: a, matched, verdict: 'met', reasons: ['근거'] });
const judgement = (verdict: Verdict, lines: JudgeLine[] = [], extra: Partial<Judgement> = {}): Judgement =>
  ({ verdict, lines, inProgress: 0, conditionText: null, total: 3, ...extra });

describe('qualificationView', () => {
  it('badge 4종과 headline', () => {
    expect(qualificationView(judgement('met'), criteria).badge).toEqual({ text: '충족', status: 'ok' });
    expect(qualificationView(judgement('possibly_short'), criteria).badge).toEqual({ text: '미달 가능', status: 'warn' });
    expect(qualificationView(judgement('review'), criteria).badge).toEqual({ text: '확인 필요', status: 'warn' });
    const none = qualificationView(judgement('no_data'), criteria);
    expect(none.badge).toEqual({ text: '실적 없음', status: 'idle' });
    expect(none.headline).toBe('실적 목록이 비어 있습니다');
    expect(qualificationView(judgement('met'), criteria).headline).toBe('인정기간과 인정금액을 충족하는 실적이 있습니다');
    expect(qualificationView(judgement('review'), criteria).headline).toBe('자동으로 판정할 수 없는 항목이 있습니다');
    expect(none.settingsHref).toBe('#/settings?section=performances');
  });

  it('줄이 1개면 제목이 비고, 여러 개면 후보 제목', () => {
    expect(qualificationView(judgement('met', [line([])]), criteria).lines[0]!.title).toBe('');
    const v = qualificationView(judgement('review', [line([]), line([], crit(5), { value: null, state: 'unknown', status: 'missing' })]), criteria);
    expect(v.lines[0]!.title).toBe('후보 1: 인정기간 3년, 인정금액 5억 원');
    expect(v.lines[1]!.title).toBe('후보 2: 인정기간 5년, 인정금액 없음');
  });

  it('matched 5건 제한과 more', () => {
    const v = qualificationView(judgement('met', [line(matchedOf(8))]), criteria);
    expect(v.lines[0]!.matched).toHaveLength(5);
    expect(v.lines[0]!.more).toBe(3);
    expect(v.lines[0]!.matched[0]!).toMatchObject({ title: '사업0', client: '기관0', endAt: '2024-01-01' });
    expect(qualificationView(judgement('met', [line(matchedOf(5))]), criteria).lines[0]!.more).toBe(0);
  });

  it('footnotes와 인정조건 원문', () => {
    const v = qualificationView(judgement('review', [], { inProgress: 2, conditionText: 'a'.repeat(300) }), criteria);
    expect(v.footnotes).toEqual(['진행 중 실적 2건은 판정에서 제외했습니다']);
    expect(v.condition).toEqual({ text: 'a'.repeat(200), truncated: true });
    expect(qualificationView(judgement('review', [], { conditionText: 'b' }), criteria).condition).toEqual({ text: 'b', truncated: false });
    const none = qualificationView(judgement('met'), criteria);
    expect(none.footnotes).toEqual([]);
    expect(none.condition).toBeNull();
  });
});
