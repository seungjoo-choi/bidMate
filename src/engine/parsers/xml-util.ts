import type { DocBlock, DocLoc, DocModel, DocFormat, DocTable } from '../../core/doc/model';
import type { ParseFailReason, ParseInput, ParseResult } from './types';

export type ParseXml = (xml: string) => Document;

export const defaultParseXml: ParseXml = (xml) => new DOMParser().parseFromString(xml, 'application/xml');

/** 파싱 결과에 parsererror가 있으면 예외를 던진다. */
export function parseXmlChecked(parseXml: ParseXml, xml: string): Document {
  const doc = parseXml(xml);
  if (!doc.documentElement || doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('XML 파싱 실패');
  }
  return doc;
}

export const utf8 = (b: Uint8Array): string => new TextDecoder('utf-8').decode(b).replace(/^﻿/, '');

export function elChildren(el: Element): Element[] {
  return Array.from(el.childNodes).filter((n): n is Element => n.nodeType === 1);
}

export function descendants(el: Element, local: string): Element[] {
  const out: Element[] = [];
  const walk = (e: Element): void => {
    for (const c of elChildren(e)) {
      if (c.localName === local) out.push(c);
      walk(c);
    }
  };
  walk(el);
  return out;
}

/** 네임스페이스와 무관하게 localName으로 속성을 찾는다. */
export function attr(el: Element | undefined, local: string): string | undefined {
  if (!el) return undefined;
  for (const a of Array.from(el.attributes)) if (a.localName === local) return a.value;
  return undefined;
}

export const intAttr = (el: Element | undefined, local: string, def: number): number => {
  const v = Number(attr(el, local));
  return Number.isFinite(v) && attr(el, local) !== undefined && attr(el, local) !== '' ? v : def;
};

export class ParseStop extends Error {
  constructor(readonly reason: ParseFailReason, message: string) { super(message); }
}

export function guard(input: ParseInput): void {
  if (input.signal?.aborted) throw new ParseStop('cancelled', '취소됨');
  if (Date.now() > input.deadlineAt) throw new ParseStop('timeout', '시간 초과');
}

/** 공통 실행 래퍼: 취소/시간 초과/예외(corrupt)를 결과로 변환하고 stats를 채운다. */
export function runParse(
  input: ParseInput,
  format: DocFormat,
  fn: () => { blocks: DocBlock[]; warnings: string[]; tables: number },
): ParseResult {
  const t0 = Date.now();
  try {
    guard(input);
    const { blocks, warnings, tables } = fn();
    guard(input);
    const doc: DocModel = { format, blocks, warnings, stats: { chars: countChars(blocks), tables, ms: Date.now() - t0 } };
    return { ok: true, doc };
  } catch (e) {
    if (e instanceof ParseStop) return { ok: false, reason: e.reason, message: e.message };
    return { ok: false, reason: 'corrupt', message: (e as Error).message };
  }
}

function countChars(blocks: DocBlock[]): number {
  let n = 0;
  for (const b of blocks) {
    if (b.kind === 'p') n += b.text.length;
    else for (const c of b.cells) n += c.text.length + countChars(c.blocks);
  }
  return n;
}

/** t 요소의 자식을 순회해 텍스트 노드, tab, lineBreak/br/cr를 순서대로 조립한다. */
function inlineText(t: Element): string {
  let s = '';
  for (const n of Array.from(t.childNodes)) {
    if (n.nodeType === 3 || n.nodeType === 4) s += n.nodeValue ?? '';
    else if (n.nodeType === 1) {
      const ln = (n as Element).localName;
      if (ln === 'tab') s += '\t';
      else if (ln === 'lineBreak' || ln === 'br' || ln === 'cr') s += '\n';
      else s += inlineText(n as Element);
    }
  }
  return s;
}

export interface BlockCtx {
  /** 문단/표 요소의 localName (hwpx: p/tbl, docx: p/tbl) */
  pTag: string;
  tblTag: string;
  textTag: string;
  counter: { n: number };
  section?: number | string;
  makeTable(tbl: Element, index: number, loc: DocLoc, caption: string | undefined): DocTable;
}

/** root 아래를 문서 순서로 훑어 문단과 (최상위) 표를 블록으로 만든다. 표 내부는 makeTable이 재귀 처리한다. */
export function extractBlocks(root: Element, ctx: BlockCtx, guardFn?: () => void): DocBlock[] {
  const blocks: DocBlock[] = [];
  const push = (b: DocBlock): void => { blocks.push(b); };
  const addTable = (tbl: Element): void => {
    const loc: DocLoc = { block: blocks.length };
    if (ctx.section !== undefined) loc.section = ctx.section;
    const prev = blocks[blocks.length - 1];
    const caption = prev && prev.kind === 'p' && prev.text.trim() ? prev.text.trim().slice(0, 80) : undefined;
    push(ctx.makeTable(tbl, ctx.counter.n++, loc, caption));
  };
  const textOf = (p: Element, tbls: Element[]): string => {
    let s = '';
    const walk = (e: Element): void => {
      for (const c of elChildren(e)) {
        if (c.localName === ctx.tblTag) { tbls.push(c); continue; }
        if (c.localName === ctx.textTag) s += inlineText(c);
        else if (c.localName === 'tab') s += '\t';
        else if (c.localName === 'br' || c.localName === 'cr' || c.localName === 'lineBreak') s += '\n';
        else walk(c);
      }
    };
    walk(p);
    return s;
  };
  const walk = (e: Element): void => {
    for (const c of elChildren(e)) {
      guardFn?.();
      if (c.localName === ctx.tblTag) addTable(c);
      else if (c.localName === ctx.pTag) {
        const tbls: Element[] = [];
        const text = textOf(c, tbls);
        if (text.trim()) {
          const loc: DocLoc = { block: blocks.length };
          if (ctx.section !== undefined) loc.section = ctx.section;
          push({ kind: 'p', text, loc });
        }
        tbls.forEach(addTable);
      } else walk(c);
    }
  };
  walk(root);
  return blocks;
}

/** 셀 요소에서 text(문단을 줄바꿈으로 결합)와 중첩 표 blocks를 만든다. */
export function cellContent(tc: Element, ctx: BlockCtx, guardFn?: () => void): { text: string; blocks: DocBlock[] } {
  const all = extractBlocks(tc, ctx, guardFn);
  return {
    text: all.filter((b) => b.kind === 'p').map((b) => (b as { text: string }).text).join('\n'),
    blocks: all.filter((b) => b.kind === 'table'),
  };
}
