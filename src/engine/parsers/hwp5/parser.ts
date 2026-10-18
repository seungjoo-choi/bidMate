import type { DocBlock, DocCell, DocModel, DocTable } from '../../../core/doc/model';
import type { DocParser, ParseInput, ParseResult } from '../types';
import { MAX_TABLE_AREA, MAX_TABLE_COLS, MAX_TABLE_ROWS } from '../../../core/doc/limits';
import { yieldToLoop } from '../yield';
import { MAX_INFLATE_BYTES } from '../../../core/doc/limits';
import { InflateStop, inflateRaw, listSections, openCfb, readHeader } from './cfb';
import { ctrlId, decodeParaText, readRecords, TAG, u16, type Rec } from './records';

interface Scope { last: string }
interface State { recs: Rec[]; section: number; tableCount: number; chars: number; warnings: string[] }

const fail = (reason: Extract<ParseResult, { ok: false }>['reason'], message: string): ParseResult => ({ ok: false, reason, message });

/** r[i]의 하위 범위 끝(같거나 얕은 level이 처음 나오는 위치). */
function endOf(recs: Rec[], i: number, limit: number): number {
  const lv = recs[i]!.level;
  let j = i + 1;
  while (j < limit && recs[j]!.level > lv) j++;
  return j;
}

function parseParas(st: State, from: number, to: number, out: DocBlock[], sc: Scope): void {
  const recs = st.recs;
  let i = from;
  while (i < to) {
    if (recs[i]!.tag !== TAG.PARA_HEADER) { i++; continue; }
    const e = endOf(recs, i, to);
    const lv = recs[i]!.level;
    let text = '';
    const ctrls: number[] = [];
    for (let j = i + 1; j < e; j++) {
      const r = recs[j]!;
      if (r.level !== lv + 1) continue;
      if (r.tag === TAG.PARA_TEXT) text += decodeParaText(r.body);
      else if (r.tag === TAG.CTRL_HEADER) ctrls.push(j);
    }
    text = text.trim();
    if (text) {
      st.chars += text.length;
      out.push({ kind: 'p', text, loc: { section: st.section, block: out.length } });
      sc.last = text;
    }
    for (const j of ctrls) {
      const ce = endOf(recs, j, e);
      if (ctrlId(recs[j]!.body) === ' lbt') parseTable(st, j, ce, out, sc);
      else parseParas(st, j + 1, ce, out, sc); // gso/머리말/각주 등은 문단으로 흘린다
    }
    i = e;
  }
}

