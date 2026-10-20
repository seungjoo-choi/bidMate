import { describe, expect, it } from 'vitest';
import { headerKeyOf, parseSheetAmount, parseSheetDate, parseSheetShare, rowsFromCells } from '../../src/core/performances/sheet';

describe('headerKeyOf', () => {
  it('괄호와 공백 제거', () => {
    expect(headerKeyOf('계약금액(원)')).toBe('계약금액');
    expect(headerKeyOf('지분율 (%)')).toBe('지분율');
    expect(headerKeyOf(' 사업명 ')).toBe('사업명');
  });
});

describe('parseSheetDate', () => {
  it('여러 표기를 2024-03-01로', () => {
    for (const s of ['2024-03-01', '2024.03.01', '2024/3/1', '2024. 3. 1.', '20240301', '2024-03-01 00:00:00']) {
      expect(parseSheetDate(s)).toBe('2024-03-01');
    }
  });
  it('엑셀 일련번호', () => {
    expect(parseSheetDate('45352')).toBe('2024-03-01');
    expect(parseSheetDate('45352.5')).toBe('2024-03-01');
  });
  it('해석 불가는 null', () => {
    for (const s of ['2024-13-01', 'abc', '1000', '99999']) expect(parseSheetDate(s)).toBeNull();
  });
});

describe('parseSheetAmount', () => {
  it('여러 표기를 1748181818로', () => {
    for (const s of ['1,748,181,818', '1748181818원', '1.748181818E9', '17억 4,818만 1,818원']) {
      expect(parseSheetAmount(s)).toBe(1748181818);
    }
  });
  it('범위 밖은 null', () => {
    for (const s of ['0', '-5', '1e13']) expect(parseSheetAmount(s)).toBeNull();
  });
  it('3.5억', () => {
    expect(parseSheetAmount('3.5억')).toBe(350000000);
  });
});

describe('parseSheetShare', () => {
  it('"%"가 붙은 값은 퍼센트 서식 분기를 쓰지 않는다', () => {
    expect(parseSheetShare('1%')).toBe(1);
    expect(parseSheetShare('0.5%')).toBeNull();
  });
  it('해석 규칙', () => {
    expect(parseSheetShare('')).toBe(100);
    expect(parseSheetShare('70')).toBe(70);
    expect(parseSheetShare('70%')).toBe(70);
    expect(parseSheetShare('0.7')).toBe(70);
    expect(parseSheetShare('1')).toBe(100);
    expect(parseSheetShare('0')).toBeNull();
    expect(parseSheetShare('150')).toBeNull();
    expect(parseSheetShare('70.4')).toBe(70);
  });
});

describe('rowsFromCells', () => {
  const line = (r: number, vals: string[]) => vals.map((text, c) => ({ r, c, text }));
  const header = ['사업명', '발주기관', '계약금액(원)', '착수일', '완료일', '지분율(%)', '분야', '비고'];

  it('머리글 순서 섞임과 모르는 열 허용', () => {
    const cells = [
      ...line(0, ['메모', '착수일', '계약금액', '발주기관', '사업명']),
      ...line(1, ['x', '2024-01-01', '1,000', '공단', 'A사업']),
    ];
    const r = rowsFromCells(cells);
    expect(r).toMatchObject({ ok: true, valid: 1, invalid: 0 });
    if (r.ok) expect(r.rows[0]!.input).toEqual({ title: 'A사업', client: '공단', amount: 1000, startAt: '2024-01-01' });
  });
  it('필수 머리글이 없으면 ok:false에 누락 열 이름', () => {
    const r = rowsFromCells(line(0, ['사업명', '발주기관']));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('계약금액');
      expect(r.error).toContain('착수일');
    }
  });
  it('완전 빈 행 건너뜀, 행 번호는 1-based', () => {
    const cells = [
      ...line(0, header),
      ...line(1, ['A', '공단', '1000', '2024-01-01', '', '', '', '']),
      ...line(2, ['', '', '', '', '', '', '', '']),
      ...line(3, ['B', '공단', '2000', '2024-02-01', '2024-03-01', '70', '', '']),
    ];
    const r = rowsFromCells(cells);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rows.map((x) => x.row)).toEqual([2, 4]);
      expect(r.rows[0]!.input!.endAt).toBeUndefined();
      expect(r.rows[1]!.input).toMatchObject({ endAt: '2024-03-01', share: 70 });
    }
  });
  it('필수 빈 칸과 착수일 > 완료일은 오류 행', () => {
    const cells = [
      ...line(0, header),
      ...line(1, ['', '공단', '1000', '2024-01-01', '', '', '', '']),
      ...line(2, ['B', '공단', '1000', '2024-05-01', '2024-03-01', '', '', '']),
    ];
    const r = rowsFromCells(cells);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.invalid).toBe(2);
      expect(r.rows[0]!.error).toBe('사업명: 비어 있음');
      expect(r.rows[1]!.error).toBeTruthy();
      expect(r.rows[1]!.input).toBeUndefined();
    }
  });
  it('머리글이 2행에 있는 파일', () => {
    const cells = [
      ...line(1, header),
      ...line(2, ['A', '공단', '1000', '2024-01-01', '', '', '', '']),
    ];
    const r = rowsFromCells(cells);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows[0]!.row).toBe(3);
  });
});
