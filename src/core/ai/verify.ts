import type { DocKind } from '../extraction/classify';
import { valueKey } from '../extraction/decide';
import { compact, parseKoreanAmount } from '../extraction/normalize';
import { REVIEW_KIND, type ReviewValueKind } from '../extraction/review-rows';
import { checkLeafValue } from '../model/field-edit';
import type { EvidenceRef } from '../types/extraction';
import type { AiProvider, AiRejectReason, AiRuleRelation, AiRun, AiSuggestion, AiVariant } from '../types/ai';
import { isAiKey, isDocAiKey, type AiKey } from './keys';
import { DOT_THOUSANDS, coerceValue, type RawAiItem } from './parse';

export interface VerifyFile { attachmentId: string; sourceFile: string; name: string; docKind: DocKind; text: string }
export interface VerifyContext {
  /** 파일 전체 텍스트(발췌가 아님) */
  files: VerifyFile[];
  /** 비교 당시 효과값(userEdited.value 우선, 없으면 item.value) */
  baseline: Partial<Record<AiKey, unknown | null>>;
  requested: AiKey[];
  /** 규칙 후보 값(extraction.items[key].candidates[].value + value). 주면 ruleRelation을 계산한다 */
  candidates?: Partial<Record<AiKey, unknown[]>>;
  provider: AiProvider;
  promptVersion: string;
}
export interface VerifyResult {
  suggestions: Partial<Record<AiKey, AiSuggestion>>;
  rejected: AiRun['rejected'];
  warnings: string[];
}
export interface QuoteLocation {
  line: number /* 1부터 */; endLine: number; page: number | null; partial: boolean;
  /** 표 행 조각 대조로 찾음(연속 일치 아님). partial처럼 값이 원문 행에 있어야 근거로 인정한다. */
  viaRow?: boolean;
  /** 매치된 원문 줄(line~endLine). 태그 제거, 줄은 ' | '로 연결 */
  sourceText: string;
}

const PARTIAL_LEN = 50;
const QUOTE_MAX = 600;
const MIN_QUOTE_CHARS = 8;
const MIN_QUOTE_LETTERS = 4;
const ABSOLUTE_MIN_LETTERS = 2;
const MAX_SPAN_LINES = 3;
const LONG_QUOTE_CHARS = 60;
const MAX_SPAN_LINES_LONG = 12;

const stripTags = (line: string): string => line.replace(/\[셀[^\]]*\]/g, '').replace(/\[표\s*\d+\]/g, '').replace(/\[p\s*\d+\]/g, '').trim();

/** 줄 앞 또는 `|` 뒤(셀 경계)의 글머리표. 웹 AI가 `* 항목`을 마크다운 목록으로 렌더링해 `- 항목`으로 복사되는 경우를 맞춘다. */
// 기호 바로 뒤가 숫자면 지우지 않는다("-2점" 같은 부호 보존). "- 항목"·"-항목"·"※참고"는 지운다.
const LEADING_BULLET = /(^|\|)\s*[-*•·∙◦○●▪■□※>]+(?:\s+|(?![\d.]))/g;

/** `[셀 …]`, `[표 k]`, `[p N]` 태그 제거 → 줄 앞 글머리표 제거 → `|` 제거 → compact. quote와 원문 양쪽에 같은 변환을 쓴다. */
export function normalizeForMatch(line: string): string {
  return compact(stripTags(line).replace(LEADING_BULLET, '').replace(/\|/g, ''));
}
const normalizeKeepBullet = (line: string): string => compact(stripTags(line).replace(/\|/g, ''));

/** 두 양수가 정확히 10^k(k≥1) 배 차이인가. */
function powerOf10Apart(a: number, b: number): boolean {
  if (!(a > 0 && b > 0) || a === b || !Number.isInteger(a) || !Number.isInteger(b)) return false;
  let r = Math.max(a, b);
  const small = Math.min(a, b);
  if (r % small !== 0) return false;
  r /= small;
  while (r % 10 === 0) r /= 10;
  return r === 1;
}

/** 원문 줄에 있는 금액(원 단위) 목록. 중복 제거. withUnit이면 조·억·만·천·원이 붙은 것만. */
function amountsIn(text: string, withUnit = false): number[] {
  const out = new Set<number>();
  for (const m of text.match(/\d[\d,.]*(?:\s*[조억만천백\d,.]+)*\s*원?/g) ?? []) {
    if (DOT_THOUSANDS.test(m.trim())) continue;
    if (withUnit && !/[조억만천원]/.test(m)) continue;
    const v = parseKoreanAmount(m);
    if (v !== null && v > 0) out.add(v);
  }
  return [...out];
}

