import { parseKoreanAmount } from '../extraction/normalize';
import type { DateOnly, PerformanceInput } from '../types/performance';
import { isDateOnly } from './normalize';

export const SHEET_COLUMNS = ['사업명', '발주기관', '계약금액', '착수일', '완료일', '지분율', '분야', '비고'] as const;
export const SHEET_REQUIRED = ['사업명', '발주기관', '계약금액', '착수일'] as const;
export type SheetColumn = (typeof SHEET_COLUMNS)[number];

/** 머리글 정규화: 공백 제거, 괄호와 괄호 안 제거("계약금액(원)" → "계약금액", "지분율(%)" → "지분율") */
export function headerKeyOf(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, '').replace(/[(（][^)）]*[)）]/g, '');
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** 날짜 셀. 'YYYY-MM-DD' 또는 엑셀 일련번호(시각 소수부는 버림). 실패 null */
export function parseSheetDate(text: string): DateOnly | null {
  const t = text.trim();
  if (/^\d{8}$/.test(t)) {
    const s = `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
    return isDateOnly(s) ? s : null;
  }
  if (/^\d+(\.\d+)?$/.test(t)) {
    const n = Math.floor(Number(t));
    if (n < 20000 || n > 80000) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + n * 86_400_000);
    return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const m = /^(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})\s*\.?(?:[T\s]+\d{1,2}:\d{2}.*)?$/.exec(t);
  if (!m) return null;
  const s = `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`;
  return isDateOnly(s) ? s : null;
}

/** 금액 셀. 소수는 반올림. 1 미만이나 1e13 이상은 null */
export function parseSheetAmount(text: string): number | null {
  const t = text.trim().replace(/[,\s]/g, '').replace(/원$/, '');
  let n: number | null = null;
  if (/^\d+(\.\d+)?([eE][+-]?\d+)?$/.test(t)) n = Number(t);
  else if (/^[\d.조억만천백]+$/.test(t) && /[조억만천백]/.test(t)) n = parseKoreanAmount(t);
  if (n === null || !Number.isFinite(n)) return null;
  n = Math.round(n);
  return n >= 1 && n < 1e13 ? n : null;
}

/** 지분율 셀. 빈 문자열 → 100. "%" 없이 0 < n <= 1 이면 엑셀 퍼센트 서식. 정수로 반올림, 1~100 밖은 null */
export function parseSheetShare(text: string): number | null {
  const raw = text.trim();
  const hasPct = raw.endsWith('%');
  const t = raw.replace(/%$/, '').trim();
  if (t === '') return 100;
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  // 0 < n <= 1 은 "%" 없는 엑셀 퍼센트 서식 칸("0.7")에만 적용한다. "1%"는 1이다.
  if (hasPct && n < 1) return null;
  const v = Math.round(!hasPct && n > 0 && n <= 1 ? n * 100 : n);
  return v >= 1 && v <= 100 ? v : null;
}

export interface SheetRow { row: number /* 1-based 엑셀 행 번호 */; input?: PerformanceInput; error?: string }
export type SheetParse = { ok: true; rows: SheetRow[]; valid: number; invalid: number } | { ok: false; error: string };

/** 표 셀 → 행. 머리글은 위 2행 안의 첫 번째 비어 있지 않은 행. 오류가 여러 개면 첫 번째만 */
export function rowsFromCells(cells: Array<{ r: number; c: number; text: string }>): SheetParse {
  const byRow = new Map<number, Map<number, string>>();
  for (const cell of cells) {
    const text = cell.text.trim();
    if (text === '') continue;
    let m = byRow.get(cell.r);
    if (!m) byRow.set(cell.r, (m = new Map()));
    m.set(cell.c, text);
  }
  const rowIdx = [...byRow.keys()].sort((a, b) => a - b);
  const headerR = rowIdx.find((r) => r <= 1);
  if (headerR === undefined) return { ok: false, error: '머리글 행을 찾지 못했습니다.' };

  const colOf = new Map<SheetColumn, number>();
  for (const [c, text] of byRow.get(headerR)!) {
    const key = headerKeyOf(text) as SheetColumn;
    if ((SHEET_COLUMNS as readonly string[]).includes(key) && !colOf.has(key)) colOf.set(key, c);
  }
  const missingCols = SHEET_REQUIRED.filter((k) => !colOf.has(k));
  if (missingCols.length > 0) return { ok: false, error: `필수 머리글이 없습니다: ${missingCols.join(', ')}` };

  const rows: SheetRow[] = [];
  let valid = 0;
  let invalid = 0;
  for (const r of rowIdx) {
    if (r <= headerR) continue;
    const m = byRow.get(r)!;
    const get = (k: SheetColumn): string => (colOf.has(k) ? (m.get(colOf.get(k)!) ?? '') : '');
    const row = r + 1;
    const fail = (error: string) => { rows.push({ row, error }); invalid++; };

    const title = get('사업명');
    const client = get('발주기관');
    const amountText = get('계약금액');
    const startText = get('착수일');
    const endText = get('완료일');
    if (title === '') { fail('사업명: 비어 있음'); continue; }
    if (client === '') { fail('발주기관: 비어 있음'); continue; }
    if (amountText === '') { fail('계약금액: 비어 있음'); continue; }
    if (startText === '') { fail('착수일: 비어 있음'); continue; }
    const amount = parseSheetAmount(amountText);
    if (amount === null) { fail('계약금액: 금액 형식 아님'); continue; }
    const startAt = parseSheetDate(startText);
    if (startAt === null) { fail('착수일: 날짜 형식 아님'); continue; }
    let endAt: DateOnly | null = null;
    if (endText !== '') {
      endAt = parseSheetDate(endText);
      if (endAt === null) { fail('완료일: 날짜 형식 아님'); continue; }
      if (startAt > endAt) { fail('착수일: 완료일보다 늦음'); continue; }
    }
    const share = parseSheetShare(get('지분율'));
    if (share === null) { fail('지분율: 1~100 사이 숫자 아님'); continue; }
    if (title.length > 200) { fail('사업명: 200자 초과'); continue; }
    if (client.length > 100) { fail('발주기관: 100자 초과'); continue; }
    const category = get('분야');
    const note = get('비고');
    if (category.length > 50) { fail('분야: 50자 초과'); continue; }
    if (note.length > 500) { fail('비고: 500자 초과'); continue; }

    const input: PerformanceInput = { title, client, amount, startAt };
    if (endAt !== null) input.endAt = endAt;
    if (share !== 100) input.share = share;
    if (category !== '') input.category = category;
    if (note !== '') input.note = note;
    rows.push({ row, input });
    valid++;
  }
  return { ok: true, rows, valid, invalid };
}
