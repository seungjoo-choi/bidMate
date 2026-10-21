// 비교용 텍스트 정규화와 문자 bigram 유사도.

const BULLET = /^\s*[o○●•·▪◦ㅇ※\-–□■▶►❍]+\s*/;

/** 줄마다 글머리를 떼고, 공백을 한 칸으로, 끝 문장부호를 지운 비교용 텍스트. */
export function normalizeText(s: string | undefined): string {
  if (!s) return '';
  return s.normalize('NFC').toLowerCase().split('\n')
    .map((l) => l.replace(BULLET, '').trim()).filter(Boolean).join('\n')
    .replace(/[，]/g, ',').replace(/[ \t ]+/g, ' ').replace(/[.。]+$/, '').trim();
}

/** 띄어쓰기·문장부호·글머리 기호를 모두 지운 문자열. 이것만 같으면 '표기만 다름'(같은 요구사항)으로 본다. */
export function stripFormat(s: string | undefined): string {
  return (s ?? '').normalize('NFC').replace(/[\s .,·ㆍ･:;\-–—_()（）[\]「」『』"'“”‘’`~!?○ㅇ●•▪◦※❍□■▶►]/g, '');
}

/** 비교 줄 키: 글머리·공백 제거 */
export const lineKey = (l: string): string => l.normalize('NFC').replace(BULLET, '').replace(/\s+/g, '');

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) { const b = s.slice(i, i + 2); m.set(b, (m.get(b) ?? 0) + 1); }
  return m;
}
const compact = (s: string) => normalizeText(s).replace(/\s/g, '');

/** 미리 계산한 bigram. 같은 항목을 여러 번 비교할 때 한 번만 만든다. */
export interface Grams { s: string; g: Map<string, number> }
export const gramsOfCompact = (s: string): Grams => ({ s, g: bigrams(s) });
export const grams = (text: string | undefined): Grams => gramsOfCompact(compact(text ?? ''));

/** 문자 bigram Dice 계수(0..1). 2자 미만은 동일성으로 판정. */
export function diceGrams(A: Grams, B: Grams): number {
  if (A.s.length < 2 || B.s.length < 2) return A.s === B.s ? 1 : 0;
  let inter = 0;
  const [small, big] = A.g.size <= B.g.size ? [A.g, B.g] : [B.g, A.g];
  for (const [k, v] of small) inter += Math.min(v, big.get(k) ?? 0);
  return (2 * inter) / (A.s.length - 1 + B.s.length - 1);
}
/** 공백 무시 Dice */
export const dice = (a: string | undefined, b: string | undefined): number => diceGrams(grams(a), grams(b));
export const diceCompact = (x: string, y: string): number => diceGrams(gramsOfCompact(x), gramsOfCompact(y));

/** part의 bigram 중 whole에 들어 있는 비율(분할·병합 판정). */
export function containGrams(part: Grams, whole: Grams): number {
  if (part.s.length < 2 || whole.s.length < 2) return 0;
  let inter = 0, total = 0;
  for (const [k, v] of part.g) { inter += Math.min(v, whole.g.get(k) ?? 0); total += v; }
  return inter / total;
}
export const containment = (part: string | undefined, whole: string | undefined): number => containGrams(grams(part), grams(whole));

const NUM_TOKEN = /\d[\d,.]*\s*(?:%|년|개월|일|건|명|식|대|억|만|원|GB|TB|MB|초|ms|시간|회)?/g;
/** 숫자 토큰 집합(수치 변경 판정). 문장 끝 마침표·쉼표는 숫자에 붙이지 않는다. */
export function numberTokens(s: string | undefined): Set<string> {
  return new Set(((s ?? '').match(NUM_TOKEN) ?? []).map((x) => x.replace(/\s/g, '').replace(/[.,]+$/, '').replace(/,/g, '')));
}
