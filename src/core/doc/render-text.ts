import type { DocBlock, DocModel } from './model';

/** 문단=줄, 표=`[표 k]`, 셀=`[셀 r c]`(+` rs2`/` cs2`), PDF=`[p N]`. 각 블록 loc.line을 채운다(0부터). */
export function renderText(doc: DocModel): string {
  const lines: string[] = [];
  let page: number | undefined;

  const emit = (blocks: DocBlock[]): void => {
    for (const b of blocks) {
      if (b.kind === 'p') {
        if (b.loc.page !== undefined && b.loc.page !== page) {
          page = b.loc.page;
          lines.push(`[p ${page}]`);
        }
        b.loc.line = lines.length;
        lines.push(...b.text.split('\n')); // 줄바꿈을 품은 텍스트도 loc.line이 어긋나지 않게 분할
        continue;
      }
      b.loc.line = lines.length;
      lines.push(`[표 ${b.index}]`);
      const cells = [...b.cells].sort((x, y) => x.r - y.r || x.c - y.c);
      for (const cell of cells) {
        cell.loc.line = lines.length;
        let tag = `[셀 ${cell.r} ${cell.c}`;
        if (cell.rowSpan > 1) tag += ` rs${cell.rowSpan}`;
        if (cell.colSpan > 1) tag += ` cs${cell.colSpan}`;
        lines.push(...`${tag}] ${cell.text}`.trimEnd().split('\n'));
        emit(cell.blocks);
      }
    }
  };
  emit(doc.blocks);
  return lines.join('\n');
}
