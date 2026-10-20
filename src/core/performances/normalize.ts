import type { DateOnly, PerformanceRecord } from '../types/performance';

const err = (code: string, message: string) => Object.assign(new Error(message), { code });
const AMOUNT_MAX = 1e13;

/** 'YYYY-MM-DD' 형식이면서 실제 달력 날짜인지. */
export function isDateOnly(v: unknown): v is DateOnly {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const isAmount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v < AMOUNT_MAX;
const isShare = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 100;

function text(v: unknown, min: number, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length >= min && t.length <= max ? t : null;
}
function optText(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t.length >= 1 && t.length <= max ? t : undefined;
}

/** 저장 파일 항목 보정. 필수가 깨지면 null(건너뜀). 선택 필드는 틀리면 제거 */
export function normalizePerformance(raw: unknown, fileUpdatedAt: string): PerformanceRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || o.id === '') return null;
  const title = text(o.title, 1, 200);
  const client = text(o.client, 1, 100);
  if (title === null || client === null) return null;
  if (!isAmount(o.amount) || !isDateOnly(o.startAt)) return null;
  const rec: PerformanceRecord = {
    id: o.id, title, client, amount: o.amount, startAt: o.startAt,
    source: o.source === 'excel' ? 'excel' : 'manual',
    updatedAt: typeof o.updatedAt === 'string' && o.updatedAt !== '' ? o.updatedAt : fileUpdatedAt,
  };
  if (isDateOnly(o.endAt)) {
    if (o.endAt < o.startAt) return null;
    rec.endAt = o.endAt;
  }
  if (isShare(o.share)) rec.share = o.share;
  const category = optText(o.category, 50);
  if (category !== undefined) rec.category = category;
  const note = optText(o.note, 500);
  if (note !== undefined) rec.note = note;
  return rec;
}

/** 입력 검증. 실패 시 { code: 'INVALID_VALUE', message } 형태의 Error를 던진다. 통과하면 정규화된 값 */
export function validatePerformanceInput(input: unknown): Omit<PerformanceRecord, 'id' | 'updatedAt' | 'source'> {
  if (!input || typeof input !== 'object') throw err('INVALID_VALUE', '실적 입력이 올바르지 않습니다.');
  const o = input as Record<string, unknown>;
  const title = text(o.title, 1, 200);
  if (title === null) throw err('INVALID_VALUE', '사업명은 1자 이상 200자 이하여야 합니다.');
  const client = text(o.client, 1, 100);
  if (client === null) throw err('INVALID_VALUE', '발주기관은 1자 이상 100자 이하여야 합니다.');
  if (!isAmount(o.amount)) throw err('INVALID_VALUE', '계약금액은 1원 이상 1e13 미만의 정수여야 합니다.');
  if (!isDateOnly(o.startAt)) throw err('INVALID_VALUE', '착수일은 YYYY-MM-DD 형식의 실제 날짜여야 합니다.');
  const out: Omit<PerformanceRecord, 'id' | 'updatedAt' | 'source'> = { title, client, amount: o.amount, startAt: o.startAt };
  if (o.endAt !== undefined && o.endAt !== null && o.endAt !== '') {
    if (!isDateOnly(o.endAt)) throw err('INVALID_VALUE', '완료일은 YYYY-MM-DD 형식의 실제 날짜여야 합니다.');
    if (o.endAt < o.startAt) throw err('INVALID_VALUE', '완료일은 착수일 이후여야 합니다.');
    out.endAt = o.endAt;
  }
  if (o.share !== undefined && o.share !== null) {
    if (!isShare(o.share)) throw err('INVALID_VALUE', '지분율은 1 이상 100 이하의 정수여야 합니다.');
    out.share = o.share;
  }
  for (const [key, label, max] of [['category', '분야', 50], ['note', '비고', 500]] as const) {
    const v = o[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string') throw err('INVALID_VALUE', `${label}은(는) 문자열이어야 합니다.`);
    const t = v.trim();
    if (t.length > max) throw err('INVALID_VALUE', `${label}은(는) ${max}자 이하여야 합니다.`);
    if (t !== '') out[key] = t;
  }
  return out;
}
