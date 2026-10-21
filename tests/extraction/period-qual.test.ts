import { describe, expect, it } from 'vitest';
import type { DocBlock, DocModel } from '../../src/core/doc/model';
import type { DocKind } from '../../src/core/extraction/classify';
import { decide, valueKey, type Candidate } from '../../src/core/extraction/decide';
import { loadRules } from '../../src/core/extraction/rules/load';
import { runRules } from '../../src/core/extraction/run-rules';
import { sameKey } from '../../src/core/model/merge';
import { periodKey } from '../../src/core/model/period';
import type { EvidenceRef, ExtractionKey } from '../../src/core/types/extraction';

const rules = loadRules();
const P = (text: string, i: number): DocBlock => ({ kind: 'p', text, loc: { block: i, line: i + 1 } });
const table = (rows: string[][], index = 0): DocBlock => ({
  kind: 'table', index, rows: rows.length, cols: rows[0]!.length, loc: { block: 100 + index },
  cells: rows.flatMap((row, r) => row.map((text, c) => ({ r, c, rowSpan: 1, colSpan: 1, text, blocks: [], loc: { block: 100 + index, line: r + 1 } }))),
});
const docOf = (blocks: DocBlock[]): DocModel => ({ format: 'hwp5', warnings: [], stats: { chars: 10, tables: 1, ms: 1 }, blocks });
const cands = (blocks: DocBlock[], docKind: DocKind = 'rfp', id = 'a') =>
  runRules([{ doc: docOf(blocks), attachmentId: id, sourceFile: id, docKind, priority: 3 }], rules).candidates;
const ev = (id: string): EvidenceRef => ({ attachmentId: id, sourceFile: id, location: `L-${id}`, evidence: `근거-${id}`, ruleId: 'x', docKind: 'rfp' });
const cand = (target: string, value: unknown, id = 'a', priority = 3): Candidate => ({ target, value, evidence: ev(id), priority, weight: 1, docKind: 'rfp' });

describe('기간 표기 비교', () => {
  it.each([
    ['2026. 1. 1. ∼ 2026. 12. 31.(12개월)', '2026-01-01~2026-12-31'],
    ['2026. 1. 1. ∼ 12. 31.', '2026-01-01~2026-12-31'],
    ['2026/01/01 ~ 2026/12/31', '2026-01-01~2026-12-31'],
    ['2026년 3월 1일부터 2027년 2월 28일까지', '2026-03-01~2027-02-28'],
    ['2026. 7. 1. ~ 6. 30.', '2026-07-01~2027-06-30'],
  ])('"%s" -> %s', (v, k) => expect(periodKey(v)).toBe(k));

  it.each([['계약일로부터 12개월'], ['2026. 1. 1. ∼ 12. 31. 및 하자보수 1년'], ['2026년']])('기간 형태가 아니면 null: "%s"', (v) => expect(periodKey(v)).toBeNull());

  it('표기만 다른 같은 기간은 valueKey·sameKey가 같고, 다른 기간은 다름', () => {
    expect(valueKey('2026. 1. 1. ∼ 2026. 12. 31.(12개월)')).toBe(valueKey('2026. 1. 1. ∼ 12. 31.'));
    expect(sameKey('2026. 1. 1. ∼ 2026. 12. 31.(12개월)')).toBe(sameKey('2026/01/01 ~ 2026/12/31'));
    expect(valueKey('2026. 1. 1. ∼ 12. 31.')).not.toBe(valueKey('2027. 1. 1. ∼ 12. 31.'));
  });

  it('공고문·제안요청서 표기가 달라도 사업기간은 확인, 값은 우선순위 높은 문서 표기', () => {
    const d = decide([
      cand('extras.projectPeriod', '2026. 1. 1. ∼ 2026. 12. 31.(12개월)', 'n', 2),
      cand('extras.projectPeriod', '2026. 1. 1. ∼ 12. 31.', 'r1'), cand('extras.projectPeriod', '2026. 1. 1. ∼ 12. 31.', 'r2'),
    ], rules);
    expect(d.extras.projectPeriod).toMatchObject({ status: 'verified', value: '2026. 1. 1. ∼ 2026. 12. 31.(12개월)' });
  });

  it('숫자 없는 빈 서식(". . .부터 . . .까지")은 사업기간 후보가 아님', () => {
    const c = cands([P('사업기간', 0), P('. . .부터 . . .까지', 1), P('□ 사업기간 : . . . ~ . . .', 2)]);
    expect(c.filter((x) => x.target.startsWith('extras.projectPeriod'))).toEqual([]);
  });
});

