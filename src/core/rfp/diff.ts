import { FINE_MAX_CHARS, LCS_MAX_CELLS, LINE_PAIR, LINE_PAIR_MAX } from './constants';
import { diceGrams, gramsOfCompact, lineKey } from './normalize';
import type { DiffSegment, LineOp } from '../types/rfp';

type Op<T> = { op: 'eq'; a: T; b: T } | { op: 'del'; a: T } | { op: 'ins'; b: T };

/** LCS 기반 편집 스크립트. 표가 상한을 넘으면 통째 삭제+추가로 본다. */
function lcs<T>(a: T[], b: T[], key: (x: T) => string): Array<Op<T>> {
  const n = a.length, m = b.length;
  if ((n + 1) * (m + 1) > LCS_MAX_CELLS) return [...a.map((x) => ({ op: 'del' as const, a: x })), ...b.map((y) => ({ op: 'ins' as const, b: y }))];
  const ka = a.map(key), kb = b.map(key);
  // LCS 값 ≤ min(n,m) ≤ √LCS_MAX_CELLS(2000) 이라 16비트로 충분
  const T: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    T[i]![j] = ka[i] === kb[j] ? T[i + 1]![j + 1]! + 1 : Math.max(T[i + 1]![j]!, T[i]![j + 1]!);
  }
  const out: Array<Op<T>> = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (ka[i] === kb[j]) out.push({ op: 'eq', a: a[i++]!, b: b[j++]! });
    else if (T[i + 1]![j]! >= T[i]![j + 1]!) out.push({ op: 'del', a: a[i++]! });
    else out.push({ op: 'ins', b: b[j++]! });
  }
  while (i < n) out.push({ op: 'del', a: a[i++]! });
  while (j < m) out.push({ op: 'ins', b: b[j++]! });
  return out;
}

function push(out: DiffSegment[], op: DiffSegment['op'], text: string, fine?: boolean) {
  const last = out[out.length - 1];
  if (last && last.op === op && !!last.fine === !!fine) last.text += text;
  else out.push(fine ? { op, text, fine } : { op, text });
}

/** 글자 단위 diff */
export function diffChars(a: string, b: string): DiffSegment[] {
  const out: DiffSegment[] = [];
  for (const o of lcs([...a], [...b], (x) => x)) push(out, o.op, o.op === 'ins' ? o.b : o.a);
  return out;
}

/**
 * 어절 diff. 공백도 토큰으로 두어 원문을 그대로 복원한다.
 * 인접한 삭제·추가가 둘 다 짧으면(≤FINE_MAX_CHARS) 글자 단위로 다시 쪼개 숫자·조사 변경이 눈에 띄게 한다.
 */
export function diffWords(a: string, b: string): DiffSegment[] {
  const tok = (s: string) => s.split(/(\s+)/).filter(Boolean);
  const coarse: DiffSegment[] = [];
  for (const o of lcs(tok(a), tok(b), (x) => x)) push(coarse, o.op, o.op === 'ins' ? o.b : o.a);
  const out: DiffSegment[] = [];
  for (let i = 0; i < coarse.length; i++) {
    const s = coarse[i]!, nx = coarse[i + 1];
    if (s.op === 'del' && nx?.op === 'ins' && s.text.length <= FINE_MAX_CHARS && nx.text.length <= FINE_MAX_CHARS) {
      for (const f of diffChars(s.text, nx.text)) push(out, f.op, f.text, f.op !== 'eq');
      i++;
    } else push(out, s.op, s.text);
  }
  return out;
}

const lines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean);

/**
 * 줄 단위 diff. 같은 줄(글머리·공백 무시) / 빠진 줄 / 새 줄을 가르고,
 * 연속된 빠짐·생김 묶음 안에서 비슷한 줄(≥LINE_PAIR)끼리는 '고친 줄'로 짝지어 그 안만 어절 diff 한다.
 * 줄 순서: 묶음 안에서 빠진 줄(고친 줄 포함) → 남은 새 줄.
 */
export function diffLines(a: string, b: string): LineOp[] {
  const raw = lcs(lines(a), lines(b), lineKey);
  const out: LineOp[] = [];
  for (let s = 0; s < raw.length;) {
    const r = raw[s]!;
    if (r.op === 'eq') { out.push({ op: 'eq', prev: r.a, next: r.b }); s++; continue; }
    let e = s;
    while (e < raw.length && raw[e]!.op !== 'eq') e++;
    const dels: string[] = [], inss: string[] = [];
    for (const x of raw.slice(s, e)) if (x.op === 'del') dels.push(x.a); else if (x.op === 'ins') inss.push(x.b);
    const used = new Set<number>();
    // 고친 줄 짝짓기는 묶음 크기 곱이 상한을 넘으면 생략한다(전부 빠진 줄·새 줄로 표시)
    const pairable = dels.length * inss.length <= LINE_PAIR_MAX;
    const ig = pairable ? inss.map((x) => gramsOfCompact(lineKey(x))) : [];
    for (const d of dels) {
      let best = -1, bs = LINE_PAIR;
      if (pairable) {
        const dg = gramsOfCompact(lineKey(d));
        ig.forEach((x, k) => { if (used.has(k)) return; const sc = diceGrams(dg, x); if (sc >= bs) { bs = sc; best = k; } });
      }
      if (best >= 0) { used.add(best); const nx = inss[best]!; out.push({ op: 'mod', prev: d, next: nx, segs: diffWords(d, nx) }); }
      else out.push({ op: 'del', prev: d });
    }
    inss.forEach((x, k) => { if (!used.has(k)) out.push({ op: 'ins', next: x }); });
    s = e;
  }
  return out;
}

export function lineStats(ops: LineOp[]): { add: number; del: number; mod: number } {
  let add = 0, del = 0, mod = 0;
  for (const o of ops) if (o.op === 'ins') add++; else if (o.op === 'del') del++; else if (o.op === 'mod') mod++;
  return { add, del, mod };
}
