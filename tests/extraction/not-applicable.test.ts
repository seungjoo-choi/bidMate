import { describe, expect, it } from 'vitest';
import type { DocKind } from '../../src/core/extraction/classify';
import { computeStatus, decide, type Candidate } from '../../src/core/extraction/decide';
import { coveringKey, isNotApplicable, itemReviewState, NA_NOTE, pendingKeys, reviewCountOf, conflictCountOf } from '../../src/core/extraction/review-count';
import { loadRules } from '../../src/core/extraction/rules/load';
import { runRules } from '../../src/core/extraction/run-rules';
import { docFieldsOf } from '../../src/engine/extraction/extract-step';
import type { DocModel } from '../../src/core/doc/model';
import { EXTRACTION_KEYS, type EvidenceRef, type Extraction, type ExtractedItem, type ExtractionKey } from '../../src/core/types/extraction';

const rules = loadRules();
const ev = (id: string, ruleId: string, docKind: DocKind = 'rfp'): EvidenceRef =>
  ({ attachmentId: id, sourceFile: id, location: `L-${id}`, evidence: `근거-${id}`, ruleId, docKind });
const cand = (target: string, value: unknown, id = 'a', docKind: DocKind = 'rfp'): Candidate =>
  ({ target, value, evidence: ev(id, 'x', docKind), priority: 3, weight: 1, docKind });
const qt = (value: string, id = 'a') => cand('extras.quantTable', value, id);
const base = [cand('differentialScoring', false)];
const PERF_KEYS: ExtractionKey[] = ['performanceScore', 'performancePeriod', 'performanceMinAmount', 'performanceCondition'];

describe('decide: 정량평가 표 해당 없음', () => {
  it('10:mgmt + 경영상태 10 -> 실적 4개와 신인도 해당 없음, 전체 verified, 확인 필요 0', () => {
    const d = decide([...base, qt('10:mgmt'), cand('managementScore', 10)], rules);
    const qev = d.extras.quantTable!.evidence!;
    for (const k of [...PERF_KEYS, 'credibilityScore'] as ExtractionKey[]) {
      expect(d.items[k]).toMatchObject({ value: null, status: 'verified', reason: 'not_applicable' });
      expect(d.items[k].evidence).toEqual(qev);
    }
    expect(d.items.managementScore).toMatchObject({ value: 10, status: 'verified' });
    expect(computeStatus(d.items, ['parsed'])).toBe('verified');
    const x = { items: d.items } as Extraction;
    expect(reviewCountOf(x)).toBe(0);
    expect(conflictCountOf(x)).toBe(0);
  });

  it('performancePeriod "3년" 후보가 있으면 유지하고 나머지만 해당 없음', () => {
    const d = decide([...base, qt('10:mgmt'), cand('managementScore', 10), cand('performancePeriod', '3년')], rules);
    expect(d.items.performancePeriod).toMatchObject({ value: '3년', status: 'verified' });
    expect(d.items.performancePeriod.reason).toBeUndefined();
    expect(d.items.performanceScore.reason).toBe('not_applicable');
    expect(d.items.performanceMinAmount.reason).toBe('not_applicable');
    expect(d.items.performanceCondition.reason).toBe('not_applicable');
  });

  it('performanceScore inline 후보가 있으면 해당 없음 아님', () => {
    const d = decide([...base, qt('10:mgmt'), cand('managementScore', 10), cand('performanceScore', 5)], rules);
    expect(d.items.performanceScore).toMatchObject({ value: 5, status: 'verified' });
    expect(d.items.performanceScore.reason).toBeUndefined();
  });

  it('bonusTable 값이 있으면 credibility 해당 없음 아님', () => {
    const d = decide([...base, qt('10:mgmt'), cand('managementScore', 10), cand('extras.bonusTable', '가점 6항목, 감점 2항목')], rules);
    expect(d.items.credibilityScore.reason).not.toBe('not_applicable');
  });

  it('quantEvalDoc에 수행실적이 있으면 perf 해당 없음 아님', () => {
    const d = decide([...base, qt('10:mgmt'), cand('managementScore', 10), cand('extras.quantEvalDoc', '정량평가 : 조달청(경영상태, 수행실적)')], rules);
    expect(d.items.performanceScore).toMatchObject({ status: 'needs_review', reason: 'not_found' });
    expect(d.items.credibilityScore.reason).toBe('not_applicable');
  });

  it('quantTable 두 문서가 다른 범주면 conflict, 해당 없음 없음', () => {
    const d = decide([...base, qt('10:mgmt', 'a'), qt('10:mgmt,perf', 'b'), cand('managementScore', 10)], rules);
    expect(d.extras.quantTable).toMatchObject({ status: 'needs_review', reason: 'conflict' });
    for (const k of EXTRACTION_KEYS) expect(d.items[k].reason).not.toBe('not_applicable');
  });

  it('credibilityScore가 conflict면 해당 없음 아님', () => {
    const d = decide([...base, qt('10:mgmt'), cand('managementScore', 10), cand('credibilityScore', 2, 'a'), cand('credibilityScore', 3, 'b')], rules);
    expect(d.items.credibilityScore).toMatchObject({ status: 'needs_review', reason: 'conflict' });
  });

  it('10:mgmt,cred에서 mgmt 후보가 없으면 mgmt는 확인 필요, 신인도 해당 없음은 그룹 충족이 아님', () => {
    const d = decide([...base, qt('10:mgmt,cred')], rules);
    expect(d.items.managementScore).toMatchObject({ status: 'needs_review', reason: 'not_found' });
    expect(d.items.credibilityScore).toMatchObject({ status: 'needs_review', reason: 'not_found' });
    expect(coveringKey(d.items, 'managementScore')).toBeUndefined();
    expect(pendingKeys(d.items)).toContain('managementScore');
  });

  it('정량표에 mgmt가 있는데 managementScore 후보가 없으면 신인도 해당 없음이 그룹 충족이 아니다', () => {
    const d = decide([...base, qt('10:mgmt')], rules);
    expect(d.items.credibilityScore.reason).toBe('not_applicable');
    expect(d.items.managementScore).toMatchObject({ status: 'needs_review', reason: 'not_found' });
    expect(coveringKey(d.items, 'managementScore')).toBeUndefined();
    expect(reviewCountOf({ items: d.items } as Extraction)).toBeGreaterThanOrEqual(1);
  });

  it('form/qna 문서의 정량표는 후보가 나오지 않는다', () => {
    const doc: DocModel = {
      format: 'hwp5', warnings: [], stats: { chars: 10, tables: 1, ms: 1 },
      blocks: [{
        kind: 'table', index: 0, rows: 2, cols: 3, caption: '정량평가(10점)', loc: { block: 0 },
        cells: [['대항목', '평가요소', '배점'], ['경영상태', '신용도', '10']].flatMap((row, r) =>
          row.map((text, c) => ({ r, c, rowSpan: 1, colSpan: 1, text, blocks: [], loc: { block: 0, line: r + 1 } }))),
      }],
    };
    for (const docKind of ['form', 'qna'] as DocKind[]) {
      const c = runRules([{ doc, attachmentId: 'a', sourceFile: 'a', docKind, priority: 3 }], rules).candidates;
      expect(c.filter((x) => x.target === 'extras.quantTable')).toHaveLength(0);
    }
    const c = runRules([{ doc, attachmentId: 'a', sourceFile: 'a', docKind: 'rfp', priority: 3 }], rules).candidates;
    expect(c.filter((x) => x.target === 'extras.quantTable')).toHaveLength(1);
  });
});

