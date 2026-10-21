/** 기간 표기 비교 키. "2026. 1. 1. ∼ 2026. 12. 31.(12개월)", "2026. 1. 1. ∼ 12. 31.", "2026/01/01 ~ 2026/12/31"은 모두 같은 키. */
const D = '(\\d{4})[./\\-년](\\d{1,2})[./\\-월](\\d{1,2})[.일]?';
const E = '(?:(\\d{4})[./\\-년])?(\\d{1,2})[./\\-월](\\d{1,2})[.일]?';
const PERIOD_RE = new RegExp(`^${D}(?:부터[~∼～]?|[~∼～])${E}(?:까지)?(?:\\([^)]*\\))?$`);
const pad = (s: string) => s.padStart(2, '0');

/** 기간 전체가 "시작일 ~ 종료일"(괄호 설명 허용) 형태면 정규화 키, 아니면 null. 종료일 연도가 없으면 시작 연도(종료 월일이 더 앞이면 다음 해). */
export function periodKey(v: string): string | null {
  const m = PERIOD_RE.exec(v.normalize('NFC').replace(/\s+/g, ''));
  if (!m) return null;
  const [, y1, m1, d1, y2, m2, d2] = m;
  const start = `${pad(m1!)}-${pad(d1!)}`, end = `${pad(m2!)}-${pad(d2!)}`;
  const endYear = y2 ?? String(Number(y1) + (end < start ? 1 : 0));
  return `${y1}-${start}~${endYear}-${end}`;
}
