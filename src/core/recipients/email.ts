const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX = 254;

// 앞뒤 공백 제거 후 소문자로 정규화
export const normalizeEmail = (s: string): string => s.trim().toLowerCase();

// 정규화된 값 기준 형식 검사
export const isValidEmail = (s: string): boolean => {
  const e = normalizeEmail(s);
  return e.length > 0 && e.length <= EMAIL_MAX && EMAIL_RE.test(e);
};
