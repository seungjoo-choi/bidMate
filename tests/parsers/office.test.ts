// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { Grid, allTables } from '../../src/core/doc/grid';
import { renderText } from '../../src/core/doc/render-text';
import { hwpxParser } from '../../src/engine/parsers/hwpx';
import { docxParser } from '../../src/engine/parsers/docx';
import { createXlsxParser, resolveTarget, xlsxParser } from '../../src/engine/parsers/xlsx';
import type { ParseInput } from '../../src/engine/parsers/types';

const zip = (files: Record<string, string>): Uint8Array =>
  zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
const inp = (bytes: Uint8Array, extra: Partial<ParseInput> = {}): ParseInput =>
  ({ name: 'x', bytes, deadlineAt: Date.now() + 60000, ...extra });

const HP = 'xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"';
const hc = (r: number, c: number, body: string, rs = 1, cs = 1) =>
  `<hp:tc><hp:subList>${body}</hp:subList><hp:cellAddr colAddr="${c}" rowAddr="${r}"/><hp:cellSpan colSpan="${cs}" rowSpan="${rs}"/></hp:tc>`;
const hpara = (t: string) => `<hp:p><hp:run><hp:t>${t}</hp:t></hp:run></hp:p>`;

describe('hwpx', () => {
  const nested = `<hp:p><hp:run><hp:tbl rowCnt="1" colCnt="1"><hp:tr>${hc(0, 0, hpara('안쪽'))}</hp:tr></hp:tbl></hp:run></hp:p>`;
  const section = `<?xml version="1.0"?><hs:sec xmlns:hs="s" ${HP}>
    ${hpara('평가 기준 안내')}
    <hp:p><hp:run><hp:tbl rowCnt="3" colCnt="4">
      <hp:tr>${hc(0, 0, hpara('구분'))}${hc(0, 1, hpara('A'))}${hc(0, 2, hpara('B'))}${hc(0, 3, hpara('C'))}</hp:tr>
      <hp:tr>${hc(1, 0, hpara('신용'), 2)}${hc(1, 1, hpara('바깥') + nested)}${hc(1, 2, hpara('x'))}${hc(1, 3, hpara('y'))}</hp:tr>
      <hp:tr>${hc(2, 1, hpara('p'))}${hc(2, 2, hpara('q'))}${hc(2, 3, hpara('r'))}</hp:tr>
    </hp:tbl></hp:run></hp:p></hs:sec>`;
  const bytes = zip({ 'mimetype': 'application/hwp+zip', 'Contents/section0.xml': section });

  it('표/rowSpan/중첩/caption/한글', async () => {
    const r = await hwpxParser.parse(inp(bytes));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const tables = allTables(r.doc);
    expect(tables).toHaveLength(2);
    const t = tables[0]!;
    expect(t.rows).toBe(3);
    expect(t.cols).toBe(4);
    expect(t.caption).toBe('평가 기준 안내');
    const g = new Grid(t);
    expect(g.at(2, 0)).toBe(g.at(1, 0));
    expect(g.at(1, 0)!.rowSpan).toBe(2);
    expect(g.at(1, 0)!.text).toBe('신용');
    expect(g.at(1, 1)!.blocks).toHaveLength(1);
    expect(g.rowText(0)).toBe('구분 | A | B | C');
    expect(new Grid(tables[1]!).at(0, 0)!.text).toBe('안쪽');
    const text = renderText(r.doc);
    expect(text).toContain('[셀 1 0 rs2] 신용');
    expect(text).toContain('[표 1]');
    expect(r.doc.stats.tables).toBe(2);
    expect(r.doc.stats.chars).toBeGreaterThan(0);
  });
});

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const wp = (t: string) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
const wc = (body: string, pr = '') => `<w:tc><w:tcPr>${pr}</w:tcPr>${body}</w:tc>`;

