/** 표기 헬퍼(순수 함수). UI와 메일 렌더가 함께 쓴다. */

const comma = (n: number) => String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** 억/만 단위 표기. 500000000 → "5억 원", 550000000 → "5억 5,000만 원", 15000000 → "1,500만 원", 0 → "0원". */
export function formatAmountShort(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  if (n < 10_000) return `${comma(n)}원`;
  const eok = Math.floor(n / 100_000_000);
  const man = Math.floor((n % 100_000_000) / 10_000);
  const parts: string[] = [];
  if (eok > 0) parts.push(`${comma(eok)}억`);
  if (man > 0) parts.push(`${comma(man)}만`);
  return `${parts.join(' ')} 원`;
}

/** 억/만 표기와 원 단위 병기. 예: "5억 원 (500,000,000원)". 1만 원 미만은 원 단위만. */
export function formatAmountFull(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  if (n < 10_000) return `${comma(n)}원`;
  return `${formatAmountShort(n)} (${comma(n)}원)`;
}

export function formatScore(n: unknown): string {
  return typeof n === 'number' && Number.isFinite(n) ? `${n}점` : '—';
}

/** 기간 값은 "3년" 문자열로 저장된다. 숫자가 오면 "N년"으로 만든다. */
export function formatPeriod(v: unknown): string {
  if (typeof v === 'number' && Number.isFinite(v)) return `${v}년`;
  return typeof v === 'string' && v ? v : '—';
}

export function formatDifferential(v: unknown): string {
  return typeof v === 'boolean' ? (v ? '적용' : '미적용') : '—';
}

const p2 = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD HH:mm (로컬 시간). 해석 불가면 빈 문자열. */
export function formatDateTimeFull(iso: string | undefined | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/** YYYY-MM-DD (로컬 시간). 해석 불가면 빈 문자열. */
export function formatDateFull(iso: string | undefined | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

export function formatJoint(v: unknown): string {
  return typeof v === 'boolean' ? (v ? '허용' : '불허') : '—';
}
