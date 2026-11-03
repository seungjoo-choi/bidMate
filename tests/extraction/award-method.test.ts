import { describe, expect, it } from 'vitest';
import type { DocBlock, DocModel } from '../../src/core/doc/model';
import { decide, type Candidate } from '../../src/core/extraction/decide';
import { NA_NOTES } from '../../src/core/extraction/review-count';
import { loadRules } from '../../src/core/extraction/rules/load';
import { runRules } from '../../src/core/extraction/run-rules';
import type { EvidenceRef } from '../../src/core/types/extraction';
import { docOnlyFieldsOf } from '../../src/engine/extraction/extract-step';

const rules = loadRules();
const P = (text: string, i: number): DocBlock => ({ kind: 'p', text, loc: { block: i, line: i + 1 } });
const docOf = (blocks: DocBlock[]): DocModel => ({ format: 'txt', warnings: [], stats: { chars: 10, tables: 0, ms: 1 }, blocks });
const fromLines = (lines: string[]) =>
  runRules([{ doc: docOf(lines.map(P)), attachmentId: 'n', sourceFile: 'n.txt', docKind: 'notice', priority: 2 }], rules).candidates;
const ev = (id: string): EvidenceRef => ({ attachmentId: id, sourceFile: id, location: `L-${id}`, evidence: `근거-${id}`, ruleId: 'x', docKind: 'rfp' });
const cand = (target: string, value: unknown, id = 'a'): Candidate => ({ target, value, evidence: ev(id), priority: 3, weight: 1, docKind: 'rfp' });

const SMALL = '소액수의견적-소액수의견적(2인 이상 견적 제출)';
const SMALL_LINE = '용역 소액수의 견적제출 안내공고';
const QUAL = '적격심사제-추정가격이 5억원 미만 2억원 이상';
const SCORES = ['credibilityScore', 'managementScore', 'performanceScore', 'differentialScoring'] as const;
const PERF = ['performancePeriod', 'performanceMinAmount', 'performanceCondition'] as const;
const ALL = [...SCORES, ...PERF] as const;

const isNA = (it?: { status: string; reason?: string }) => !!it && it.status === 'verified' && it.reason === 'not_applicable';
const naKeys = (d: ReturnType<typeof decide>) => ALL.filter((k) => isNA(d.items[k]));

