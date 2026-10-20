import { describe, expect, it } from 'vitest';
import type { DocCell, DocModel, DocTable } from '../../src/core/doc/model';
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
