import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { hwp5Parser } from '../../src/engine/parsers/hwp5/parser';
import { allTables, Grid } from '../../src/core/doc/grid';
import type { DocBlock, DocModel } from '../../src/core/doc/model';
import { loadRules } from '../../src/core/extraction/rules/load';
import { runRules as runRulesFull, type RuleDocInput } from '../../src/core/extraction/run-rules';
import { validateRule, type RuleSet } from '../../src/core/extraction/rules/schema';
import { computeStatus, decide, type Candidate } from '../../src/core/extraction/decide';
import type { DocKind } from '../../src/core/extraction/classify';
import type { EvidenceRef } from '../../src/core/types/extraction';

const runRules = (i: RuleDocInput[], r: RuleSet) => runRulesFull(i, r).candidates;
const DIR = 'tests/fixtures/docs/R26BK01722175';
const parse = async (n: string): Promise<DocModel> => {
  const r = await hwp5Parser.parse({ name: n, bytes: new Uint8Array(readFileSync(`${DIR}/${n}`)), deadlineAt: Date.now() + 20000 });
  if (!r.ok) throw new Error(`${r.reason}: ${r.message}`);
  return r.doc;
};

let f1: RuleDocInput, f3: RuleDocInput, f6: RuleDocInput;
beforeAll(async () => {
  f1 = { doc: await parse('1. 입찰공고문.hwp'), attachmentId: 'f1', sourceFile: '1. 입찰공고문.hwp', docKind: 'notice', priority: 2 };
  f3 = { doc: await parse('2. 제안요청서.hwp'), attachmentId: 'f3', sourceFile: '2. 제안요청서.hwp', docKind: 'rfp', priority: 3 };
  f6 = { doc: await parse('5. (참고) 사전공고 질의답변.hwp'), attachmentId: 'f6', sourceFile: '5. (참고) 사전공고 질의답변.hwp', docKind: 'qna', priority: 4 };
});

describe('실제 문서 f1+f3', () => {
  it('기대값', () => {
    const rules = loadRules();
    const cands = runRules([f1, f3], rules);
    const { items, extras } = decide(cands, rules);

    const quant = allTables(f3.doc).find((t) => {
      const g = new Grid(t);
      return g.headerRow().cells.map((c) => c.text).join('|') === '구분|평가부문|평가항목|배점' && g.at(1, 0)?.text.startsWith('정량평가');
    })!;
    expect(items.managementScore).toMatchObject({ value: 4, status: 'verified' });
    expect(items.managementScore.evidence!.location).toBe(`표${quant.index} r1c3`);
    expect(items.managementScore.evidence!.attachmentId).toBe('f3');
    expect(items.credibilityScore).toMatchObject({ value: null, status: 'needs_review', reason: 'no_total', raw: '가점 6항목, 감점 2항목' });
    expect(items.credibilityScore.evidence!.evidence).toMatch(/^(가점|감점)/);
    expect(items.performanceScore).toMatchObject({ value: 6, status: 'verified' });
    expect(extras.projectPeriod).toMatchObject({ value: '계약체결일로부터 2028.02.28.까지', status: 'verified' });
    expect(items.performancePeriod).toMatchObject({ value: '5년', status: 'verified' });
    expect(items.performancePeriod.raw).toContain('5년 이내');
    expect(items.performanceMinAmount).toMatchObject({ value: 500000000, status: 'verified' });
    expect(items.performanceMinAmount.evidence!.evidence).toContain('5억원 이상');

    const cond = items.performanceCondition;
    const text = cond.value as string;
    expect(text.startsWith('※ 유사사업 :')).toBe(true);
    expect(text).toContain('(단, 유사사업이라고 하더라도');
    expect(text).not.toContain('작성 및 증빙방법');
    expect(text.trimEnd().endsWith('불포함)')).toBe(true);
    expect(cond.status).toBe('verified');

    expect(items.differentialScoring).toMatchObject({ value: false, status: 'verified' });
    expect(items.differentialScoring.evidence!.attachmentId).toBe('f1');
    expect(items.differentialScoring.evidence!.line).toBeGreaterThan(0);
  });

  it('evidence 300자/context 400자 이내, 원문(공백 보존)', () => {
    const cands = runRules([f1, f3], loadRules());
    for (const c of cands) {
      expect(c.evidence.evidence.length).toBeLessThanOrEqual(300);
      expect((c.evidence.context ?? '').length).toBeLessThanOrEqual(400);
    }
    expect(cands.find((c) => c.target === 'differentialScoring')!.evidence.evidence).toBe('차등점수제 : 미적용');
  });

  it('f3 전체 규칙 실행 시간', () => {
    const t0 = performance.now();
    runRules([f3], loadRules());
    const ms = performance.now() - t0;
    console.log(`[perf] f3 runRules ${ms.toFixed(0)}ms`);
    expect(ms).toBeLessThan(2000);
  });
});

