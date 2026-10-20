import { compact } from '../extraction/normalize';
import { AI_EXCERPT_EXTRA_KEYWORDS, EXCERPT_FILE_MAX_CHARS, EXCERPT_MAX_CHARS } from './constants';

/** 발췌 대상 파일 1개. name·kindLabel은 호출자가 만든다(core는 ui를 import하지 않는다). */
export interface ExcerptFileInput {
  attachmentId: string; sourceFile: string; name: string; kindLabel: string; priority: number; text: string;
}
export interface ExcerptInput {
  files: ExcerptFileInput[];
  /** RuleSet.synonyms */
  synonyms: Record<string, string[]>;
  /** 총 상한(기본 EXCERPT_MAX_CHARS). 더 큰 값은 EXCERPT_MAX_CHARS로 줄인다. */
  maxChars?: number;
}
export interface ExcerptResult {
  text: string;
  files: Array<{ attachmentId: string; sourceFile: string; name: string; chars: number; truncated: boolean }>;
  chars: number; truncated: boolean; warnings: string[];
}

/** mgmtExclude는 제외 키워드라 발췌 키워드에서 뺀다. */
const SYNONYM_KEYS = ['credibility', 'management', 'performance', 'perfAnchor', 'bonusLabel', 'scoreHeader'];
const WINDOW_BEFORE = 6;
const WINDOW_AFTER = 30;
const TABLE_MAX_LINES = 150;
const NO_KEYWORD_LINES = 60;

export function excerptKeywords(synonyms: Record<string, string[]>): string[] {
  const set = new Set<string>();
  for (const k of SYNONYM_KEYS) for (const w of synonyms[k] ?? []) { const c = compact(w); if (c) set.add(c); }
  for (const w of AI_EXCERPT_EXTRA_KEYWORDS) set.add(compact(w));
  return [...set];
}

const isCellLine = (l: string) => l.startsWith('[셀 ');
const isTableStart = (l: string) => /^\[표 \d+\]/.test(l);

/** 줄별 표 끝 줄 번호(표 밖이면 -1). 표 = `[표 k]`부터 `[셀`/`[표` 줄이 이어지는 구간(셀 안 줄바꿈 평문은 최대 2줄까지 허용). */
function tableEnds(lines: string[]): number[] {
  const ends = new Array<number>(lines.length).fill(-1);
  for (let i = 0; i < lines.length; i++) {
    if (!isTableStart(lines[i]!) || ends[i]! >= 0) continue;
    let end = i;
    let plain = 0;
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j]!;
      if (isCellLine(l) || isTableStart(l)) { end = j; plain = 0; } else if (++plain > 2) break;
    }
    for (let j = i; j <= end; j++) ends[j] = Math.max(ends[j]!, end);
  }
  return ends;
}

/** `[셀 r c …] 텍스트` 줄을 같은 r끼리 ` | `로 이어 한 줄로 만든다. 나머지 줄은 그대로. */
function renderLines(lines: string[]): string[] {
  const out: string[] = [];
  let curR: string | null = null;
  let cells: string[] = [];
  const flush = () => { if (curR !== null) { if (cells.length) out.push(cells.join(' | ')); curR = null; cells = []; } };
  for (const l of lines) {
    const m = /^\[셀 (\d+) \d+[^\]]*\] ?(.*)$/.exec(l);
    if (m) {
      if (m[1] !== curR) { flush(); curR = m[1]!; }
      if (m[2]!.trim()) cells.push(m[2]!.trim());
    } else { flush(); out.push(l); }
  }
  flush();
  return out;
}

function pageAt(lines: string[], idx: number): string {
  for (let i = idx; i >= 0; i--) {
    const m = /^\[p (\d+)\]/.exec(lines[i]!);
    if (m) return m[1]!;
  }
  return '';
}

function buildSegments(lines: string[], keywords: string[]): Array<[number, number]> {
  const ends = tableEnds(lines);
  const hits: number[] = [];
  lines.forEach((l, i) => { const c = compact(l); if (c && keywords.some((k) => c.includes(k))) hits.push(i); });
  if (hits.length === 0) return lines.length ? [[0, Math.min(lines.length, NO_KEYWORD_LINES) - 1]] : [];
  const wins: Array<[number, number]> = hits.map((i) => {
    let to = i + WINDOW_AFTER;
    if (ends[i]! >= 0) to = Math.max(to, Math.min(ends[i]!, i + TABLE_MAX_LINES));
    return [Math.max(0, i - WINDOW_BEFORE), Math.min(lines.length - 1, to)];
  });
  const merged: Array<[number, number]> = [];
  for (const w of wins) {
    const last = merged[merged.length - 1];
    if (last && w[0] <= last[1] + 1) last[1] = Math.max(last[1], w[1]); else merged.push([w[0], w[1]]);
  }
  return merged;
}

