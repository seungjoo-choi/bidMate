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
import { docOf, fakeParsers, mkCollectJob, readJsonFile, runCollect } from '../helpers/extract-harness';
import { PRESPEC_MAP } from '../../src/adapters/g2b/prespec-api';
import { loadRules } from '../../src/core/extraction/rules/load';
import type { Notice } from '../../src/core/types/notice';
import { itemWith } from '../helpers/extract-harness';

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

describe('runCollectJob prespec (추정 매핑)', () => {
  const col = (key: string) => PRESPEC_MAP.fields.find((f) => f.key === key)!.api;
  const specItem: Record<string, string> = {
    [col('specRegNo')]: 'R26BD00273952', [col('specName')]: '통합 시스템', [col('registeredAt')]: '2026-10-10 09:00:00',
    [col('opinionCloseAt')]: '2026-10-17 18:00:00', [col('orderingOrg')]: '발주기관',
    [`${PRESPEC_MAP.attachUrl}1`]: 'https://dl.test/1', [`${PRESPEC_MAP.attachName}1`]: '규격서.hwp',
  };
  const specJob = (): Job => ({
    id: 'j2', type: 'collect', noticeId: 'R26BD00273952', ref: { kind: 'prespec', noticeNo: 'R26BD00273952', origin: 'g2b' }, status: 'running',
    steps: ['fetch_basic', 'download_attachments', 'extract', 'fetch_html'].map((id) => ({ id: id as never, status: 'pending' as const })),
    attempt: 1, createdAt: 't', updatedAt: 't', errors: [],
  });

  it('id=번호, 필드 채움, extract skipped, html 무시, 폴더는 <번호>_<제목>', async () => {
    const store = new MemoryStore();
    const f = vi.fn(async (url: string) => (url.includes('apis.data.go.kr')
      ? new Response(apiBody(specItem))
      : new Response('x', { headers: { 'content-length': '1' } })));
    const { d, emitted } = deps(store, f, { extract: { parsers: fakeParsers(async () => docOf('a')), rules: loadRules() } });
    const html = { capturedAt: '2026-10-19T00:00:00Z', fields: { projectPeriod: { raw: '90일', ref: 'r' } } };
    const out = await runCollectJob({ job: specJob(), html, secrets: { g2bServiceKey: 'K' }, settings: defaultSettings() }, d);
    expect(out.status).toBe('completed');
    expect(out.result?.noticeId).toBe('R26BD00273952');
    const key = [...store.files.keys()].find((k) => k.endsWith('/notice.json'))!;
    expect(key).toMatch(/^notices\/2026\/R26BD00273952_통합 시스템\/notice\.json$/);
    const saved = JSON.parse(await store.readText(key));
    expect(saved.ref.kind).toBe('prespec');
    expect(saved.prespec.specName.value).toBe('통합 시스템');
    expect(saved.prespec.opinionCloseAt.value).toBeTruthy();
    expect(saved.basic.title.value).toBe('통합 시스템');
    expect(saved.basic.projectPeriod.value).toBeNull(); // html 무시
    expect(saved.isCorrection).toBe(false);
    expect(saved.attachments).toHaveLength(1);
    expect(emitted.find((p) => p.step === 'fetch_html')).toMatchObject({ status: 'done', label: '화면값 1개 항목 전달됨' });
    expect(emitted.find((p) => p.step === 'extract')).toMatchObject({ status: 'skipped', label: '평가정보 추출 대상 아님' });
    const facts = emitted.find((p) => p.event?.kind === 'facts')!.event as { facts: { prespec?: object } };
    expect(facts.facts.prespec).toBeTruthy();
    expect(JSON.stringify(facts)).not.toMatch(/officer/);
  });

  it('orderplan은 KIND_UNSUPPORTED로 실패', async () => {
    const job = { ...specJob(), ref: { kind: 'orderplan' as const, noticeNo: 'X', origin: 'g2b' as const } };
    const { d } = deps(new MemoryStore(), vi.fn());
    const out = await runCollectJob({ job, secrets: { g2bServiceKey: 'K' }, settings: defaultSettings() }, d);
    expect(out.status).toBe('failed');
    expect(out.error?.code).toBe('KIND_UNSUPPORTED');
    expect(out.error?.retryable).toBe(false);
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

describe('runCollectJob 상세화면 읽기(readDetail)', () => {
  const detailHtml = { capturedAt: '2026-10-19T00:00:00Z', fields: { projectPeriod: { raw: '계약일로부터 90일', ref: 'title=사업기간' } } };
  const apiFetch = () => vi.fn(async (url: string) => (url.includes('apis.data.go.kr')
    ? new Response(apiBody(baseItem))
    : new Response('x', { headers: { 'content-length': '1' } })));
  const readNotice = (store: MemoryStore) => {
    const key = [...store.files.keys()].find((k) => k.endsWith('/notice.json'))!;
    return store.readText(key).then((t) => JSON.parse(t));
  };
  const stepOf = (emitted: JobProgress[], status: string) => emitted.find((p) => p.step === 'fetch_html' && p.status === status);
  const detailErr = (code: string) => Object.assign(new Error(`${code} 실패`), { code });

  it('html 없음+bid+readDetail → 호출하고 병합 결과에 반영', async () => {
    const store = new MemoryStore();
    const readDetail = vi.fn(async () => detailHtml);
    const { d, emitted } = deps(store, apiFetch(), { readDetail });
    const out = await runCollectJob(input(), d);
    expect(out.status).toBe('completed');
    expect(readDetail).toHaveBeenCalledWith('j1');
    expect((await readNotice(store)).basic.projectPeriod.value).toBe('계약일로부터 90일');
    expect(stepOf(emitted, 'done')).toMatchObject({ label: '상세화면 읽기 완료' });
  });

  it('DETAIL_TIMEOUT → partial, collect.errors 기록, fetch_html failed, 나머지 step 정상', async () => {
    const store = new MemoryStore();
    const { d, emitted } = deps(store, apiFetch(), { readDetail: vi.fn(async () => { throw detailErr('DETAIL_TIMEOUT'); }) });
    const out = await runCollectJob(input(), d);
    expect(out.status).toBe('partial');
    expect(out.error?.code).toBe('DETAIL_TIMEOUT');
    const saved = await readNotice(store);
    expect(saved.collect.status).toBe('partial');
    expect(saved.collect.errors[0].code).toBe('DETAIL_TIMEOUT');
    expect(stepOf(emitted, 'failed')).toBeTruthy();
    expect(emitted.find((p) => p.step === 'fetch_basic' && p.status === 'done')).toBeTruthy();
    expect(emitted.find((p) => p.step === 'download_attachments' && p.status === 'done')).toBeTruthy();
  });

  it('DETAIL_CANCELLED → cancelled', async () => {
    const { d } = deps(new MemoryStore(), apiFetch(), { readDetail: vi.fn(async () => { throw detailErr('DETAIL_CANCELLED'); }) });
    const out = await runCollectJob(input(), d);
    expect(out.status).toBe('cancelled');
    expect(out.error).toBeUndefined();
  });

  it('html 제공 → readDetail 미호출, done', async () => {
    const readDetail = vi.fn(async () => detailHtml);
    const { d, emitted } = deps(new MemoryStore(), apiFetch(), { readDetail });
    const out = await runCollectJob({ ...input(), html: detailHtml }, d);
    expect(out.status).toBe('completed');
    expect(readDetail).not.toHaveBeenCalled();
    expect(stepOf(emitted, 'done')).toMatchObject({ label: '화면값 1개 항목 전달됨' });
  });

  it('prespec → 미호출, skipped', async () => {
    const col = (key: string) => PRESPEC_MAP.fields.find((f) => f.key === key)!.api;
    const specItem: Record<string, string> = {
      [col('specRegNo')]: 'R26BD00273952', [col('specName')]: '통합 시스템', [col('registeredAt')]: '2026-10-10 09:00:00',
      [col('opinionCloseAt')]: '2026-10-17 18:00:00', [col('orderingOrg')]: '발주기관',
    };
    const job: Job = { ...mkJob(), id: 'j3', noticeId: 'R26BD00273952', ref: { kind: 'prespec', noticeNo: 'R26BD00273952', origin: 'g2b' } };
    const readDetail = vi.fn(async () => detailHtml);
    const { d, emitted } = deps(new MemoryStore(), vi.fn(async () => new Response(apiBody(specItem))), { readDetail });
    await runCollectJob({ job, secrets: { g2bServiceKey: 'K' }, settings: defaultSettings() }, d);
    expect(readDetail).not.toHaveBeenCalled();
    expect(stepOf(emitted, 'skipped')).toMatchObject({ label: '상세화면 대상 아님' });
  });

  it('readDetail 미주입 → skipped', async () => {
    const { d, emitted } = deps(new MemoryStore(), apiFetch());
    const out = await runCollectJob(input(), d);
    expect(out.status).toBe('completed');
    expect(stepOf(emitted, 'skipped')).toMatchObject({ label: '상세화면 읽기 건너뜀' });
  });

  const retryJob = (fetchHtmlDone: boolean): Job => {
    const job = mkJob();
    job.noticeId = 'R1-000';
    job.attempt = 2;
    job.ref = { noticeNo: 'R1', round: '000', origin: 'g2b' };
    job.steps = job.steps.map((s) => (s.id === 'fetch_html' && !fetchHtmlDone ? s : { ...s, status: 'done' as const }));
    return job;
  };
  const seed = async (store: MemoryStore) => {
    await new NoticeStore(store).saveNotice(emptyNotice('R1-000', { noticeNo: 'R1', round: '000', origin: 'g2b' }, 'notices/2026/R1-000_t', '2026-10-17T00:00:00Z'));
  };

  it('재시도: fetch_basic done·fetch_html pending → 호출·병합', async () => {
    const store = new MemoryStore();
    await seed(store);
    const readDetail = vi.fn(async () => detailHtml);
    const { d } = deps(store, vi.fn(), { readDetail });
    const out = await runCollectJob({ job: retryJob(false), secrets: {}, settings: defaultSettings() }, d);
    expect(out.status).toBe('completed');
    expect(readDetail).toHaveBeenCalledTimes(1);
    expect((await readNotice(store)).basic.projectPeriod.value).toBe('계약일로부터 90일');
  });

  it('재시도: fetch_html done → 미호출', async () => {
    const store = new MemoryStore();
    await seed(store);
    const readDetail = vi.fn(async () => detailHtml);
    const { d } = deps(store, vi.fn(), { readDetail });
    const out = await runCollectJob({ job: retryJob(true), secrets: {}, settings: defaultSettings() }, d);
    expect(out.status).toBe('completed');
    expect(readDetail).not.toHaveBeenCalled();
  });
});

describe('runCollectJob 기록용 이벤트', () => {
  const ev = (emitted: JobProgress[], kind: string) => emitted.flatMap((p) => (p.event?.kind === kind ? [p.event] : []));

  it('file start/end 쌍 수는 첨부 수와 같고 facts는 2건(fetch_basic, extract)', async () => {
    const { out, emitted } = await runCollect({
      files: { '1. 입찰공고문.txt': 'a', '2. 제안요청서.txt': 'b' }, parsers: fakeParsers(async () => docOf('a')),
    });
    expect(out.status).toBe('completed');
    const dl = ev(emitted, 'file').filter((e) => e.kind === 'file' && e.step === 'download_attachments');
    expect(dl.filter((e) => e.kind === 'file' && e.phase === 'start')).toHaveLength(2);
    expect(dl.filter((e) => e.kind === 'file' && e.phase === 'end')).toHaveLength(2);
    const ex = ev(emitted, 'file').filter((e) => e.kind === 'file' && e.step === 'extract');
    expect(ex.filter((e) => e.kind === 'file' && e.phase === 'start').length).toBeGreaterThan(0);
    expect(ex.filter((e) => e.kind === 'file' && e.phase === 'start')).toHaveLength(ex.filter((e) => e.kind === 'file' && e.phase === 'end').length);
    const facts = ev(emitted, 'facts');
    expect(facts.map((e) => e.kind === 'facts' && e.step)).toEqual(['fetch_basic', 'extract']);
  });

  it('fetch_basic ms는 상세화면 읽기 지연을 포함하지 않는다', async () => {
    const delay = 120;
    const readDetail = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, delay));
      return { capturedAt: '2026-10-19T00:00:00Z', fields: {} };
    });
    const f = vi.fn(async (url: string) => (url.includes('apis.data.go.kr')
      ? new Response(apiBody(baseItem))
      : new Response('x', { headers: { 'content-length': '1' } })));
    const { d, emitted } = deps(new MemoryStore(), f, { readDetail });
    await runCollectJob(input(), d);
    const done = emitted.find((p) => p.step === 'fetch_basic' && p.status === 'done')!;
    expect(done.ms).toBeDefined();
    expect(done.ms!).toBeLessThan(delay);
  });
});