describe('실제 문서 f1+f3+f6 (질의답변 포함 실측 고정)', () => {
  it('질의답변은 질문 행과 "제안요청서에 명시된 기준" 상투 답변이 빠져 credibilityScore 제외 verified', () => {
    const rules = loadRules();
    const { items } = decide(runRules([f1, f3, f6], rules), rules);
    expect(items.managementScore).toMatchObject({ value: 4, status: 'verified' });
    expect(items.credibilityScore).toMatchObject({ value: null, status: 'needs_review', reason: 'no_total' });
    expect(items.performanceScore).toMatchObject({ value: 6, status: 'verified' });
    expect(items.performancePeriod).toMatchObject({ value: '5년', status: 'verified' });
    // qna의 "5억 이상"은 질문 행(r1c1)에만 있어 answersOnly로 빠지므로 후보가 늘지 않는다.
    expect(items.performanceMinAmount).toMatchObject({ value: 500000000, status: 'verified' });
    expect(items.performanceMinAmount.candidates ?? []).toHaveLength(0);
    expect(items.differentialScoring).toMatchObject({ value: false, status: 'verified' });
    // 답변 r4c1 "실적 인정 범위는 제안요청서에 명시된 기준을 적용합니다"는 앵커에서 제외된다.
    const c = items.performanceCondition;
    expect(c.status).toBe('verified');
    expect(c.evidence!.attachmentId).toBe('f3');
    expect((c.value as string).startsWith('※ 유사사업 :')).toBe(true);
    expect((c.candidates ?? []).filter((x) => x.evidence.docKind === 'qna')).toHaveLength(0);
  });
});

describe('확장성', () => {
  it('extras.techRatio 규칙만 추가해도 extras에 90', () => {
    const rules = loadRules({
      synonyms: { techEval: ['기술능력평가'] },
      rules: [{
        id: 'extra.techRatio', target: 'extras.techRatio', strategy: 'window-regex',
        anchor: 'techEval', pattern: '기술능력평가(?<v>\\d+)%', blocksAfter: 0, valueType: 'number',
      }],
    });
    expect(rules.warnings).toEqual([]);
    const { items, extras } = decide(runRules([f1], rules), rules);
    expect(extras.techRatio).toMatchObject({ value: 90, status: 'verified' });
    expect(extras.techRatio!.evidence!.evidence).toContain('기술능력평가 90%');
    expect(items.differentialScoring.value).toBe(false);
  });
});

// ---- 합성 ----
const P = (text: string, block = 0): DocBlock => ({ kind: 'p', text, loc: { block } });
const doc = (blocks: DocBlock[]): DocModel => ({ format: 'txt', blocks, warnings: [], stats: { chars: 0, tables: 0, ms: 0 } });
const input = (d: DocModel, docKind: DocKind = 'notice', priority = 2): RuleDocInput => ({ doc: d, attachmentId: 'x', sourceFile: 'x.txt', docKind, priority });
const ev = (id: string, docKind: DocKind, ruleId = 'cred.table'): EvidenceRef => ({ attachmentId: id, sourceFile: id, location: 'L', evidence: 'e', ruleId, docKind });
const cand = (target: string, value: unknown, id: string, docKind: DocKind, priority: number, ruleId?: string): Candidate =>
  ({ target, value, evidence: ev(id, docKind, ruleId), priority, weight: 1, docKind });

describe('결정기', () => {
  const rules = loadRules();
  it('두 문서 점수 4와 5 → value null, conflict, 후보 2', () => {
    const { items } = decide([cand('credibilityScore', 4, 'a', 'notice', 2), cand('credibilityScore', 5, 'b', 'rfp', 3)], rules);
    expect(items.credibilityScore.value).toBeNull();
    expect(items.credibilityScore).toMatchObject({ status: 'needs_review', reason: 'conflict' });
    expect(items.credibilityScore.candidates).toHaveLength(2);
  });
  it('qna 문서에만 값 → low_confidence', () => {
    const { items } = decide([cand('credibilityScore', 4, 'q', 'qna', 4)], rules);
    expect(items.credibilityScore).toMatchObject({ value: 4, status: 'needs_review', reason: 'low_confidence' });
  });
  it('후보 0개 → not_found', () => {
    const { items } = decide([], rules);
    expect(items.performanceScore).toMatchObject({ value: null, status: 'needs_review', reason: 'not_found' });
  });
  it('같은 값이 두 곳 → verified, candidates 1개 이상', () => {
    const { items } = decide([cand('performanceScore', 6, 'a', 'notice', 2), cand('performanceScore', 6, 'b', 'rfp', 3)], rules);
    expect(items.performanceScore.status).toBe('verified');
    expect(items.performanceScore.evidence!.attachmentId).toBe('a');
    expect(items.performanceScore.candidates!.length).toBeGreaterThanOrEqual(1);
  });
  it('prefer_priority 충돌 → 최우선 값, needs_review', () => {
    const { items } = decide([
      cand('performanceCondition', '기준 B', 'r', 'rfp', 3, 'perf.condition'),
      cand('performanceCondition', '기준 A', 'n', 'notice', 2, 'perf.condition'),
    ], rules);
    expect(items.performanceCondition).toMatchObject({ value: '기준 A', status: 'needs_review', reason: 'conflict' });
  });
  it('값 비교 키: "5년"/"5 년", 공백 차이는 같은 값', () => {
    const { items } = decide([cand('performancePeriod', '5년', 'a', 'notice', 2), cand('performancePeriod', '5 년', 'b', 'rfp', 3)], rules);
    expect(items.performancePeriod.status).toBe('verified');
  });
  it('전체 status', () => {
    const ok = decide([
      cand('credibilityScore', 1, 'a', 'notice', 2), cand('managementScore', 1, 'a', 'notice', 2), cand('performanceScore', 1, 'a', 'notice', 2),
      cand('performancePeriod', '5년', 'a', 'notice', 2), cand('performanceMinAmount', 1, 'a', 'notice', 2),
      cand('performanceCondition', 'c', 'a', 'notice', 2), cand('differentialScoring', false, 'a', 'notice', 2),
    ], rules).items;
    expect(computeStatus(ok, ['parsed', 'skipped'])).toBe('verified');
    expect(computeStatus(decide([], rules).items, ['parsed'])).toBe('needs_review');
    expect(computeStatus(ok, ['unsupported', 'scanned', 'encrypted'])).toBe('unsupported');
    expect(computeStatus(ok, ['failed', 'corrupt'])).toBe('failed');
  });
});

