import { describe, expect, it } from 'vitest';
import type { DocBlock, DocCell, DocModel, DocTable } from '../../../src/core/doc/model';
import { renderText } from '../../../src/core/doc/render-text';
import { extractRequirements } from '../../../src/core/rfp/extract';

// ── 합성 DocModel 헬퍼 ──
type CellSpec = string | { t: string; rs?: number; cs?: number; blocks?: DocBlock[] };
let tableSeq = 0;

/** 행 단위 명세로 표를 만든다. 병합으로 이미 차지된 칸은 건너뛰며 배치한다. */
function table(rowsSpec: CellSpec[][], cols?: number): DocTable {
  const occ = new Set<string>();
  const cells: DocCell[] = [];
  let maxC = 0;
  rowsSpec.forEach((row, r) => {
    let c = 0;
    for (const spec of row) {
      while (occ.has(`${r},${c}`)) c++;
      const s = typeof spec === 'string' ? { t: spec } : spec;
      const rs = s.rs ?? 1, cs = s.cs ?? 1;
      for (let i = 0; i < rs; i++) for (let j = 0; j < cs; j++) occ.add(`${r + i},${c + j}`);
      cells.push({ r, c, rowSpan: rs, colSpan: cs, text: s.t, blocks: s.blocks ?? [], loc: { block: 0 } });
      maxC = Math.max(maxC, c + cs);
      c += cs;
    }
  });
  return { kind: 'table', index: tableSeq++, rows: rowsSpec.length, cols: cols ?? maxC, cells, loc: { block: 0 } };
}
const para = (text: string): DocBlock => ({ kind: 'p', text, loc: { block: 0 } });
function docOf(...blocks: DocBlock[]): DocModel {
  return { format: 'hwp5', blocks, warnings: [], stats: { chars: 0, tables: 0, ms: 0 } };
}
function extract(...blocks: DocBlock[]) {
  const doc = docOf(...blocks);
  renderText(doc);
  return extractRequirements(doc);
}

describe('extractRequirements: 카드형', () => {
  it('1. 3열 카드 + 상세설명 rowSpan2', () => {
    const r = extract(table([
      ['요구사항 분류', '', '기능'],
      ['요구사항 고유번호', '', 'SFR-001'],
      ['요구사항 명칭', '', '로그인'],
      [{ t: '요구사항 상세설명', rs: 2 }, '정의', '정의문'],
      ['세부내용', '세부문'],
    ]));
    expect(r.items).toHaveLength(1);
    const it = r.items[0]!;
    expect(it.key).toBe('SFR-001');
    expect(it.form).toBe('card');
    expect(it.category).toBe('기능');
    expect(it.name).toBe('로그인');
    expect(it.definition).toBe('정의문');
    expect(it.detail).toBe('세부문');
  });

  it('2. 그룹 라벨이 곧 세부내용', () => {
    const r = extract(table([
      ['고유번호', 'COR-01'],
      ['명칭', '표준 준수'],
      ['정의', '정의문'],
      ['요구사항 상세설명', '세부문'],
    ]));
    expect(r.items).toHaveLength(1);
    expect(r.items[0]!.detail).toBe('세부문');
    expect(r.items[0]!.definition).toBe('정의문');
  });

  it('3. 4열 라벨-값-라벨-값', () => {
    const r = extract(table([
      ['고유번호', 'SFR-001', '명칭', '로그인'],
      ['세부내용', { t: '본문', cs: 3 }],
    ]));
    expect(r.items).toHaveLength(1);
    expect(r.items[0]!.name).toBe('로그인');
    expect(r.items[0]!.detail).toBe('본문');
  });

  it('4. 한 표에 카드 2장 연속(분류가 번호보다 먼저)', () => {
    const r = extract(table([
      ['분류', '기능'],
      ['고유번호', 'SFR-001'],
      ['명칭', '로그인'],
      ['정의', '정의1'],
      ['세부내용', '세부1'],
      ['분류', '성능'],
      ['고유번호', 'SFR-002'],
      ['명칭', '검색'],
      ['정의', '정의2'],
      ['세부내용', '세부2'],
    ]));
    expect(r.items).toHaveLength(2);
    expect(r.items[0]!.category).toBe('기능');
    expect(r.items[1]!.category).toBe('성능');
    expect(r.items[1]!.name).toBe('검색');
    expect(r.items[1]!.detail).toBe('세부2');
  });

  it('5. 모르는 라벨(산출정보)은 extras', () => {
    const r = extract(table([
      ['고유번호', 'SFR-001'],
      ['명칭', '로그인'],
      ['정의', '정의문'],
      ['세부내용', '세부문'],
      ['산출정보', '설계서'],
    ]));
    expect(r.items).toHaveLength(1);
    expect(r.items[0]!.extras).toEqual([{ label: '산출정보', text: '설계서' }]);
  });
});

