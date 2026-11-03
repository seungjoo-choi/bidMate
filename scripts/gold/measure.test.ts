import { it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { createParserRegistry } from '../../src/engine/parsers/registry';
import { loadRules } from '../../src/core/extraction/rules/load';
import { runExtractStep } from '../../src/engine/extraction/extract-step';
import { emptyNotice, setFields } from '../../src/core/model/notice-fields';
import { mapApiItem } from '../../src/adapters/g2b/openapi';
import { REVIEW_LEAF_KEYS, leafReviewState } from '../../src/core/extraction/review-rows';

const G = path.dirname(new URL(import.meta.url).pathname);
const D = new JSDOM('').window;
const parseXml = (xml: string) => new D.DOMParser().parseFromString(xml, 'application/xml') as unknown as Document;
const parsers = createParserRegistry({ pdf: { cMapUrl: path.resolve(G, '../../node_modules/pdfjs-dist') + '/cmaps/', standardFontDataUrl: path.resolve(G, '../../node_modules/pdfjs-dist') + '/standard_fonts/' }, parseXml });
const rules = loadRules();

it('harness', async () => {
  const cands: Record<string, string>[] = JSON.parse(fs.readFileSync(G + '/data/notices.json', 'utf8'));
  const only = (process.env.ONLY ?? '').split(',').filter(Boolean);
  const out: Record<string, unknown> = {};
  for (const item of cands) {
    const no = item.bidNtceNo; const dir = G + '/files/' + no;
    if (!fs.existsSync(dir + '/manifest.json') || (only.length && !only.includes(no))) continue;
    const man = JSON.parse(fs.readFileSync(dir + '/manifest.json', 'utf8'));
    const now = new Date().toISOString();
    const notice = emptyNotice(no, { noticeNo: no, origin: 'g2b' } as never, dir, now);
    setFields(notice, mapApiItem(item, now));
    notice.attachments = man.map((m: any) => ({ id: 'a' + m.index, index: m.index, originalName: m.name, savedName: m.saved ?? null, url: '', expectedSize: null, savedSize: m.size ?? null, status: m.error ? 'failed' : 'saved', attempts: 1 }));
    fs.mkdirSync(dir + '/source/text', { recursive: true });
    const store = { writeText: async (p: string, t: string) => fs.writeFileSync(p, t) } as never;
    const t0 = Date.now();
    const r = await runExtractStep({ id: 'j', attempt: 1 } as never, notice, null, {
      store, parsers, rules, emit: () => {}, settings: { budgetMs: 180000, fileTimeoutMs: 60000, maxParseMB: 50 },
      readFile: async (p: string) => new Uint8Array(fs.readFileSync(p.replace(dir + '/attachments/', dir + '/'))),
    });
    const x = r.extraction ?? null;
    const leaves: Record<string, unknown> = {};
    for (const k of REVIEW_LEAF_KEYS) {
      const j = leafReviewState(notice, x, k);
      const it2 = (x?.items as any)?.[k];
      leaves[k] = { state: j.state, value: j.value, reason: j.reason ?? it2?.reason, ev: it2?.evidence?.slice?.(0, 2)?.map((e: any) => e.snippet ?? e.text ?? e) };
    }
    out[no] = { status: r.status, ms: Date.now() - t0, files: x?.files.map((f) => ({ n: f.name, inner: f.innerPath, kind: f.docKind, st: f.status, skip: f.skipReason, err: f.error, text: f.textPath?.split('/').pop() })), leaves };
    console.log(no, r.status, Date.now() - t0, 'ms');
  }
  fs.mkdirSync(G + '/out', { recursive: true });
  fs.writeFileSync(G + '/out/' + (process.env.OUT ?? 'rules-result.json'), JSON.stringify(out, null, 1));
});
