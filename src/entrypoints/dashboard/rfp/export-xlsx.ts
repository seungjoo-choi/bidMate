import { strToU8, zipSync } from 'fflate';
import { diffLines } from '../../../core/rfp/diff';
import { bodyOf } from '../../../core/rfp/match';
import { PREFIX_LABELS } from '../../../core/rfp/ids';
import type { LineOp, RequirementItem, RfpCompareResult, RfpPair, RfpPairStatus } from '../../../core/types/rfp';
import { hintsOf, refItem } from './compare-view-logic';

/**
 * RFP 비교 결과를 엑셀(xlsx)로 만든다. 시트: 변경점 / 번호 대조 / 요약.
 * - 변경점: scope='changed'면 변경·신규·삭제만, 'all'이면 동일까지(동일 행은 회색).
 * - "바뀐 내용" 칸은 서식 있는 텍스트: 지운 말 빨간 취소선, 새 말 초록 굵게. 같은 줄은 생략한다.
 */
export type ExportScope = 'changed' | 'all';
export interface ExportInput {
  result: RfpCompareResult; scope: ExportScope;
  prevTitle: string; nextTitle: string; at: Date;
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const STATUS_LABEL: Record<RfpPairStatus, string> = { changed: '변경', added: '신규', removed: '삭제', same: '동일' };
const CELL_MAX = 32000; /* 엑셀 셀 글자 상한 32767 */

// ── 서식(styles.xml 인덱스) ──
const S = { header: 1, body: 2, changed: 3, added: 4, removed: 5, same: 6, gray: 7, title: 8, label: 9, num: 10, mono: 11, monoGray: 12 } as const;
const STATUS_STYLE: Record<RfpPairStatus, number> = { changed: S.changed, added: S.added, removed: S.removed, same: S.same };
const FONT = '<name val="맑은 고딕"/><family val="3"/><charset val="129"/>';
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="7">
<font><sz val="10"/>${FONT}</font>
<font><b/><sz val="10"/>${FONT}</font>
<font><sz val="10"/><color rgb="FF8A8A8A"/>${FONT}</font>
<font><b/><sz val="14"/>${FONT}</font>
<font><b/><sz val="10"/><color rgb="FF8A8A8A"/>${FONT}</font>
<font><sz val="10"/><name val="Consolas"/><family val="3"/></font>
<font><sz val="10"/><color rgb="FF8A8A8A"/><name val="Consolas"/><family val="3"/></font>
</fonts>
<fills count="7">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF1F1EF"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFDEBD0"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFDDF2E3"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFADBD8"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF4F4F4"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFD9D9D9"/></left><right style="thin"><color rgb="FFD9D9D9"/></right><top style="thin"><color rgb="FFD9D9D9"/></top><bottom style="thin"><color rgb="FFD9D9D9"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="13">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>
<xf numFmtId="0" fontId="1" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>
<xf numFmtId="0" fontId="1" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>
<xf numFmtId="0" fontId="4" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
<xf numFmtId="0" fontId="5" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="6" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

// ── 셀 ──
/** 서식 있는 텍스트 조각. 엑셀 셀 안에서 글자마다 다른 서식을 줄 때 쓴다. */
export interface Run { text: string; kind?: 'del' | 'ins' | 'label' }
type Cell = { v: string | number; s?: number } | { runs: Run[]; s?: number } | null;

// XML 1.0에서 허용되지 않는 제어문자는 지운다(문서 파서가 남긴 것)
// eslint-disable-next-line no-control-regex
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '');
const esc = (s: string) => clean(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : colName(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));
/** 중첩 표 칸 구분자(탭)는 엑셀에서 " | "로 */
const flat = (s: string) => s.replace(/\t/g, ' | ');
const cut = (s: string) => (s.length > CELL_MAX ? `${s.slice(0, CELL_MAX)}…(이하 생략)` : s);

const RPR: Record<NonNullable<Run['kind']> | 'plain', string> = {
  plain: `<rPr><sz val="10"/><rFont val="맑은 고딕"/><family val="3"/><charset val="129"/></rPr>`,
  del: `<rPr><strike/><sz val="10"/><color rgb="FFC0392B"/><rFont val="맑은 고딕"/><family val="3"/><charset val="129"/></rPr>`,
  ins: `<rPr><b/><sz val="10"/><color rgb="FF1E8449"/><rFont val="맑은 고딕"/><family val="3"/><charset val="129"/></rPr>`,
  label: `<rPr><b/><sz val="10"/><color rgb="FF555555"/><rFont val="맑은 고딕"/><family val="3"/><charset val="129"/></rPr>`,
};

