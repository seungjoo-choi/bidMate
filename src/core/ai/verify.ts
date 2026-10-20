import type { DocKind } from '../extraction/classify';
import { valueKey } from '../extraction/decide';
import { compact, parseKoreanAmount } from '../extraction/normalize';
import { VALUE_CHECK } from '../model/field-edit';
import { EXTRACTION_KEYS, type EvidenceRef, type ExtractionKey } from '../types/extraction';
import type { AiProvider, AiRejectReason, AiRun, AiSuggestion } from '../types/ai';
import { DOT_THOUSANDS, coerceValue, type RawAiItem } from './parse';

export interface VerifyFile { attachmentId: string; sourceFile: string; name: string; docKind: DocKind; text: string }
export interface VerifyContext {
  /** 파일 전체 텍스트(발췌가 아님) */
  files: VerifyFile[];
  /** 비교 당시 효과값(userEdited.value 우선, 없으면 item.value) */
  baseline: Partial<Record<ExtractionKey, unknown | null>>;
  requested: ExtractionKey[];
  provider: AiProvider;
  promptVersion: string;
}
export interface VerifyResult {
  suggestions: Partial<Record<ExtractionKey, AiSuggestion>>;
  rejected: AiRun['rejected'];
  warnings: string[];
}
export interface QuoteLocation {
  line: number /* 1부터 */; endLine: number; page: number | null; partial: boolean;
  /** 매치된 원문 줄(line~endLine). 태그 제거, 줄은 ' | '로 연결 */
  sourceText: string;
}

const PARTIAL_LEN = 50;
const QUOTE_MAX = 600;
const MIN_QUOTE_CHARS = 8;
const MIN_QUOTE_LETTERS = 4;
const ABSOLUTE_MIN_LETTERS = 2;
const MAX_SPAN_LINES = 3;

const stripTags = (line: string): string => line.replace(/\[셀[^\]]*\]/g, '').replace(/\[표\s*\d+\]/g, '').replace(/\[p\s*\d+\]/g, '').trim();

/** `[셀 …]`, `[표 k]`, `[p N]` 태그 제거 → `|` 제거 → compact. quote와 원문 양쪽에 같은 변환을 쓴다. */
export function normalizeForMatch(line: string): string {
  return compact(stripTags(line).replace(/\|/g, ''));
}

/** 'long'=충분, 'exact_only'=짧아서 원문 한 줄/표 한 행 전체와 정확히 같을 때만 허용, 'too_short'=글자 2자 미만(항상 거부). */
export function quoteStrength(quote: string): 'long' | 'exact_only' | 'too_short' {
  const n = quote.split('\n').map(normalizeForMatch).join('');
  const letters = (n.match(/[가-힣a-zA-Z]/g) ?? []).length;
  if (letters < ABSOLUTE_MIN_LETTERS) return 'too_short';
  return n.length < MIN_QUOTE_CHARS || letters < MIN_QUOTE_LETTERS ? 'exact_only' : 'long';
}