describe('docx', () => {
  const doc = `<w:document ${W}><w:body>${wp('머리 문단')}
    <w:tbl>
      <w:tr>${wc(wp('병합'), '<w:gridSpan w:val="2"/>')}${wc(wp('Z'))}</w:tr>
      <w:tr>${wc(wp('세로'), '<w:vMerge w:val="restart"/>')}${wc(wp('a'))}${wc(wp('b') + `<w:tbl><w:tr>${wc(wp('안쪽'))}</w:tr></w:tbl>`)}</w:tr>
      <w:tr>${wc('<w:p/>', '<w:vMerge/>')}${wc(wp('c'))}${wc(wp('d'))}</w:tr>
      <w:tr>${wc('<w:p/>', '<w:vMerge w:val="continue"/>')}${wc(wp('e'))}${wc(wp('f'))}</w:tr>
    </w:tbl></w:body></w:document>`;
  const bytes = zip({ 'word/document.xml': doc });

  it('gridSpan/vMerge/중첩 표', async () => {
    const r = await docxParser.parse(inp(bytes));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const tables = allTables(r.doc);
    expect(tables).toHaveLength(2);
    const t = tables[0]!;
    expect(t.caption).toBe('머리 문단');
    expect(t.rows).toBe(4);
    expect(t.cols).toBe(3);
    const g = new Grid(t);
    expect(g.at(0, 0)!.colSpan).toBe(2);
    expect(g.at(0, 1)).toBe(g.at(0, 0));
    expect(g.at(1, 0)!.rowSpan).toBe(3);
    expect(g.at(3, 0)).toBe(g.at(1, 0));
    expect(g.at(2, 1)!.text).toBe('c');
    expect(g.at(1, 2)!.blocks).toHaveLength(1);
    expect(new Grid(tables[1]!).at(0, 0)!.text).toBe('안쪽');
    expect(renderText(r.doc)).toContain('[셀 1 0 rs3] 세로');
  });
});

const wbXml = (names: string[]) =>
  `<workbook xmlns="m" xmlns:r="rel"><sheets>${names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`;
const relsXml = (n: number) =>
  `<Relationships xmlns="rl">${Array.from({ length: n }, (_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`;

describe('xlsx', () => {
  const sst = `<sst xmlns="m"><si><t>공유A</t></si><si><r><t>공유</t></r><r><t>B</t></r></si></sst>`;
  const sheet1 = `<worksheet xmlns="m"><sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>인라인</t></is></c><c r="C1"><v>42</v></c></row>
    <row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>9</v></c></row>
    </sheetData><mergeCells count="1"><mergeCell ref="A1:B2"/></mergeCells></worksheet>`;
  const sheet2 = `<worksheet xmlns="m"><sheetData><row r="3"><c r="B3" t="s"><v>1</v></c></row></sheetData></worksheet>`;
  const bytes = zip({
    'xl/workbook.xml': wbXml(['첫째', '둘째']), 'xl/_rels/workbook.xml.rels': relsXml(2),
    'xl/sharedStrings.xml': sst, 'xl/worksheets/sheet1.xml': sheet1, 'xl/worksheets/sheet2.xml': sheet2,
  });

  it('시트 2개/sharedStrings/inlineStr/mergeCell', async () => {
    const r = await xlsxParser.parse(inp(bytes));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const tables = allTables(r.doc);
    expect(tables).toHaveLength(2);
    expect(tables[0]!.loc.sheet).toBe('첫째');
    expect(tables[1]!.loc.sheet).toBe('둘째');
    const g = new Grid(tables[0]!);
    expect(g.at(1, 1)).toBe(g.at(0, 0));
    expect(g.at(0, 0)!.text).toBe('공유A');
    expect(g.at(0, 0)!.rowSpan).toBe(2);
    expect(g.at(0, 0)!.colSpan).toBe(2);
    expect(g.at(0, 2)!.text).toBe('42');
    expect(new Grid(tables[1]!).at(2, 1)!.text).toBe('공유B');
    expect(renderText(r.doc)).toContain('[셀 0 0 rs2 cs2] 공유A');
  });

  it('셀 상한 warning', async () => {
    const r = await createXlsxParser({ maxCells: 2 }).parse(inp(bytes));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.warnings.some((w) => w.includes('첫째'))).toBe(true);
    expect(new Grid(allTables(r.doc)[0]!).at(0, 2)).toBeUndefined();
  });
});

describe('공통', () => {
  const broken = zip({ 'word/document.xml': '<w:document><w:p></w:document>' });
  it('깨진 XML이면 corrupt', async () => {
    const r = await docxParser.parse(inp(broken));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('corrupt');
    const h = await hwpxParser.parse(inp(zip({ 'Contents/section0.xml': '<a><b></a>' })));
    expect(!h.ok && h.reason).toBe('corrupt');
  });
  it('abort된 signal이면 cancelled', async () => {
    const ac = new AbortController();
    ac.abort();
    const r = await docxParser.parse(inp(broken, { signal: ac.signal }));
    expect(!r.ok && r.reason).toBe('cancelled');
  });
});

