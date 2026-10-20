/** "1,923,000,000", "1,923,000,000원" 만 숫자로 해석한다. 억/만 등 단위가 섞이면 null. */
export function parseAmount(raw: string): number | null {
  const m = /^\s*(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*(원|점|%)?\s*$/.exec(raw);
  if (!m) return null;
  const n = Number(`${m[1]!.replace(/,/g, '')}${m[2] ?? ''}`);
  return Number.isFinite(n) ? n : null;
}