function parseTable(st: State, j: number, ce: number, out: DocBlock[], sc: Scope): void {
  const recs = st.recs;
  const lv = recs[j]!.level + 1;
  let t = -1;
  for (let k = j + 1; k < ce; k++) {
    if (recs[k]!.level === lv && recs[k]!.tag === TAG.TABLE) { t = k; break; }
  }
  if (t < 0) { parseParas(st, j + 1, ce, out, sc); return; }

  const table: DocTable = {
    kind: 'table', index: st.tableCount++, rows: u16(recs[t]!.body, 4), cols: u16(recs[t]!.body, 6),
    cells: [], loc: { section: st.section, block: out.length },
  };
  if (sc.last) { table.caption = sc.last.slice(0, 80); sc.last = ''; }

  const heads: number[] = [];
  for (let k = t + 1; k < ce; k++) {
    if (recs[k]!.level === lv && recs[k]!.tag === TAG.LIST_HEADER) heads.push(k);
  }
  heads.forEach((k, n) => {
    const cend = n + 1 < heads.length ? heads[n + 1]! : ce;
    const body = recs[k]!.body;
    const inner: DocBlock[] = [];
    parseParas(st, k + 1, cend, inner, { last: '' });
    const cell: DocCell = {
      c: u16(body, 8), r: u16(body, 10),
      colSpan: Math.max(1, u16(body, 12)), rowSpan: Math.max(1, u16(body, 14)),
      text: inner.filter((b) => b.kind === 'p').map((b) => (b as { text: string }).text).join('\n'),
      blocks: inner.filter((b) => b.kind === 'table'),
      loc: { section: st.section, block: table.loc.block },
    };
    table.rows = Math.max(table.rows, cell.r + cell.rowSpan);
    table.cols = Math.max(table.cols, cell.c + cell.colSpan);
    table.cells.push(cell);
  });
  // 표 크기 상한: 행/열을 자르고, 셀 주소/span을 경계 안으로 맞춘다.
  if (table.rows > MAX_TABLE_ROWS) { st.warnings.push(`표 ${table.index}: 행 수 ${table.rows}를 ${MAX_TABLE_ROWS}로 자름`); table.rows = MAX_TABLE_ROWS; }
  if (table.cols > MAX_TABLE_COLS) { st.warnings.push(`표 ${table.index}: 열 수 ${table.cols}를 ${MAX_TABLE_COLS}로 자름`); table.cols = MAX_TABLE_COLS; }
  if (table.rows * table.cols > MAX_TABLE_AREA) {
    st.warnings.push(`표 ${table.index}: 면적이 상한 ${MAX_TABLE_AREA}를 넘어 행 수를 줄임`);
    table.rows = Math.max(1, Math.floor(MAX_TABLE_AREA / table.cols));
  }
  const before = table.cells.length;
  table.cells = table.cells.filter((x) => x.r < table.rows && x.c < table.cols);
  if (table.cells.length < before) st.warnings.push(`표 ${table.index}: 경계 밖 셀 ${before - table.cells.length}개 제거`);
  let spanCut = 0;
  for (const x of table.cells) {
    const rs = Math.min(x.rowSpan, table.rows - x.r);
    const cs = Math.min(x.colSpan, table.cols - x.c);
    if (rs !== x.rowSpan || cs !== x.colSpan) {
      spanCut++;
      x.rowSpan = rs;
      x.colSpan = cs;
    }
    if (x.rowSpan * x.colSpan > MAX_TABLE_AREA) {
      spanCut++;
      x.rowSpan = 1;
      x.colSpan = 1;
    }
  }
  if (spanCut > 0) st.warnings.push(`표 ${table.index}: span 잘림 ${spanCut}건`);
  out.push(table);
}

export const hwp5Parser: DocParser = {
  id: 'hwp5',
  format: 'hwp5',
  async parse(input: ParseInput): Promise<ParseResult> {
    const t0 = Date.now();
    const stop = (): ParseResult | null => {
      if (input.signal?.aborted) return fail('cancelled', '취소됨');
      if (Date.now() > input.deadlineAt) return fail('timeout', '시간 초과');
      return null;
    };
    const early = stop();
    if (early) return early;
    try {
      const c = openCfb(input.bytes);
      const header = readHeader(c);
      if (!header) return fail('corrupt', 'FileHeader가 없습니다');
      if (header.encrypted) return fail('encrypted', '암호가 걸린 문서입니다');
      if (header.drm) return fail('drm', '배포용 문서입니다');
      const sections = listSections(c);
      if (sections.length === 0) return fail('corrupt', 'BodyText가 없습니다');

      const blocks: DocBlock[] = [];
      const st: State = { recs: [], section: 0, tableCount: 0, chars: 0, warnings: [] };
      const sc: Scope = { last: '' };
      let inflated = 0;
      for (const s of sections) {
        const halt = stop();
        if (halt) return halt;
        const raw = header.compressed
          ? await inflateRaw(s.bytes, { signal: input.signal, deadlineAt: input.deadlineAt, maxBytes: MAX_INFLATE_BYTES - inflated })
          : s.bytes;
        inflated += raw.length;
        if (inflated > MAX_INFLATE_BYTES) return fail('corrupt', '압축 해제 상한 초과');
        st.recs = readRecords(raw, st.warnings);
        st.section = s.n;
        parseParas(st, 0, st.recs.length, blocks, sc);
        await yieldToLoop();
      }
      const doc: DocModel = {
        format: 'hwp5', blocks, warnings: st.warnings,
        stats: { chars: st.chars, tables: st.tableCount, ms: Date.now() - t0 },
      };
      return { ok: true, doc };
    } catch (e) {
      if (e instanceof InflateStop) return fail(e.reason, e.message);
      return fail('corrupt', (e as Error).message);
    }
  },
};
