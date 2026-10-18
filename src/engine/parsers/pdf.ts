import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { DocBlock, DocModel } from '../../core/doc/model';
import type { DocParser, ParseFailReason, ParseInput, ParseResult, PdfEnv } from './types';
import { yieldToLoop } from './yield';

const SCAN_MIN_CHARS = 20;

interface Item { str: string; x: number; y: number; w: number; h: number }
interface Line { y: number; h: number; items: Item[] }

const fail = (reason: ParseFailReason, message: string): ParseResult => ({ ok: false, reason, message });

/** 텍스트 아이템을 y로 묶어 줄을 만들고, 줄 안에서는 x순으로 정렬해 공백을 복원한다. */
function buildLines(items: Item[]): string[] {
  const lines: Line[] = [];
  for (const it of items) {
    const line = lines.find((l) => Math.abs(l.y - it.y) <= 0.5 * Math.max(l.h, it.h));
    if (line) {
      line.items.push(it);
      line.h = Math.max(line.h, it.h);
    } else {
      lines.push({ y: it.y, h: it.h, items: [it] });
    }
  }
  lines.sort((a, b) => b.y - a.y);
  const out: string[] = [];
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    let s = '';
    let prevEnd: number | null = null;
    for (const it of l.items) {
      if (prevEnd !== null && it.x - prevEnd > 0.3 * l.h && !/\s$/.test(s) && !/^\s/.test(it.str)) s += ' ';
      s += it.str;
      prevEnd = it.x + it.w;
    }
    s = s.trim();
    if (s) out.push(s);
  }
  return out;
}

export function createPdfParser(env: PdfEnv): DocParser {
  return {
    id: 'pdf',
    format: 'pdf',
    async parse(input: ParseInput): Promise<ParseResult> {
      const t0 = Date.now();
      const { signal } = input;
      const stop = (): ParseResult | null => {
        if (signal?.aborted) return fail('cancelled', '취소됨');
        if (Date.now() > input.deadlineAt) return fail('timeout', '시간 초과');
        return null;
      };
      const early = stop();
      if (early) return early;
      if (env.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = env.workerSrc;

      const task = pdfjs.getDocument({
        data: new Uint8Array(input.bytes), // pdfjs가 버퍼를 가져가므로 복사본을 넘긴다
        cMapUrl: env.cMapUrl,
        cMapPacked: true,
        standardFontDataUrl: env.standardFontDataUrl,
        isEvalSupported: false,
        disableFontFace: true,
        useSystemFonts: false,
      });
      const onAbort = () => { void task.destroy(); };
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        const pdf = await task.promise;
        const blocks: DocBlock[] = [];
        const warnings: string[] = [];
        const emptyPages: number[] = [];
        let chars = 0;
        let nonSpace = 0;
        for (let p = 1; p <= pdf.numPages; p++) {
          const halt = stop();
          if (halt) return halt;
          const page = await pdf.getPage(p);
          const tc = await page.getTextContent();
          const items: Item[] = [];
          for (const it of tc.items) {
            if (!('str' in it)) continue;
            const str = it.str.replace(/\u0000/g, '');
            if (!str) continue;
            items.push({ str, x: it.transform[4]!, y: it.transform[5]!, w: it.width, h: it.height || Math.abs(it.transform[3]!) });
          }
          const lines = buildLines(items);
          let pageChars = 0;
          for (const text of lines) {
            blocks.push({ kind: 'p', text, loc: { page: p, block: blocks.length } });
            chars += text.length;
            pageChars += text.replace(/\s/g, '').length;
          }
          nonSpace += pageChars;
          if (pageChars < SCAN_MIN_CHARS) emptyPages.push(p);
          page.cleanup();
          await yieldToLoop();
        }
        const pages = pdf.numPages;
        if (pages === 0 || nonSpace / pages < SCAN_MIN_CHARS) return fail('scanned', '텍스트가 거의 없는 스캔 문서입니다');
        if (emptyPages.length) warnings.push(`텍스트가 거의 없는 페이지: ${emptyPages.join(',')}`);
        const doc: DocModel = { format: 'pdf', blocks, pages, warnings, stats: { chars, tables: 0, ms: Date.now() - t0 } };
        return { ok: true, doc };
      } catch (e) {
        const err = e as Error;
        if (signal?.aborted) return fail('cancelled', '취소됨');
        if (err.name === 'PasswordException') return fail('encrypted', '암호가 걸린 문서입니다');
        if (err.name === 'InvalidPDFException') return fail('corrupt', 'PDF가 손상되었습니다');
        return fail('corrupt', err.message);
      } finally {
        signal?.removeEventListener('abort', onAbort);
        void task.destroy().catch(() => {}); // 정상/예외/취소 경로 모두 해제
      }
    },
  };
}