/** 'long'=충분, 'exact_only'=짧아서 원문 한 줄/표 한 행 전체와 정확히 같을 때만 허용, 'too_short'=글자 2자 미만(항상 거부). */
export function quoteStrength(quote: string): 'long' | 'exact_only' | 'too_short' {
  const n = quote.split('\n').map(normalizeForMatch).join('');
  const letters = (n.match(/[가-힣a-zA-Z]/g) ?? []).length;
  if (letters < ABSOLUTE_MIN_LETTERS) return 'too_short';
  return n.length < MIN_QUOTE_CHARS || letters < MIN_QUOTE_LETTERS ? 'exact_only' : 'long';
}

const cellRow = (line: string): string | null => /^\[셀 (\d+) \d+/.exec(line)?.[1] ?? null;

/** 셀 안 줄바꿈으로 이어진 줄로 인정하는 최대 줄 수. 표 끝 표시가 없어 표 뒤 문단이 마지막 셀에 붙는 것을 제한한다. */
const MAX_CELL_CONT_LINES = 6;

/** 줄별 표 행 키(`표순번:r`)와 셀 태그 줄 여부. 태그 없는 줄은 바로 앞 셀의 이어진 줄(셀 안 줄바꿈)로 보고
 * 그 행을 물려받되, 셀 태그 뒤 MAX_CELL_CONT_LINES줄까지만. 표 밖이면 null. */
function rowKeys(lines: string[]): { keys: Array<string | null>; tagged: boolean[] } {
  const keys: Array<string | null> = [];
  const tagged: boolean[] = [];
  let table = -1;
  let cur: string | null = null;
  let cont = 0;
  for (const l of lines) {
    const r = cellRow(l);
    tagged.push(r !== null);
    if (/^\[표 \d+\]/.test(l)) { table++; cur = null; keys.push(null); continue; }
    if (r !== null) { if (table < 0) table = 0; cur = `${table}:${r}`; cont = 0; keys.push(cur); continue; }
    if (/^\[p \d+\]/.test(l)) { cur = null; keys.push(null); continue; }
    if (!l.trim()) { keys.push(null); continue; }
    if (cur !== null && ++cont > MAX_CELL_CONT_LINES) cur = null;
    keys.push(cur);
  }
  return { keys, tagged };
}

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
  const { keys: rows, tagged } = rowKeys(lines);
  const sameRow = (from: number, to: number): boolean => {
    const r = rows[from];
    if (r == null) return false;
    for (let i = from; i <= to; i++) if (rows[i] !== r && lines[i]!.trim()) return false;
    return true;
  };
  // 짧은 인용은 3줄까지(흩어진 조각 오매치 방지). 같은 표 행(셀 안 이어진 줄 포함)은 길이와 무관하게 허용.
  // 정규화 길이가 충분히 긴 인용은 연속 일치 자체가 강한 근거라 문단(최대 MAX_SPAN_LINES_LONG줄)까지 허용.
  // 긴 범위 허용은 실제로 찾은 문자열 기준이며, 앞부분만 맞춘 partial 검색에는 주지 않는다.
  const spanOk = (from: number, to: number, needleLen: number, partial: boolean): boolean => {
    const n = to - from + 1;
    if (n <= MAX_SPAN_LINES) return true;
    if (sameRow(from, to)) return true;
    return !partial && needleLen >= LONG_QUOTE_CHARS && n <= MAX_SPAN_LINES_LONG;
  };
  /** from~to가 같은 표 행의 셀 전체인가: 앞뒤에 같은 행의 셀 태그 줄이 없어야 한다(이어진 줄은 경계 판정에서 제외). */
  const wholeRow = (from: number, to: number): boolean => {
    if (!tagged[from] || !sameRow(from, to)) return false;
    const r = rows[from];
    const sameTagged = (i: number) => tagged[i] && rows[i] === r;
    return (from === 0 || !sameTagged(from - 1)) && (to === lines.length - 1 || !sameTagged(to + 1));
  };
  const search = (needle: string, partial: boolean): QuoteLocation | null => {
    for (let idx = acc.indexOf(needle); idx >= 0; idx = acc.indexOf(needle, idx + 1)) {
      const li = lineAt(idx);
      const ei = lineAt(idx + needle.length - 1);
      if (li < 0 || ei < li || !spanOk(li, ei, needle.length, partial)) continue;
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
  /** 표 행 인용 대조: AI가 행을 `셀 | 셀 | 셀`로 압축하며 셀 안 중간 줄을 뺀 경우.
   * `|`·줄바꿈으로 나눈 조각이 같은 표 행(셀 태그 줄에서 시작하는 연속 구간) 안에서 순서대로 모두 나오면 그 행으로 본다. */
  const searchRow = (): QuoteLocation | null => {
    const segs = quote.split(/[|\n]/).map(normalizeForMatch).filter(Boolean);
    if (segs.length < 2 || segs.join('').length < MIN_QUOTE_CHARS) return null;
    for (let s = 0; s < lines.length; s++) {
      if (!tagged[s] || rows[s] == null || (s > 0 && rows[s - 1] === rows[s])) continue; // 행의 첫 줄에서만 시작
      let e = s;
      while (e + 1 < lines.length && (rows[e + 1] === rows[s] || !lines[e + 1]!.trim())) e++;
      const rowText = acc.slice(starts[s], ends[e]);
      let pos = 0;
      let last = -1;
      for (const seg of segs) {
        const at = rowText.indexOf(seg, pos);
        if (at < 0) { last = -1; break; }
        pos = at + seg.length;
        last = lineAt(starts[s]! + pos - 1);
      }
      if (last < 0) continue;
      let page: number | null = null;
      for (let i = s; i >= 0; i--) {
        const m = /^\[p (\d+)\]/.exec(lines[i]!);
        if (m) { page = parseInt(m[1]!, 10); break; }
      }
      return { line: s + 1, endLine: last + 1, page, partial: false, viaRow: true, sourceText: lines.slice(s, last + 1).map(stripTags).filter(Boolean).join(' | ') };
    }
    return null;
  };
  const full = search(quoteN, false);
  if (full || opts.exactOnly) return full;
  const row = searchRow();
  if (row || quoteN.length <= PARTIAL_LEN) return row;
  return search(quoteN.slice(0, PARTIAL_LEN), true);
}

function findFileByName(files: VerifyFile[], name: string): VerifyFile | undefined {
  return files.find((f) => f.name === name) ?? files.find((f) => f.name.endsWith(name));
}

/**
 * 같은 값인가. datetime은 시각 동일(분 단위), 공고 잎 text는 compact 후 한쪽이 다른 쪽을 포함(짧은 쪽 4자 이상), 그 외는 valueKey 비교.
 * 포함 규칙은 API 값과 문서 표기의 형식 차이를 흡수하려는 것이라 공고 잎에만 쓴다. 문서 잎(실적 인정조건 등)은
 * "유사 용역 실적"과 "유사 용역 실적(하도급 제외)"처럼 덧붙은 말이 뜻을 바꾸므로 기존 valueKey 비교를 유지한다.
 */
export function sameValue(key: AiKey, a: unknown, b: unknown): boolean {
  const kind: ReviewValueKind = REVIEW_KIND[key];
  if (kind === 'datetime' && typeof a === 'string' && typeof b === 'string') {
    const [x, y] = [Date.parse(a), Date.parse(b)];
    return !Number.isNaN(x) && Math.floor(x / 60_000) === Math.floor(y / 60_000);
  }
  if (kind === 'text' && !isDocAiKey(key) && typeof a === 'string' && typeof b === 'string') {
    const [x, y] = [compact(a), compact(b)];
    const [short, long] = x.length <= y.length ? [x, y] : [y, x];
    return short.length >= 4 && long.includes(short);
  }
  return valueKey(a) === valueKey(b);
}

/** quote는 AI가 준 문장이 아니라 매치된 원문 줄 텍스트다. */
function valueInQuote(key: AiKey, value: unknown, quote: string): boolean {
  switch (key) {
    case 'credibilityScore': case 'managementScore': case 'performanceScore':
      return (quote.match(/\d+(?:\.\d+)?/g) ?? []).some((n) => parseFloat(n) === value);
    case 'performancePeriod': {
      const y = parseInt(String(value), 10);
      return (quote.match(/\d+/g) ?? []).some((n) => parseInt(n, 10) === y);
    }
    case 'differentialScoring':
      return /적용|차등/.test(quote);
    default:
  }
  switch (REVIEW_KIND[key]) {
    case 'datetime': {
      if (typeof value !== 'string' || value.length < 16) return false;
      const [hh, mm] = [value.slice(11, 13), value.slice(14, 16)];
      return quote.includes(value.slice(0, 4)) && new RegExp(`(?<!\\d)0?${Number(hh)}:${mm}`).test(quote);
    }
    case 'amount':
      return amountsIn(quote).includes(value as number);
    case 'joint':
      return /공동|단독|컨소시엄|분담|이행/.test(quote);
    default:
      return true;
  }
}

type Checked =
  | { ok: true; value: unknown; found: { file: VerifyFile; loc: QuoteLocation }; inSource: boolean }
  | { ok: false; reason: AiRejectReason };

/** 환산 전 원문 표기(raw)를 남기는 값 종류 */
const RAW_KINDS = new Set<ReviewValueKind>(['amount', 'period', 'datetime', 'joint']);

export function verifySuggestions(raw: RawAiItem[], ctx: VerifyContext): VerifyResult {
  const suggestions: VerifyResult['suggestions'] = {};
  const rejected: VerifyResult['rejected'] = [];
  const warnings: string[] = [];
  const seen = new Set<AiKey>();
  type Src = { key: string; value?: unknown; quote: string; file: string | null };
  const reject = (it: Src, reason: AiRejectReason): void => {
    rejected.push({
      key: it.key, reason,
      ...(it.value !== null && it.value !== undefined ? { value: it.value } : {}),
      ...(it.quote ? { quote: it.quote } : {}),
      ...(it.file ? { file: it.file } : {}),
    });
  };
  const locate = (it: Src, exactOnly = false): { file: VerifyFile; loc: QuoteLocation } | null => {
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
  /** 값(null 아님)과 인용 검증. 본 항목과 variant가 같은 규칙을 쓴다. */
  const check = (key: AiKey, it: Src): Checked => {
    const c = coerceValue(key, it.value);
    if (!c.ok || !checkLeafValue(key, c.value) || it.quote.length > QUOTE_MAX) return { ok: false, reason: 'bad_format' };
    if (!it.quote.trim()) return { ok: false, reason: 'quote_missing' };
    const strength = quoteStrength(it.quote);
    if (strength === 'too_short') return { ok: false, reason: 'quote_too_short' };
    const found = locate(it, strength === 'exact_only');
    if (!found) return { ok: false, reason: strength === 'exact_only' ? 'quote_too_short' : 'quote_not_found' };
    let value = c.value;
    let inSource = valueInQuote(key, value, found.loc.sourceText);
    if (REVIEW_KIND[key] === 'amount' && !inSource) {
      // AI가 억·만 단위를 원으로 바꾸며 자릿수만 틀린 경우(10의 거듭제곱 배): 인용 원문에 단위 금액이 하나뿐이면 그 값을 쓴다.
      const amounts = amountsIn(found.loc.sourceText, true);
      if (amounts.length === 1 && typeof value === 'number' && powerOf10Apart(amounts[0]!, value)) {
        warnings.push(`${it.key}: AI가 준 값(${String(value)})이 인용 원문의 금액과 달라 원문 금액(${amounts[0]})으로 고쳤습니다.`);
        value = amounts[0]!;
        inSource = true;
      }
    }
    if (key === 'performanceCondition') {
      // 글머리표를 둔 비교(한 줄로 이어 붙인 값)와 줄마다 지운 비교(웹 AI가 기호를 바꾼 값) 중 하나만 맞으면 된다.
      const lines = found.file.text.split('\n');
      const v = String(value).split('\n');
      const keep = lines.map(normalizeKeepBullet).join('').includes(v.map(normalizeKeepBullet).join(''));
      const strip = lines.map(normalizeForMatch).join('').includes(v.map(normalizeForMatch).join(''));
      if (found.loc.partial || !(keep || strip)) return { ok: false, reason: 'quote_not_found' };
    } else if ((found.loc.partial || found.loc.viaRow || strength === 'exact_only') && !inSource) {
      // 짧은 인용(셀 하나 등)은 값이 원문에 없으면 근거로 보지 않는다.
      return { ok: false, reason: strength === 'exact_only' ? 'quote_too_short' : 'quote_not_found' };
    }
    if (found.loc.partial) warnings.push(`${it.key}: 인용문이 길어 앞 ${PARTIAL_LEN}자만 일치했습니다(partial).`);
    return { ok: true, value, found, inSource };
  };
  const relationOf = (key: AiKey, values: unknown[]): AiRuleRelation | undefined => {
    if (!ctx.candidates || !values.length) return undefined;
    const cands = ctx.candidates[key] ?? [];
    if (!cands.length) return 'no_candidates';
    return values.every((v) => cands.some((c) => sameValue(key, c, v))) ? 'in_candidates' : 'differs_from_candidates';
  };

  for (const it of raw) {
    if (!isAiKey(it.key) || !ctx.requested.includes(it.key)) { reject(it, 'unknown_key'); continue; }
    const key = it.key;
    const kind = REVIEW_KIND[key];
    if (seen.has(key)) { warnings.push(`${key}: 같은 항목이 여러 번 와서 첫 번째만 썼습니다.`); continue; }
    seen.add(key); // 첫 항목이 거부돼도 두 번째는 쓰지 않는다
    const baseline = ctx.baseline[key] ?? null;
    const evidenceOf = (found: { file: VerifyFile; loc: QuoteLocation }, quote: string): EvidenceRef => ({
      attachmentId: found.file.attachmentId, sourceFile: found.file.sourceFile,
      ...(found.loc.page !== null ? { page: found.loc.page } : {}),
      line: found.loc.line, location: `line ${found.loc.line}`,
      evidence: quote.slice(0, 300), ruleId: `ai:${ctx.provider}:${ctx.promptVersion}`, docKind: found.file.docKind,
    });
    /** 금액·기간은 AI가 원문 표기 문자열로 주므로(v2) 환산 전 표기를 함께 남긴다. */
    const rawOf = (v: unknown): { raw?: string } => (RAW_KINDS.has(kind) && typeof v === 'string' && v.trim() ? { raw: v.trim().slice(0, 40) } : {});
    /** 조건별 값 검증. 실패한 variant는 `<key>#<i>`로 rejected에 기록하고 제외한다. */
    const runVariants = (): AiVariant[] => {
      const out: AiVariant[] = [];
      (it.variants ?? []).forEach((v, i) => {
        const src: Src = { key: `${key}#${i}`, value: v.value, quote: v.quote, file: it.file };
        const r: Checked = v.value === null || v.value === undefined ? { ok: false, reason: 'bad_format' } : check(key, src);
        if (!r.ok) { reject(src, r.reason); return; }
        out.push({
          condition: v.condition, value: r.value, ...rawOf(v.value), quote: v.quote, file: r.found.file.name, page: r.found.loc.page,
          evidence: evidenceOf(r.found, v.quote), valueInQuote: r.inSource,
        });
      });
      return out;
    };

    if (it.value === null) {
      const variants = runVariants();
      const strength = it.quote.trim() ? quoteStrength(it.quote) : 'too_short';
      const found = strength === 'too_short' ? null : locate(it, strength === 'exact_only');
      const relation = relationOf(key, variants.map((v) => v.value));
      suggestions[key] = {
        key, value: null, quote: it.quote, ...(it.note ? { note: it.note } : {}),
        ...(found ? { file: found.file.name, page: found.loc.page, evidence: evidenceOf(found, it.quote) } : {}),
        verdict: variants.length ? 'multi' : 'none', baseline, valueInQuote: false,
        ...(variants.length ? { variants } : {}),
        ...(relation ? { ruleRelation: relation } : {}),
      };
      continue;
    }

    const r = check(key, it);
    if (!r.ok) { reject(it, r.reason); continue; }
    const { value, found, inSource } = r;
    const variants = runVariants();
    const relation = relationOf(key, [value, ...variants.map((v) => v.value)]);

    suggestions[key] = {
      key, value, ...rawOf(it.value), quote: it.quote, ...(it.note ? { note: it.note } : {}),
      file: found.file.name, page: found.loc.page, evidence: evidenceOf(found, it.quote),
      verdict: baseline === null ? 'new' : sameValue(key, baseline, value) ? 'match' : 'differs',
      baseline, valueInQuote: inSource,
      ...(variants.length ? { variants } : {}),
      ...(relation ? { ruleRelation: relation } : {}),
    };
  }
  return { suggestions, rejected, warnings };
}