describe('규칙 로더', () => {
  it('id 덮어쓰기/추가, 동의어 키 단위 덮어쓰기', () => {
    const base = loadRules();
    const r = loadRules({
      synonyms: { credibility: ['신인도'] },
      rules: [
        { id: 'perf.period', target: 'performancePeriod', strategy: 'window-regex', anchor: 'perfAnchor', pattern: '(?<v>\\d+)년', blocksAfter: 1, valueType: 'years' },
        { id: 'new.rule', target: 'extras.n', strategy: 'keyword-enum', pattern: 'x', map: { x: true } },
      ],
    });
    expect(r.synonyms.credibility).toEqual(['신인도']);
    expect(r.synonyms.performance).toEqual(base.synonyms.performance);
    expect(r.rules).toHaveLength(base.rules.length + 1);
    expect(r.rules.find((x) => x.id === 'perf.period')).toMatchObject({ blocksAfter: 1 });
    expect(r.warnings).toEqual([]);
  });
  it('틀린 규칙/동의어는 그 항목만 버리고 warning', () => {
    const base = loadRules();
    const good = { id: 'ok.rule', target: 'extras.ok', strategy: 'keyword-enum', pattern: 'x', map: { x: true } };
    const bads: unknown[] = [
      { id: 'z', target: 'extras.z', strategy: 'window-regex', anchor: '(', pattern: 'a', blocksAfter: 0, valueType: 'string' },
      { id: 'e1', target: 'extras.__proto__', strategy: 'keyword-enum', pattern: 'x', map: { x: true } },
      { id: 'e2', target: 'extras.1a', strategy: 'keyword-enum', pattern: 'x', map: { x: true } },
      { id: 'tl', target: 'credibilityScore', strategy: 'table-score', label: '(', scoreHeader: 'scoreHeader' },
      { id: 'il', target: 'credibilityScore', strategy: 'inline-score', label: 'credibility', maxGap: 500 },
      { id: 'nk', target: 'extras.n', strategy: 'keyword-enum', pattern: '{{nokey}}', map: { x: true } },
      { id: 'rd', target: 'extras.r', strategy: 'keyword-enum', pattern: '(a+)+b', map: { a: true } },
    ];
    const r = loadRules({ version: 'v9', synonyms: { empty: [], blank: [' '], ok: ['가'] }, rules: [...bads, good] });
    expect(r.rules).toHaveLength(base.rules.length + 1);
    expect(r.rules.some((x) => x.id === 'ok.rule')).toBe(true);
    expect(r.synonyms.ok).toEqual(['가']);
    expect('empty' in r.synonyms || 'blank' in r.synonyms).toBe(false);
    expect(r.warnings.length).toBeGreaterThanOrEqual(bads.length + 2);
    expect(r.version).toBe(`${base.version}+v9`);
    const r2 = loadRules('str');
    expect(r2.rules).toEqual(base.rules);
    expect(r2.warnings.length).toBe(1);
  });
});

describe('inline-score 오탐 방지', () => {
  const rules = loadRules();
  const inline = (d: DocModel) => runRules([input(d)], rules).filter((c) => c.evidence.ruleId.endsWith('.inline'));
  it('라벨 없이 "N점"만 있으면 후보가 없다', () => {
    expect(inline(doc([P('총점 100점 만점, 기술 80점, 가격 20점'), P('배점 10점')]))).toEqual([]);
  });
  it('실제 문서(f1, f3)에서도 inline 후보가 오염되지 않는다', () => {
    const c = runRules([f1, f3], rules).filter((x) => x.evidence.ruleId.endsWith('.inline'));
    expect(c.every((x) => /신인도|경영상태|신용|실적|유사/.test(x.evidence.evidence))).toBe(true);
    expect(c.every((x) => x.weight < 1)).toBe(true);
  });
  it('라벨이 붙은 경우만 후보', () => {
    const c = inline(doc([P('대외 신인도 평가는 5점으로 한다')]));
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ target: 'credibilityScore', value: 5 });
  });
});

describe('docKinds 제한', () => {
  it('규칙의 docKinds 밖 문서는 건너뛴다', () => {
    const rules = loadRules({ rules: [{ id: 'diff.enum', target: 'differentialScoring', strategy: 'keyword-enum', docKinds: ['rfp'], pattern: '차등점수제[^가-힣]{0,6}?(?<v>미적용|적용)', map: { 미적용: false, 적용: true } }] });
    const d = doc([P('차등점수제 : 미적용')]);
    expect(runRules([input(d, 'notice')], rules).filter((c) => c.target === 'differentialScoring')).toEqual([]);
    expect(runRules([input(d, 'rfp', 3)], rules).filter((c) => c.target === 'differentialScoring')).toHaveLength(1);
  });
});