const cellRow = (line: string): string | null => /^\[셀 (\d+) \d+/.exec(line)?.[1] ?? null;

/** 줄별 정규화 문자열을 이어 붙인 곳에서 quote를 찾는다. line은 1부터, page는 해당 줄 이전 마지막 `[p N]`.
 * 매치가 3줄을 넘으면 실패(단 모두 같은 표 행의 셀이면 허용). */
export function locateQuote(text: string, quote: string, opts: { exactOnly?: boolean } = {}): QuoteLocation | null {
  const quoteN = quote.split('\n').map(normalizeForMatch).join('');
  if (!quoteN) return null;
  const lines = text.split('\n');
  let acc = '';
  const starts: number[] = []; // 줄별 acc 내 시작 오프셋
  const ends: number[] = [];
  lines.forEach((l) => {
    starts.push(acc.length);
    acc += normalizeForMatch(l);
    ends.push(acc.length);
  });
  const lineAt = (pos: number): number => {
    for (let i = 0; i < lines.length; i++) if (pos >= starts[i]! && pos < ends[i]!) return i;
    return -1;
  };
  const spanOk = (from: number, to: number): boolean => {
    if (to - from + 1 <= MAX_SPAN_LINES) return true;
    const r = cellRow(lines[from]!);
    if (r === null) return false;
    for (let i = from; i <= to; i++) if (cellRow(lines[i]!) !== r) return false;
    return true;
  };
  /** from~to가 같은 표 행(같은 r)의 셀 전체인가: 앞뒤 줄이 같은 r 셀이 아니어야 한다. */
  const wholeRow = (from: number, to: number): boolean => {
    const r = cellRow(lines[from]!);
    if (r === null) return false;
    for (let i = from; i <= to; i++) if (cellRow(lines[i]!) !== r) return false;
    return (from === 0 || cellRow(lines[from - 1]!) !== r) && (to === lines.length - 1 || cellRow(lines[to + 1]!) !== r);
  };
  const search = (needle: string, partial: boolean): QuoteLocation | null => {
    for (let idx = acc.indexOf(needle); idx >= 0; idx = acc.indexOf(needle, idx + 1)) {
      const li = lineAt(idx);
      const ei = lineAt(idx + needle.length - 1);
      if (li < 0 || ei < li || !spanOk(li, ei)) continue;
      if (opts.exactOnly && !(!partial && idx === starts[li] && idx + needle.length === ends[ei] && (li === ei || wholeRow(li, ei)))) continue;
      let page: number | null = null;
      for (let i = li; i >= 0; i--) {
        const m = /^\[p (\d+)\]/.exec(lines[i]!);
        if (m) { page = parseInt(m[1]!, 10); break; }
      }
      return { line: li + 1, endLine: ei + 1, page, partial, sourceText: lines.slice(li, ei + 1).map(stripTags).filter(Boolean).join(' | ') };
    }
    return null;
  };
  const full = search(quoteN, false);
  if (full || quoteN.length <= PARTIAL_LEN || opts.exactOnly) return full;
  return search(quoteN.slice(0, PARTIAL_LEN), true);
}

function findFileByName(files: VerifyFile[], name: string): VerifyFile | undefined {
  return files.find((f) => f.name === name) ?? files.find((f) => f.name.endsWith(name));
}

/** quote는 AI가 준 문장이 아니라 매치된 원문 줄 텍스트다. */
function valueInQuote(key: ExtractionKey, value: unknown, quote: string): boolean {
  switch (key) {
    case 'credibilityScore': case 'managementScore': case 'performanceScore':
      return (quote.match(/\d+(?:\.\d+)?/g) ?? []).some((n) => parseFloat(n) === value);
    case 'performancePeriod': {
      const y = parseInt(String(value), 10);
      return (quote.match(/\d+/g) ?? []).some((n) => parseInt(n, 10) === y);
    }
    case 'performanceMinAmount':
      return (quote.match(/\d[\d,.]*(?:\s*[조억만천백\d,.]+)*\s*원?/g) ?? []).some((m) => !DOT_THOUSANDS.test(m.trim()) && parseKoreanAmount(m) === value);
    case 'differentialScoring':
      return /적용|차등/.test(quote);
    default:
      return true;
  }
}

export function verifySuggestions(raw: RawAiItem[], ctx: VerifyContext): VerifyResult {
  const suggestions: VerifyResult['suggestions'] = {};
  const rejected: VerifyResult['rejected'] = [];
  const warnings: string[] = [];
  const seen = new Set<ExtractionKey>();
  const reject = (it: RawAiItem, reason: AiRejectReason): void => {
    rejected.push({
      key: it.key, reason,
      ...(it.value !== null && it.value !== undefined ? { value: it.value } : {}),
      ...(it.quote ? { quote: it.quote } : {}),
      ...(it.file ? { file: it.file } : {}),
    });
  };
  const locate = (it: RawAiItem, exactOnly = false): { file: VerifyFile; loc: QuoteLocation } | null => {
    const named = it.file ? findFileByName(ctx.files, it.file) : undefined;
    if (named) {
      const loc = locateQuote(named.text, it.quote, { exactOnly });
      if (loc) return { file: named, loc };
    }
    for (const f of ctx.files) {
      if (f === named) continue;
      const loc = locateQuote(f.text, it.quote, { exactOnly });
      if (loc) {
        if (it.file) warnings.push(`${it.key}: 인용문을 AI가 알려준 파일(${it.file})이 아니라 ${f.name}에서 찾았습니다.`);
        return { file: f, loc };
      }
    }
    return null;
  };

  for (const it of raw) {
    if (!(EXTRACTION_KEYS as string[]).includes(it.key) || !ctx.requested.includes(it.key as ExtractionKey)) { reject(it, 'unknown_key'); continue; }
    const key = it.key as ExtractionKey;
    if (seen.has(key)) { warnings.push(`${key}: 같은 항목이 여러 번 와서 첫 번째만 썼습니다.`); continue; }
    seen.add(key); // 첫 항목이 거부돼도 두 번째는 쓰지 않는다
    const baseline = ctx.baseline[key] ?? null;
    const evidenceOf = (found: { file: VerifyFile; loc: QuoteLocation }): EvidenceRef => ({
      attachmentId: found.file.attachmentId, sourceFile: found.file.sourceFile,
      ...(found.loc.page !== null ? { page: found.loc.page } : {}),
      line: found.loc.line, location: `line ${found.loc.line}`,
      evidence: it.quote.slice(0, 300), ruleId: `ai:${ctx.provider}:${ctx.promptVersion}`, docKind: found.file.docKind,
    });

    if (it.value === null) {
      const strength = it.quote.trim() ? quoteStrength(it.quote) : 'too_short';
      const found = strength === 'too_short' ? null : locate(it, strength === 'exact_only');
      suggestions[key] = {
        key, value: null, quote: it.quote, ...(it.note ? { note: it.note } : {}),
        ...(found ? { file: found.file.name, page: found.loc.page, evidence: evidenceOf(found) } : {}),
        verdict: 'none', baseline, valueInQuote: false,
      };
      continue;
    }

    const c = coerceValue(key, it.value);
    if (!c.ok || !VALUE_CHECK[key](c.value) || it.quote.length > QUOTE_MAX) { reject(it, 'bad_format'); continue; }
    if (!it.quote.trim()) { reject(it, 'quote_missing'); continue; }
    const strength = quoteStrength(it.quote);
    if (strength === 'too_short') { reject(it, 'quote_too_short'); continue; }
    const found = locate(it, strength === 'exact_only');
    if (!found) { reject(it, strength === 'exact_only' ? 'quote_too_short' : 'quote_not_found'); continue; }
    const inSource = valueInQuote(key, c.value, found.loc.sourceText);
    if (key === 'performanceCondition') {
      const norm = found.file.text.split('\n').map(normalizeForMatch).join('');
      if (found.loc.partial || !norm.includes(normalizeForMatch(String(c.value)))) { reject(it, 'quote_not_found'); continue; }
    } else if ((found.loc.partial || strength === 'exact_only') && !inSource) {
      // 짧은 인용(셀 하나 등)은 값이 원문에 없으면 근거로 보지 않는다.
      reject(it, strength === 'exact_only' ? 'quote_too_short' : 'quote_not_found'); continue;
    }
    if (found.loc.partial) warnings.push(`${key}: 인용문이 길어 앞 ${PARTIAL_LEN}자만 일치했습니다(partial).`);

    suggestions[key] = {
      key, value: c.value, quote: it.quote, ...(it.note ? { note: it.note } : {}),
      file: found.file.name, page: found.loc.page, evidence: evidenceOf(found),
      verdict: baseline === null ? 'new' : valueKey(baseline) === valueKey(c.value) ? 'match' : 'differs',
      baseline, valueInQuote: inSource,
    };
  }
  return { suggestions, rejected, warnings };
}
