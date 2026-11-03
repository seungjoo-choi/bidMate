import { compact } from '../extraction/normalize';
import type { AiKey } from './keys';
import {
  AI_EXCERPT_EXTRA_KEYWORDS, AI_FOCUS_KEYWORDS, API_FULLTEXT_MAX_CHARS, EXCERPT_FILE_MAX_CHARS, EXCERPT_MAX_CHARS,
  NOTE_LINE_RE, REF_MAX_HITS, REF_WINDOW_AFTER, REF_WINDOW_BEFORE, SECTION_HEAD_RE, SECTION_MAX_CHARS,
} from './constants';

/** 발췌 대상 파일 1개. name·kindLabel은 호출자가 만든다(core는 ui를 import하지 않는다). */
export interface ExcerptFileInput {
  attachmentId: string; sourceFile: string; name: string; kindLabel: string; priority: number; text: string;
  /** 이 파일의 발췌 상한(기본 EXCERPT_FILE_MAX_CHARS). */
  maxChars?: number;
}
export interface ExcerptInput {
  files: ExcerptFileInput[];
  /** RuleSet.synonyms */
  synonyms: Record<string, string[]>;
  /** 총 상한(기본 EXCERPT_MAX_CHARS). 더 큰 값은 EXCERPT_MAX_CHARS로 줄인다. */
  maxChars?: number;
  /** 대상 항목. 주면 상한 초과 시 이 항목 키워드가 적은 구간부터 뺀다(없으면 뒤쪽 구간부터). */
  keys?: AiKey[];
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

/** 대상 항목별 집중 키워드(compact). 구간 관련도 점수에 쓴다. */
export function focusKeywords(synonyms: Record<string, string[]>, keys: AiKey[]): string[] {
  const set = new Set<string>();
  for (const k of keys) {
    const f = AI_FOCUS_KEYWORDS[k];
    for (const sk of f.synonymKeys) for (const w of synonyms[sk] ?? []) { const c = compact(w); if (c) set.add(c); }
    for (const w of f.words) set.add(compact(w));
  }
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
export function renderLines(lines: string[]): string[] {
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

export function pageAt(lines: string[], idx: number): string {
  for (let i = idx; i >= 0; i--) {
    const m = /^\[p (\d+)\]/.exec(lines[i]!);
    if (m) return m[1]!;
  }
  return '';
}

interface Range { from: number; to: number; prot: boolean }
interface TableSpan { start: number; end: number; scored: boolean }
const CELL_RE = /^\[셀 (\d+) \d+[^\]]*\] ?(.*)$/;

/** 표 목록. 배점 열 표 = 머리글 행(첫 셀 행)에 synonyms.scoreHeader 단어가 든 표. */
function findTables(lines: string[], ends: number[], scoreHeaders: string[]): TableSpan[] {
  const out: TableSpan[] = [];
  let covered = -1;
  for (let i = 0; i < lines.length; i++) {
    if (i <= covered || !isTableStart(lines[i]!)) continue;
    const end = ends[i]!;
    covered = end;
    let scored = false;
    let row: string | null = null;
    for (let j = i + 1; j <= end && !scored; j++) {
      const m = CELL_RE.exec(lines[j]!);
      if (!m) continue;
      if (row === null) row = m[1]!; else if (m[1] !== row) break;
      const c = compact(m[2]!);
      scored = scoreHeaders.some((w) => c.includes(w));
    }
    out.push({ start: i, end, scored });
  }
  return out;
}

/** 표 끝 다음 줄부터 이어지는 주석 줄(※ * ** *** 주N))의 마지막 줄 번호(없으면 표 끝) */
function noteEnd(lines: string[], tableEnd: number): number {
  let j = tableEnd + 1;
  while (j < lines.length && NOTE_LINE_RE.test(lines[j]!)) j++;
  return j - 1;
}

function buildSegments(lines: string[], keywords: string[], synonyms: Record<string, string[]>, focus: string[], budget: number): Range[] {
  const ends = tableEnds(lines);
  const n = lines.length;
  const cl = lines.map((l) => compact(l));
  const hits: number[] = [];
  cl.forEach((c, i) => { if (c && keywords.some((k) => c.includes(k))) hits.push(i); });
  if (hits.length === 0) return n ? [{ from: 0, to: Math.min(n, NO_KEYWORD_LINES) - 1, prot: false }] : [];

  const scoreHeaders = (synonyms.scoreHeader ?? []).map((w) => compact(w)).filter(Boolean);
  const tables = findTables(lines, ends, scoreHeaders);
  // 섹션 경계: 표 밖 머리 기호 줄이 시작. lastHead[i] = i 이하 가장 가까운 머리 줄, nextHead[i] = i 초과 가장 가까운 머리 줄.
  const isHead = lines.map((l, i) => ends[i]! < 0 && SECTION_HEAD_RE.test(l));
  const lastHead = new Array<number>(n).fill(-1);
  const nextHead = new Array<number>(n).fill(n);
  for (let i = 0, h = -1; i < n; i++) { if (isHead[i]) h = i; lastHead[i] = h; }
  for (let i = n - 1, h = n; i >= 0; i--) { nextHead[i] = h; if (isHead[i]) h = i; }
  /** 섹션 [s, e]를 SECTION_MAX_CHARS까지만 자른 끝 줄 */
  const sectionClip = (s: number, e: number): number => {
    let chars = 0;
    for (let j = s; j <= e; j++) { chars += lines[j]!.length + 1; if (chars > SECTION_MAX_CHARS) return Math.max(s, j - 1); }
    return e;
  };

  const wins: Range[] = hits.map((i) => {
    let to = i + WINDOW_AFTER;
    if (ends[i]! >= 0) to = Math.max(to, Math.min(ends[i]!, i + TABLE_MAX_LINES));
    return { from: Math.max(0, i - WINDOW_BEFORE), to: Math.min(n - 1, to), prot: false };
  });
  // 주석 결속: 표 끝이 구간에 든 표는 바로 뒤 주석 줄까지 포함
  for (const w of wins) {
    for (const t of tables) if (t.start <= w.to && t.end >= w.from && t.end <= w.to) { const ne = noteEnd(lines, t.end); if (ne > w.to) w.to = ne; }
  }
  for (const t of tables.filter((x) => x.scored)) {
    const inTable = (j: number) => j >= t.start && j <= t.end;
    const dist = (j: number) => Math.abs(j - t.end);
    const cells: string[] = [];
    for (let j = t.start + 1; j <= t.end; j++) { const m = CELL_RE.exec(lines[j]!); if (m) cells.push(m[2]!); }
    // 셀의 `*`·`**` 기호로 시작하는 정의 줄을 같은 파일 전체에서 찾는다(표에 가까운 5줄까지).
    const markers = new Set<number>();
    for (const c of cells) for (const m of c.matchAll(/[0-9A-Za-z가-힣)\]](\*{1,3})(?!\*)/g)) markers.add(m[1]!.length);
    for (const k of markers) {
      const re = new RegExp(`^\\s*\\*{${k}}(?!\\*)`);
      const found: number[] = [];
      for (let j = 0; j < n; j++) if (!inTable(j) && re.test(lines[j]!)) found.push(j);
      for (const j of found.sort((a, b) => dist(a) - dist(b)).slice(0, 5)) wins.push({ from: j, to: Math.min(n - 1, j + 3), prot: true });
    }
    // 참조어 추적: 기호가 붙은 명사구를 compact해 같은 파일에서 그 어구가 든 줄의 창을 더한다.
    const phrases = new Set<string>();
    for (const c of cells) for (const m of c.matchAll(/([가-힣A-Za-z][가-힣A-Za-z0-9·]+)\s?(?:\*{1,3}|※|\(?주\s*\d+\)?)/g)) { const p = compact(m[1]!); if (p.length >= 2) phrases.add(p); }
    for (const p of phrases) {
      const found: number[] = [];
      for (let j = 0; j < n; j++) if (!inTable(j) && cl[j]!.includes(p)) found.push(j);
      for (const j of found.sort((a, b) => dist(a) - dist(b)).slice(0, REF_MAX_HITS)) wins.push({ from: Math.max(0, j - REF_WINDOW_BEFORE), to: Math.min(n - 1, j + REF_WINDOW_AFTER), prot: false });
    }
  }
  const mergeWins = (ws: Range[]): Range[] => {
    const out: Range[] = [];
    for (const w of [...ws].sort((a, b) => a.from - b.from || a.to - b.to)) {
      const last = out[out.length - 1];
      if (last && w.from <= last.to + 1) { last.to = Math.max(last.to, w.to); last.prot = last.prot || w.prot; } else out.push({ ...w });
    }
    return out;
  };
  // 섹션 확장: 적중 줄을 소속 섹션 전체(SECTION_MAX_CHARS까지)로 넓힌다. 기본 구간은 그대로 두고, 파일 예산(budget) 안에서만
  // 항목 관련 적중부터 더한다(확장 때문에 다른 구간이 밀려나지 않게 한다).
  const covered = new Array<boolean>(n).fill(false);
  let used = 0;
  const cover = (from: number, to: number): number => {
    let add = 0;
    for (let j = from; j <= to; j++) if (!covered[j]) { add += lines[j]!.length + 1; }
    return add;
  };
  for (const w of mergeWins(wins)) { used += cover(w.from, w.to); for (let j = w.from; j <= w.to; j++) covered[j] = true; }
  const isFocus = (i: number) => focus.length > 0 && focus.some((k) => cl[i]!.includes(k));
  const expansions = hits.map((i) => {
    const s = lastHead[i]!;
    if (s < 0) return null;
    const e = sectionClip(s, nextHead[i]! - 1);
    return i <= e ? { i, from: s, to: e, focus: isFocus(i) } : null;
  }).filter((x): x is NonNullable<typeof x> => x !== null).sort((a, b) => Number(b.focus) - Number(a.focus) || a.i - b.i);
  for (const x of expansions) {
    const add = cover(x.from, x.to);
    if (add === 0 || used + add > budget) continue;
    used += add; wins.push({ from: x.from, to: x.to, prot: false });
    for (let j = x.from; j <= x.to; j++) covered[j] = true;
  }
  const merged = mergeWins(wins);
  for (const m of merged) if (tables.some((t) => t.scored && t.start <= m.to && t.end >= m.from)) m.prot = true;
  return merged;
}

