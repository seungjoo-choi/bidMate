import * as CFB from 'cfb';
import type { DetectedFormat, DocFormat, DocParser, ParserRegistry, PdfEnv } from './types';
import { openZip } from './zip';
import { txtParser } from './txt';
import { hwp5Parser } from './hwp5/parser';
import { createPdfParser } from './pdf';
import { createHwpxParser } from './hwpx';
import { createDocxParser } from './docx';
import { createXlsxParser } from './xlsx';

const startsWith = (b: Uint8Array, sig: number[]) => sig.every((v, i) => b[i] === v);
const ascii = (b: Uint8Array, n: number) => String.fromCharCode(...b.subarray(0, n));

/** 매직 바이트로 형식을 판정한다. 확장자는 매직으로 못 가릴 때(txt)만 보조로 쓴다. */
export function detect(name: string, head: Uint8Array, bytes: Uint8Array): DetectedFormat {
  if (startsWith(head, [0xd0, 0xcf, 0x11, 0xe0])) {
    try {
      const cfb = CFB.read(bytes, { type: 'array' });
      const fh = CFB.find(cfb, '/FileHeader');
      const sig = fh?.content ? ascii(Uint8Array.from(fh.content as ArrayLike<number>), 17) : '';
      return sig === 'HWP Document File' ? 'hwp5' : 'unknown';
    } catch {
      return 'unknown';
    }
  }
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04])) {
    try {
      const zip = openZip(bytes);
      const paths = new Set(zip.entries.map((e) => e.path));
      if (paths.has('mimetype') && new TextDecoder().decode(zip.read('mimetype')).trim() === 'application/hwp+zip') return 'hwpx';
      if (paths.has('Contents/section0.xml')) return 'hwpx';
      if (paths.has('word/document.xml')) return 'docx';
      if (paths.has('xl/workbook.xml')) return 'xlsx';
    } catch {
      /* 목록을 못 읽으면 일반 zip */
    }
    return 'zip';
  }
  if (ascii(head, 4) === '%PDF') return 'pdf';
  if (ascii(head, 20) === 'HWP Document File V3') return 'hwp3';
  if (/\.txt$/i.test(name)) return 'txt';
  return 'unknown';
}

function unsupportedParser(format: DocFormat): DocParser {
  return {
    id: `${format}-unsupported`,
    format,
    async parse() {
      return { ok: false, reason: 'unsupported', message: `${format} 파서가 등록되지 않았습니다` };
    },
  };
}

/** 형식별 파서 등록. pdf는 env.pdf가 있을 때만(자산 경로 필요). hwp3는 항상 unsupported. */
export function createParserRegistry(env?: { pdf: PdfEnv; parseXml?: (xml: string) => Document }): ParserRegistry {
  const parseXml = env?.parseXml;
  const parsers = new Map<DocFormat, DocParser>([
    ['txt', txtParser],
    ['hwp5', hwp5Parser],
    ['hwpx', createHwpxParser(parseXml)],
    ['docx', createDocxParser(parseXml)],
    ['xlsx', createXlsxParser({ parseXml })],
  ]);
  if (env?.pdf) parsers.set('pdf', createPdfParser(env.pdf));
  return {
    detect,
    get: (format) => parsers.get(format) ?? unsupportedParser(format),
  };
}