// ---- 정규식 단위 ----
const ruleOf = (id: string) => loadRules().rules.find((r) => r.id === id) as Extract<ReturnType<typeof loadRules>['rules'][number], { pattern: string }>;
const runOne = (id: string, text: string) => {
  const rules = loadRules();
  return runRules([input(doc([P(text)]))], { ...rules, rules: rules.rules.filter((r) => r.id === id) });
};

describe('perf.amount', () => {
  const cases: Array<[string, number | null]> = [
    ['유사사업 500,000,000원 이상', 500000000],
    ['유사사업 5억 5천만원 이상', 550000000],
    ['유사사업 5억원 이상', 500000000],
    ['유사사업 3천만원 이상', 30000000],
    ['유사사업 1,500만원 이상', 15000000],
    ['유사사업 15억원 사업', null],
  ];
  for (const [t, v] of cases) {
    it(t, () => {
      const c = runOne('perf.amount', t);
      if (v === null) expect(c).toEqual([]);
      else expect(c.map((x) => x.value)).toEqual([v]);
    });
  }
  it('숫자 중간에서 시작하지 않는다(압축 텍스트 기준)', () => {
    expect(new RegExp(ruleOf('perf.amount').pattern).test('2,500,000,000원이상')).toBe(true);
    expect(new RegExp(ruleOf('perf.amount').pattern).exec('12,345원이상')!.groups!.v).toBe('12,345원');
  });
});

describe('diff.enum', () => {
  const cases: Array<[string, boolean]> = [
    ['차등점수제 적용 여부 : 미적용', false],
    ['차등점수제(적용/미적용) : 적용', true],
    ['차등점수제 : 미적용', false],
    ['차등점수제 적용', true],
  ];
  for (const [t, v] of cases) {
    it(t, () => {
      expect(runOne('diff.enum', t).map((x) => x.value)).toEqual([v]);
    });
  }
});

describe('perf.period', () => {
  it('2024년간은 매치되지 않는다', () => {
    expect(runOne('perf.period', '유사사업 2024년간 수행')).toEqual([]);
    expect(runOne('perf.period', '유사사업 최근 3년간 수행').map((x) => x.value)).toEqual(['3년']);
  });
  it('창업기업 예외 기간(최근 7년 이내에 사업을 개시한)은 후보가 아니다', () => {
    const t = '* 해당 사업규모 대비 입찰공고일 기준 최근 3년간 사업수행실적(금액 기준)을 합산 적용. 단, 입찰공고일을 기준으로 최근 7년 이내에 사업을 개시한 창업기업에 대해서는 최근 7년간 사업수행실적을 합산 적용';
    expect(runOne('perf.period', t).map((x) => x.value)).toEqual(['3년']);
  });
  it('기준 낱말을 넓혀 "유사 또는 동등 실적", "관련 사업 실적", "5년(…) 내"도 읽는다', () => {
    expect(runOne('perf.period', '최근 3년간 유사 또는 동등 실적').map((x) => x.value)).toEqual(['3년']);
    expect(runOne('perf.period', '공고일 기준 최근 3년 이내 관련 사업 실적').map((x) => x.value)).toEqual(['3년']);
    expect(runOne('perf.period', '최근 5년(2021. 10. 1. ~ 2026. 9. 30.) 내 이행 완료된 유사 실적에 한함').map((x) => x.value)).toEqual(['5년']);
  });
  it('제출 서류 작성 안내와 목차는 인정기간이 아니다', () => {
    expect(runOne('perf.period', '※ 최근 5년간 주요 사업실적만을 요약 기재할 것')).toEqual([]);
    expect(runOne('perf.period', 'ㆍ최근 3년 이내 행사 기획 및 운영실적 작성')).toEqual([]);
    expect(runOne('perf.period', '〔붙임 6〕주요사업실적(최근 5년간) 36')).toEqual([]);
    expect(runOne('perf.period', '❍ 주요사업 실적(최근 3년간)증명서 및 재무상태 관련 자료 1부')).toEqual([]);
  });
  it('"…실적만 작성"은 인정 범위를 제한하는 기준이다(카라바오 공고문)', () => {
    expect(runOne('perf.period', '① 입찰공고일 기준 5년 이내 국내외 용역 수행 완료 실적 중 유사사업 수행실적만 작성').map((x) => x.value)).toEqual(['5년']);
  });
  it('평가 기준 문장은 "증명서/작성"이 있어도 남고, 실적과 무관한 "N년(…)"은 기간이 아니다(리뷰 지적)', () => {
    const v = (t: string) => runOne('perf.period', t).map((x) => x.value);
    expect(v('평가기준: 최근 3년간 유사용역 수행실적(실적증명서 기준)')).toEqual(['3년']);
    expect(v('최근 3년간 유사사업 수행실적 3건 이상 : 5점, 사업수행실적표 작성')).toEqual(['3년']);
    expect(v('수행실적은 별지 제3호 서식에 따라 제출하되 최근 3년 이내 실적에 한함')).toEqual(['3년']);
    expect(v('유사사업 수행실적. 하자보수 기간 2년(준공후)')).toEqual([]);
    expect(v('유사사업 수행실적. 계약기간 1년(연장가능)')).toEqual([]);
    expect(v('유사사업 수행 3년내외')).toEqual([]);
  });
  it('작성 안내라도 "에 한하여"가 있으면 인정 기준이다', () => {
    expect(runOne('perf.period', '1. 최근 3년간(입찰공고일 기준) 계약액이 2천만 원 이상인 유사 용역 수행 실적에 한하여 기재').map((x) => x.value)).toEqual(['3년']);
  });
  it('번호가 붙은 목차 줄도 제외하고, 다른 기간의 작성 안내는 앞 기간을 지우지 않는다', () => {
    const v = (t: string) => runOne('perf.period', t).map((x) => x.value);
    expect(v('붙임 서식 3. 최근 3년간 주요 사업실적')).toEqual([]);
    expect(v('유사사업 최근 10년 이내 실적, 최근 3년간 기재')).toEqual(['10년']);
  });
  it('기간 뒤 괄호 설명이 있어도 이내/간/내가 이어지면 읽는다', () => {
    const v = (t: string) => runOne('perf.period', t).map((x) => x.value);
    expect(v('유사사업 최근 5년(공고일 기준) 이내 실적')).toEqual(['5년']);
    expect(v('유사사업 최근 3년(입찰공고일 전일 기준)간 수행실적')).toEqual(['3년']);
    expect(v('유사사업 수행실적. 하자보수 기간 2년(준공후) 보증')).toEqual([]);
    expect(v('유사사업 수행실적. 계약기간 1년(계약일로부터) 이내')).toEqual([]);
  });
  it('연도 표기나 기간 아닌 "N년 이상"은 작성 안내 판정을 멈추지 않고, 번호 붙은 본문 제목은 목차가 아니다(리뷰 지적)', () => {
    const v = (t: string) => runOne('perf.period', t).map((x) => x.value);
    expect(v('유사사업 최근 3년간(2021년~2023년) 실적을 기재')).toEqual([]);
    expect(v('유사사업 최근 5년간(2019년 1월 1일 이후) 실적을 작성')).toEqual([]);
    expect(v('유사사업 최근 3년간 1년 이상 수행 실적 기재')).toEqual([]);
    expect(v('붙임1. 입찰참가자격: 최근 3년간 유사사업 실적 보유자')).toEqual(['3년']);
    expect(v('서식2. 최근 3년간 유사사업 실적')).toEqual(['3년']);
  });
  it('창업 언급 뒤라도 멀리 떨어진 기간은 후보로 남는다', () => {
    expect(runOne('perf.period', '유사사업: 창업 후 7년 이내 기업은 최근 3년 이내 실적').map((x) => x.value)).toEqual(['3년']);
  });
});

