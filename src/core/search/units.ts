import { buildTextBlocks } from '../doc/text-blocks';
import { normalizeLine } from './normalize';
import type { SearchUnit } from './types';

/** 문서 줄 → 검색 유닛. 표 밖 줄 1개 또는 표 행 1개. 정규화 결과가 빈 줄(빈 줄, `[표 k]`, `[p N]`)은 유닛이 없다. */
export function buildUnits(lines: string[]): SearchUnit[] {
  const out: SearchUnit[] = [];
  const add = (kind: SearchUnit['kind'], idxs: number[]) => {
    let norm = '';
    const map: SearchUnit['map'] = [];
    for (const line of idxs) {
      const n = normalizeLine(lines[line]!);
      norm += n.norm;
      n.map.forEach((col, k) => map.push({ line, col, end: n.ends[k]! }));
    }
    if (!norm) return;
    out.push({ kind, start: idxs[0]!, end: idxs[idxs.length - 1]!, lines: idxs, norm, map });
  };
  for (const b of buildTextBlocks(lines)) {
    if (b.kind === 'line') add('line', [b.i]);
    else if (b.kind === 'table') {
      for (const row of b.rows) {
        const cells = [...row].sort((a, c) => a.c - c.c);
        add('row', cells.flatMap((c) => c.lines));
      }
    }
  }
  return out;
}
