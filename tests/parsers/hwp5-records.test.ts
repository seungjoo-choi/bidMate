import { describe, expect, it, vi } from 'vitest';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { decodeParaText, readRecords } from '../../src/engine/parsers/hwp5/records';
import { deflateSync } from 'fflate';
import { inflateRaw } from '../../src/engine/parsers/hwp5/cfb';
import { Grid } from '../../src/core/doc/grid';
import { MAX_TABLE_AREA } from '../../src/core/doc/limits';
import { createPdfParser } from '../../src/engine/parsers/pdf';
import type { DocTable } from '../../src/core/doc/model';

const w = (...codes: number[]) => {
  const b = new Uint8Array(codes.length * 2);
  codes.forEach((c, i) => { b[i * 2] = c & 0xff; b[i * 2 + 1] = c >> 8; });
  return b;
};
const str = (s: string) => [...s].map((c) => c.charCodeAt(0));

describe('decodeParaText', () => {
  it('필드 시작(3)+텍스트+필드 끝(4)+inline 인자 뒤 텍스트가 깨끗하다', () => {
    const body = w(3, ...Array(7).fill(0x41), ...str('가나'), 4, ...Array(7).fill(0x42), ...str('다라'));
    expect(decodeParaText(body)).toBe('가나다라');
  });
  it('탭은 9일 때만 출력, 30/31은 공백', () => {
    expect(decodeParaText(w(...str('a'), 9, ...Array(7).fill(0), ...str('b'), 30, ...str('c'), 31, ...str('d')))).toBe('a\tb c d');
    expect(decodeParaText(w(5, ...Array(7).fill(0), ...str('x')))).toBe('x');
  });
});

describe('readRecords', () => {
  it('잘린 레코드는 warning을 남긴다', () => {
    const buf = new Uint8Array(8);
    new DataView(buf.buffer).setUint32(0, (100 << 20) | 67, true);
    const warnings: string[] = [];
    expect(readRecords(buf, warnings)).toHaveLength(0);
    expect(warnings).toHaveLength(1);
  });
});

describe('inflateRaw', () => {
  it('abort된 signal이면 던진다', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(inflateRaw(new Uint8Array([3, 0]), { signal: ac.signal })).rejects.toMatchObject({ reason: 'cancelled' });
  });
  it('압축 끝 뒤 여분 바이트는 무시한다(Chrome DecompressionStream은 오류로 처리)', async () => {
    const src = new TextEncoder().encode('본문 '.repeat(50000));
    const d = deflateSync(src);
    const junk = new Uint8Array(d.length + 37);
    junk.set(d);
    junk.fill(0xab, d.length);
    expect(await inflateRaw(junk)).toEqual(src);
  });
  it('상한을 넘으면 corrupt', async () => {
    const d = deflateSync(new Uint8Array(1_000_000));
    await expect(inflateRaw(d, { maxBytes: 1000 })).rejects.toMatchObject({ reason: 'corrupt' });
  });
  it('깨진 데이터는 corrupt', async () => {
    await expect(inflateRaw(new Uint8Array([0xff, 0xff, 0xff, 0xff]))).rejects.toMatchObject({ reason: 'corrupt' });
  });
});

describe('Grid 면적 상한', () => {
  it('거대한 span도 MAX_TABLE_AREA 이상 채우지 않는다', () => {
    const t: DocTable = {
      kind: 'table', index: 0, rows: 100000, cols: 100000, loc: { block: 0 },
      cells: [{ r: 0, c: 0, rowSpan: 100000, colSpan: 100000, text: 'x', blocks: [], loc: { block: 0 } }],
    };
    const g = new Grid(t);
    expect(g.at(0, 0)?.text).toBe('x');
    expect(g.at(99999, 99999)).toBeUndefined();
    expect(MAX_TABLE_AREA).toBeGreaterThan(0);
  });
});

describe('pdf destroy', () => {
  it('손상 PDF 처리 후 destroy가 호출된다', async () => {
    const probe = pdfjs.getDocument({ data: new Uint8Array([37, 80, 68, 70]) });
    probe.promise.catch(() => {});
    const spy = vi.spyOn(Object.getPrototypeOf(probe) as { destroy(): Promise<void> }, 'destroy');
    await probe.destroy().catch(() => {});
    spy.mockClear();
    const parser = createPdfParser({ cMapUrl: 'node_modules/pdfjs-dist/cmaps/', standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/' });
    const r = await parser.parse({ name: 'x.pdf', bytes: new TextEncoder().encode('%PDF-1.4 garbage'), deadlineAt: Date.now() + 20000 });
    expect(r).toMatchObject({ ok: false, reason: 'corrupt' });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