describe('table-score 라벨 범위', () => {
  const cell = (r: number, c: number, text: string) => ({ r, c, rowSpan: 1, colSpan: 1, text, blocks: [], loc: { block: 0 } });
  const table = (rows: string[][]): DocModel => doc([{
    kind: 'table', index: 0, rows: rows.length, cols: rows[0]!.length, loc: { block: 0 },
    cells: rows.flatMap((row, r) => row.map((t, c) => cell(r, c, t))),
  }]);
  const run = (d: DocModel) => runRules([input(d)], loadRules()).filter((c) => c.evidence.ruleId === 'perf.table');
  it('설명 셀에 라벨 단어가 있어도 후보가 아니다', () => {
    const long = '평가항목 중 유사사업 수행실적을 고려하여 종합적으로 평가하며 세부 내용은 별첨의 평가기준표와 증빙서류를 따른다';
    expect(run(table([['구분', '설명', '배점'], ['기술능력', long, '20']]))).toEqual([]);
  });
  it('점수 열 오른쪽 셀은 라벨이 아니다', () => {
    expect(run(table([['구분', '배점', '비고'], ['기술', '20', '실적']]))).toEqual([]);
  });
  it('같은 라벨 낱말이 든 정상 배점 행이 여러 개여도 모두 후보로 남는다', () => {
    const c = run(table([['구분', '평가항목', '배점'], ['정량', '유사사업 수행실적', '10'], ['정량', '참여인력 수행실적', '5'], ['정량', '사업수행실적 평가', '3']]));
    expect(c.map((x) => x.value)).toEqual([10, 5, 3]);
  });
  it('신용등급 기호가 있는 등급별 점수표 행은 배점이 아니다', () => {
    const d = table([['신용평가등급', '기업신용평가등급', '배점'], ['정량', '경영상태(신용평가등급)', '10'], ['AAA', 'AAA (회사채에 대한 신용평가등급 AAA에 준하는 등급)', '10'], ['BBB+', 'BBB+ 신용평가등급', '9.5'], ['BB-', 'BB- 신용평가등급', '9']]);
    const c = runRules([input(d)], loadRules()).filter((x) => x.evidence.ruleId === 'mgmt.table');
    expect(c.map((x) => x.value)).toEqual([10]);
  });
  it('설명 칸에 등급 기호가 있어도 라벨이 정상이면 배점으로 읽는다', () => {
    const d = table([['구분', '평가항목', '평가기준', '배점'], ['정량', '경영상태(신용평가등급)', '회사채 AAA~BBB- 등급별 차등', '10']]);
    const c = runRules([input(d)], loadRules()).filter((x) => x.evidence.ruleId === 'mgmt.table');
    expect(c.map((x) => x.value)).toEqual([10]);
  });
  it('여러 행에 걸친 분류 칸과 긴 설명 칸의 상대 항목 낱말로는 제외하지 않는다', () => {
    const cellAt = (r: number, c: number, text: string, rowSpan = 1) => ({ r, c, rowSpan, colSpan: 1, text, blocks: [], loc: { block: 0 } });
    const d = doc([{
      kind: 'table', index: 0, rows: 3, cols: 4, loc: { block: 0 },
      cells: [
        cellAt(0, 0, '구분'), cellAt(0, 1, '평가항목'), cellAt(0, 2, '평가기준'), cellAt(0, 3, '배점'),
        cellAt(1, 0, '경영상태 및 수행실적', 2), cellAt(1, 1, '경영상태'), cellAt(1, 2, '신용평가등급 확인서 기준으로 평가하며 부정당업자 제재 기간 중인 업체는 최저등급으로 평가한다'), cellAt(1, 3, '5'),
        cellAt(2, 1, '수행실적'), cellAt(2, 2, '최근 3년 유사사업'), cellAt(2, 3, '5'),
      ],
    }]);
    const c = runRules([input(d)], loadRules()).filter((x) => x.evidence.ruleId === 'mgmt.table' || x.evidence.ruleId === 'perf.table');
    expect(c.map((x) => [x.evidence.ruleId, x.value])).toEqual([['mgmt.table', 5], ['perf.table', 5]]);
  });
  it('한 줄 묶음 문장("수행실적 및 경영상태 4점")은 어느 쪽 배점도 아니다', () => {
    const c = runRules([input(doc([P('수행실적 및 경영상태 4점 / 가격평가 20점')]))], loadRules())
      .filter((x) => x.target === 'managementScore' || x.target === 'performanceScore');
    expect(c).toEqual([]);
    const ok = runRules([input(doc([P('경영상태 평가 5점, 수행실적 평가 6점')]))], loadRules())
      .filter((x) => x.target === 'managementScore' || x.target === 'performanceScore');
    expect(ok.map((x) => [x.target, x.value])).toEqual([['managementScore', 5], ['performanceScore', 6]]);
  });
  it('이름이 신용도여도 내용이 제재 이력이면 경영상태가 아니다', () => {
    const d = table([['구분', '평가항목', '평가기준', '배점'], ['정량', '∘ 신 용 도', '입찰참가제한 업무정지 등', '2'], ['정량', '경영상태', '신용평가등급', '5']]);
    const c = runRules([input(d)], loadRules()).filter((x) => x.evidence.ruleId === 'mgmt.table');
    expect(c.map((x) => x.value)).toEqual([5]);
  });
  it('숫자가 여러 개인 점수 칸(등급별 점수 나열)은 배점이 아니다', () => {
    expect(run(table([['구분', '평가항목', '배점'], ['정량', '수행실적', '6 5 4 3 2 1']]))).toEqual([]);
  });
  it('경영상태와 수행실적을 묶은 소계 행은 어느 쪽 배점도 아니다', () => {
    const d = table([['구분', '평가항목', '배점'], ['정량적 평가', 'ㅇ 기업경영상태, 용역수행실적(B)', '10'], ['정량', '수행실적', '5'], ['정량', '경영상태', '5']]);
    const c = runRules([input(d)], loadRules()).filter((x) => x.evidence.ruleId === 'mgmt.table' || x.evidence.ruleId === 'perf.table');
    expect(c.map((x) => [x.evidence.ruleId, x.value])).toEqual([['mgmt.table', 5], ['perf.table', 5]]);
  });
  it('정상 라벨 행과 "4점(최대)"/"10점만점" 표기', () => {
    const c = run(table([['구분', '평가항목', '배점'], ['정량', '수행실적', '4점(최대)'], ['정량', '이행실적', '10점만점']]));
    expect(c.map((x) => x.value)).toEqual([4, 10]);
  });
});

