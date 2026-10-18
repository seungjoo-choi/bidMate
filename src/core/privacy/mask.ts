// 이메일 로컬파트 마스킹. 구분자는 '@' 또는 URL 인코딩 '%40'(대소문자 무관)이며 원래 형태를 유지한다.
const LOCAL = '(?:[A-Za-z0-9_+\\-]|%[0-9A-Fa-f]{2})(?:[A-Za-z0-9._+\\-]|%[0-9A-Fa-f]{2})*';
const EMAIL_RE = new RegExp(`${LOCAL}(@|%2540|%40)([A-Za-z0-9\\-]+(?:\\.[A-Za-z0-9\\-]+)*\\.[A-Za-z]{2,})`, 'gi');
// 자르기로 도메인이 잘린 부분 이메일(안전망)
const PARTIAL_TAIL_RE = new RegExp(`${LOCAL}(@|%2540|%40)([A-Za-z0-9.\\-]*)$`, 'i');

export const maskStr = (s: string): string => s.replace(EMAIL_RE, '***$1$2');

/** 마스킹 먼저, 자르기 나중. 끝에 남은 부분 이메일도 마스킹한다. */
export function truncateMasked(s: string, max: number): string {
  return maskStr(s).slice(0, max).replace(PARTIAL_TAIL_RE, '***$1$2');
}

export function maskDeep<T>(v: T): T {
  if (typeof v === 'string') return maskStr(v) as unknown as T;
  if (Array.isArray(v)) return v.map(maskDeep) as unknown as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = maskDeep(val);
    return out as T;
  }
  return v;
}