describe('실적 인정기간 오탐 제외', () => {
  const periods = (line: string) => cands([P('유사사업 수행실적 평가', 0), P(line, 1)]).filter((c) => c.target === 'performancePeriod').map((c) => c.value);
  it('하도급계약 예정금액 대비 최근 3년간 -> 후보 없음', () => {
    expect(periods('※ 하도급계약 예정금액 대비 최근 3년간 유사사업 수행실적 합산액의 비율을 기준으로 평가')).toEqual([]);
  });
  it('경력사항은 5년이내의 증명서 -> 후보 없음', () => {
    expect(periods('핵심투입인력에 대한 증명서류 PL급이상(재직증명서, 경력사항은 5년이내의 증명서)를 제출')).toEqual([]);
    expect(periods('참여인력 경력 5년간 유지')).toEqual([]);
  });
  it('일반 실적 인정기간은 그대로', () => {
    expect(periods('최근 3년간 유사사업 수행실적')).toEqual(['3년']);
    expect(periods('용역수행경력 3년 이내 실적')).toEqual(['3년']);
  });
});

describe('정성 항목만인 배점표', () => {
  const H = ['평가항목', '세부평가항목', '평가기준', '배점'];
  const QUAL = [H, ['전략 및 방법론', '사업 이해도', '이해도 평가', '25'], ['사업수행', '운영방안', '타당성 평가', '30'], ['프로젝트관리', '관리방법론', '관리 평가', '25'], ['프로젝트지원', '교육지원', '교육계획 평가', '20']];
  const qual = (rows: string[][]) => cands([table(rows)]).filter((c) => c.target === 'extras.qualOnlyTable');
  const SCORE_KEYS: ExtractionKey[] = ['credibilityScore', 'managementScore', 'performanceScore', 'performancePeriod', 'performanceMinAmount', 'performanceCondition'];

  it('합계 100점, 정량 항목 없음 -> 근거 1개, 6개 해당 없음', () => {
    const c = qual(QUAL);
    expect(c).toHaveLength(1);
    const d = decide([...c, cand('differentialScoring', false)], rules);
    for (const k of SCORE_KEYS) expect(d.items[k]).toMatchObject({ value: null, status: 'verified', reason: 'not_applicable' });
  });

  it('정량 항목 말이 있거나 합계가 100이 아니거나 행이 적으면 근거 아님', () => {
    expect(qual([...QUAL.slice(0, 4), ['정량평가', '경영상태', '신용평가등급', '20']])).toEqual([]);
    expect(qual(QUAL.slice(0, 4))).toEqual([]);
    expect(qual([H, ['전략', '이해도', '평가', '60'], ['수행', '운영', '평가', '40']])).toEqual([]);
    expect(qual([['구분', '내용', '비고', '배점'], ...QUAL.slice(1)])).toEqual([]);
  });

  it('배점 하나라도 찾았거나 정량평가 설명이 있으면 적용하지 않음', () => {
    const c = qual(QUAL);
    const d1 = decide([...c, cand('performanceScore', 10)], rules);
    expect(d1.items.managementScore).toMatchObject({ status: 'needs_review', reason: 'not_found' });
    const d2 = decide([...c, cand('extras.quantEvalDoc', '정량평가 : 조달청(경영상태, 수행실적)')], rules);
    expect(d2.items.managementScore).toMatchObject({ status: 'needs_review', reason: 'not_found' });
  });

  it('문서에 "정량" 언급이 있으면 정성표 근거를 쓰지 않음', () => {
    const c = cands([table(QUAL), P('정량적 평가는 「협상에 의한 계약 제안서평가 세부기준」에 따름', 0)]);
    expect(c.some((x) => x.target === 'extras.quantMention')).toBe(true);
    expect(decide(c, rules).items.managementScore).toMatchObject({ status: 'needs_review', reason: 'not_found' });
  });

  it('정성표 근거일 때 실적 하위 항목에 후보가 있으면 덮지 않음(명시 문구와 다름)', () => {
    const d = decide([...qual(QUAL), cand('performancePeriod', '5년', 'a'), cand('performancePeriod', '3년', 'b')], rules);
    expect(d.items.performanceScore.reason).toBe('not_applicable');
    expect(d.items.performancePeriod).toMatchObject({ status: 'needs_review', reason: 'conflict' });
    expect(d.items.performanceMinAmount.reason).toBe('not_applicable');
  });
});