describe('규칙 격리', () => {
  it('실행 중 예외가 나면 그 규칙만 건너뛰고 warning', () => {
    const rules = loadRules();
    const broken = { ...rules, synonyms: { ...rules.synonyms, scoreHeader: [] as string[] } };
    const r = runRulesFull([input(doc([P('차등점수제 : 미적용')]))], broken);
    expect(r.warnings.some((w) => w.includes('cred.table'))).toBe(true);
    expect(r.candidates.some((c) => c.target === 'differentialScoring')).toBe(true);
  });
  it('extras 결과는 JSON 직렬화 가능', () => {
    const d = decide([], loadRules());
    expect(JSON.parse(JSON.stringify(d.extras))).toEqual({
      bonusTable: { value: null, status: 'needs_review', reason: 'not_found' },
      projectPeriod: { value: null, status: 'needs_review', reason: 'not_found' },
    });
  });
});

describe('block-capture 앵커 처리', () => {
  const cap = (lines: string[]) => runRules([input(doc(lines.map((t, i) => P(t, i))))], loadRules()).filter((c) => c.target === 'performanceCondition');
  it('목차/제목(본문 없음)과 캡처 범위 안의 앵커는 버린다', () => {
    const c = cap(['실적인정범위', '※ 다음 항목', '※ 유사사업 : 다음 중 5억원 이상인 사업', '- 대민 시스템 구축', '실적인정기준에 따른다', '※ 작성방법']);
    expect(c).toHaveLength(1);
    expect((c[0]!.value as string).startsWith('※ 유사사업 :')).toBe(true);
  });
  it('다음 줄이 바로 번호 항목이어도 콜론 뒤에 내용이 있는 한 줄은 캡처한다', () => {
    const c = cap(['1. 사업실적에 의하여 평가한다.', '2. 실적 인정 범위 : 결제, 금융 시스템 개발 구축 실적만 인정', '3. 수행실적 증명은 다음과 같다']);
    expect(c.map((x) => x.value)).toEqual(['2. 실적 인정 범위 : 결제, 금융 시스템 개발 구축 실적만 인정']);
  });
  it('콜론 뒤가 다른 문서를 가리키기만 하는 한 줄은 캡처하지 않는다', () => {
    expect(cap(['2. 실적인정 기준: 제안요청서 Ⅲ.3.가 항목 참조', '3. 수행실적 증명은 다음과 같다'])).toEqual([]);
  });
  it('평가등급표 머리글에서 캡처를 멈춘다', () => {
    const c = cap(['- 유사용역의 정의 : 소프트웨어 개발이 포함된 구축 업무에 한함', '- 이행실적에 따른 배점은 아래와 같음', '평가등급', '평점', '100% 이상']);
    expect(c.map((x) => x.value)).toEqual(['- 유사용역의 정의 : 소프트웨어 개발이 포함된 구축 업무에 한함']);
  });
  it('문서 끝 표시 줄(/끝/)은 값에서 뺀다', () => {
    const c = cap(['※ 유사사업 : 다음 중 5억원 이상인 사업', '- 대민 시스템 구축', '/끝/']);
    expect(c[0]!.value).toBe('※ 유사사업 : 다음 중 5억원 이상인 사업\n- 대민 시스템 구축');
  });
});

