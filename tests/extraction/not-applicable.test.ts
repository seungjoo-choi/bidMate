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
    for (const k of [...PERF_KEYS, 'credibilityScore'] as ExtractionKey[]) expect(d.items[k].naKind).toBe('quant_table');
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

describe('decide: 정량평가 없음 명시', () => {
  const qn = (id = 'n') => cand('extras.quantEvalNone', '정량평가 : 없음', id, 'notice');
  const ALL: ExtractionKey[] = ['credibilityScore', 'managementScore', ...PERF_KEYS];

  it('정량평가 없음 + 표 없음 + 실적 제한 없음 -> 6개 해당 없음(실적 인정기간 충돌도 덮음)', () => {
    const d = decide([...base, qn(), cand('performancePeriod', '5년', 'a'), cand('performancePeriod', '3년', 'b')], rules);
    for (const k of ALL) {
      expect(d.items[k]).toMatchObject({ value: null, status: 'verified', reason: 'not_applicable' });
      expect(d.items[k].evidence?.attachmentId).toBe('n');
      expect(d.items[k].naKind).toBe('quant_none');
    }
    expect(d.items.performancePeriod.candidates?.map((c) => c.value)).toEqual(['5년', '3년']);
    expect(computeStatus(d.items, ['parsed'])).toBe('verified');
  });

  it('참가자격 실적 제한이 있으면 배점 3개만 해당 없음, 하위 3개는 유지', () => {
    const d = decide([...base, qn(), cand('extras.perfRestriction', '수행실적이 있는', 'n', 'notice')], rules);
    for (const k of ['credibilityScore', 'managementScore', 'performanceScore'] as ExtractionKey[]) expect(d.items[k].reason).toBe('not_applicable');
    for (const k of ['performancePeriod', 'performanceMinAmount', 'performanceCondition'] as ExtractionKey[]) expect(d.items[k]).toMatchObject({ status: 'needs_review', reason: 'not_found' });
  });

  it('확인된 배점 값과 확인된 하위 값은 덮지 않는다', () => {
    const d = decide([...base, qn(), cand('performanceScore', 10), cand('performancePeriod', '3년')], rules);
    expect(d.items.performanceScore).toMatchObject({ value: 10, status: 'verified' });
    expect(d.items.performancePeriod).toMatchObject({ value: '3년', status: 'verified' });
    expect(d.items.managementScore.reason).toBe('not_applicable');
  });

  it('정량평가 표 후보가 있으면 적용하지 않는다', () => {
    const d = decide([...base, qn(), cand('extras.quantTable', '깨진값')], rules);
    expect(d.items.managementScore).toMatchObject({ status: 'needs_review', reason: 'not_found' });
  });

  it('가감점 표가 있으면 신인도는 해당 없음 아님', () => {
    const d = decide([...base, qn(), cand('extras.bonusTable', '가점 6항목, 감점 2항목')], rules);
    expect(d.items.credibilityScore.reason).not.toBe('not_applicable');
    expect(d.items.managementScore.reason).toBe('not_applicable');
  });

  it('문구 없으면 그대로 not_found', () => {
    const d = decide([...base], rules);
    for (const k of ALL) expect(d.items[k]).toMatchObject({ status: 'needs_review', reason: 'not_found' });
  });
});