describe('extractRequirements: 목록형·기타', () => {
  it('6. 헤더 있는 목록표', () => {
    const r = extract(table([
      ['요구사항 ID', '요구사항 명칭', '세부내용'],
      ['SFR-001', '로그인', '로그인 본문'],
      ['SFR-002', '검색', '검색 본문'],
      ['SFR-003', '등록', '등록 본문'],
    ]));
    expect(r.items).toHaveLength(3);
    expect(r.items.every((i) => i.form === 'list')).toBe(true);
    expect(r.items.map((i) => i.name)).toEqual(['로그인', '검색', '등록']);
    expect(r.items[1]!.detail).toBe('검색 본문');
  });

  it('7. 헤더 없는 요약표는 둘째 열이 명칭', () => {
    const r = extract(table([
      ['SFR-001', '로그인'],
      ['SFR-002', '검색'],
      ['SFR-003', '등록'],
      ['SFR-004', '삭제'],
    ]));
    expect(r.items).toHaveLength(4);
    expect(r.items.map((i) => i.name)).toEqual(['로그인', '검색', '등록', '삭제']);
  });

  it('8. 바깥 1x1 표 안에 중첩된 카드 표', () => {
    const inner = table([
      ['고유번호', 'SFR-001'],
      ['명칭', '로그인'],
      ['정의', '정의문'],
      ['세부내용', '세부문'],
    ]);
    const outer = table([[{ t: '', blocks: [inner] }]]);
    const r = extract(outer);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]!.name).toBe('로그인');
    expect(r.items[0]!.detail).toBe('세부문');
  });

  it('9. 요약표(명칭만) + 카드(본문 있음)에 같은 번호 → 1건, dupCount 2', () => {
    const summary = table([
      ['요구사항 ID', '요구사항 명칭'],
      ['SFR-001', '로그인'],
    ]);
    const card = table([
      ['고유번호', 'SFR-001'],
      ['명칭', '로그인'],
      ['정의', '정의문'],
      ['세부내용', '세부문'],
    ]);
    const r = extract(summary, card);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]!.detail).toBe('세부문');
    expect(r.items[0]!.dupCount).toBe(2);
  });

  it('10. 사전에 없는 접두어는 1번이면 제외, 2번 이상이면 포함', () => {
    const base: CellSpec[][] = [
      ['요구사항 ID', '요구사항 명칭'],
      ['SFR-001', '로그인'],
    ];
    const once = extract(table([...base, ['XYZ-001', '이상한 번호']]));
    expect(once.items.map((i) => i.key)).toEqual(['SFR-001']);
    const twice = extract(table([...base, ['XYZ-001', '이상한 번호'], ['XYZ-002', '또 다른 번호']]));
    expect(twice.items.map((i) => i.key)).toEqual(['SFR-001', 'XYZ-001', 'XYZ-002']);
  });

  it('11. 표가 없으면 문단형', () => {
    const r = extract(para('SFR-001 로그인'), para('세부 내용 줄'), para('SFR-002 검색'));
    expect(r.items).toHaveLength(2);
    expect(r.items.every((i) => i.form === 'para')).toBe(true);
    expect(r.items[0]!.detail).toBe('세부 내용 줄');
    expect(r.stats.paraItems).toBe(2);
  });
});

describe('extractRequirements: quality', () => {
  const listOf = (n: number) => table([
    ['요구사항 ID', '요구사항 명칭', '세부내용'],
    ...Array.from({ length: n }, (_, i) => [`SFR-${String(i + 1).padStart(3, '0')}`, `명칭${i + 1}`, `본문${i + 1}`]),
  ]);
  it('12. 0건 none / 3건 partial / 6건 good', () => {
    expect(extract(para('아무 내용 없음')).quality).toBe('none');
    expect(extract(listOf(3)).quality).toBe('partial'
);
    expect(extract(listOf(6)).quality).toBe('good');
  });
});

describe('extractRequirements: 카드형 보강', () => {
  it('A. 세로 병합 라벨의 값이 여러 행이면 줄로 이어 붙인다', () => {
    const r = extract(table([
      ['고유번호', 'SFR-001'],
      ['명칭', '로그인'],
      [{ t: '세부내용', rs: 3 }, '항목1'],
      ['항목2'],
      ['항목3'],
      ['고유번호', 'SFR-002'],
      ['명칭', '검색'],
      ['세부내용', '본문2'],
    ]));
    expect(r.items).toHaveLength(2);
    expect(r.items[0]!.detail).toBe('항목1\n항목2\n항목3');
    expect(r.items[1]!.detail).toBe('본문2');
    expect(r.items[1]!.extras ?? []).toEqual([]);
  });

  it('B. 번호를 못 읽는 카드는 버리고 다음 카드에 섞이지 않는다', () => {
    const r = extract(table([
      ['고유번호', 'SFR-001'],
      ['명칭', '로그인'],
      ['정의', '정의문'],
      ['세부내용', '세부문'],
      ['고유번호', 'SFR-XXX'],
      ['명칭', '버려질명칭'],
      ['세부내용', '버려질본문'],
      ['고유번호', 'SFR-003'],
      ['명칭', '정상명칭'],
      ['세부내용', '정상본문'],
    ]));
    expect(r.items).toHaveLength(2);
    const it3 = r.items.find((i) => i.key === 'SFR-003')!;
    expect(it3.name).toBe('정상명칭');
    expect(it3.detail).toBe('정상본문');
    expect(JSON.stringify(r.items)).not.toContain('버려질');
  });

  it('C. 분류가 번호보다 먼저 오고 카드1에 본문이 없어도 분류가 덮어쓰이지 않는다', () => {
    const r = extract(table([
      ['분류', '기능'],
      ['고유번호', 'SFR-001'],
      ['명칭', 'A'],
      ['분류', '성능'],
      ['고유번호', 'PER-001'],
      ['명칭', 'B'],
      ['세부내용', '본문'],
    ]));
    expect(r.items.find((i) => i.key === 'SFR-001')!.category).toBe('기능');
    expect(r.items.find((i) => i.key === 'PER-001')!.category).toBe('성능');
  });
});
