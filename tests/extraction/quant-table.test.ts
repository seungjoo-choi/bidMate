import { describe, expect, it } from 'vitest';
import type { DocCell, DocModel, DocTable } from '../../src/core/doc/model';
import { decide } from '../../src/core/extraction/decide';
import { loadRules } from '../../src/core/extraction/rules/load';
import { runRules } from '../../src/core/extraction/run-rules';

const rules = loadRules();

type C = string | { t: string; rs?: number };
/** rows: 행마다 칸 목록. 앞 행의 rowSpan이 덮는 열은 건너뛴다(칸 목록에서 생략). */
function table(rows: C[][], opts: { caption?: string; truncated?: boolean } = {}): DocModel {
  const cells: DocCell[] = [];
  const busy = new Set<string>();
  let cols = 0;
  rows.forEach((row, r) => {
    let c = 0;
    for (const item of row) {
      while (busy.has(`${r},${c}`)) c++;
      const t = typeof item === 'string' ? item : item.t;
      const rs = typeof item === 'string' ? 1 : item.rs ?? 1;
      cells.push({ r, c, rowSpan: rs, colSpan: 1, text: t, blocks: [], loc: { block: 0, line: r + 1 } });
      for (let k = 0; k < rs; k++) busy.add(`${r + k},${c}`);
      c++;
    }
    cols = Math.max(cols, c);
  });
  const t: DocTable = {
    kind: 'table', index: 0, rows: rows.length + (opts.truncated ? 2000 : 0), cols, cells,
    ...(opts.caption ? { caption: opts.caption } : {}), loc: { block: 0 },
  };
  return { format: 'hwp5', blocks: [t], warnings: [], stats: { chars: 10, tables: 1, ms: 1 } };
}

const run = (doc: DocModel) =>
  runRules([{ doc, attachmentId: 'a', sourceFile: 'a.hwp', docKind: 'rfp', priority: 3 }], rules).candidates
    .filter((c) => c.target === 'extras.quantTable');

