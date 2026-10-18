const CHOSUNG = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';

/** 한글 음절은 초성으로, 나머지 글자는 그대로 둔다. "입찰마감" → "ㅇㅊㅁㄱ". */
export function toChosung(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.charCodeAt(0) - 0xac00;
    out += code >= 0 && code < 11172 ? CHOSUNG[Math.floor(code / 588)] : ch;
  }
  return out;
}

const isChosungOnly = (q: string) => /^[ㄱ-ㅎ]+$/.test(q);

/**
 * 검색어가 text에 들어 있는지. 대소문자와 공백은 무시한다.
 * 검색어가 자음만이면 초성으로 비교한다("ㅇㅊ" → "입찰").
 */
export function matchesQuery(text: string, query: string): boolean {
  const q = query.replace(/\s+/g, '').toLowerCase();
  if (!q) return true;
  const t = text.replace(/\s+/g, '').toLowerCase();
  if (t.includes(q)) return true;
  return isChosungOnly(q) && toChosung(t).includes(q);
}
