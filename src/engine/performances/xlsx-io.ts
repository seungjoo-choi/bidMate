import { strToU8, zipSync } from 'fflate';
import { rowsFromCells, SHEET_COLUMNS, type SheetParse } from '../../core/performances/sheet';
import type { DocTable } from '../../core/doc/model';
import { createXlsxParser } from '../parsers/xlsx';
import type { ParseXml } from '../parsers/xml-util';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = (i: number) => String.fromCharCode(65 + i);

const EXAMPLE: Array<string | number> = ['OO시스템 구축', 'OO공단', 350000000, '2024-03-01', '2024-12-31', 100, '정보시스템', '예시 행입니다. 지우고 쓰세요'];
const WIDTHS = [32, 20, 16, 14, 14, 10, 16, 36];

function rowXml(r: number, vals: Array<string | number>): string {
  const cells = vals.map((v, i) => {
    const ref = `${colName(i)}${r}`;
    return typeof v === 'number'
      ? `<c r="${ref}"><v>${v}</v></c>`
      : `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
  });
  return `<row r="${r}">${cells.join('')}</row>`;
}

/** 빈 양식 xlsx(머리글 1행 + 예시 1행). */
export function buildTemplateXlsx(): Uint8Array {
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const RNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const cols = WIDTHS.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  const headers = [...SHEET_COLUMNS].map((c) => (c === '계약금액' ? '계약금액(원)' : c === '지분율' ? '지분율(%)' : c));
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`),
    '_rels/.rels': strToU8(`${head}<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${RNS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(`${head}<workbook xmlns="${NS}" xmlns:r="${RNS}"><sheets><sheet name="실적" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`${head}<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${RNS}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
    'xl/worksheets/sheet1.xml': strToU8(`${head}<worksheet xmlns="${NS}"><cols>${cols}</cols><sheetData>${rowXml(1, headers)}${rowXml(2, EXAMPLE)}</sheetData></worksheet>`),
  };
  return zipSync(files, { level: 6 });
}

/** 파일 바이트 → 첫 시트 셀 → rowsFromCells. 파서 실패나 시트 없음은 ok:false 메시지 */
export async function parsePerformanceXlsx(bytes: Uint8Array, opts: { parseXml?: ParseXml } = {}): Promise<SheetParse> {
  const r = await createXlsxParser({ parseXml: opts.parseXml }).parse({ name: 'import.xlsx', bytes, deadlineAt: Date.now() + 20_000 });
  if (!r.ok) return { ok: false, error: r.message };
  const table = r.doc.blocks.find((b): b is DocTable => b.kind === 'table');
  if (!table) return { ok: false, error: '시트를 찾지 못했습니다.' };
  return rowsFromCells(table.cells);
}