describe('quant-table 전략', () => {
  it('양식 A: 제목에 정량평가, 경영상태 한 행 -> 10:mgmt', () => {
    const hits = run(table([
      ['대항목', '중항목', '평가요소', '배점기준'],
      ['관리부문\n(10)', '경영상태주1)', '- 신용 평가기관의 신용도', '10'],
    ], { caption: '2) 정량평가(10점)' }));
    expect(hits).toHaveLength(1);
    expect(hits[0]!.value).toBe('10:mgmt');
    expect(hits[0]!.evidence.location).toBe('표0 r1c3');
  });

  it('양식 B: 0열 라벨 칸 rowSpan 2 -> 10:mgmt,perf', () => {
    const hits = run(table([
      ['구분', '평가부문', '평가항목', '배점'],
      [{ t: '정량평가\n(10점)', rs: 2 }, '경영상태', '신용등급', '4'],
      ['수행실적', '회사 유사사업\n수행 실적', '6'],
    ]));
    expect(hits.map((h) => h.value)).toEqual(['10:mgmt,perf']);
  });

  it('합계 10인데 행 배점 합이 4면 없음', () => {
    expect(run(table([
      ['대항목', '평가요소', '배점'],
      ['경영상태', '신용도', '4'],
    ], { caption: '정량평가(10점)' }))).toHaveLength(0);
  });

  it('제목에 합계가 없으면 없음, 합계 행이 있으면 있음', () => {
    const head = ['대항목', '평가요소', '배점'];
    expect(run(table([head, ['경영상태', '신용도', '10']], { caption: '정량평가' }))).toHaveLength(0);
    const hits = run(table([head, ['경영상태', '신용도', '10'], ['합계', '', '10']], { caption: '정량평가' }));
    expect(hits.map((h) => h.value)).toEqual(['10:mgmt']);
  });

  it('caption이 정량평가 자가진단표면 없음', () => {
    expect(run(table([
      ['대항목', '평가요소', '배점'],
      ['경영상태', '신용도', '10'],
    ], { caption: '정량평가(10점) 자가진단표' }))).toHaveLength(0);
  });

  it('등급표(머리글 신용평가등급|평점, caption 없음)는 없음', () => {
    expect(run(table([
      ['신용평가등급', '평점'],
      ['AAA', '10'],
    ]))).toHaveLength(0);
  });

  it('caption이 정량평가여도 0열에 정성평가만 있고 정량 라벨이 없으면 없음', () => {
    expect(run(table([
      ['구분', '평가항목', '배점'],
      [{ t: '정성평가(90점)', rs: 2 }, '사업이해도', '50'],
      ['제안내용', '40'],
    ], { caption: '정량평가(10점)' }))).toHaveLength(0);
  });

  it('신인도 +-2 행과 경영상태 10, 합계 10 -> 10:cred,mgmt', () => {
    const hits = run(table([
      ['대항목', '평가요소', '배점'],
      ['경영상태', '신용도', '10'],
      ['신인도', '부정당제재', '±2'],
    ], { caption: '정량평가(10점)' }));
    expect(hits.map((h) => h.value)).toEqual(['10:cred,mgmt']);
  });

  it('잘린 표(t.rows > g.rows)는 없음', () => {
    expect(run(table([
      ['대항목', '평가요소', '배점'],
      ['경영상태', '신용도', '10'],
    ], { caption: '정량평가(10점)', truncated: true }))).toHaveLength(0);
  });

  it('배점 열이 둘이어도 오른쪽 열의 범주를 인식한다(mgmt, perf)', () => {
    const mk = (right: string) => run(table([
      ['대항목', '배점', '중항목', '세부배점'],
      ['관리부문(10)', '10', right, '10'],
    ], { caption: '정량평가(10점)' }));
    expect(mk('경영상태').map((h) => h.value)).toEqual(['10:mgmt']);
    expect(mk('유사실적').map((h) => h.value as string)[0]).toContain('perf');
  });

  it('양식 B에서 라벨 칸과 배점만 있고 범주 칸이 없으면 없음', () => {
    expect(run(table([
      ['구분', '배점'],
      ['정량평가\n(10점)', '10'],
    ]))).toHaveLength(0);
  });

  it('caption이 정량평가 및 정성평가 기준(100점)이면 없음', () => {
    expect(run(table([
      ['대항목', '평가요소', '배점'],
      ['경영상태', '신용도', '100'],
    ], { caption: '정량평가 및 정성평가 기준(100점)' }))).toHaveLength(0);
  });

  it('아는 범주가 하나도 없는 표(수행능력, 기술인력)는 없음', () => {
    expect(run(table([
      ['대항목', '평가요소', '배점'],
      ['수행능력', '유사용역 수행 정도', '6'],
      ['기술인력', '보유 인력 수', '4'],
    ], { caption: '정량평가(10점)' }))).toHaveLength(0);
  });

  it('머리글만 배점 동의어인 설명 열의 범주도 본다', () => {
    const hits = run(table([
      ['대항목', '배점', '평가방법(점수산정)'],
      ['경영상태', '6', '신용평가등급'],
      ['수행능력', '4', '유사사업 수행실적 건수'],
    ], { caption: '정량평가(10점)' }));
    expect(hits.map((h) => h.value as string)[0]).toContain('perf');
  });
});

describe('quant-table 전략: 괄호 합계 라벨과 병합 묶음 칸', () => {
  const head = ['구분', '평가항목', '배점'];
  const naKeys = (doc: DocModel) => {
    const cands = runRules([{ doc, attachmentId: 'a', sourceFile: 'a.hwp', docKind: 'rfp', priority: 3 }], rules).candidates;
    const d = decide(cands, rules);
    return { perf: d.items.performanceScore, cred: d.items.credibilityScore };
  };
  const qualRows = (label: string): C[][] => [
    head,
    [label, '경영상태', '10'],
    [{ t: '정성\n(90)', rs: 2 }, '사업 이해도', '50'],
    ['추진 전략', '40'],
  ];

  it.each([['정량평가\n(10)'], ['정량\n(10)']])('1/2. 라벨 칸 "%s" -> 10:mgmt, 수행실적과 신뢰도 해당 없음', (label) => {
    const doc = table(qualRows(label));
    expect(run(doc).map((h) => h.value)).toEqual(['10:mgmt']);
    const { perf, cred } = naKeys(doc);
    expect(perf).toMatchObject({ status: 'verified', reason: 'not_applicable' });
    expect(cred).toMatchObject({ status: 'verified', reason: 'not_applicable' });
  });

  it('3. 라벨 칸이 "정량제안서"면 없음', () => {
    expect(run(table(qualRows('정량제안서')))).toHaveLength(0);
  });

  const grouped = (outerRs: number): DocModel => table([
    ['구분', '평가부문', '평가항목', '배점'],
    [{ t: '기술능력평가', rs: outerRs }, { t: '정량평가\n(7)', rs: 2 }, '경영상태', '5'],
    ['우선구매대상', '2'],
    ...(outerRs === 4
      ? [[{ t: '정성평가', rs: 2 }, '사업 이해도', '50'] as C[], ['추진 전략', '43'] as C[]]
      : [['기타', { t: '정성평가', rs: 2 }, '사업 이해도', '50'] as C[], ['추진 전략', '43'] as C[]]),
  ]);

  it('4. 첫 칸이 더 긴 세로 병합이면 둘째 칸 정량평가(7) 인정', () => {
    const hits = run(grouped(4));
    expect(hits).toHaveLength(1);
    expect(hits[0]!.value as string).toMatch(/^7:/);
    expect(hits[0]!.value as string).toContain('mgmt');
    expect(hits[0]!.value as string).not.toContain('perf');
  });

  it('5. 첫 칸 rowSpan이 라벨 칸과 같으면 둘째 칸 라벨은 인정하지 않음', () => {
    expect(run(grouped(2))).toHaveLength(0);
  });

  it('6. 라벨 "정량평가 (10)"인데 행 배점 합이 8이면 없음', () => {
    expect(run(table([head, ['정량평가 (10)', '경영상태', '8']]))).toHaveLength(0);
  });
});

