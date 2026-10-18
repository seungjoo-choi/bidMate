import { describe, expect, it } from 'vitest';
import { GMAIL_URL_MAX } from '../../src/adapters/gmail/compose-url';
import { gmailV1 } from '../../src/adapters/gmail/selectors/gmail-v1';
import { naverworksV1 } from '../../src/adapters/naverworks/selectors/naverworks-v1';
import type { ComposeSelectorSet, ComposeState } from '../../src/adapters/naverworks/types';
import { defaultSettings } from '../../src/core/model/default-settings';
import { sampleNotice } from '../../src/core/templates/sample-notice';
import type { Job, JobProgress } from '../../src/core/types/job';
import { saveGroup, saveRecipient, setDefaultGroup } from '../../src/engine/config/recipients-api';
import { runComposeJob, type ComposeJobDeps } from '../../src/engine/jobs/compose-job';
import { NoticeStore } from '../../src/engine/notices/notice-store';
import { getDraft } from '../../src/engine/mail/prepare';
import { MemoryStore } from '../helpers/memory-store';

const FOLDER = 'notices/2026/R1-000_가';
const verifiedSet: ComposeSelectorSet = { ...naverworksV1, status: 'verified' };

async function setup(opts: { group?: boolean; attachSize?: number } = {}) {
  const mem = new MemoryStore();
  const n = sampleNotice();
  n.id = 'R1-000'; n.folder = FOLDER;
  n.attachments = [{ id: 'a1', index: 0, originalName: '공고문.hwp', savedName: '공고문.hwp', url: '', expectedSize: 10, savedSize: 12, status: 'saved', attempts: 1 }];
  await new NoticeStore(mem).saveNotice(n);
  mem.files.set(`${FOLDER}/attachments/공고문.hwp`, new Uint8Array(opts.attachSize ?? 12));
  if (opts.group !== false) {
    const r1 = (await saveRecipient(mem, { name: '가', email: 'a@x.com', enabled: true, defaultRole: 'to' })).recipients[0]!.id;
    const gid = (await saveGroup(mem, { name: '팀', memberIds: [r1] })).groups[0]!.id;
    await setDefaultGroup(mem, gid);
  }
  return mem;
}

const job: Job = { id: 'j1', type: 'compose', noticeId: 'R1-000', status: 'running', steps: [], attempt: 1, createdAt: '', updatedAt: '', errors: [] };

type Handler = (payload: any) => unknown;
function harness(mem: MemoryStore, handlers: Record<string, Handler>, extra: Partial<ComposeJobDeps> = {}, settings = defaultSettings()) {
  const calls: string[] = [];
  const progress: JobProgress[] = [];
  const ac = new AbortController();
  let clock = Date.parse('2026-10-18T09:00:00.000Z');
  const deps: ComposeJobDeps = {
    store: mem, checkPermission: async () => undefined, emit: (p) => progress.push(p), signal: ac.signal,
    call: (async (type: string, payload: unknown) => {
      calls.push(type);
      const h = handlers[type];
      if (!h) return undefined;
      return h(payload);
    }) as ComposeJobDeps['call'],
    selectorSets: { 'naverworks-v1': verifiedSet }, sleep: async (ms) => { clock += ms; }, now: () => new Date(clock),
    ...extra,
  };
  return { calls, progress, ac, run: () => runComposeJob({ job, settings }, deps) };
}

const okFields = (p: any) => (['to', 'cc', 'subject', 'body'] as const).map((field) => ({ field, requested: p[field] ?? '', rendered: null, status: 'ok' as const, method: 'm' }));
const okState = async (mem: MemoryStore): Promise<ComposeState> => {
  const d = (await getDraft(mem, 'R1-000'))!;
  return { to: d.to, cc: d.cc, subject: d.subject, bodyText: d.text, bodyHtml: d.html, attachments: [] };
};
const attachDone = (p: any) => ({ done: true, result: { fileId: p.fileId, name: '공고문.hwp', size: 12, status: 'uploaded', method: 'input', elapsedMs: 5 } });

