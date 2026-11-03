import { pageAt, renderLines } from '../ai/excerpt';
import { NOTE_LINE_RE } from '../ai/constants';
import { buildTextBlocks } from '../doc/text-blocks';
import {
  ASK_CONTEXT_MAX_CHARS, ASK_FILE_MAX_CHARS, ASK_NO_HIT_LINES, ASK_TABLE_MAX_LINES, ASK_WINDOW_AFTER, ASK_WINDOW_BEFORE,
} from './constants';
import { questionTerms, scoreUnit } from './score';
import type { SearchDoc, SearchUnit } from './types';

export interface ContextSegment { docId: string; from: number; to: number; text: string }
interface Range { from: number; to: number }
interface SizedRange extends Range { chars: number }
/** 남은 여유가 이보다 작으면 그 문서(또는 전체)는 찼다고 보고 후보를 건너뛴다. */
const MIN_ROOM = 80;
/** 연속으로 담지 못한 후보가 이만큼이면 멈춘다(예산 경계에서 후보마다 축소·재렌더를 반복하지 않게). */
const MAX_MISSES = 50;

const textOf = (lines: string[], r: Range): string => renderLines(lines.slice(r.from, r.to + 1)).join('\n');

/** 세그먼트 머리줄(`--- [p N] 부근, 줄 a~b ---`). 프롬프트 발췌(ask-prompt)와 예산 계산이 같은 문자열을 쓴다. */
export function segmentHeader(lines: string[], from: number, to: number): string {
  const page = pageAt(lines, from);
  return `--- ${page ? `[p ${page}] 부근` : '쪽 미상'}, 줄 ${from + 1}~${to + 1} ---`;
}
/** 파일 머리줄. */
export const fileHeader = (d: SearchDoc): string => `=== 파일: ${d.label} (${d.kindLabel}) ===`;

/** 세그먼트 하나가 발췌에서 차지하는 글자 수(머리줄 + 본문 + 줄바꿈). */
const rangeChars = (d: SearchDoc, r: Range): number => segmentHeader(d.lines, r.from, r.to).length + 1 + textOf(d.lines, r).length + 1;

/** 표 밖 유닛은 [start-4, end+12], 표 행 유닛은 그 표 전체(최대 150줄)와 표 끝 뒤 주석 줄까지. */
function windowFor(lines: string[], unit: SearchUnit, tableAt: Map<number, { start: number; end: number }>): Range {
  const last = lines.length - 1;
  const t = tableAt.get(unit.start);
  if (unit.kind === 'row' && t) {
    let from = t.start;
    if (unit.end > from + ASK_TABLE_MAX_LINES - 1) from = unit.start;
    const to = Math.min(t.end, from + ASK_TABLE_MAX_LINES - 1);
    let end = to;
    if (to === t.end) { while (end + 1 <= last && NOTE_LINE_RE.test(lines[end + 1]!)) end++; }
    return { from, to: end };
  }
  return { from: Math.max(0, unit.start - ASK_WINDOW_BEFORE), to: Math.min(last, unit.end + ASK_WINDOW_AFTER) };
}

/**
 * 질문 컨텍스트 선정. 항목값 문서(kind 'fields')는 항상 전부 맨 앞에 넣고 budget에는 세지 않는다.
 * 나머지 문서는 점수 높은 유닛부터 창을 넓혀 담되 파일당 ASK_FILE_MAX_CHARS, 합계 budget을 넘지 않는다(겹치는 창은 병합).
 * 글자 수에는 파일 머리줄·세그먼트 머리줄이 포함된다(실제 프롬프트 발췌 기준).
 * 점수가 모두 0이면 문서마다 앞 ASK_NO_HIT_LINES줄. units는 문서 id → 그 문서의 유닛(buildUnits 결과).
 */
