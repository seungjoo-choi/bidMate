import * as promptModule from '../../src/core/ai/prompt';
import { buildPrompt } from '../../src/core/ai/prompt';
import { EXTRACTION_KEYS } from '../../src/core/types/extraction';

/** prompt.ts가 PROMPT_EXAMPLE_TOKENS를 export하기 전까지 쓰는 허용 목록 */
const LOCAL_EXAMPLE_TOKENS: string[] = [];
export const BANNED_PHRASES = ['사업규모', 'KOICA', '코이카'];

/** SYSTEM_PROMPT + 항목 정의(excerpt 빈 문자열) 텍스트 */
export function renderLintTarget(): string {
  const b = buildPrompt({ runId: 'lint', keys: EXTRACTION_KEYS, excerpt: '', skippedFiles: [] });
  return `${b.system}\n${b.user}`;
}

export const allowedExampleTokens = (): string[] =>
  (promptModule as unknown as { PROMPT_EXAMPLE_TOKENS?: readonly string[] }).PROMPT_EXAMPLE_TOKENS?.slice() ?? LOCAL_EXAMPLE_TOKENS;

/** 허용 목록에 없는 숫자 토큰과 금지 어구를 위반 목록으로 돌려준다. schema 태그·runId·요청 항목 개수 안내는 제외한다. */
export function lintPrompt(text: string, allowed: readonly string[] = allowedExampleTokens()): string[] {
  const out: string[] = [];
  const stripped = text
    .replace(/bidmate-ai-review\/\d+/g, '')
    .replace(/"runId": "[^"]*"/g, '')
    .replace(/runId는 "[^"]*"/g, '')
    .replace(/key는 아래 \d+개만/g, '');
  for (const m of stripped.match(/\d[\d,.]*/g) ?? []) {
    const t = m.replace(/[,.]+$/, '');
    if (!allowed.includes(t)) out.push(`숫자 토큰: ${t}`);
  }
  for (const p of BANNED_PHRASES) if (text.includes(p)) out.push(`금지 어구: ${p}`);
  return [...new Set(out)];
}

/** "예:"/"예)"가 있는 줄 중 "(가상 예)" 표시가 없는 줄 */
export function lintExampleMarkers(text: string): string[] {
  return text.split('\n').filter((l) => /예:|예\)/.test(l) && !l.includes('(가상 예)')).map((l) => `(가상 예) 누락: ${l.trim()}`);
}