describe('정량표 해당 없음과 실적 하위 항목(작성 안내 문장)', () => {
  const GUIDE = '- 용역실적은 공고일 기준 최근 3년간 본 사업과 유관한 사업수행을 완료한 실적 2천만원(부가세 포함)이상 건에 대하여 기재하고 실적증명서를 첨부해야 함';
  const quantRows: C[][] = [
    ['구분', '평가항목', '배점'],
    ['정량평가 (10)', '경영상태', '10'],
    [{ t: '정성\n(90)', rs: 2 }, '사업 이해도', '50'],
    ['추진 전략', '40'],
  ];
  const P = (text: string, i: number) => ({ kind: 'p' as const, text, loc: { block: 10 + i, line: i + 1 } });
  const go = (withTable: boolean, srcs: Array<['rfp' | 'notice', string]>) => {
    const inputs = srcs.map(([docKind, line], i) => ({
      doc: { format: 'hwp5' as const, blocks: [...(withTable && i === 0 ? table(quantRows).blocks : []), P(line, i)], warnings: [], stats: { chars: 10, tables: 1, ms: 1 } },
      attachmentId: `a${i}`, sourceFile: `a${i}.hwp`, docKind, priority: docKind === 'notice' ? 2 : 3,
    }));
    return decide(runRules(inputs, rules).candidates, rules).items;
  };
  const isNA = (it: { status: string; reason?: string }) => it.status === 'verified' && it.reason === 'not_applicable';

  it('A. 작성 안내 문장뿐이면 실적 기간/최소금액도 해당 없음, 원래 값은 candidates에 남음', () => {
    const items = go(true, [['rfp', GUIDE]]);
    expect(items.performanceScore).toMatchObject({ status: 'verified', reason: 'not_applicable' });
    for (const k of ['performancePeriod', 'performanceMinAmount'] as const) {
      expect(items[k]).toMatchObject({ status: 'verified', reason: 'not_applicable', naKind: 'quant_table' });
      expect(items[k].candidates?.length).toBeGreaterThan(0);
    }
    expect(JSON.stringify(items.performancePeriod.candidates)).toContain('3년');
    expect(JSON.stringify(items.performanceMinAmount.candidates)).toContain('20000000');
  });

  it('B. 참가자격 실적 제한(notice)이 있으면 실적 기간은 해당 없음이 아님', () => {
    const items = go(true, [['rfp', GUIDE], ['notice', '입찰참가자격: 최근 3년간 유사 용역 실적이 있는 업체']]);
    expect(isNA(items.performancePeriod)).toBe(false);
    expect(items.performancePeriod.value).not.toBeNull();
  });

  it('C. 작성 안내가 아닌 인정 기준 문장이면 값 유지', () => {
    const items = go(true, [['rfp', '- 용역실적은 최근 3년 이내 완료된 단일 계약 2천만원 이상 실적만 인정']]);
    expect(isNA(items.performancePeriod)).toBe(false);
    expect(isNA(items.performanceMinAmount)).toBe(false);
    expect(items.performancePeriod.value).not.toBeNull();
    expect(items.performanceMinAmount.value).not.toBeNull();
  });

  it('D. 정량표가 없으면 값 유지', () => {
    const items = go(false, [['rfp', GUIDE]]);
    expect(isNA(items.performancePeriod)).toBe(false);
    expect(isNA(items.performanceMinAmount)).toBe(false);
    expect(items.performancePeriod.value).not.toBeNull();
    expect(items.performanceMinAmount.value).not.toBeNull();
  });
});
