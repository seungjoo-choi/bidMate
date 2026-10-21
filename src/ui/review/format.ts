/** 검수 화면 표기 헬퍼(순수 함수). */

export { formatAmountShort, formatAmountFull, formatScore, formatPeriod, formatDifferential } from '../../core/model/format';

const p2 = (n: number) => String(n).padStart(2, '0');

function parse(iso: string | undefined | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** YYYY/MM/DD HH:mm (로컬 시간). 화면 날짜 표기는 모두 이 형식(연도 포함)으로 통일한다. */
export function formatDateTime(iso: string | undefined | null): string {
  const d = parse(iso);
  return d ? `${formatYmd(d)} ${p2(d.getHours())}:${p2(d.getMinutes())}` : '—';
}

/** YYYY/MM/DD (로컬 시간). */
export function formatDate(iso: string | undefined | null): string {
  const d = parse(iso);
  return d ? formatYmd(d) : '—';
}

/** Date → YYYY/MM/DD. 날짜를 직접 조립하는 곳도 이걸 쓴다 */
export function formatYmd(d: Date): string {
  return `${d.getFullYear()}/${p2(d.getMonth() + 1)}/${p2(d.getDate())}`;
}

export function isPast(iso: string | undefined | null, now: Date = new Date()): boolean {
  const d = parse(iso);
  return d !== null && d.getTime() < now.getTime();
}

/** 로컬 달력 날짜 기준 D-day. 오늘이면 "D-day", 지났으면 "마감", 값이 없으면 null. */
export function formatDDay(iso: string | undefined | null, now: Date = new Date()): string | null {
  const d = parse(iso);
  if (!d) return null;
  if (d.getTime() < now.getTime()) return '마감';
  const day = (x: Date) => Date.UTC(x.getFullYear(), x.getMonth(), x.getDate());
  const n = Math.round((day(d) - day(now)) / 86_400_000);
  return n === 0 ? 'D-day' : `D-${n}`;
}

/** D-day 표기 색 등급. 오늘, 내일은 urgent, 2~3일 뒤는 soon, 나머지는 null. */
export function dDayLevel(dday: string | null): 'urgent' | 'soon' | null {
  if (dday === 'D-day' || dday === 'D-1') return 'urgent';
  if (dday === 'D-2' || dday === 'D-3') return 'soon';
  return null;
}

/** 마감이 지나지 않았고 days일(기본 3일) 이내면 true. */
export function isDueSoon(iso: string | undefined | null, now: Date = new Date(), days = 3): boolean {
  const d = parse(iso);
  if (!d) return false;
  const diff = d.getTime() - now.getTime();
  return diff >= 0 && diff <= days * 86_400_000;
}