describe('review-count: 해당 없음', () => {
  const na: ExtractedItem<unknown> = { value: null, status: 'verified', reason: 'not_applicable', evidence: ev('a', 'x') };
  const mk = (over: Partial<Record<ExtractionKey, ExtractedItem<unknown>>>) => {
    const items = {} as Record<ExtractionKey, ExtractedItem<unknown>>;
    for (const k of EXTRACTION_KEYS) items[k] = { value: 1, status: 'verified', evidence: ev('a', 'x') };
    return { ...items, ...over };
  };

  it('itemReviewState는 not_applicable, userEdited가 있으면 user_edited', () => {
    expect(itemReviewState(mk({ performanceScore: na }), 'performanceScore')).toBe('not_applicable');
    const edited = { ...na, userEdited: { value: 5, editedAt: '2026-01-01T00:00:00.000Z' } } as ExtractedItem<unknown>;
    expect(itemReviewState(mk({ performanceScore: edited }), 'performanceScore')).toBe('user_edited');
    expect(isNotApplicable(na)).toBe(true);
  });

  it('pendingKeys에서 제외되고 그룹 충족 근거가 아니다', () => {
    const nf: ExtractedItem<unknown> = { value: null, status: 'needs_review', reason: 'not_found' };
    const items = mk({ performanceScore: na, credibilityScore: na, managementScore: nf });
    expect(pendingKeys(items)).toEqual(['managementScore']);
    expect(coveringKey(items, 'managementScore')).toBeUndefined();
  });
});

describe('extract-step: fieldOfItem(docFieldsOf 경유)', () => {
  it('해당 없음 항목은 value null, verified, note NA_NOTE, source', () => {
    const items = {} as Record<ExtractionKey, ExtractedItem<unknown>>;
    for (const k of EXTRACTION_KEYS) items[k] = { value: null, status: 'verified', reason: 'not_applicable', raw: '요약', evidence: ev('a', 'x') };
    const f = docFieldsOf(items, '2026-01-01T00:00:00.000Z');
    expect(f.performanceScore).toMatchObject({ value: null, status: 'verified', note: NA_NOTE, raw: '요약' });
    expect(f.performanceScore!.source).toMatchObject({ kind: 'document', ref: 'a#L-a' });
  });
});