describe('나라장터 낙찰방법에 따른 해당 없음', () => {
  it('1. 소액수의견적 + 근거 줄 -> 배점/차등/실적 항목과 제안서 평가일자 해당 없음', () => {
    const d = decide(fromLines([SMALL_LINE]), rules, { awardMethod: SMALL });
    for (const k of ALL) {
      expect(d.items[k]).toMatchObject({ status: 'verified', reason: 'not_applicable', value: null, naKind: 'small_quote' });
      expect(d.items[k].evidence?.evidence).toContain(SMALL_LINE);
    }
    expect(isNA(d.extras.proposalEvalAt)).toBe(true);
  });

  it('2. 소액수의견적이어도 문서에 낙찰방법 문장이 없으면 not_found', () => {
    const d = decide(fromLines(['제안서 평가 안내']), rules, { awardMethod: SMALL });
    for (const k of ALL) expect(d.items[k]).toMatchObject({ status: 'needs_review', reason: 'not_found' });
  });

  it('3. 배점 값이 확인된 경우 아무 항목도 해당 없음으로 바뀌지 않음', () => {
    const d = decide([...fromLines([SMALL_LINE]), cand('performanceScore', 10)], rules, { awardMethod: SMALL });
    expect(naKeys(d)).toEqual([]);
  });

  it('4. 실적 제한 후보가 있으면 배점/차등만 해당 없음, 실적 하위 항목은 not_found 유지', () => {
    const d = decide([...fromLines([SMALL_LINE]), cand('extras.perfRestriction', '최근 3년 용역실적')], rules, { awardMethod: SMALL });
    expect(naKeys(d)).toEqual([...SCORES]);
    for (const k of PERF) expect(d.items[k]).toMatchObject({ status: 'needs_review', reason: 'not_found' });
  });

  it('5. 적격심사 + 대상 문장 -> 차등점수제만 해당 없음', () => {
    const d = decide(fromLines(['가. 총액입찰, 전자입찰, 제한경쟁, 적격심사대상입니다.']), rules, { awardMethod: QUAL });
    expect(d.items.differentialScoring).toMatchObject({ status: 'verified', reason: 'not_applicable', naKind: 'qualified' });
    expect(d.items.managementScore).toMatchObject({ status: 'needs_review', reason: 'not_found' });
  });

  it('6. 적격심사 비대상 문장만 있으면 차등점수제 not_found 유지', () => {
    const d = decide(fromLines(['나. 적격심사 비대상 용역입니다.']), rules, { awardMethod: QUAL });
    expect(d.items.differentialScoring).toMatchObject({ status: 'needs_review', reason: 'not_found' });
  });

  it('7. 최저가낙찰제 + 최저가 문장 -> 차등점수제 lowest_price', () => {
    const d = decide([cand('extras.awardMethodDoc', '최저가 낙찰자')].map((c) => ({ ...c, evidence: { ...c.evidence, evidence: '6. 최저가 낙찰자 결정방법' } })), rules, { awardMethod: '최저가낙찰제-최저가낙찰자' });
    expect(d.items.differentialScoring).toMatchObject({ status: 'verified', reason: 'not_applicable', naKind: 'lowest_price' });
  });

  it('8. 협상에 의한 계약이면 변화 없음', () => {
    const d = decide(fromLines([SMALL_LINE]), rules, { awardMethod: '협상에의한계약-협상에 의한 낙찰자 결정' });
    expect(naKeys(d)).toEqual([]);
  });

  it('9. ctx 생략이면 변화 없음', () => {
    const d = decide(fromLines([SMALL_LINE]), rules);
    expect(naKeys(d)).toEqual([]);
  });

  it('10. 적격심사 + 근거 줄이어도 차등점수제 후보 false는 verified false 유지', () => {
    const doc = { ...cand('extras.awardMethodDoc', '적격심사대상입니다'), evidence: { ...ev('a'), evidence: '가. 적격심사대상입니다.' } };
    const d = decide([doc, cand('differentialScoring', false)], rules, { awardMethod: QUAL });
    expect(d.items.differentialScoring).toMatchObject({ status: 'verified', value: false });
    expect(isNA(d.items.differentialScoring)).toBe(false);
  });

  it('11. docOnlyFieldsOf는 해당 없음 제안서 평가일자를 날짜 변환 없이 돌려줌', () => {
    const d = decide(fromLines([SMALL_LINE]), rules, { awardMethod: SMALL });
    const f = docOnlyFieldsOf(d.extras, '2026-10-20T00:00:00Z').proposalEvalAt;
    expect(f).toMatchObject({ value: null, status: 'verified', note: NA_NOTES.small_quote });
    expect(f?.source?.kind).toBe('document');
  });

  it('12. 신뢰도 배점 후보가 충돌하면 아무 항목도 해당 없음으로 바뀌지 않음', () => {
    const cs = [...fromLines([SMALL_LINE]), cand('credibilityScore', 5, 'a'), cand('credibilityScore', 3, 'b')];
    const d = decide(cs, rules, { awardMethod: SMALL });
    for (const k of ['managementScore', 'performanceScore', 'differentialScoring', ...PERF] as const) {
      expect(d.items[k]).toMatchObject({ status: 'needs_review', reason: 'not_found' });
    }
    expect(d.extras.proposalEvalAt).toMatchObject({ status: 'needs_review', reason: 'not_found' });
  });

  it('13. 적격심사 대상이 아니라는 문장만 있으면 차등점수제 not_found 유지', () => {
    const d = decide(fromLines(['본 용역은 적격심사 대상이 아닙니다.']), rules, { awardMethod: QUAL });
    expect(d.items.differentialScoring).toMatchObject({ status: 'needs_review', reason: 'not_found' });
  });
});