describe('대외신인도와 경영상태 분리', () => {
  const table = (rows: string[][]): DocBlock => ({
    kind: 'table', index: 0, rows: rows.length, cols: rows[0]!.length, loc: { block: 0 },
    cells: rows.flatMap((row, r) => row.map((text, c) => ({ r, c, rowSpan: 1, colSpan: 1, text, blocks: [], loc: { block: 0 } }))),
  });
  const run = (blocks: DocBlock[]) => {
    const rules = loadRules();
    return decide(runRules([input(doc(blocks), 'rfp', 3)], rules), rules).items;
  };
  it('합성 표에서 경영상태와 대외신인도가 각각 잡힌다', () => {
    const items = run([table([['구분', '평가항목', '배점'], ['정량', '경영상태(신용평가등급)', '10'], ['정량', '대외신인도', '4']])]);
    expect(items.managementScore).toMatchObject({ value: 10, status: 'verified' });
    expect(items.credibilityScore).toMatchObject({ value: 4, status: 'verified' });
  });
  it('신용평가등급 단독 행은 managementScore 후보만', () => {
    const cands = runRules([input(doc([table([['구분', '평가항목', '배점'], ['정량', '신용평가등급', '7']])]), 'rfp', 3)], loadRules());
    expect(cands.filter((c) => c.target === 'managementScore')).not.toHaveLength(0);
    expect(cands.filter((c) => c.target === 'credibilityScore')).toHaveLength(0);
  });
  it('inline: 대외 신인도는 credibility만, 경영상태는 management만', () => {
    const a = runRules([input(doc([P('대외 신인도 평가는 5점으로 한다')]))], loadRules());
    expect(a.filter((c) => c.target === 'credibilityScore').map((c) => c.value)).toEqual([5]);
    expect(a.filter((c) => c.target === 'managementScore')).toHaveLength(0);
    const b = runRules([input(doc([P('경영상태 평가 10점')]))], loadRules());
    expect(b.filter((c) => c.target === 'managementScore').map((c) => c.value)).toEqual([10]);
    expect(b.filter((c) => c.target === 'credibilityScore')).toHaveLength(0);
  });
  it('로더: 기본 규칙은 경고 없음, 겹치는 사용자 동의어는 경고만', () => {
    expect(loadRules().warnings).toEqual([]);
    const base = loadRules();
    const r = loadRules({ synonyms: { credibility: ['대외신인도', '경영상태'] } });
    expect(r.warnings.some((w) => w.includes('동의어 겹침') && w.includes('경영상태'))).toBe(true);
    expect(r.rules).toHaveLength(base.rules.length);
  });
});

