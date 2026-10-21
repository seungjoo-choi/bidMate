import { describe, expect, it } from 'vitest';
import { alignOps } from '../../src/entrypoints/dashboard/rfp/LineDiff';
import type { LineOp } from '../../src/core/types/rfp';

const kinds = (ops: LineOp[]) => alignOps(ops).map((r) => `${r.l.kind}/${r.r.kind}`);

describe('alignOps', () => {
  it('같은 줄은 양쪽 같은 행', () => {
    expect(kinds([{ op: 'eq', prev: 'a', next: 'a' }])).toEqual(['eq/eq']);
  });
  it('빠진 줄·새 줄은 서로 마주 보고 모자란 쪽은 빈칸', () => {
    const ops: LineOp[] = [
      { op: 'eq', prev: 'a', next: 'a' },
      { op: 'del', prev: 'x' }, { op: 'del', prev: 'y' }, { op: 'ins', next: 'z' },
      { op: 'eq', prev: 'b', next: 'b' },
      { op: 'ins', next: 'w' },
    ];
    expect(kinds(ops)).toEqual(['eq/eq', 'del/ins', 'del/none', 'eq/eq', 'none/ins']);
  });
  it('고친 줄은 앞뒤 빠진 줄·새 줄과 섞이지 않는다', () => {
    const ops: LineOp[] = [
      { op: 'del', prev: 'x' },
      { op: 'mod', prev: 'p', next: 'q', segs: [] },
      { op: 'ins', next: 'z' },
    ];
    expect(kinds(ops)).toEqual(['del/none', 'mod/mod', 'none/ins']);
  });
});
