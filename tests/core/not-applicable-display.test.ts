import { describe, expect, it } from 'vitest';
import { NA_NOTE, NA_VALUE_TEXT } from '../../src/core/extraction/review-count';
import { leafReviewState, rowStateOf } from '../../src/core/extraction/review-rows';
import { decideHandoff } from '../../src/core/model/handoff';
import { emptyNotice } from '../../src/core/model/notice-fields';
import { evalFacts } from '../../src/core/model/notice-summary';
import { criteriaOf, judge } from '../../src/core/qualification/judge';
import { resolveComposite } from '../../src/core/templates/composites';
import { resolveValue } from '../../src/core/templates/values';
import { docFieldsOf } from '../../src/engine/extraction/extract-step';
import { summaryView } from '../../src/entrypoints/sidepanel/summary-view';
import { basicFacts } from '../../src/core/model/notice-summary';
import type { Job } from '../../src/core/types/job';
import { EXTRACTION_KEYS, type Extraction, type ExtractedItem, type ExtractionKey } from '../../src/core/types/extraction';
import type { PerformanceRecord } from '../../src/core/types/performance';
import { overviewGroups } from '../../src/ui/notice-detail/view';
import { buildReviewRows } from '../../src/ui/review/rows';
import { buildCard } from '../../src/ui/review/view';

const evd = { attachmentId: 'a', sourceFile: 'f.hwp', location: '표1 r1c3', evidence: 'e', ruleId: 'eval.quantTable', docKind: 'rfp' } as never;
const na = (): ExtractedItem<unknown> => ({ value: null, status: 'verified', reason: 'not_applicable', raw: '정량평가 10점', evidence: evd });
const ok = (value: unknown): ExtractedItem<unknown> => ({ value, status: 'verified' });
const make = (over: Partial<Record<ExtractionKey, ExtractedItem<unknown>>>): Extraction => {
  const items = {} as Record<ExtractionKey, ExtractedItem<unknown>>;
  for (const k of EXTRACTION_KEYS) items[k] = ok(1);
  return { schemaVersion: 2, noticeId: 'N', jobId: 'j', extractedAt: 't', rulesVersion: '1', status: 'verified', items: { ...items, ...over }, extras: {}, files: [], warnings: [] } as Extraction;
};
const notice = () => emptyNotice('N-00', { noticeNo: 'N', origin: 'manual' }, 'f', '2026-09-11T00:00:00Z');
const naField = { value: null, status: 'verified' as const, note: NA_NOTE };
const naNotice = () => {
  const n = notice();
  for (const k of ['performanceScore', 'performancePeriod', 'performanceMinAmount', 'performanceCondition', 'credibilityScore'] as const) n.evaluation[k] = { ...naField } as never;
  n.evaluation.managementScore = { value: 10, status: 'verified' };
  return n;
};

describe('해당 없음 표시 (5)', () => {
  it('buildCard: 배지 notApplicable, 값 글자, 사유', () => {
    const items = make({ performanceScore: na() }).items;
    const c = buildCard('performanceScore', items.performanceScore, items);
    expect(c).toMatchObject({ badge: 'notApplicable', valueText: NA_VALUE_TEXT, reason: NA_NOTE });
  });
  it('leafReviewState와 행 상태 우선순위(covered 다음, verified 앞)', () => {
    const x = make({ performanceScore: na() });
    expect(leafReviewState(notice(), x, 'performanceScore')).toMatchObject({ state: 'not_applicable', reason: NA_NOTE });
    expect(rowStateOf(['verified', 'not_applicable'])).toBe('not_applicable');
    expect(rowStateOf(['covered', 'not_applicable'])).toBe('covered');
    const row = buildReviewRows(notice(), x).find((r) => r.key === 'performanceScore')!;
    expect(row.head).toMatchObject({ state: 'not_applicable', badge: 'notApplicable', valueText: NA_VALUE_TEXT });
  });
  it('evalRow: 개요 탭 행은 해당 없음, 확인 필요 표시와 링크 없음', () => {
    const n = naNotice();
    const rows = overviewGroups(n, [], make({ performanceScore: na() })).flatMap((g) => g.rows);
    const r = rows.find((x) => x.label === '수행실적 배점')!;
    expect(r.value).toBe('해당 없음');
    expect(r.mark).toBeUndefined();
    expect(r.href).toBeUndefined();
  });
  it('summary-view 행 값 해당 없음, check false', () => {
    const n = naNotice();
    const ev = evalFacts(n, make({ performanceScore: na() }));
    expect(ev.items.performanceScore).toMatchObject({ needsCheck: false, notApplicable: true });
    const v = summaryView({ facts: basicFacts(n), eval: ev, notice: n }, new Date(2026, 9, 19, 9, 0));
    const row = v.evaluation?.rows.find((r) => r.label === '실적');
    expect(row).toMatchObject({ value: '해당 없음', check: false });
  });
  it('resolveValue와 composites', () => {
    const n = naNotice();
    expect(resolveValue(n, 'performanceScore')).toEqual({ text: '해당 없음', status: 'ok', raw: null });
    expect(resolveComposite(n, 'performanceEval', (k) => resolveValue(n, k)).text).toBe('해당 없음');
    const c = resolveComposite(n, 'credibilityEval');
    expect(c).toMatchObject({ status: 'ok' });
    expect(c.text).toContain('경영상태');
    expect(c.text).not.toContain('대외신인도');
    n.evaluation.managementScore = { ...naField } as never;
    expect(resolveComposite(n, 'credibilityEval').text).toBe('해당 없음');
  });
});

describe('해당 없음 추출/메일 연결 (6)', () => {
  it('docFieldsOf: NA 항목은 verified, value null, note NA_NOTE, source', () => {
    const items = make({ performanceScore: na() }).items;
    const f = docFieldsOf(items, '2026-09-11T00:00:00Z').performanceScore!;
    expect(f).toMatchObject({ value: null, status: 'verified', note: NA_NOTE });
    expect(f.source).toBeDefined();
  });
  it('handoff: reviewCount 0이면 compose', () => {
    const S = { enabled: true, afterCollect: 'compose', recipients: { mode: 'default' }, reviewGate: 'any_review' } as never;
    const j = { id: 'j', type: 'collect', status: 'completed', steps: [], attempt: 1, createdAt: 't', updatedAt: 't', errors: [],
      result: { noticeId: 'n', extraction: { status: 'verified', reviewCount: 0, conflictCount: 0 } } } as Job;
    expect(decideHandoff(j, S)).toEqual({ kind: 'compose' });
  });
});

describe('해당 없음 적격 판정 (7)', () => {
  it('reasons에 해당 없음 문구, verdict review', () => {
    const n = notice();
    n.basic.postedAt = { value: '2026-09-11', status: 'verified' };
    const x = make({ performancePeriod: na(), performanceMinAmount: na() });
    const rec: PerformanceRecord = { id: 'p', title: 't', client: 'c', amount: 1, startAt: '2025-01-01', endAt: '2026-01-01', source: 'manual', updatedAt: '2026-01-01T00:00:00Z' };
    const j = judge(criteriaOf(n, x), [rec]);
    expect(j.verdict).toBe('review');
    const reasons = j.lines.flatMap((l) => l.reasons);
    expect(reasons).toContain('인정기간: 해당 없음(정량평가에 실적 항목 없음)');
    expect(reasons).toContain('인정금액: 해당 없음(정량평가에 실적 항목 없음)');
  });
});