interface FileBlock { file: ExcerptFileInput; head: string; segs: string[]; truncated: boolean }
const blockText = (b: FileBlock) => [b.head, ...b.segs].join('\n');

export function buildExcerpt(input: ExcerptInput): ExcerptResult {
  const maxTotal = Math.min(input.maxChars ?? EXCERPT_MAX_CHARS, EXCERPT_MAX_CHARS);
  const keywords = excerptKeywords(input.synonyms);
  const warnings: string[] = [];
  const sorted = input.files.map((f, i) => ({ f, i })).sort((a, b) => a.f.priority - b.f.priority || a.i - b.i).map((x) => x.f);

  const blocks: FileBlock[] = sorted.map((file) => {
    const lines = file.text.split('\n');
    const segs = buildSegments(lines, keywords).map(([from, to]) => {
      const page = pageAt(lines, from);
      const head = `--- ${page ? `[p ${page}] 부근` : '쪽 미상'}, 줄 ${from + 1}~${to + 1} ---`;
      return `${head}\n${renderLines(lines.slice(from, to + 1)).join('\n')}`;
    });
    const b: FileBlock = { file, head: `=== 파일: ${file.name} (${file.kindLabel}) ===`, segs, truncated: false };
    // 파일 상한: 뒤쪽 구간부터 제거, 구간 하나만 남아도 넘으면 자른다.
    while (blockText(b).length > EXCERPT_FILE_MAX_CHARS && b.segs.length > 1) { b.segs.pop(); b.truncated = true; }
    if (blockText(b).length > EXCERPT_FILE_MAX_CHARS) {
      b.segs[0] = b.segs[0]!.slice(0, Math.max(0, EXCERPT_FILE_MAX_CHARS - b.head.length - 1)); b.truncated = true;
    }
    if (b.truncated) warnings.push(`${file.name}: 파일 발췌 상한(${EXCERPT_FILE_MAX_CHARS.toLocaleString('en-US')}자)을 넘어 뒤쪽 구간을 뺐습니다.`);
    return b;
  });

  const total = () => blocks.filter((b) => b.segs.length).map(blockText).join('\n\n').length;
  let totalTrimmed = false;
  // priority가 가장 낮은(뒤) 파일부터 뒤쪽 구간을 하나씩 빼고, 구간이 1개 남으면 파일을 통째로 뺀 뒤 앞 파일로 넘어간다.
  while (total() > maxTotal) {
    const withSegs = blocks.map((b, i) => (b.segs.length ? i : -1)).filter((i) => i >= 0);
    if (withSegs.length === 0) break;
    const b = blocks[withSegs[withSegs.length - 1]!]!;
    totalTrimmed = true; b.truncated = true;
    if (b.segs.length > 1) { b.segs.pop(); continue; }
    if (withSegs.length === 1) { b.segs[0] = b.segs[0]!.slice(0, Math.max(0, maxTotal - b.head.length - 1)); break; }
    b.segs.length = 0;
  }

  const used = blocks.filter((b) => b.segs.length);
  const dropped = blocks.filter((b) => !b.segs.length && b.file.text.length > 0);
  for (const b of dropped) warnings.push(`${b.file.name}: 총 발췌 상한(${maxTotal.toLocaleString('en-US')}자)을 넘어 통째로 뺐습니다.`);
  if (totalTrimmed) warnings.push(`총 발췌 상한(${maxTotal.toLocaleString('en-US')}자)을 넘어 뒤쪽 구간을 뺐습니다.`);
  const text = used.map(blockText).join('\n\n');
  const truncated = blocks.some((b) => b.truncated);
  return {
    text,
    files: used.map((b) => ({ attachmentId: b.file.attachmentId, sourceFile: b.file.sourceFile, name: b.file.name, chars: blockText(b).length, truncated: b.truncated })),
    chars: text.length, truncated, warnings,
  };
}