interface Seg { text: string; score: number; prot: boolean }
interface FileBlock { file: ExcerptFileInput; head: string; segs: Seg[]; truncated: boolean }
const blockText = (b: FileBlock) => [b.head, ...b.segs.map((s) => s.text)].join('\n');
/** 제거 우선순위(낮을수록 먼저 제거). 배점표·결속 주석 구간(prot)은 마지막에 뺀다. */
const rank = (s: Seg) => (s.prot ? 1e9 : 0) + s.score;

/** 제거 우선순위가 가장 낮은 구간 번호. 같으면 뒤쪽. */
function weakestSeg(segs: Seg[]): number {
  let at = segs.length - 1;
  for (let i = segs.length - 2; i >= 0; i--) if (rank(segs[i]!) < rank(segs[at]!)) at = i;
  return at;
}

export function buildExcerpt(input: ExcerptInput): ExcerptResult {
  const maxTotal = Math.min(input.maxChars ?? EXCERPT_MAX_CHARS, EXCERPT_MAX_CHARS);
  const keywords = excerptKeywords(input.synonyms);
  const focus = input.keys?.length ? focusKeywords(input.synonyms, input.keys) : [];
  const scoreOf = (lines: string[]) => (focus.length ? lines.filter((l) => { const c = compact(l); return !!c && focus.some((k) => c.includes(k)); }).length : 0);
  const warnings: string[] = [];
  const sorted = input.files.map((f, i) => ({ f, i })).sort((a, b) => a.f.priority - b.f.priority || a.i - b.i).map((x) => x.f);

  const blocks: FileBlock[] = sorted.map((file) => {
    const lines = file.text.split('\n');
    const cap = Math.min(file.maxChars ?? EXCERPT_FILE_MAX_CHARS, maxTotal);
    const segs = buildSegments(lines, keywords, input.synonyms, focus, cap).map(({ from, to, prot }) => {
      const page = pageAt(lines, from);
      const head = `--- ${page ? `[p ${page}] 부근` : '쪽 미상'}, 줄 ${from + 1}~${to + 1} ---`;
      const slice = lines.slice(from, to + 1);
      return { text: `${head}\n${renderLines(slice).join('\n')}`, score: scoreOf(slice), prot };
    });
    const b: FileBlock = { file, head: `=== 파일: ${file.name} (${file.kindLabel}) ===`, segs, truncated: false };
    // 파일 상한: 관련도 낮은(같으면 뒤쪽) 구간부터 제거, 구간 하나만 남아도 넘으면 자른다.
    while (blockText(b).length > cap && b.segs.length > 1) { b.segs.splice(weakestSeg(b.segs), 1); b.truncated = true; }
    if (blockText(b).length > cap) {
      b.segs[0]!.text = b.segs[0]!.text.slice(0, Math.max(0, cap - b.head.length - 1)); b.truncated = true;
    }
    if (b.truncated) warnings.push(`${file.name}: 파일 발췌 상한(${cap.toLocaleString('en-US')}자)을 넘어 ${focus.length ? '관련도 낮은' : '뒤쪽'} 구간을 뺐습니다.`);
    return b;
  });

  const total = () => blocks.filter((b) => b.segs.length).map(blockText).join('\n\n').length;
  let totalTrimmed = false;
  // 전체에서 관련도가 가장 낮은 구간부터 뺀다. 같으면 priority 낮은(뒤) 파일의 뒤쪽 구간부터.
  // 구간이 1개 남은 파일은 통째로 빠지고, 마지막 파일 하나만 남으면 자른다.
  while (total() > maxTotal) {
    const withSegs = blocks.map((b, i) => (b.segs.length ? i : -1)).filter((i) => i >= 0);
    if (withSegs.length === 0) break;
    let bi = withSegs[withSegs.length - 1]!;
    for (let j = withSegs.length - 2; j >= 0; j--) {
      const c = blocks[withSegs[j]!]!; const cur = blocks[bi]!;
      if (rank(c.segs[weakestSeg(c.segs)]!) < rank(cur.segs[weakestSeg(cur.segs)]!)) bi = withSegs[j]!;
    }
    const b = blocks[bi]!;
    totalTrimmed = true; b.truncated = true;
    if (b.segs.length > 1) { b.segs.splice(weakestSeg(b.segs), 1); continue; }
    if (withSegs.length === 1) { b.segs[0]!.text = b.segs[0]!.text.slice(0, Math.max(0, maxTotal - b.head.length - 1)); break; }
    b.segs.length = 0;
  }

  const used = blocks.filter((b) => b.segs.length);
  const dropped = blocks.filter((b) => !b.segs.length && b.file.text.length > 0);
  for (const b of dropped) warnings.push(`${b.file.name}: 총 발췌 상한(${maxTotal.toLocaleString('en-US')}자)을 넘어 통째로 뺐습니다.`);
  if (totalTrimmed) warnings.push(`총 발췌 상한(${maxTotal.toLocaleString('en-US')}자)을 넘어 ${focus.length ? '관련도 낮은' : '뒤쪽'} 구간을 뺐습니다.`);
  const text = used.map(blockText).join('\n\n');
  const truncated = blocks.some((b) => b.truncated);
  return {
    text,
    files: used.map((b) => ({ attachmentId: b.file.attachmentId, sourceFile: b.file.sourceFile, name: b.file.name, chars: blockText(b).length, truncated: b.truncated })),
    chars: text.length, truncated, warnings,
  };
}

