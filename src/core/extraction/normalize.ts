/** NFC → \u0000/zero-width 제거 → `：`→`:` → 모든 공백 제거. 규칙 정규식은 compact된 텍스트 대상. */
export function compact(s: string): string {
  return s
    .normalize('NFC')
    .replace(/[\u0000​-‍⁠﻿]/g, '')
    .replace(/：/g, ':')
    .replace(/\s+/g, '');
}

const SMALL: Record<string, number> = { 천: 1e3, 백: 1e2 };
const BIG: Record<string, number> = { 조: 1e12, 억: 1e8, 만: 1e4 };

/** '5억원', '5억 5천만원', '500,000,000원', '1.5억원' → 원 단위 숫자. 해석 불가면 null. */
export function parseKoreanAmount(s: string): number | null {
  const t = s.normalize('NFC').replace(/[,\s]/g, '');
  let total = 0;
  let section = 0;
  let found = false;
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)?(조|억|만|천|백)?/g)) {
    const num = m[1] !== undefined ? parseFloat(m[1]) : undefined;
    const unit = m[2];
    if (num === undefined && unit === undefined) continue;
    found = true;
    if (unit === undefined) section += num!;
    else if (unit in SMALL) section += (num ?? 1) * SMALL[unit]!;
    else {
      total += (num !== undefined ? section + num : section === 0 ? 1 : section) * BIG[unit]!;
      section = 0;
    }
  }
  if (!found) return null;
  return Math.round(total + section);
}

/** '5년', '최근 3년간' → 연수. */
export function parseYears(s: string): number | null {
  const m = /(\d+)\s*년/.exec(s);
  return m ? parseInt(m[1]!, 10) : null;
}
