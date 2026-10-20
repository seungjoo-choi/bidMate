import { existsSync, readdirSync, readFileSync } from 'node:fs';
import type { ExcerptFileInput } from '../../src/core/ai/excerpt';
import { coerceValue } from '../../src/core/ai/parse';
import { normalizeForMatch, type VerifyFile } from '../../src/core/ai/verify';
import type { DocKind } from '../../src/core/extraction/classify';
import { valueKey } from '../../src/core/extraction/decide';
import { compact } from '../../src/core/extraction/normalize';
import { DEFAULT_RULES } from '../../src/core/extraction/rules/load';
import type { ExtractionKey } from '../../src/core/types/extraction';

export const EVAL_DIR = 'tests/fixtures/ai-eval';
export const RESULTS_DIR = `${EVAL_DIR}/results`;
export const RESPONSES_DIR = `${EVAL_DIR}/responses`;
/** 온라인 평가·리플레이가 공유하는 고정 runId(parse가 runId 일치를 검사한다) */
export const EVAL_RUN_ID = 'eval';
export const SYNONYMS = DEFAULT_RULES.synonyms;

export interface AnswerItem {
  expected: unknown | null;
  variants?: Array<{ condition: string; value: unknown }>;
  evidenceLines: Array<{ file: string; line: number }>;
  ambiguous?: string;
}
export interface AnswerKey { noticeId: string; title: string; textDir: string; items: Partial<Record<ExtractionKey, AnswerItem>> }

export const readText = (path: string): string => readFileSync(path, 'utf8');

export function loadAnswerKeys(): AnswerKey[] {
  if (!existsSync(EVAL_DIR)) return [];
  return readdirSync(EVAL_DIR).filter((f) => f.endsWith('.json')).sort()
    .map((f) => JSON.parse(readText(`${EVAL_DIR}/${f}`)) as AnswerKey);
}

export interface EvalFile { fileName: string; name: string; text: string; priority: number; kindLabel: string; docKind: DocKind }

/** 파일명에서 앞 `N_` 접두와 `.txt` 제거 */
export const displayNameOf = (fileName: string): string => fileName.replace(/\.txt$/i, '').replace(/^\d+_/, '');

function classifyByName(name: string): { priority: number; kindLabel: string; docKind: DocKind } {
  if (/공고/.test(name)) return { priority: 0, kindLabel: '공고문', docKind: 'notice' };
  if (/제안요청|과업/.test(name)) return { priority: 1, kindLabel: '제안요청서', docKind: 'rfp' };
  return { priority: 2, kindLabel: '기타', docKind: 'other' };
}

export function loadEvalFiles(key: AnswerKey): EvalFile[] {
  const dir = existsSync(key.textDir) ? key.textDir : `${EVAL_DIR}/text/${key.noticeId}`;
  return readdirSync(dir).filter((f) => f.endsWith('.txt')).sort().map((fileName) => {
    const name = displayNameOf(fileName);
    return { fileName, name, text: readText(`${dir}/${fileName}`), ...classifyByName(name) };
  });
}

export const toExcerptInputs = (files: EvalFile[]): ExcerptFileInput[] =>
  files.map((f, i) => ({ attachmentId: `f${i}`, sourceFile: f.fileName, name: f.name, kindLabel: f.kindLabel, priority: f.priority, text: f.text }));
export const toVerifyFiles = (files: EvalFile[]): VerifyFile[] =>
  files.map((f, i) => ({ attachmentId: `f${i}`, sourceFile: f.fileName, name: f.name, docKind: f.docKind, text: f.text }));

/** 정답표의 file(파일명·표시명·접두 없는 이름 모두 허용)로 텍스트 파일을 찾는다. */
export function findEvalFile(files: EvalFile[], file: string): EvalFile | undefined {
  const base = file.replace(/^.*[\\/]/, '');
  return files.find((f) => f.fileName === base) ?? files.find((f) => f.name === displayNameOf(base));
}

export type Verdict = 'correct' | 'partial' | 'wrong' | 'rejected' | 'skipped';
export interface AiItemOutcome { value: unknown | null; note?: string; rejectedReason?: string; variants?: Array<{ condition?: string; value: unknown }> }

function mentionsVariantValue(note: string, v: unknown): boolean {
  const n = compact(note);
  if (typeof v === 'number') {
    return [String(v), v.toLocaleString('en-US'), v % 100_000_000 === 0 ? `${v / 100_000_000}억` : '', v % 10_000 === 0 ? `${v / 10_000}만` : '']
      .some((s) => s && n.includes(compact(s)));
  }
  const s = compact(String(v));
  return s.length > 0 && n.includes(s);
}

/** 정답표 항목과 AI 결과를 비교한다. valueKey 기준, 정답·AI 값 모두 coerceValue 후 비교.
 *  정답에 variants가 있고 AI도 variants를 냈으면 조건 문자열은 무시하고 값 집합(valueKey)만 비교한다: 일치 correct, 일부 일치 partial, 없으면 wrong.
 *  variants 없는 구 응답은 기존 규칙: AI value가 null인데 note에 variant 값이 하나라도 언급되면 'partial', 아니면 'wrong'. */
/** 인정조건(원문 문단)은 범위가 조금 다를 수 있다(머리말 "※ 유사사업 :" 포함 여부 등).
 * 정규화 후 한쪽이 다른 쪽을 포함하고 짧은 쪽이 긴 쪽의 70% 이상이면 같은 문단으로 본다. */
function sameParagraph(a: string, b: string): boolean {
  const n = (s: string) => s.split('\n').map(normalizeForMatch).join('');
  const [x, y] = [n(a), n(b)];
  if (!x || !y) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return long.includes(short) && short.length >= long.length * 0.7;
}

export function judge(key: ExtractionKey, ans: AnswerItem, ai: AiItemOutcome): Verdict {
  if (ans.ambiguous) return 'skipped';
  if (ai.rejectedReason) return 'rejected';
  const co = (v: unknown): unknown => {
    if (v === null || v === undefined) return null;
    const c = coerceValue(key, v);
    return c.ok ? c.value : v;
  };
  const exp = co(ans.expected);
  const got = co(ai.value);
  if (ans.variants?.length && ai.variants?.length) {
    const want = new Set(ans.variants.map((v) => valueKey(co(v.value))));
    const have = new Set(ai.variants.map((v) => valueKey(co(v.value))));
    const hit = [...have].filter((k) => want.has(k)).length;
    if (hit === 0) return 'wrong';
    return hit === want.size && have.size === want.size ? 'correct' : 'partial';
  }
  if (exp === null && !ans.variants?.length) return got === null ? 'correct' : 'wrong';
  if (exp !== null && got !== null && key === 'performanceCondition') return sameParagraph(String(exp), String(got)) ? 'correct' : 'wrong';
  if (exp !== null && got !== null) return valueKey(got) === valueKey(exp) ? 'correct' : 'wrong';
  if (exp !== null) return 'wrong'; // 정답 있음, AI null
  if (got !== null) return 'wrong'; // 정답 null(조건별 variants만 존재), AI는 단일 값
  const note = ai.note ?? '';
  return ans.variants!.some((v) => mentionsVariantValue(note, v.value)) ? 'partial' : 'wrong';
}