/** API 모드용 전문. 파일 priority순으로 렌더링한 전체 텍스트를 이어 붙인다. 총 API_FULLTEXT_MAX_CHARS 초과 시 null(호출부가 buildExcerpt로 폴백). */
export function buildFullText(input: ExcerptInput): ExcerptResult | null {
  const sorted = input.files.map((f, i) => ({ f, i })).sort((a, b) => a.f.priority - b.f.priority || a.i - b.i).map((x) => x.f);
  const blocks = sorted.filter((f) => f.text.length > 0).map((file) => {
    const lines = file.text.split('\n');
    const head = `=== 파일: ${file.name} (${file.kindLabel}) ===`;
    const page = pageAt(lines, 0);
    const text = `${head}\n--- ${page ? `[p ${page}] 부근` : '쪽 미상'}, 줄 1~${lines.length} ---\n${renderLines(lines).join('\n')}`;
    return { file, text };
  });
  const text = blocks.map((b) => b.text).join('\n\n');
  if (text.length > API_FULLTEXT_MAX_CHARS) return null;
  return {
    text,
    files: blocks.map((b) => ({ attachmentId: b.file.attachmentId, sourceFile: b.file.sourceFile, name: b.file.name, chars: b.text.length, truncated: false })),
    chars: text.length, truncated: false, warnings: [],
  };
}
