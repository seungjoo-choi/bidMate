import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createPdfParser } from '../../src/engine/parsers/pdf';
import { createParserRegistry } from '../../src/engine/parsers/registry';

const DIR = 'tests/fixtures/docs/R26BK01722175';
const env = { cMapUrl: 'node_modules/pdfjs-dist/cmaps/', standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/' };
const parser = createPdfParser(env);
const compact = (s: string) => s.replace(/\s+/g, '');

/** 텍스트 없이 빈 페이지 1장만 가진 최소 PDF. */
function blankPdf(): Uint8Array {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>',
  ];
  let s = '%PDF-1.4\n';
  const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(s.length); s += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = s.length;
  s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offs) s += `${String(o).padStart(10, '0')} 00000 n \n`;
  s += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(s);
}

describe('pdf', () => {
  it('f2: 25쪽, 차등점수제:미적용, scanned 아님, 2초 미만', async () => {
    const t0 = performance.now();
    const r = await parser.parse({ name: 'f2.pdf', bytes: new Uint8Array(readFileSync(`${DIR}/1. 입찰공고문.pdf`)), deadlineAt: Date.now() + 20000 });
    const ms = performance.now() - t0;
    if (!r.ok) throw new Error(`${r.reason}: ${r.message}`);
    expect(ms).toBeLessThan(2000);
    expect(r.doc.pages).toBe(25);
    expect(r.doc.blocks.every((b) => b.kind === 'p' && b.loc.page !== undefined)).toBe(true);
    expect(compact(r.doc.blocks.map((b) => (b as { text: string }).text).join(''))).toContain('차등점수제:미적용');
  });
  it('텍스트 없는 합성 PDF는 scanned', async () => {
    expect(await parser.parse({ name: 'b.pdf', bytes: blankPdf(), deadlineAt: Date.now() + 20000 })).toMatchObject({ ok: false, reason: 'scanned' });
  });
  it('이미 abort된 signal은 cancelled', async () => {
    const ac = new AbortController();
    ac.abort();
    const r = await parser.parse({ name: 'f2.pdf', bytes: new Uint8Array(readFileSync(`${DIR}/1. 입찰공고문.pdf`)), signal: ac.signal, deadlineAt: Date.now() + 20000 });
    expect(r).toMatchObject({ ok: false, reason: 'cancelled' });
  });
  it('깨진 바이트는 corrupt', async () => {
    const r = await parser.parse({ name: 'x.pdf', bytes: new TextEncoder().encode('%PDF-1.4 garbage'), deadlineAt: Date.now() + 20000 });
    expect(r).toMatchObject({ ok: false, reason: 'corrupt' });
  });
  it('레지스트리에 모든 형식이 등록되고, pdf는 env가 없으면 unsupported', async () => {
    const reg = createParserRegistry({ pdf: env });
    for (const f of ['pdf', 'hwp5', 'hwpx', 'docx', 'xlsx', 'txt'] as const) expect(reg.get(f).format).toBe(f);
    const noPdf = createParserRegistry();
    expect(await noPdf.get('pdf').parse({ name: 'a', bytes: new Uint8Array(), deadlineAt: Date.now() + 1000 })).toMatchObject({ reason: 'unsupported' });
  });
});
