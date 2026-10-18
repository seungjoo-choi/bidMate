const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

const trimEnd = (s: string): string => s.replace(/[ .]+$/, '');

/** 경로 세그먼트(폴더/파일명)용 문자열 정리. */
export function sanitizeSegment(s: string, maxLen: number): string {
  let out = s.replace(ILLEGAL, '').replace(/\s+/g, ' ');
  out = trimEnd(out.trim());
  out = trimEnd(Array.from(out).slice(0, maxLen).join(''));
  const base = out.split('.')[0]?.trim() ?? '';
  if (RESERVED.test(base)) out += '_';
  return out === '' ? '_' : out;
}
