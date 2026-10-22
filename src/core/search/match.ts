import { CELL_RE, displayLine } from '../doc/text-blocks';
import { SEARCH_MAX_HITS_PER_DOC, SEARCH_MAX_SPANS_PER_TERM, SEARCH_SNIPPET_CHARS } from './constants';
import type { SearchDoc, SearchHit, SearchQuery, SearchSpan, SearchUnit } from './types';

/** 유닛 안에서 항 t의 등장 위치를 원문 (줄, 열) 구간으로 바꾼다. 여러 줄에 걸치면 줄별로 쪼갠다. */
function findSpans(u: SearchUnit, t: string): SearchSpan[] {
  const out: SearchSpan[] = [];
  let at = u.norm.indexOf(t);
  for (let n = 0; at >= 0 && n < SEARCH_MAX_SPANS_PER_TERM; n++) {
    let cur: SearchSpan | null = null;
    for (let i = at; i < at + t.length; i++) {
      const m = u.map[i]!;
      if (cur && cur.line === m.line) cur.to = m.end ?? m.col + 1;
      else { cur = { line: m.line, from: m.col, to: m.end ?? m.col + 1 }; out.push(cur); }
    }
    at = u.norm.indexOf(t, at + t.length);
  }
  return out;
}

function snippetOf(doc: SearchDoc, u: SearchUnit, first: SearchSpan): string {
  let text = '';
  let offset = 0;
  for (const line of u.lines) {
    const raw = doc.lines[line]!;
    const d = displayLine(raw);
    const sep = text === '' ? '' : CELL_RE.test(raw) ? ' | ' : ' ';
    if (!d.trim()) { if (line === first.line) offset = text.length; continue; }
    text += sep;
    if (line === first.line) offset = text.length;
    text += d;
  }
  let start = Math.max(0, offset + first.from - Math.floor(SEARCH_SNIPPET_CHARS / 4));
  const end = Math.min(text.length, start + SEARCH_SNIPPET_CHARS);
  if (end === text.length) start = Math.max(0, end - SEARCH_SNIPPET_CHARS);
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

/** 문서 하나 검색. 유닛마다 모든 항·구문을 포함하면 적중(AND). 문서 순서 유지, max 초과분은 total에만 센다. */
export function searchDoc(doc: SearchDoc, units: SearchUnit[], q: SearchQuery, max = SEARCH_MAX_HITS_PER_DOC): { hits: SearchHit[]; total: number } {
  const needles = [...q.terms, ...q.phrases];
  const hits: SearchHit[] = [];
  let total = 0;
  if (!needles.length) return { hits, total };
  units.forEach((u, unit) => {
    if (!needles.every((t) => u.norm.includes(t))) return;
    total++;
    if (hits.length >= max) return;
    const spans = needles.flatMap((t) => findSpans(u, t)).sort((a, b) => a.line - b.line || a.from - b.from);
    const first = spans[0]!;
    hits.push({ docId: doc.id, unit, line: first.line, spans, snippet: snippetOf(doc, u, first) });
  });
  return { hits, total };
}