describe('rules: 정량평가 없음 문구 / 실적 제한', () => {
  const docOf = (lines: string[]): DocModel => ({
    format: 'hwp5', warnings: [], stats: { chars: 10, tables: 0, ms: 1 },
    blocks: lines.map((text, i) => ({ kind: 'p' as const, text, loc: { block: i, line: i + 1 } })),
  });
  const hits = (lines: string[], target: string, docKind: DocKind = 'notice') =>
    runRules([{ doc: docOf(lines), attachmentId: 'a', sourceFile: 'a', docKind, priority: 2 }], rules).candidates.filter((c) => c.target === target);

  it.each([['- 정량평가 : 없음'], ['정량평가: 미실시'], ['정량적 평가 : 해당 없음'], ['- 정량평가 : 없음 - 정성평가 : 경제·인문사회연구회']])('"%s" -> 후보', (line) => {
    expect(hits([line], 'extras.quantEvalNone')).toHaveLength(1);
  });

  it.each([['정량평가 : 조달청'], ['정량평가 : 없음시 정성평가만 실시'], ['정량평가 없음'], ['정량평가 : 없음으로 처리']])('"%s" -> 후보 없음', (line) => {
    expect(hits([line], 'extras.quantEvalNone')).toHaveLength(0);
  });

  it('실적 제한 문구는 공고문에서만 잡고 하수급인 실적은 제외', () => {
    expect(hits(['최근 3년 이내 단일 건 5억원 이상 용역실적이 있는 자'], 'extras.perfRestriction')).toHaveLength(1);
    expect(hits(['이 입찰은 실적제한 경쟁입찰입니다'], 'extras.perfRestriction')).toHaveLength(1);
    expect(hits(['하수급인의 실적이 있는 경우'], 'extras.perfRestriction')).toHaveLength(0);
    expect(hits(['하수급인의 수행실적이 있는 경우'], 'extras.perfRestriction')).toHaveLength(0);
    expect(hits(['실적제한 없음'], 'extras.perfRestriction')).toHaveLength(0);
    expect(hits(['실적 제한을 두지 않음'], 'extras.perfRestriction')).toHaveLength(0);
    expect(hits(['용역실적이 있는 자'], 'extras.perfRestriction', 'rfp')).toHaveLength(0);
  });

  it('합산 비율 평가 문구(perfAggregate)만 잡고 하도급 대비는 제외', () => {
    const agg = (line: string) => hits([line], 'extras.perfAggregate', 'rfp');
    expect(agg('   * 해당 사업규모 대비 입찰공고일 기준 최근 3년간 사업수행실적(금액 기준)을 합산 적용. 단, 입찰공고일을 기준으로 최근 7년 이내에 사업을 개시한 창업기업에 대해서는 최근 7년간 사업수행실적을 합산 적용.')).toHaveLength(1);
    expect(agg('※ 하도급계약 예정금액 대비 최근 3년간 유사사업 수행실적 합산액의 비율을 기준으로 평가')).toHaveLength(0);
    expect(agg('해당 사업규모 대비 실적 비율 점수를 부여한다')).toHaveLength(0);
    expect(agg('추정가격 대비 단일 건 최대 실적금액 비율로 평가(공동수급체는 구성원 실적을 지분율로 합산)')).toHaveLength(0);
    expect(agg('사업금액 대비 1건의 최대 실적 비율 (공동수급체 실적 합산)')).toHaveLength(0);
  });

  it('건당 실적 하한 문구(perfPerCase)만 잡고 하수급인 실적은 제외', () => {
    const pc = (line: string) => hits([line], 'extras.perfPerCase', 'rfp');
    expect(pc('단일 건 3억 이상의 경우 인정')).toHaveLength(1);
    expect(pc('건당 6억원 이상 실적만 인정')).toHaveLength(1);
    expect(pc('실적규모 건당 1억 이상')).toHaveLength(1);
    for (const line of ['단일 계약 건 5억 이상', '단일 용역 계약금액 5억 이상', '1건의 용역금액이 5억 이상', '1건 계약금액이 사업금액의 50% 이상',
      '단일건 사업규모의 1/2 이상', '1건 계약금액이 추정가격의 2분의 1 이상', '단일 프로젝트 5억 이상']) {
      expect(pc(line), line).toHaveLength(1);
    }
    expect(hits(['단일 건 3억 이상의 경우 인정'], 'extras.perfPerCase', 'qna')).toHaveLength(1);
    expect(pc('하수급인의 건당 1억 이상 실적')).toHaveLength(0);
  });
});

describe('실적 합산 비율 평가', () => {
  const agg = (id = 'g') => cand('extras.perfAggregate', '해당사업규모대비…합산', id);
  const NF = { status: 'needs_review', reason: 'not_found' };

  it('(a) 실적 배점 + 합산 문구 -> 인정금액 해당 없음(perf_aggregate), 근거는 합산 후보', () => {
    const d = decide([...base, cand('performanceScore', 5), agg()], rules);
    expect(d.items.performanceMinAmount).toMatchObject({ value: null, status: 'verified', reason: 'not_applicable', naKind: 'perf_aggregate' });
    expect(d.items.performanceMinAmount.evidence?.attachmentId).toBe('g');
    expect(d.items.performancePeriod).toMatchObject(NF);
    expect(d.items.performanceCondition).toMatchObject(NF);
  });

  it('(b) 건당 실적 문구(perfPerCase)가 있으면 유지', () => {
    const d = decide([...base, cand('performanceScore', 5), agg(), cand('extras.perfPerCase', '단일건3억이상')], rules);
    expect(d.items.performanceMinAmount).toMatchObject(NF);
  });

  it('(c) performanceCondition에 건당 표현이 있으면 유지', () => {
    const d = decide([...base, cand('performanceScore', 5), agg(), cand('performanceCondition', '유사용역: 단일 건 3억 이상 사업')], rules);
    expect(d.items.performanceMinAmount).toMatchObject(NF);
  });

  it('(d) 실적 배점이 없거나 충돌이면 유지', () => {
    expect(decide([...base, agg()], rules).items.performanceMinAmount).toMatchObject(NF);
    const d = decide([...base, cand('performanceScore', 5, 'a'), cand('performanceScore', 10, 'b'), agg()], rules);
    expect(d.items.performanceMinAmount).toMatchObject(NF);
  });

  it('(e) 인정금액 값이 이미 있으면 그대로', () => {
    const d = decide([...base, cand('performanceScore', 5), agg(), cand('performanceMinAmount', 300000000)], rules);
    expect(d.items.performanceMinAmount).toMatchObject({ value: 300000000, status: 'verified' });
  });
});