describe('runCollectJob 연계 사전규격 첨부', () => {
  const REG = 'R26BD00246532';
  const bidItem = { ...itemWith(['공고서.hwp', '공고서.pdf']), bfSpecRgstNo: REG };
  const preItem = { bfSpecRgstNo: REG, rcptDt: '2026-10-01 09:00:00', specDocFileUrl1: 'https://dl.test/p1', specDocFileUrl2: 'https://dl.test/p2' };
  const cd = (name: string) => `attachment;filename=${encodeURIComponent(name)};`;
  const dl = (url: string): Response => {
    const [content, name] = url.endsWith('/1') ? ['SAME', null] : url.endsWith('/2') ? ['BID2', null] : url.endsWith('/p1') ? ['SAME', '2. 다른이름.hwp'] : ['RFP', '3. 제안요청서.hwp'];
    return new Response(content, { headers: { 'content-length': String(content.length), ...(name ? { 'content-disposition': cd(name) } : {}) } });
  };
  const mkFetch = (bid: Record<string, string>, pre: (url: string) => Response | Promise<Response>) =>
    vi.fn(async (url: string) => {
      if (url.includes('HrcspSsstndrdInfoService')) return pre(url);
      if (url.includes('apis.data.go.kr')) return new Response(apiBody(bid));
      return dl(url);
    });
  const preOk = () => new Response(apiBody(preItem));
  const savedNotice = (store: MemoryStore): Notice => JSON.parse(store.files.get([...store.files.keys()].find((k) => k.endsWith('/notice.json'))!) as string);
  const preCalls = (f: ReturnType<typeof mkFetch>) => f.mock.calls.filter((c) => String(c[0]).includes('HrcspSsstndrdInfoService')).length;

  it('bid 첨부 2개 + 사전규격 첨부 2개(하나는 중복) → 4행, 중복은 skipped, linked 기록, raw 저장', async () => {
    const store = new MemoryStore();
    const f = mkFetch(bidItem, preOk);
    const { d, emitted } = deps(store, f);
    const out = await runCollectJob(input(), d);
    expect(out.status).toBe('completed');
    const n = savedNotice(store);
    expect(n.attachments).toHaveLength(4);
    expect(n.attachments.map((a) => a.origin)).toEqual([undefined, undefined, 'prespec', 'prespec']);
    const dup = n.attachments.find((a) => a.duplicateOf)!;
    expect(dup).toMatchObject({ status: 'skipped', duplicateOf: n.attachments[0]!.id, origin: 'prespec' });
    expect(n.attachments.filter((a) => a.status === 'saved')).toHaveLength(3);
    expect(n.attachments[3]).toMatchObject({ originalName: '3. 제안요청서.hwp', status: 'saved' });
    expect(n.linkedPrespec).toMatchObject({ regNo: REG, status: 'linked', attachmentCount: 2 });
    expect([...store.files.keys()].some((k) => /\/source\/api-prespec-[^/]+\.json$/.test(k))).toBe(true);
    expect(emitted.some((p) => p.step === 'fetch_basic' && p.label === '공고정보 조회 완료, 사전규격 첨부 2건')).toBe(true);
  });

  it('bfSpecRgstNo가 없으면 사전규격을 조회하지 않고 linkedPrespec도 없다', async () => {
    const store = new MemoryStore();
    const f = mkFetch({ ...bidItem, bfSpecRgstNo: '' }, preOk);
    const { d } = deps(store, f);
    const out = await runCollectJob(input(), d);
    expect(out.status).toBe('completed');
    expect(preCalls(f)).toBe(0);
    expect(savedNotice(store)).not.toHaveProperty('linkedPrespec');
  });

  it('사전규격 미존재 → not_found, completed, errors 없음', async () => {
    const store = new MemoryStore();
    const empty = () => new Response(JSON.stringify({ response: { header: { resultCode: '00' }, body: { items: [] } } }));
    const { d } = deps(store, mkFetch(bidItem, empty));
    const out = await runCollectJob(input(), d);
    expect(out.status).toBe('completed');
    const n = savedNotice(store);
    expect(n.linkedPrespec).toMatchObject({ regNo: REG, status: 'not_found' });
    expect(n.collect.errors).toEqual([]);
  });

  it('HTTP 500 → failed, partial, PRESPEC_FETCH_FAILED(retryable false)', async () => {
    const store = new MemoryStore();
    const f = mkFetch(bidItem, () => new Response('err', { status: 500 }));
    const { d } = deps(store, f);
    const out = await runCollectJob(input(), d);
    expect(out.status).toBe('partial');
    expect(out.error).toMatchObject({ code: 'PRESPEC_FETCH_FAILED', retryable: false });
    expect(out.error?.message).toMatch(/다시 수집하면 다시 조회합니다\.$/);
    const n = savedNotice(store);
    expect(n.linkedPrespec?.status).toBe('failed');
    expect(n.collect.status).toBe('partial');
    expect(n.collect.errors.map((e) => e.code)).toContain('PRESPEC_FETCH_FAILED');
  });

  it('조회 중 abort → cancelled', async () => {
    const ac = new AbortController();
    const f = mkFetch(bidItem, () => new Promise<Response>(() => { setTimeout(() => ac.abort(), 10); }));
    const { d } = deps(new MemoryStore(), f, { signal: ac.signal });
    const out = await runCollectJob(input(), d);
    expect(out.status).toBe('cancelled');
  });

  it('재시도(fetch_basic done)에서는 사전규격을 다시 조회하지 않는다', async () => {
    const store = new MemoryStore();
    const first = mkFetch(bidItem, preOk);
    await runCollectJob(input(), deps(store, first).d);
    expect(preCalls(first)).toBe(1);
    const job = mkJob();
    job.noticeId = savedNotice(store).id;
    job.attempt = 2;
    job.steps = job.steps.map((s) => ({ ...s, status: 'done' as const }));
    const second = mkFetch(bidItem, preOk);
    const out = await runCollectJob({ job, secrets: { g2bServiceKey: 'K' }, settings: defaultSettings() }, deps(store, second).d);
    expect(out.status).toBe('completed');
    expect(preCalls(second)).toBe(0);
    expect(savedNotice(store).linkedPrespec?.status).toBe('linked');
  });

  it('extract: 같은 priority면 bid 파일이 먼저, ExtractionFile.origin 기록', async () => {
    const store = new MemoryStore();
    const bid = { ...itemWith(['1. 제안요청서.hwp']), bfSpecRgstNo: REG };
    const pre = { bfSpecRgstNo: REG, specDocFileUrl1: 'https://dl.test/p2' };
    const f = mkFetch(bid, () => new Response(apiBody(pre)));
    const order: string[] = [];
    const parsers = fakeParsers(async (name) => { order.push(name); return docOf('a'); });
    const job = { ...mkJob(), steps: ['fetch_basic', 'download_attachments', 'extract', 'fetch_html'].map((id) => ({ id: id as never, status: 'pending' as const })) };
    const { d } = deps(store, f, { extract: { parsers, rules: loadRules() } });
    const out = await runCollectJob({ job, secrets: { g2bServiceKey: 'K' }, settings: defaultSettings() }, d);
    expect(out.status).toBe('completed');
    const x = readJsonFile<Extraction>(store, '/extraction.json');
    const parsed = x.files.filter((fl) => fl.status === 'parsed');
    expect(parsed.map((fl) => fl.origin)).toEqual([undefined, 'prespec']);
    expect(order).toHaveLength(2);
  });

  it('사전규격 조회 실패 뒤 재시도 잡도 조회 없이 partial과 PRESPEC_FETCH_FAILED를 유지한다', async () => {
    const store = new MemoryStore();
    const first = mkFetch(bidItem, () => new Response('err', { status: 500 }));
    expect((await runCollectJob(input(), deps(store, first).d)).status).toBe('partial');
    const job = mkJob();
    job.noticeId = savedNotice(store).id;
    job.attempt = 2;
    job.steps = job.steps.map((s) => ({ ...s, status: 'done' as const }));
    const second = mkFetch(bidItem, preOk);
    const out = await runCollectJob({ job, secrets: { g2bServiceKey: 'K' }, settings: defaultSettings() }, deps(store, second).d);
    expect(out.status).toBe('partial');
    expect(out.error).toMatchObject({ code: 'PRESPEC_FETCH_FAILED', retryable: false });
    expect(preCalls(second)).toBe(0);
    const n = savedNotice(store);
    expect(n.collect.status).toBe('partial');
    expect(n.collect.errors.map((e) => e.code)).toContain('PRESPEC_FETCH_FAILED');
  });
});

