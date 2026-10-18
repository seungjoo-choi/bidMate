/**
 * 공동수급 허용 여부 해석(API/html 공통).
 * - '불허'가 있거나 값이 '단독'뿐이면 false
 * - '공동'/'분담'이 있고 '불허'가 없으면 true
 * - 그 밖에는 null(판단 불가 → needs_review)
 */
export function parseJointVenture(raw: string): boolean | null {
  const v = raw.trim();
  if (v.includes('불허')) return false;
  if (v.replace(/[()\s]/g, '') === '단독') return false;
  if (v.includes('공동') || v.includes('분담')) return true;
  return null;
}
