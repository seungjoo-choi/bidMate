import type { DocBlock, DocModel } from '../../doc/model';

/** 전략이 돌려주는 날 후보. runRules가 EvidenceRef로 감싼다. */
export interface RawHit {
  value: unknown; raw?: string; location: string; page?: number; sheet?: string; line?: number;
  evidence: string; context?: string;
}
export type Synonyms = Record<string, string[]>;

/** 문서 순서로 평탄화한 한 줄(renderText의 줄과 같은 순서). */
export interface Unit { text: string; location: string; page?: number; sheet?: string; line?: number }

const ZW = /[\u0000​-‍⁠﻿]/;

/** compact()와 같은 결과 + compact 위치 → NFC 원문 위치 매핑. */
export function compactWithMap(s: string): { c: string; map: number[]; src: string } {
  const src = s.normalize('NFC');
  let c = '';
  const map: number[] = [];
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (ZW.test(ch) || /\s/.test(ch)) continue;
    c += ch === '：' ? ':' : ch;
    map.push(i);
  }
  return { c, map, src };
}

/** compact 구간 [start,end) → 원문 부분 문자열. */
export function origSlice(m: { map: number[]; src: string }, start: number, end: number): string {
  if (end <= start) return '';
  return m.src.slice(m.map[start]!, m.map[end - 1]! + 1);
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 동의어 키면 교대식으로, 아니면 `{{key}}`만 치환한 정규식 소스를 돌려준다. 빈 교대식이 되면 예외(그 규칙은 건너뛴다). */
export function expandTerm(term: string, syn: Synonyms): string {
  const alt = (k: string) => {
    const items = Object.prototype.hasOwnProperty.call(syn, k) ? syn[k]!.map((a) => a.replace(/\s+/g, '')) : [];
    if (items.length === 0 || items.some((a) => a === '')) throw new Error(`동의어 ${k}가 비었거나 없음`);
    return `(?:${items.map(esc).join('|')})`;
  };
  if (Object.prototype.hasOwnProperty.call(syn, term)) return alt(term);
  return term.replace(/\{\{(\w+)\}\}/g, (_, k: string) => alt(k));
}

export type CMap = ReturnType<typeof compactWithMap>;
/** 문서당 한 번 만들어 규칙들이 공유하는 평탄화/compact 결과. */
export interface Prepared { doc: DocModel; units: Array<{ u: Unit; m: CMap }> }
export const MAX_LINE_CHARS = 10000;

export function prepare(doc: DocModel): { prepared: Prepared; warnings: string[] } {
  const warnings: string[] = [];
  let cut = 0;
  const units = flattenUnits(doc).map((u) => {
    if (u.text.length > MAX_LINE_CHARS) { cut++; u = { ...u, text: u.text.slice(0, MAX_LINE_CHARS) }; }
    return { u, m: compactWithMap(u.text) };
  });
  if (cut) warnings.push(`${cut}개 줄이 ${MAX_LINE_CHARS}자를 넘어 잘라서 규칙을 적용함`);
  return { prepared: { doc, units }, warnings };
}

/** 문단과 표 셀(r,c 순, 셀 문단 → 중첩 블록)을 render-text와 같은 순서로 줄 단위 평탄화. renderText 호출 뒤에 써야 line이 채워져 있다. */
export function flattenUnits(doc: DocModel): Unit[] {
  const out: Unit[] = [];
  const push = (text: string, location: string, loc: { page?: number; sheet?: string }, line?: number) => {
    if (!text.replace(/\s+/g, '')) return;
    out.push({ text, location, page: loc.page, sheet: loc.sheet, line });
  };
  const walk = (blocks: DocBlock[]): void => {
    for (const b of blocks) {
      if (b.kind === 'p') {
        const base = b.loc.line;
        b.text.split('\n').forEach((t, i) => push(t, `블록${b.loc.block}`, b.loc, base === undefined ? undefined : base + i));
        continue;
      }
      const cells = [...b.cells].sort((x, y) => x.r - y.r || x.c - y.c);
      for (const cell of cells) {
        const base = cell.loc.line;
        cell.text.split('\n').forEach((t, i) => push(t, `표${b.index} r${cell.r}c${cell.c}`, cell.loc, base === undefined ? undefined : base + i));
        walk(cell.blocks);
      }
    }
  };
  walk(doc.blocks);
  return out;
}

export const hitFromUnit = (u: Unit): Pick<RawHit, 'location' | 'page' | 'sheet' | 'line'> => ({
  location: u.location, page: u.page, sheet: u.sheet, line: u.line,
});