describe('가감점 표와 사업기간', () => {
  const table = (rows: string[][], index = 0): DocBlock => ({
    kind: 'table', index, rows: rows.length, cols: rows[0]!.length, loc: { block: 0 },
    cells: rows.flatMap((row, r) => row.map((text, c) => ({ r, c, rowSpan: 1, colSpan: 1, text, blocks: [], loc: { block: 0 } }))),
  });
  const bonus = table([['구분', '평가항목', '배점'], ['가점', 'A. 지방 소재 중소기업', '0.5점\n(최대 0.5점)'], ['감점', 'G. 경고조치', '0.5점\n(최대 2.5점)']]);
  const run = (inputs: RuleDocInput[]) => {
    const rules = loadRules();
    return { cands: runRules(inputs, rules), ...decide(runRules(inputs, rules), rules) };
  };
  const period = (text: string) => run([input(doc([P(text)]))]).extras.projectPeriod!;

  it('1. 가감점 표만 있으면 no_total', () => {
    const { items, extras } = run([input(doc([bonus]), 'rfp', 3)]);
    expect(extras.bonusTable).toMatchObject({ value: '가점 1항목, 감점 1항목', status: 'verified' });
    expect(extras.bonusTable!.evidence!.location).toBe('표0 r1c0');
    expect(items.credibilityScore).toMatchObject({ value: null, status: 'needs_review', reason: 'no_total', raw: '가점 1항목, 감점 1항목' });
  });
  it('1-1. 병합 없이 행마다 같은 라벨을 적으면 라벨별로 합친다', () => {
    const rows = table([['구분', '평가항목', '배점'], ['가점', 'A. 지방', '0.5점'], ['가점', 'C. 여성', '0.2점'], ['감점', 'G. 경고', '0.5점']]);
    const { extras } = run([input(doc([rows]), 'rfp', 3)]);
    expect(extras.bonusTable).toMatchObject({ value: '가점 2항목, 감점 1항목' });
  });
  it('2. 신인도 배점 표가 있으면 그 값', () => {
    const quant = table([['구분', '평가항목', '배점'], ['정량', '대외신인도', '4']], 1);
    const { items } = run([input(doc([bonus, quant]), 'rfp', 3)]);
    expect(items.credibilityScore).toMatchObject({ value: 4, status: 'verified' });
  });
  it('3. 점수 칸이 빈 자가진단표는 제외', () => {
    const { items, extras } = run([input(doc([table([['평가항목', '증빙요약', '점수'], ['가점', '', ''], ['감점', '', '']])]), 'rfp', 3)]);
    expect(extras.bonusTable).toMatchObject({ value: null, reason: 'not_found' });
    expect(items.credibilityScore).toMatchObject({ reason: 'not_found' });
  });
  it('4. 라벨은 완전 일치만', () => {
    const { cands } = run([input(doc([table([['구분', '평가항목', '배점'], ['정량', '중소기업 가점을 부여하지 않는다', '4']])]), 'rfp', 3)]);
    expect(cands.filter((c) => c.target === 'extras.bonusTable')).toHaveLength(0);
  });
  it('5. 문서 간 항목 수가 다르면 우선순위 높은 문서 값', () => {
    const other = table([['구분', '평가항목', '배점'], ['가점', 'A', '0.5점'], ['가점', 'B', '0.5점'], ['감점', 'G', '0.5점']]);
    const hi = { ...input(doc([bonus]), 'rfp', 2), attachmentId: 'hi' };
    const lo = { ...input(doc([other]), 'rfp', 3), attachmentId: 'lo' };
    const { items } = run([lo, hi]);
    expect(items.credibilityScore).toMatchObject({ value: null, reason: 'no_total', raw: '가점 1항목, 감점 1항목' });
    expect(items.credibilityScore.evidence!.attachmentId).toBe('hi');
  });
  it('6. 용역기간 문구는 띄어쓰기를 유지', () => {
    expect(period('나. 용역기간 : 계약체결일로부터 2028.02.28.까지')).toMatchObject({ value: '계약체결일로부터 2028.02.28.까지', status: 'verified' });
  });
  it('7. 문장 속 계약기간은 제외', () => {
    expect(period('1) 계약기간이 90일 이내인 경우 2) 납품대금이 1억원 이하인 경우')).toMatchObject({ reason: 'not_found' });
  });
  it('8. 괄호 머리말', () => {
    expect(period('(사업기간) 2026-2031')).toMatchObject({ value: '2026-2031' });
  });
  it('9. 오탐 문구는 제외', () => {
    for (const t of ['전체 사업기간 중 총 2회', '추정 사업기간', '사업기간', '하자담보기간 : 2년']) {
      expect(period(t)).toMatchObject({ reason: 'not_found' });
    }
    const cell = table([['구분', '내용'], ['사업기간', '']]);
    expect(run([input(doc([cell]))]).extras.projectPeriod).toMatchObject({ reason: 'not_found' });
  });
  it('10. 기호가 붙은 머리말', () => {
    expect(period('□ 사업기간: 계약일로부터 12개월')).toMatchObject({ value: '계약일로부터 12개월' });
  });
  it('11. 두 문서 값이 다르면 conflict', () => {
    const a = { ...input(doc([P('사업기간: 계약일로부터 12개월')]), 'notice', 2), attachmentId: 'a' };
    const b = { ...input(doc([P('사업기간: 계약일로부터 6개월')]), 'rfp', 3), attachmentId: 'b' };
    expect(run([a, b]).extras.projectPeriod).toMatchObject({ status: 'needs_review', reason: 'conflict' });
  });
});

describe('스키마 검증', () => {
  const syn = loadRules().synonyms;
  it('bonus-table 통과, rowLabel 누락 오류', () => {
    const base = { id: 'x', target: 'extras.x', strategy: 'bonus-table', scoreHeader: 'scoreHeader', rowLabel: 'bonusLabel' };
    expect(validateRule(base, syn)).toEqual([]);
    expect(validateRule({ ...base, rowLabel: undefined }, syn).join()).toContain('rowLabel 누락');
  });
  it('window-regex valueType text 통과', () => {
    expect(validateRule({ id: 'x', target: 'extras.x', strategy: 'window-regex', anchor: 'a', pattern: '(?<v>b)', blocksAfter: 0, valueType: 'text' }, syn)).toEqual([]);
  });
});