export function selectContext(docs: SearchDoc[], units: Record<string, SearchUnit[]>, question: string, budget: number = ASK_CONTEXT_MAX_CHARS): ContextSegment[] {
  const qt = questionTerms(question);
  const body = docs.filter((d) => d.kind !== 'fields');
  // size = 이 문서가 발췌에서 차지하는 글자 수(범위가 있으면 파일 머리줄 포함). 병합 때 겹친 범위만 다시 그려 증분으로 갱신한다.
  const state = new Map<string, { ranges: SizedRange[]; sum: number; size: number; head: number }>(
    body.map((d) => [d.id, { ranges: [], sum: 0, size: 0, head: fileHeader(d).length + 2 }]),
  );
  const tableMaps = new Map<string, Map<number, { start: number; end: number }>>();
  const tablesOf = (d: SearchDoc) => {
    let m = tableMaps.get(d.id);
    if (!m) {
      m = new Map();
      for (const b of buildTextBlocks(d.lines)) if (b.kind === 'table') for (let i = b.start; i <= b.end; i++) m.set(i, { start: b.start, end: b.end });
      tableMaps.set(d.id, m);
    }
    return m;
  };

  const cands: Array<{ doc: SearchDoc; unit: SearchUnit; score: number; order: number }> = [];
  let order = 0;
  for (const d of body) for (const u of units[d.id] ?? []) {
    const score = scoreUnit(u.norm, qt);
    if (score > 0) cands.push({ doc: d, unit: u, score, order: order++ });
  }
  cands.sort((a, b) => b.score - a.score || a.order - b.order);

  let total = 0;
  /**
   * r을 그 문서에 더한다. 상한을 넘으면 창 끝을 유닛 끝까지, 그래도 안 되면 창 앞을 유닛 시작까지 줄여 보고, 유닛 자체도 못 담으면 false.
   * 새로 그리는 것은 r과 겹치거나 맞닿은 범위의 합집합뿐이다.
   */
  const add = (d: SearchDoc, r: Range, minFrom: number, minTo: number): boolean => {
    const s = state.get(d.id)!;
    const cur = { ...r };
    for (;;) {
      const near = s.ranges.filter((x) => x.from <= cur.to + 1 && x.to >= cur.from - 1);
      const union: Range = { from: Math.min(cur.from, ...near.map((x) => x.from)), to: Math.max(cur.to, ...near.map((x) => x.to)) };
      const chars = rangeChars(d, union);
      const sum = s.sum - near.reduce((n, x) => n + x.chars, 0) + chars;
      const size = sum + s.head;
      if (size <= ASK_FILE_MAX_CHARS && total - s.size + size <= budget) {
        s.ranges = [...s.ranges.filter((x) => !near.includes(x)), { ...union, chars }].sort((a, b) => a.from - b.from);
        total += size - s.size; s.size = size; s.sum = sum;
        return true;
      }
      if (cur.to > minTo) cur.to = Math.max(minTo, cur.to - Math.max(1, Math.ceil((cur.to - cur.from) / 4)));
      else if (cur.from < minFrom) cur.from = Math.min(minFrom, cur.from + Math.max(1, Math.ceil((minFrom - cur.from) / 4)));
      else return false;
    }
  };
  const full = (d: SearchDoc): boolean => {
    const s = state.get(d.id)!;
    return ASK_FILE_MAX_CHARS - s.size < MIN_ROOM;
  };

  const active = new Set(cands.map((c) => c.doc.id));
  const fullIds = new Set<string>();
  let misses = 0;
  for (const c of cands) {
    if (budget - total < MIN_ROOM || fullIds.size >= active.size || misses >= MAX_MISSES) break;
    if (fullIds.has(c.doc.id)) continue;
    const ok = add(c.doc, windowFor(c.doc.lines, c.unit, tablesOf(c.doc)), c.unit.start, c.unit.end);
    misses = ok ? 0 : misses + 1;
    // 전체 남은 예산이 파일 여유보다 작아서 실패했다면 그 문서는 더 담을 수 없다(남은 예산은 줄기만 한다).
    if (full(c.doc) || (!ok && budget - total < ASK_FILE_MAX_CHARS - state.get(c.doc.id)!.size)) fullIds.add(c.doc.id);
  }
  if (cands.length === 0) {
    for (const d of body) {
      if (!d.lines.length) continue;
      add(d, { from: 0, to: Math.min(d.lines.length, ASK_NO_HIT_LINES) - 1 }, 0, 0);
    }
  }

  const out: ContextSegment[] = [];
  for (const d of docs.filter((x) => x.kind === 'fields' && x.lines.length)) {
    const r = { from: 0, to: d.lines.length - 1 };
    out.push({ docId: d.id, ...r, text: textOf(d.lines, r) });
  }
  for (const d of body) for (const r of state.get(d.id)!.ranges) out.push({ docId: d.id, from: r.from, to: r.to, text: textOf(d.lines, r) });
  return out;
}