function autoHandlers(mem: MemoryStore): Record<string, Handler> {
  return {
    'compose/open': () => ({ tabId: 7 }),
    'compose/detect': () => ({ frames: [{ frameId: 3, injected: true, isCompose: true, ready: true }] }),
    'compose/fill': (p) => okFields(p),
    'compose/attach-begin': (p) => ({ accepted: p.files.map((f: any) => f.fileId), rejected: [] }),
    'file/chunk': () => ({ received: 1 }),
    'file/end': () => ({ started: true }),
    'compose/attach-status': attachDone,
    'compose/verify': () => okState(mem),
  };
}

describe('runComposeJob', () => {
  it('수동 모드: 셀렉터셋이 unverified면 partial/manual, 기록, focus', async () => {
    const mem = await setup();
    const h = harness(mem, { 'compose/open': () => ({ tabId: 7 }) }, { selectorSets: { 'naverworks-v1': naverworksV1 } });
    const r = await h.run();
    expect(r.status).toBe('partial');
    expect(r.result?.mode).toBe('manual');
    expect(r.result?.outcome).toBe('partial');
    expect(r.result?.fields.every((f) => f.status === 'unsupported' && f.error === 'SELECTOR_UNVERIFIED')).toBe(true);
    expect(r.result?.attachments.every((a) => a.status === 'skipped')).toBe(true);
    expect(h.calls).toEqual(['compose/open', 'compose/focus']);
    expect(h.progress.filter((p) => p.status === 'skipped').map((p) => p.step)).toEqual(['fill_fields', 'attach_files', 'verify']);
    expect(JSON.parse(await mem.readText(`${FOLDER}/mail.json`))).toHaveLength(1);
    expect((await new NoticeStore(mem).loadNotice('R1-000'))?.mail.status).toBe('ready_for_review');
    expect(JSON.stringify(r.result)).not.toContain('<');
  });

  it('정상 경로: 호출 순서와 completed', async () => {
    const mem = await setup();
    const h = harness(mem, autoHandlers(mem));
    const r = await h.run();
    expect(h.calls).toEqual(['compose/open', 'compose/detect', 'compose/bind', 'compose/fill', 'compose/attach-begin',
      'file/chunk', 'file/end', 'compose/attach-status', 'compose/verify', 'compose/focus']);
    expect(r.status).toBe('completed');
    expect(r.result?.outcome).toBe('ready_for_review');
    expect(r.result?.mode).toBe('auto');
    expect(r.result?.recordId).toBeDefined();
    expect(h.progress.every((p) => p.attempt === 1)).toBe(true);
  });

  it('첨부가 maxFileMB 초과면 skipped이고 릴레이하지 않는다', async () => {
    const mem = await setup();
    const s = defaultSettings();
    s.download.maxFileMB = 0;
    const h = harness(mem, autoHandlers(mem), {}, s);
    const r = await h.run();
    expect(h.calls).not.toContain('compose/attach-begin');
    expect(r.result?.attachments[0]?.status).toBe('skipped');
    expect(r.status).toBe('partial');
  });

  it('업로드가 끝나지 않으면 uploading_timeout, partial', async () => {
    const mem = await setup();
    const hs = autoHandlers(mem);
    hs['compose/attach-status'] = () => ({ done: false, phase: 'uploading', elapsedMs: 1 });
    const r = await harness(mem, hs).run();
    expect(r.status).toBe('partial');
    expect(r.result?.attachments[0]?.status).toBe('uploading_timeout');
  });

  it('감지 타임아웃: failed COMPOSE_NOT_DETECTED', async () => {
    const mem = await setup();
    const hs = autoHandlers(mem);
    hs['compose/detect'] = () => ({ frames: [] });
    const r = await harness(mem, hs, { detectTimeoutMs: 3000 }).run();
    expect(r.status).toBe('failed');
    expect(r.error?.code).toBe('COMPOSE_NOT_DETECTED');
  });

  it('첨부 중 abort: cancelled + compose/abort', async () => {
    const mem = await setup();
    const hs = autoHandlers(mem);
    const h = harness(mem, hs);
    hs['file/chunk'] = () => { h.ac.abort(); return { received: 1 }; };
    const r = await h.run();
    expect(r.status).toBe('cancelled');
    expect(h.calls.at(-1)).toBe('compose/abort');
  });

  it('prepareMail NO_GROUP: failed, step render_mail', async () => {
    const mem = await setup({ group: false });
    const h = harness(mem, autoHandlers(mem));
    const r = await h.run();
    expect(r.status).toBe('failed');
    expect(r.error).toMatchObject({ code: 'NO_GROUP', step: 'render_mail' });
    expect(h.calls).toEqual([]);
  });

  it('감지 호출마다 10초가 걸려도 now 기준으로 120초 근처에서 끝난다', async () => {
    const mem = await setup();
    const hs = autoHandlers(mem);
    let t = 0;
    let detects = 0;
    hs['compose/detect'] = () => { detects++; t += 10_000; return { frames: [] }; };
    const r = await harness(mem, hs, { now: () => new Date(t), sleep: async (ms) => { t += ms; } }).run();
    expect(r.error?.code).toBe('COMPOSE_NOT_DETECTED');
    expect(detects).toBeGreaterThanOrEqual(10);
    expect(detects).toBeLessThanOrEqual(12);
  });

  it('감지 중 일반 오류는 계속 폴링하고 COMPOSE_TAB_CLOSED는 즉시 실패한다', async () => {
    const mem = await setup();
    const hs = autoHandlers(mem);
    let n = 0;
    hs['compose/detect'] = () => {
      if (++n < 3) throw Object.assign(new Error('x'), { code: 'INTERNAL' });
      return { frames: [{ frameId: 1, injected: true, isCompose: true, ready: true }] };
    };
    expect((await harness(mem, hs).run()).status).toBe('completed');
    const hs2 = autoHandlers(mem);
    hs2['compose/detect'] = () => { throw Object.assign(new Error('x'), { code: 'COMPOSE_TAB_CLOSED' }); };
    const r2 = await harness(mem, hs2).run();
    expect(r2.status).toBe('failed');
    expect(r2.error?.code).toBe('COMPOSE_TAB_CLOSED');
  });

  it('청크 전송이 throw하면 그 파일만 failed, 다음 파일은 계속하고 partial로 기록한다', async () => {
    const mem = await setup();
    const n = await new NoticeStore(mem).loadNotice('R1-000');
    n!.attachments.push({ id: 'a2', index: 1, originalName: '둘.pdf', savedName: '둘.pdf', url: '', expectedSize: 4, savedSize: 4, status: 'saved', attempts: 1 });
    await new NoticeStore(mem).saveNotice(n!);
    mem.files.set(`${FOLDER}/attachments/둘.pdf`, new Uint8Array(4));
    const hs = autoHandlers(mem);
    hs['file/chunk'] = (p) => {
      if (p.fileId === 'a1') throw Object.assign(new Error('t'), { code: 'TIMEOUT' });
      return { received: 1 };
    };
    hs['compose/attach-status'] = (p) => ({ done: true, result: { fileId: p.fileId, name: '둘.pdf', size: 4, status: 'uploaded', method: 'input', elapsedMs: 1 } });
    const h = harness(mem, hs);
    const r = await h.run();
    expect(r.status).toBe('partial');
    expect(r.result?.attachments.map((a) => [a.fileId, a.status, a.error])).toEqual([['a1', 'failed', 'TIMEOUT'], ['a2', 'uploaded', undefined]]);
    expect(r.result?.recordId).toBeDefined();
    expect(h.calls.at(-1)).toBe('compose/focus');
    expect((await new NoticeStore(mem).loadNotice('R1-000'))?.mail.status).toBe('ready_for_review');
  });

  it('params.recipients를 prepareMail에 전달한다', async () => {
    const mem = await setup();
    const rid = (await saveRecipient(mem, { name: '다', email: 'c@x.com', enabled: true, defaultRole: 'to' })).recipients[1]!.id;
    const h = harness(mem, { 'compose/open': () => ({ tabId: 7 }) }, { selectorSets: { 'naverworks-v1': naverworksV1 } });
    job.params = { recipients: [{ recipientId: rid, role: 'cc' }] };
    try { await h.run(); } finally { delete job.params; }
    const d = (await getDraft(mem, 'R1-000'))!;
    expect(d.cc).toEqual(['c@x.com']);
    expect(d.to).toEqual([]);
    expect(d.recipientSource).toBe('custom');
    expect(d.groupId).toBeUndefined();
  });
});