describe('상한/정규화', () => {
  const book = (merge: string) => zip({
    'xl/workbook.xml': wbXml(['s']), 'xl/_rels/workbook.xml.rels': relsXml(1),
    'xl/worksheets/sheet1.xml': `<worksheet xmlns="m"><sheetData><row r="1"><c r="A1"><v>1</v></c><c r="B2"><v>2</v></c></row></sheetData><mergeCells count="1"><mergeCell ref="${merge}"/></mergeCells></worksheet>`,
  });
  it('A1:XFD1048576 병합이 1초 안에 끝나고 잘림', async () => {
    const t0 = Date.now();
    const r = await xlsxParser.parse(inp(book('A1:XFD1048576')));
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = new Grid(allTables(r.doc)[0]!).at(0, 0)!;
    expect(c.rowSpan * c.colSpan).toBeLessThanOrEqual(20000);
  });
  it('뒤집힌 ref는 span이 양수', async () => {
    const r = await xlsxParser.parse(inp(book('B2:A1')));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const g = new Grid(allTables(r.doc)[0]!);
    expect(g.at(0, 0)!.rowSpan).toBe(2);
    expect(g.at(0, 0)!.colSpan).toBe(2);
    expect(g.at(1, 1)).toBe(g.at(0, 0));
  });
  it('rels Target 정규화', () => {
    expect(resolveTarget('worksheets/sheet1.xml')).toBe('xl/worksheets/sheet1.xml');
    expect(resolveTarget('/xl/worksheets/sheet1.xml')).toBe('xl/worksheets/sheet1.xml');
    expect(resolveTarget('../worksheets/sheet1.xml')).toBe('xl/worksheets/sheet1.xml');
  });
  it('HWPX 거대한 rowCnt/span은 상한으로 잘림', async () => {
    const sec = `<hs:sec xmlns:hs="s" ${HP}><hp:p><hp:run><hp:tbl rowCnt="999999" colCnt="999999"><hp:tr>${hc(0, 0, hpara('a'), 99999, 99999)}</hp:tr></hp:tbl></hp:run></hp:p></hs:sec>`;
    const r = await hwpxParser.parse(inp(zip({ 'Contents/section0.xml': sec })));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t = allTables(r.doc)[0]!;
    expect(t.rows).toBeLessThanOrEqual(2000);
    expect(t.cols).toBeLessThanOrEqual(256);
    expect(t.cells[0]!.rowSpan * t.cells[0]!.colSpan).toBeLessThanOrEqual(20000);
    expect(r.doc.warnings.length).toBeGreaterThan(0);
  });
  it('탭/줄바꿈 보존', async () => {
    const doc = `<w:document ${W}><w:body><w:p><w:r><w:t>가</w:t><w:tab/><w:t>나</w:t><w:br/><w:t>다</w:t></w:r></w:p></w:body></w:document>`;
    const r = await docxParser.parse(inp(zip({ 'word/document.xml': doc })));
    expect(r.ok && renderText(r.doc)).toBe('가\t나\n다');
  });
  it('xlsx 상한 밖 셀 좌표는 버려짐', async () => {
    const bytes = zip({
      'xl/workbook.xml': wbXml(['s']), 'xl/_rels/workbook.xml.rels': relsXml(1),
      'xl/worksheets/sheet1.xml': '<worksheet xmlns="m"><sheetData><row r="1"><c r="A1"><v>1</v></c></row><row r="1048576"><c r="A1048576"><v>9</v></c></row></sheetData></worksheet>',
    });
    const t0 = Date.now();
    const r = await xlsxParser.parse(inp(bytes));
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t = allTables(r.doc)[0]!;
    expect(t.rows).toBe(1);
    expect(t.rows).toBeLessThanOrEqual(2000);
    expect(r.doc.warnings.length).toBe(1);
  });
  it('HWPX t 안의 tab/lineBreak', async () => {
    const sec = `<hs:sec xmlns:hs="s" ${HP}><hp:p><hp:run><hp:t>가<hp:tab/>나<hp:lineBreak/>다</hp:t></hp:run></hp:p></hs:sec>`;
    const r = await hwpxParser.parse(inp(zip({ 'Contents/section0.xml': sec })));
    expect(r.ok && renderText(r.doc)).toBe('가\t나\n다');
  });
  it('docx gridSpan 폭주는 상한 안으로 잘림', async () => {
    const doc = `<w:document ${W}><w:body><w:tbl><w:tr>${wc(wp('a'), '<w:gridSpan w:val="1000000000"/>')}</w:tr></w:tbl></w:body></w:document>`;
    const r = await docxParser.parse(inp(zip({ 'word/document.xml': doc })));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t = allTables(r.doc)[0]!;
    expect(t.cols).toBeLessThanOrEqual(256);
    expect(t.cells[0]!.colSpan).toBeLessThanOrEqual(256);
    expect(r.doc.warnings.length).toBeGreaterThan(0);
  });
});