describe('runCollectJob 상세화면 전문(pageText)', () => {
  const PATH = 'notices';
  const pageHtml = { capturedAt: '2026-10-22T00:00:00Z', fields: {}, pageText: '공고명 테스트\n[표 1]\n[셀 0 0] 제안서 제출', pageTextTruncated: true };
  const apiFetch = () => vi.fn(async (url: string) => (url.includes('apis.data.go.kr') ? new Response(apiBody(baseItem)) : new Response('x', { headers: { 'content-length': '1' } })));
  const textKey = (store: MemoryStore) => [...store.files.keys()].find((k) => k.endsWith('/source/text/[상세] 나라장터 상세화면.txt'));
  const noticeOf = (store: MemoryStore): Notice => JSON.parse(store.files.get([...store.files.keys()].find((k) => k.endsWith('/notice.json'))!) as string);

  it('신규 경로: html.pageText가 있으면 파일 저장과 notice.detailText 설정', async () => {
    const store = new MemoryStore();
    const { d } = deps(store, apiFetch());
    const out = await runCollectJob({ ...input(), html: pageHtml }, d);
    expect(out.status).toBe('completed');
    const key = textKey(store);
    expect(key).toBeDefined();
    expect(store.files.get(key!)).toBe(pageHtml.pageText);
    const n = noticeOf(store);
    expect(n.detailText).toEqual({
      textPath: `${n.folder}/source/text/[상세] 나라장터 상세화면.txt`, capturedAt: pageHtml.capturedAt, chars: pageHtml.pageText.length, truncated: true,
    });
    expect(key!.startsWith(PATH)).toBe(true);
  });

  it('2MB 상한으로 잘리면 truncated를 OR로 합친다', async () => {
    const store = new MemoryStore();
    const { d } = deps(store, apiFetch());
    await runCollectJob({ ...input(), html: { capturedAt: '2026-10-22T00:00:00Z', fields: {}, pageText: 'a'.repeat(2 * 1024 * 1024 + 100) } }, d);
    const n = noticeOf(store);
    expect(n.detailText?.truncated).toBe(true);
    expect(n.detailText!.chars).toBeLessThanOrEqual(2 * 1024 * 1024);
  });

  it('pageText가 없으면 파일도 detailText도 없다', async () => {
    const store = new MemoryStore();
    const { d } = deps(store, apiFetch());
    await runCollectJob({ ...input(), html: { capturedAt: '2026-10-22T00:00:00Z', fields: {} } }, d);
    expect(textKey(store)).toBeUndefined();
    expect(noticeOf(store).detailText).toBeUndefined();
  });

  it('재시도 경로(fetch_basic done)에서도 저장한다', async () => {
    const store = new MemoryStore();
    const ns = new NoticeStore(store);
    const n = emptyNotice('R1-000', { noticeNo: 'R1', round: '000', origin: 'g2b' }, 'notices/2026/R1-000_t', '2026-10-17T00:00:00Z');
    await ns.saveNotice(n);
    const job = mkJob();
    job.noticeId = 'R1-000';
    job.attempt = 2;
    job.steps = job.steps.map((s) => (s.id === 'fetch_html' ? s : { ...s, status: 'done' as const }));
    const { d } = deps(store, vi.fn());
    const out = await runCollectJob({ job, secrets: {}, settings: defaultSettings(), html: { ...pageHtml, pageTextTruncated: undefined } }, d);
    expect(out.status).toBe('completed');
    expect(store.files.get('notices/2026/R1-000_t/source/text/[상세] 나라장터 상세화면.txt')).toBe(pageHtml.pageText);
    expect(noticeOf(store).detailText).toMatchObject({ textPath: 'notices/2026/R1-000_t/source/text/[상세] 나라장터 상세화면.txt', chars: pageHtml.pageText.length });
    expect(noticeOf(store).detailText?.truncated).toBeUndefined();
  });

  it('writeText 실패는 잡 상태를 바꾸지 않는다', async () => {
    const store = new MemoryStore();
    const orig = store.writeText.bind(store);
    store.writeText = async (p: string, t: string) => { if (p.includes('나라장터 상세화면')) throw new Error('disk'); return orig(p, t); };
    const { d } = deps(store, apiFetch());
    const out = await runCollectJob({ ...input(), html: pageHtml }, d);
    expect(out.status).toBe('completed');
    expect(out.error).toBeUndefined();
    expect(textKey(store)).toBeUndefined();
    expect(noticeOf(store).detailText).toBeUndefined();
    expect(noticeOf(store).collect.status).toBe('collected');
  });

  it('재추출(재수집, html 없음) 뒤에도 파일과 필드가 남는다', async () => {
    const parsers = fakeParsers(async () => docOf('본문'));
    const files = { '1. 공고문.txt': 'x' };
    const first = await runCollect({ files, parsers, html: pageHtml });
    const second = await runCollect({ files, parsers, store: first.store, job: mkCollectJob({ id: 'j2' }) });
    expect(second.out.status).not.toBe('failed');
    expect(textKey(second.store)).toBeDefined();
    expect(noticeOf(second.store).detailText?.chars).toBe(pageHtml.pageText.length);
  });
});
