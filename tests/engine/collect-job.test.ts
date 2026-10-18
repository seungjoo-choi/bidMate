import { describe, expect, it, vi } from 'vitest';
import servcFx from '../fixtures/g2b-servc-R26BK01722175.json';
import { defaultSettings } from '../../src/core/model/default-settings';
import type { Job, JobProgress } from '../../src/core/types/job';
import { emptyNotice } from '../../src/core/model/notice-fields';
import { NoticeStore } from '../../src/engine/notices/notice-store';
import { runCollectJob } from '../../src/engine/jobs/collect-job';
import { MemoryStore } from '../helpers/memory-store';
import { readFileSync } from 'node:fs';
import type { Extraction } from '../../src/core/types/extraction';
import { conflictCountOf } from '../../src/engine/extraction/extract-step';
import { createParserRegistry } from '../../src/engine/parsers/registry';
import { readJsonFile, runCollect } from '../helpers/extract-harness';

const baseItem = servcFx.response.body.items[0] as Record<string, string>;
const apiBody = (item: Record<string, string>) =>
  JSON.stringify({ response: { header: { resultCode: '00' }, body: { items: [item] } } });

const mkJob = (): Job => ({
  id: 'j1', type: 'collect', noticeId: 'R26BK01722175-00', ref: { noticeNo: 'R26BK01722175', origin: 'g2b' }, status: 'running',
  steps: ['fetch_basic', 'download_attachments', 'fetch_html'].map((id) => ({ id: id as never, status: 'pending' as const })),
  attempt: 1, createdAt: 't', updatedAt: 't', errors: [],
});

const stalled = () => new Response(new ReadableStream({ pull: () => new Promise(() => undefined) }), { headers: { 'content-length': '10' } });

function deps(store: MemoryStore, fetchFn: unknown, extra: Record<string, unknown> = {}) {
  const emitted: JobProgress[] = [];
  return {
    emitted,
    d: { store, checkPermission: async () => undefined, fetch: fetchFn as typeof fetch, emit: (p: JobProgress) => emitted.push(p), saveDebounceMs: 5, ...extra },
  };
}
const input = () => ({ job: mkJob(), secrets: { g2bServiceKey: 'K' }, settings: defaultSettings() });

describe('runCollectJob 취소', () => {
  it('fetch_basic 중 abort → cancelled, fetch 호출은 1회', async () => {
    const ac = new AbortController();
    const f = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_res, rej) => {
      setTimeout(() => ac.abort(), 10);
      init?.signal?.addEventListener('abort', () => rej(new Error('aborted')));
    }));
    const { d } = deps(new MemoryStore(), f, { signal: ac.signal });
    const out = await runCollectJob(input(), d);
    expect(out.status).toBe('cancelled');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('download 중 abort → cancelled, notice.json은 저장됨', async () => {
    const ac = new AbortController();
    const store = new MemoryStore();
    const f = vi.fn(async (url: string) => {
      if (url.includes('apis.data.go.kr')) return new Response(apiBody(baseItem));
      setTimeout(() => ac.abort(), 10);
      return stalled();
    });
    const { d } = deps(store, f, { signal: ac.signal });
    const out = await runCollectJob(input(), d);
    expect(out.status).toBe('cancelled');
    expect([...store.files.keys()].some((k) => k.endsWith('/notice.json'))).toBe(true);
  });
});

describe('runCollectJob bytes throttle', () => {
  it('bytes 이벤트가 많아도 progress는 간격당 1회, done은 즉시', async () => {
    const item: Record<string, string> = { ...baseItem };
    for (let i = 2; i <= 10; i++) { item[`ntceSpecDocUrl${i}`] = ''; item[`ntceSpecFileNm${i}`] = ''; }
    const chunks = 12;
    const f = async (url: string) => {
      if (url.includes('apis.data.go.kr')) return new Response(apiBody(item));
      let n = 0;
      const body = new ReadableStream<Uint8Array>({
        async pull(ctl) {
          await new Promise((r) => setTimeout(r, 20));
          if (n++ >= chunks) ctl.close(); else ctl.enqueue(new Uint8Array(10));
        },
      });
      return new Response(body, { headers: { 'content-length': String(chunks * 10) } });
    };
    const { d, emitted } = deps(new MemoryStore(), f, { progressIntervalMs: 100 });
    const out = await runCollectJob(input(), d);
    expect(out.status).toBe('completed');
    const bytes = emitted.filter((p) => p.bytes);
    expect(bytes.length).toBeGreaterThanOrEqual(1);
    expect(bytes.length).toBeLessThanOrEqual(4);
    expect(bytes.length).toBeLessThan(chunks);
    expect(emitted.some((p) => !p.bytes && p.progress?.done === 1)).toBe(true);
    expect(emitted.every((p) => p.attempt === 1)).toBe(true);
  });

describe('runCollectJob 재시도 html 병합', () => {
  it('fetch_basic이 done이어도 요청의 html을 notice에 병합한다', async () => {
    const store = new MemoryStore();
    const ns = new NoticeStore(store);
    const n = emptyNotice('R1-000', { noticeNo: 'R1', round: '000', origin: 'g2b' }, 'notices/2026/R1-000_t', '2026-10-17T00:00:00Z');
    await ns.saveNotice(n);
    const job = mkJob();
    job.noticeId = 'R1-000';
    job.attempt = 2;
    job.steps = job.steps.map((s) => (s.id === 'fetch_html' ? s : { ...s, status: 'done' as const }));
    const f = vi.fn();
    const { d } = deps(store, f);
    const out = await runCollectJob(
      { job, secrets: {}, settings: defaultSettings(), html: { capturedAt: '2026-10-17T00:00:00Z', fields: { projectPeriod: { raw: '계약일로부터 90일', ref: 'title=사업기간' } } } },
      d,
    );
    expect(out.status).toBe('completed');
    expect(f).not.toHaveBeenCalled();
    expect((out.result as { mailStatus?: string }).mailStatus).toBe('none');
    const saved = JSON.parse(await store.readText('notices/2026/R1-000_t/notice.json'));
    expect(saved.basic.projectPeriod.value).toBe('계약일로부터 90일');
  });
});

describe('runCollectJob result 필드', () => {
  it('extraction.conflictCount와 mailStatus를 기록한다', async () => {
    const DIR = 'tests/fixtures/docs/R26BK01722175';
    const files = { '1. 입찰공고문.hwp': readFileSync(`${DIR}/1. 입찰공고문.hwp`), '2. 제안요청서.hwp': readFileSync(`${DIR}/2. 제안요청서.hwp`) };
    const pdfEnv = { cMapUrl: 'node_modules/pdfjs-dist/cmaps/', standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/' };
    const { out, store } = await runCollect({ files, parsers: createParserRegistry({ pdf: pdfEnv }) });
    const r = out.result as { mailStatus?: string; extraction?: { reviewCount: number; conflictCount: number } };
    const x = readJsonFile<Extraction>(store, '/extraction.json');
    expect(r.mailStatus).toBe('none');
    expect(r.extraction?.conflictCount).toBe(conflictCountOf(x));
    expect(r.extraction?.conflictCount).toBeLessThanOrEqual(r.extraction!.reviewCount);
  });
});
});
