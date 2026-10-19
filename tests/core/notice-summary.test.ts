import { describe, expect, it } from 'vitest';
import { basicFacts, evalFacts } from '../../src/core/model/notice-summary';
import { emptyNotice } from '../../src/core/model/notice-fields';
import type { Notice } from '../../src/core/types/notice';

const mk = (kind?: 'bid' | 'prespec'): Notice =>
  emptyNotice('N-000', { noticeNo: 'N', kind, origin: 'g2b' }, 'f', '2026-01-01T00:00:00Z');

const BASIC_KEYS = [
  'kind', 'noticeNo', 'round', 'title', 'orderingOrg', 'demandOrg', 'estimatedPrice', 'contractMethod', 'awardMethod',
  'jointVentureAllowed', 'eligibility', 'projectPeriod', 'bidCloseAt', 'openingAt', 'attachmentCount',
];

describe('basicFacts', () => {
  it('bid: 결과 키 집합이 허용 목록과 같다', () => {
    expect(Object.keys(basicFacts(mk())).sort()).toEqual([...BASIC_KEYS].sort());
  });
  it('prespec: prespec 분기가 붙고 officerName/officerTel 키가 없다', () => {
    const n = mk('prespec');
    n.prespec.officerName = { value: '홍길동', status: 'verified' };
    n.prespec.officerTel = { value: '010-0000-0000', status: 'verified' };
    n.prespec.bizDivision = { value: '용역', status: 'verified' };
    const f = basicFacts(n);
    expect(Object.keys(f).sort()).toEqual([...BASIC_KEYS, 'prespec'].sort());
    expect(Object.keys(f.prespec!).sort()).toEqual(['assignedBudget', 'bizDivision', 'opinionCloseAt']);
    expect(f.prespec?.bizDivision).toBe('용역');
    expect(JSON.stringify(f)).not.toMatch(/officer|홍길동|010-0000/);
  });
});

describe('evalFacts', () => {
  it('항목 키 집합이 허용 목록과 같다', () => {
    const f = evalFacts(mk(), null);
    expect(Object.keys(f.items).sort()).toEqual(
      ['credibilityScore', 'differentialScoring', 'managementScore', 'performanceMinAmount', 'performancePeriod', 'performanceScore']);
    expect(Object.keys(f).sort()).toEqual(['conflictCount', 'extractionStatus', 'items', 'reviewCount']);
    expect(f.extractionStatus).toBe('not_run');
  });
  it('needsCheck: needs_review/missing은 true, user_edited/verified는 false', () => {
    const n = mk();
    n.evaluation.performanceScore = { value: 10, status: 'needs_review' };
    n.evaluation.managementScore = { value: null, status: 'missing' };
    n.evaluation.credibilityScore = { value: 5, status: 'user_edited' };
    n.evaluation.performancePeriod = { value: '5년', status: 'verified' };
    const it = evalFacts(n, null).items;
    expect([it.performanceScore.needsCheck, it.managementScore.needsCheck, it.credibilityScore.needsCheck, it.performancePeriod.needsCheck])
      .toEqual([true, true, false, false]);
    expect(it.performanceScore.value).toBe(10);
  });
});
