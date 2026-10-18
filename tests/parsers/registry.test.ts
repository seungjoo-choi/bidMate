import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { zipSync } from 'fflate';
import { createParserRegistry, detect } from '../../src/engine/parsers/registry';

const DIR = 'tests/fixtures/docs/R26BK01722175';
const load = (n: string) => new Uint8Array(readFileSync(`${DIR}/${n}`));
const d = (name: string, b: Uint8Array) => detect(name, b.subarray(0, 32), b);
const u8 = (s: string) => new TextEncoder().encode(s);

describe('detect', () => {
  it('hwp5', () => expect(d('a.hwp', load('1. 입찰공고문.hwp'))).toBe('hwp5'));
  it('pdf', () => expect(d('a.pdf', load('1. 입찰공고문.pdf'))).toBe('pdf'));
  it('zip', () => expect(d('a.zip', zipSync({ 'a.txt': u8('x') }))).toBe('zip'));
  it('docx', () => expect(d('a.docx', zipSync({ 'word/document.xml': u8('<x/>') }))).toBe('docx'));
  it('xlsx', () => expect(d('a.xlsm', zipSync({ 'xl/workbook.xml': u8('<x/>') }))).toBe('xlsx'));
  it('hwpx', () => expect(d('a.hwpx', zipSync({ 'Contents/section0.xml': u8('<x/>') }))).toBe('hwpx'));
  it('hwp3', () => {
    const b = new Uint8Array(64);
    b.set(u8('HWP Document File V3.00'));
    expect(d('a.hwp', b)).toBe('hwp3');
  });
});

describe('registry.get', () => {
  it('미등록 형식은 unsupported를 반환한다', async () => {
    const r = await createParserRegistry().get('pdf').parse({ name: 'a.pdf', bytes: new Uint8Array(), deadlineAt: Date.now() + 1000 });
    expect(r).toMatchObject({ ok: false, reason: 'unsupported' });
  });
  it('txt는 utf-8 실패 시 euc-kr로 읽는다', async () => {
    const r = await createParserRegistry().get('txt').parse({ name: 'a.txt', bytes: Uint8Array.from([0xb0, 0xa1]), deadlineAt: Date.now() + 1000 });
    const b = r.ok ? r.doc.blocks[0] : undefined;
    expect(b?.kind === 'p' && b.text).toBe('가');
  });
});