describe('runComposeJob gmail 주소 방식', () => {
  const gmailSettings = () => { const s = defaultSettings(); s.mail.provider = 'gmail'; return s; };
  const gmailSets = { 'gmail-v1': gmailV1 };

  it('open url, selector 없음, detect/fill 미호출, prefilled, partial, mode url, provider gmail', async () => {
    const mem = await setup();
    let openPayload: any;
    const h = harness(mem, { 'compose/open': (p) => { openPayload = p; return { tabId: 7 }; } }, { selectorSets: gmailSets }, gmailSettings());
    const r = await h.run();
    expect(openPayload.url.startsWith('https://mail.google.com/mail/u/0/?fs=1&tf=cm')).toBe(true);
    expect(openPayload.selector).toBeUndefined();
    expect(h.calls).toEqual(['compose/open', 'compose/focus']);
    expect(r.status).toBe('partial');
    expect(r.result?.mode).toBe('url');
    expect(r.result?.provider).toBe('gmail');
    expect(r.result?.outcome).toBe('partial');
    expect(r.result?.fields.map((f) => [f.field, f.status, f.method])).toEqual([
      ['to', 'prefilled', 'url'], ['cc', 'prefilled', 'url'], ['subject', 'prefilled', 'url'], ['body', 'prefilled', 'url'],
    ]);
    expect(r.result?.attachments.every((a) => a.status === 'skipped' && a.error === 'ATTACH_MANUAL')).toBe(true);
    expect(h.progress.filter((p) => p.status === 'skipped').map((p) => p.step)).toEqual(['fill_fields', 'attach_files', 'verify']);
    expect(JSON.stringify(r.result)).not.toContain('mail.google.com');
  });

  it('기록: adapterId gmail, selectorSetVersion none, ready_for_review 상태', async () => {
    const mem = await setup();
    await harness(mem, { 'compose/open': () => ({ tabId: 7 }) }, { selectorSets: gmailSets }, gmailSettings()).run();
    const rec = JSON.parse(await mem.readText(`${FOLDER}/mail.json`))[0];
    expect(rec.adapterId).toBe('gmail');
    expect(rec.selectorSetVersion).toBe('none');
    expect(rec.webmailUrl).toContain('mail.google.com');
    expect((await new NoticeStore(mem).loadNotice('R1-000'))?.mail.status).toBe('ready_for_review');
  });

  it('긴 본문이면 body는 URL_TOO_LONG, mode url 유지', async () => {
    const mem = await setup();
    const store = new NoticeStore(mem);
    const n = (await store.loadNotice('R1-000'))!;
    // 사업기간은 본문에만 렌더되고 제목, 받는 사람, 참조에는 나오지 않는다. 본문을 빼면 주소가 한도 안에 들어온다.
    n.basic.projectPeriod.value = '가'.repeat(3000);
    await store.saveNotice(n);
    let openUrl = '';
    const h = harness(mem, { 'compose/open': (p) => { openUrl = p.url; return { tabId: 7 }; } }, { selectorSets: gmailSets }, gmailSettings());
    const r = await h.run();
    expect(openUrl.length).toBeLessThanOrEqual(GMAIL_URL_MAX);
    expect(openUrl).not.toContain('&body=');
    expect(r.result?.fields.filter((f) => f.field !== 'body').map((f) => f.status)).toEqual(['prefilled', 'prefilled', 'prefilled']);
    const body = r.result?.fields.find((f) => f.field === 'body');
    expect(body).toMatchObject({ status: 'unsupported', method: 'none', error: 'URL_TOO_LONG' });
    expect(r.result?.mode).toBe('url');
  });
});