function cellXml(ref: string, c: Cell): string {
  if (!c) return '';
  const s = c.s ? ` s="${c.s}"` : '';
  if ('runs' in c) {
    let left = CELL_MAX;
    const rs: string[] = [];
    for (const r of c.runs) {
      if (left <= 0) { rs.push(`<r>${RPR.plain}<t xml:space="preserve">…(이하 생략)</t></r>`); break; }
      const t = flat(r.text).slice(0, left);
      left -= t.length;
      if (t) rs.push(`<r>${RPR[r.kind ?? 'plain']}<t xml:space="preserve">${esc(t)}</t></r>`);
    }
    return `<c r="${ref}"${s} t="inlineStr"><is>${rs.join('') || '<t></t>'}</is></c>`;
  }
  if (typeof c.v === 'number') return `<c r="${ref}"${s}><v>${c.v}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(cut(flat(c.v)))}</t></is></c>`;
}

interface SheetSpec { name: string; widths: number[]; rows: Cell[][]; freezeRow?: number; filter?: boolean }
function sheetXml(sp: SheetSpec): string {
  const cols = sp.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  const rows = sp.rows.map((cells, r) => `<row r="${r + 1}">${cells.map((c, i) => cellXml(`${colName(i)}${r + 1}`, c)).join('')}</row>`).join('');
  const pane = sp.freezeRow
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${sp.freezeRow}" topLeftCell="A${sp.freezeRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
  const af = sp.filter && sp.rows.length > 1 ? `<autoFilter ref="A1:${colName(sp.widths.length - 1)}${sp.rows.length}"/>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pane}<cols>${cols}</cols><sheetData>${rows}</sheetData>${af}</worksheet>`;
}

function workbook(sheets: SheetSpec[]): Uint8Array {
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const RNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const WS = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml';
  // 자동 필터는 숨은 이름 _FilterDatabase가 있어야 엑셀이 경고 없이 연다
  const names = sheets.map((sp, i) => (sp.filter && sp.rows.length > 1
    ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(sp.name.replace(/'/g, "''"))}'!$A$1:$${colName(sp.widths.length - 1)}$${sp.rows.length}</definedName>` : '')).join('');
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${WS}"/>`).join('')}</Types>`),
    '_rels/.rels': strToU8(`${head}<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${RNS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(`${head}<workbook xmlns="${NS}" xmlns:r="${RNS}"><sheets>${sheets.map((sp, i) => `<sheet name="${esc(sp.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>${names ? `<definedNames>${names}</definedNames>` : ''}</workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`${head}<Relationships xmlns="${PKG}">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${RNS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="${RNS}/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': strToU8(STYLES),
  };
  sheets.forEach((sp, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(sp)); });
  return zipSync(files, { level: 6 });
}

// ── 내용 ──
const FIELDS: Array<[label: string, get: (i: RequirementItem) => string]> = [
  ['명칭', (i) => i.name], ['분류', (i) => i.category ?? ''], ['정의', (i) => i.definition ?? ''], ['세부내용', (i) => i.detail ?? ''],
];
function fieldPairs(p: RfpPair): Array<{ label: string; a: string; b: string }> {
  const out = FIELDS.map(([label, get]) => ({ label, a: p.prev ? get(p.prev) : '', b: p.next ? get(p.next) : '' }));
  const labels: string[] = [];
  for (const e of [...(p.prev?.extras ?? []), ...(p.next?.extras ?? [])]) if (!labels.includes(e.label)) labels.push(e.label);
  for (const l of labels) out.push({ label: l, a: p.prev?.extras?.find((e) => e.label === l)?.text ?? '', b: p.next?.extras?.find((e) => e.label === l)?.text ?? '' });
  return out;
}

/** 바뀐 칸 이름 목록(양쪽 다 있는 짝만) */
export function changedFields(p: RfpPair): string[] {
  if (!p.prev || !p.next) return [];
  return fieldPairs(p).filter((f) => f.a !== f.b).map((f) => f.label);
}

/** 바뀐 칸만, 바뀐 줄만 서식 있는 텍스트로. 같은 줄은 생략한다. */
export function changeRuns(p: RfpPair): Run[] {
  if (!p.prev || !p.next || p.status === 'same') return [];
  const runs: Run[] = [];
  for (const f of fieldPairs(p)) {
    if (f.a === f.b) continue;
    if (runs.length) runs.push({ text: '\n\n' });
    runs.push({ text: `[${f.label}]\n`, kind: 'label' });
    let first = true;
    for (const o of diffLines(f.a, f.b) as LineOp[]) {
      if (o.op === 'eq') continue;
      if (!first) runs.push({ text: '\n' });
      first = false;
      if (o.op === 'del') runs.push({ text: o.prev, kind: 'del' });
      else if (o.op === 'ins') runs.push({ text: o.next, kind: 'ins' });
      else for (const s of o.segs) runs.push(s.op === 'eq' ? { text: s.text } : { text: s.text, kind: s.op });
    }
  }
  return runs;
}

const docText = (i?: RequirementItem): string => (i ? bodyOf(i) : '');
const noteOf = (p: RfpPair): string => hintsOf(p).filter((h) => h.label).map((h) => h.label).join(', ');
const pad = (n: number) => String(n).padStart(2, '0');
const stamp = (d: Date) => `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function buildCompareXlsx(x: ExportInput): Uint8Array {
  const { result } = x;
  const pairs = x.scope === 'all' ? result.pairs : result.pairs.filter((p) => p.status !== 'same');

  // 1. 변경점
  const H = ['상태', '기준 번호', '비교 대상 번호', '요구사항 명칭', '바뀐 칸', '특이사항', '바뀐 내용', '비교 대상 내용', '기준 내용', '반영 여부', '메모'];
  const main: Cell[][] = [H.map((v) => ({ v, s: S.header }))];
  for (const p of pairs) {
    const same = p.status === 'same';
    const txt = same ? S.gray : S.body, id = same ? S.monoGray : S.mono;
    const runs = changeRuns(p);
    main.push([
      { v: STATUS_LABEL[p.status], s: STATUS_STYLE[p.status] },
      { v: p.next?.id ?? '-', s: id },
      { v: p.prev?.id ?? '-', s: id },
      { v: refItem(p).name, s: txt },
      { v: changedFields(p).join(', '), s: txt },
      { v: same ? '' : noteOf(p), s: txt },
      runs.length ? { runs, s: S.body } : { v: '', s: txt },
      { v: docText(p.prev), s: txt },
      { v: docText(p.next), s: txt },
      { v: '', s: txt },
      { v: '', s: txt },
    ]);
  }

  // 2. 번호 대조: 번호가 바뀌었거나 한쪽에만 있는 항목. 비교 대상 번호 순(작년 제안서에서 찾기 쉽게)
  const ren = result.pairs.filter((p) => !p.prev || !p.next || p.prev.id !== p.next.id);
  const order = (p: RfpPair) => (p.prev ?? p.next)!;
  ren.sort((a, b) => {
    const x1 = order(a), y1 = order(b);
    return (a.prev ? 0 : 1) - (b.prev ? 0 : 1) || x1.prefix.localeCompare(y1.prefix) || x1.seq - y1.seq || (x1.sub ?? 0) - (y1.sub ?? 0);
  });
  const remark = (p: RfpPair) => (!p.next ? '기준에 없음(삭제)' : !p.prev ? '새로 생김(신규)' : p.tags.includes('number_only') ? '번호만 바뀜' : '번호·내용 바뀜');
  const map: Cell[][] = [['비교 대상 번호', '기준 번호', '요구사항 명칭', '비고'].map((v) => ({ v, s: S.header }))];
  for (const p of ren) {
    map.push([{ v: p.prev?.id ?? '-', s: S.mono }, { v: p.next?.id ?? '-', s: S.mono }, { v: refItem(p).name, s: S.body }, { v: remark(p), s: STATUS_STYLE[p.status] }]);
  }

  // 3. 요약
  const c = result.counts;
  const sum: Cell[][] = [
    [{ v: '제안요청서 비교', s: S.title }],
    [],
    [{ v: '비교 대상', s: S.label }, { v: x.prevTitle, s: S.body }],
    [{ v: '기준', s: S.label }, { v: x.nextTitle, s: S.body }],
    [{ v: '내보낸 때', s: S.label }, { v: stamp(x.at), s: S.body }],
    [{ v: '변경점 시트', s: S.label }, { v: x.scope === 'all' ? '전체 요구사항(동일 포함)' : '달라진 요구사항만', s: S.body }],
    [],
    ['분류', '이름', '전체', '변경', '신규', '삭제', '동일'].map((v) => ({ v, s: S.header })),
  ];
  const byPrefix = new Map<string, Record<RfpPairStatus, number>>();
  for (const p of result.pairs) {
    const k = refItem(p).prefix, r = byPrefix.get(k) ?? { changed: 0, added: 0, removed: 0, same: 0 };
    r[p.status]++; byPrefix.set(k, r);
  }
  for (const k of result.prefixes) {
    const r = byPrefix.get(k)!;
    sum.push([{ v: k, s: S.mono }, { v: PREFIX_LABELS[k] ?? '', s: S.body }, ...[r.changed + r.added + r.removed + r.same, r.changed, r.added, r.removed, r.same].map((v) => ({ v, s: S.num }))]);
  }
  sum.push([{ v: '합계', s: S.label }, { v: '', s: S.label }, ...[c.changed + c.added + c.removed + c.same, c.changed, c.added, c.removed, c.same].map((v) => ({ v, s: S.num }))]);

  return workbook([
    { name: '변경점', widths: [7, 13, 13, 30, 14, 18, 60, 50, 50, 10, 24], rows: main, freezeRow: 1, filter: true },
    { name: '번호 대조', widths: [15, 15, 40, 18], rows: map, freezeRow: 1, filter: true },
    { name: '요약', widths: [12, 40, 8, 8, 8, 8, 8], rows: sum },
  ]);
}

/** 파일 이름: RFP비교_<기준 제목>_<YYYYMMDD>.xlsx (윈도 금지 문자 제거) */
export function exportFileName(nextTitle: string, at: Date): string {
  const t = nextTitle.replace(/[\\/:*?"<>|\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || '결과';
  return `RFP비교_${t}_${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}.xlsx`;
}
