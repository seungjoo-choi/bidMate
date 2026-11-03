/** 추출 텍스트(render-text 형식)를 원문처럼 보여주기 위한 근거 구간 찾기. 블록 분해는 core/doc/text-blocks로 이동했고 여기서 다시 내보낸다. */

import { displayLine } from '../../core/doc/text-blocks';

export { buildTextBlocks, displayLine, type TextBlock, type TextCell } from '../../core/doc/text-blocks';

const compact = (s: string) => displayLine(s).replace(/[\s|]+/g, '');

/** 근거 원문이 걸친 줄 구간 [from, to](0부터). 기준 줄 근처부터 원문 앞부분이 든 줄을 찾고, 원문 길이만큼 뒤 줄로 넓힌다. 못 찾으면 기준 줄 하나. */
export function evidenceSpan(lines: string[], line: number | undefined, quote: string | undefined): [number, number] | null {
  const t = line && line >= 1 ? Math.min(line, lines.length) - 1 : -1;
  const q = (quote ?? '').replace(/[\s|]+/g, '');
  if (!q) return t >= 0 ? [t, t] : null;
  const head = q.slice(0, Math.min(12, q.length));
  const order: number[] = [];
  if (t >= 0) for (let d = 0; d <= 60; d++) { if (t - d >= 0) order.push(t - d); if (d && t + d < lines.length) order.push(t + d); }
  for (let k = 0; k < lines.length; k++) order.push(k);
  for (const s of order) {
    const c = compact(lines[s]!);
    const at = c.indexOf(head);
    if (at < 0) continue;
    let remain = q.length - (c.length - at);
    let e = s;
    while (remain > 0 && e + 1 < lines.length && e - s < 40) { e++; remain -= compact(lines[e]!).length; }
    return [s, e];
  }
  return t >= 0 ? [t, t] : null;
}
