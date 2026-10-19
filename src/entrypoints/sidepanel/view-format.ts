/** 사이드 패널 표시 전용 작은 서식(기존 format.ts에 없는 파일 크기, 소요 초, 시각 초 단위). */

/** 바이트 -> "412KB", "1.8MB". 값이 없으면 빈 문자열. */
export function sizeText(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

/** 밀리초 -> "0.4초" */
export function secsText(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)}초`;
}

/** ISO -> 로컬 HH:mm:ss. 해석 불가면 빈 문자열. */
export function clockText(iso: string | undefined | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 서식 함수가 돌려주는 빈 값 표시("—", 빈 문자열)를 "-"로 통일한다. */
export function dash(s: string | null | undefined): string {
  return !s || s === '—' ? '-' : s;
}
