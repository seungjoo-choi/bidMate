import { describe, expect, it } from 'vitest';
import { GMAIL_URL_MAX } from '../../src/adapters/gmail/compose-url';
import { gmailV1 } from '../../src/adapters/gmail/selectors/gmail-v1';
import { naverworksV1 } from '../../src/adapters/naverworks/selectors/naverworks-v1';
import type { ComposeSelectorSet, ComposeState } from '../../src/adapters/naverworks/types';
import { defaultSettings } from '../../src/core/model/default-settings';
import { sampleNotice } from '../../src/core/templates/sample-notice';
import type { ComposeParams, Job, JobProgress } from '../../src/core/types/job';
import { saveGroup, saveRecipient, setDefaultGroup } from '../../src/engine/config/recipients-api';
import { runComposeJob, type ComposeJobDeps } from '../../src/engine/jobs/compose-job';
import { NoticeStore } from '../../src/engine/notices/notice-store';
import { draftFingerprint } from '../../src/core/mail/send-fingerprint';
import { createMailEdits } from '../../src/core/mail/edits';
import { listTemplates } from '../../src/engine/config/templates-api';
import { getDraft, prepareMail } from '../../src/engine/mail/prepare';
import { MemoryStore } from '../helpers/memory-store';

const FOLDER = 'notices/2026/R1-000_가';
// 첨부 전송 경로를 검증하는 테스트용 셋(실제 naverworks-v1은 자동 첨부가 꺼져 있다)
const verifiedSet: ComposeSelectorSet = { ...naverworksV1, status: 'verified', attach: { ...naverworksV1.attach, item: '.att', itemName: '.nm', methods: ['input'] } };

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

/** 주소 채움 경로가 아닌 naverworks 자동 입력 경로(/mail/) 설정. */
const autoSettings = () => { const s = defaultSettings(); s.sites.naverworks.composePath = '/mail/'; return s; };

const job: Job = { id: 'j1', type: 'compose', noticeId: 'R1-000', status: 'running', steps: [], attempt: 1, createdAt: '', updatedAt: '', errors: [] };

type Handler = (payload: any) => unknown;
function harness(mem: MemoryStore, handlers: Record<string, Handler>, extra: Partial<ComposeJobDeps> = {}, settings = defaultSettings(), jobOver: Partial<Job> = {}) {
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
    selectorSets: { 'naverworks-v1': verifiedSet }, sentCount: async () => 0, sleep: async (ms) => { clock += ms; }, now: () => new Date(clock),
    ...extra,
  };
  return { calls, progress, ac, run: () => runComposeJob({ job: { ...job, ...jobOver }, settings }, deps) };
}

const okFields = (p: any) => (['to', 'cc', 'subject', 'body'] as const).map((field) => ({ field, requested: p[field] ?? '', rendered: null, status: 'ok' as const, method: 'm' }));
const okState = async (mem: MemoryStore): Promise<ComposeState> => {
  const d = (await getDraft(mem, 'R1-000'))!;
  return { to: d.to, cc: d.cc, subject: d.subject, bodyText: d.text, bodyHtml: d.html, attachments: [], supported: { to: true, cc: true, subject: true, body: true, attachments: true } };
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
  it('수동 모드: 셀렉터셋이 unverified면 partial/url, 기록, focus (받는 사람/참조/제목은 주소로 전달)', async () => {
    const mem = await setup();
    const h = harness(mem, { 'compose/open': () => ({ tabId: 7 }) }, { selectorSets: { 'naverworks-v1': { ...naverworksV1, status: 'unverified' } } });
    const r = await h.run();
    expect(r.status).toBe('partial');
    expect(r.result?.mode).toBe('url');
    expect(r.result?.outcome).toBe('partial');
    for (const f of r.result!.fields) {
      if (f.field === 'body') expect(f).toMatchObject({ status: 'unsupported', error: 'SELECTOR_UNVERIFIED' });
      else expect(f.status).toBe('prefilled');
    }
    expect(r.result?.fields.map((f) => f.field).sort()).toEqual(['body', 'cc', 'subject', 'to']);
    expect(r.result?.attachments.every((a) => a.status === 'skipped' && a.error === 'ATTACH_MANUAL')).toBe(true);
    expect(h.calls).toEqual(['compose/open', 'compose/focus']);
    expect(h.progress.filter((p) => p.status === 'skipped').map((p) => p.step)).toEqual(['fill_fields', 'attach_files', 'verify', 'send_mail']);
    expect(h.progress.find((p) => p.step === 'fill_fields' && p.status === 'skipped')?.label).toBe('주소로 전달(받는 사람, 참조, 제목), 본문은 붙여 넣기');
    expect(JSON.parse(await mem.readText(`${FOLDER}/mail.json`))).toHaveLength(1);
    expect((await new NoticeStore(mem).loadNotice('R1-000'))?.mail.status).toBe('ready_for_review');
    expect(JSON.stringify(r.result)).not.toContain('<');
  });

  it('정상 경로: 호출 순서와 completed', async () => {
    const mem = await setup();
    const h = harness(mem, autoHandlers(mem), {}, autoSettings());
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

  it('편집이 있는 공고는 params.templateId가 달라도 복사본 제목이 fill.subject에 들어간다', async () => {
    const mem = await setup();
    const tpl = (await listTemplates(mem)).templates.find((t) => t.id === 'tpl_default')!;
    const edits = createMailEdits('R1-000', tpl, new Date('2026-10-18T08:00:00.000Z'));
    edits.template.subject = '편집된 제목';
    await prepareMail(mem, { noticeId: 'R1-000', edits });
    let fillPayload: any;
    const handlers = autoHandlers(mem);
    handlers['compose/fill'] = (p) => { fillPayload = p; return okFields(p); };
    const h = harness(mem, handlers);
    job.params = { templateId: 'tpl_prespec_default' };
    try { await h.run(); } finally { delete job.params; }
    expect(fillPayload.subject).toBe('편집된 제목');
  });
});

describe('runComposeJob 실패 시 compose/focus', () => {
  it('탭을 연 뒤 감지 실패(COMPOSE_NOT_DETECTED)면 compose/focus를 호출한다', async () => {
    const mem = await setup();
    const hs = autoHandlers(mem);
    hs['compose/detect'] = () => ({ frames: [] });
    const h = harness(mem, hs, { detectTimeoutMs: 3000 });
    const r = await h.run();
    expect(r.status).toBe('failed');
    expect(h.calls.at(-1)).toBe('compose/focus');
  });
  it('탭을 연 뒤 fill rpc가 throw해도 compose/focus를 호출한다', async () => {
    const mem = await setup();
    const hs = autoHandlers(mem);
    hs['compose/fill'] = () => { throw Object.assign(new Error('x'), { code: 'INTERNAL' }); };
    const h = harness(mem, hs, {}, autoSettings());
    const r = await h.run();
    expect(r.status).toBe('failed');
    expect(h.calls).toContain('compose/open');
    expect(h.calls.at(-1)).toBe('compose/focus');
  });
  it('compose/focus 자체가 실패해도 무시한다', async () => {
    const mem = await setup();
    const hs = autoHandlers(mem);
    hs['compose/detect'] = () => ({ frames: [] });
    hs['compose/focus'] = () => { throw new Error('boom'); };
    const r = await harness(mem, hs, { detectTimeoutMs: 3000 }).run();
    expect(r.error?.code).toBe('COMPOSE_NOT_DETECTED');
  });
  it('탭 열기 전 실패(render_mail)면 호출하지 않는다', async () => {
    const mem = await setup({ group: false });
    const h = harness(mem, autoHandlers(mem));
    const r = await h.run();
    expect(r.status).toBe('failed');
    expect(h.calls).not.toContain('compose/focus');
  });
  it('COMPOSE_TAB_CLOSED면 호출하지 않는다', async () => {
    const mem = await setup();
    const hs = autoHandlers(mem);
    hs['compose/detect'] = () => { throw Object.assign(new Error('x'), { code: 'COMPOSE_TAB_CLOSED' }); };
    const h = harness(mem, hs);
    const r = await h.run();
    expect(r.error?.code).toBe('COMPOSE_TAB_CLOSED');
    expect(h.calls).not.toContain('compose/focus');
  });
  it('취소(abort)면 compose/abort만 호출하고 focus는 호출하지 않는다', async () => {
    const mem = await setup();
    const hs = autoHandlers(mem);
    const h = harness(mem, hs);
    hs['file/chunk'] = () => { h.ac.abort(); return { received: 1 }; };
    const r = await h.run();
    expect(r.status).toBe('cancelled');
    expect(h.calls).toContain('compose/abort');
    expect(h.calls).not.toContain('compose/focus');
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
    expect(h.progress.filter((p) => p.status === 'skipped').map((p) => p.step)).toEqual(['fill_fields', 'attach_files', 'verify', 'send_mail']);
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

describe('runComposeJob gmail 자동 첨부(테스트 전용 verified 셀렉터셋)', () => {
  const gmailSettings = () => { const s = defaultSettings(); s.mail.provider = 'gmail'; return s; };
  const gmailVerified = (limits?: { perFileBytes?: number; totalBytes?: number }): ComposeSelectorSet => ({
    ...gmailV1, status: 'verified', version: 'test',
    compose: { readySelector: '', scope: '.win' },
    subject: { input: '.subj' },
    body: { kind: 'contenteditable', editable: '.bd', insert: ['innerHTML'] },
    attach: { item: '.att', itemName: '.nm', methods: ['input'], ...(limits ? { limits } : {}) },
  });
  const sets = (limits?: { perFileBytes?: number; totalBytes?: number }) => ({ 'gmail-v1': gmailVerified(limits) });
  const supportedAll = { to: true, cc: true, subject: true, body: true, attachments: true };
  const gmailHandlers = (mem: MemoryStore, supported: ComposeState['supported'] = supportedAll): Record<string, Handler> => ({
    ...autoHandlers(mem),
    'compose/verify': async () => ({ ...(await okState(mem)), supported }),
  });

  it('open에 anchor(제목), fill 미호출, fill_fields skipped, 첨부 호출, 전부 ok면 completed/url', async () => {
    const mem = await setup();
    let openPayload: any;
    const hs = gmailHandlers(mem);
    hs['compose/open'] = (p) => { openPayload = p; return { tabId: 7 }; };
    const h = harness(mem, hs, { selectorSets: sets() }, gmailSettings());
    const r = await h.run();
    const d = (await getDraft(mem, 'R1-000'))!;
    expect(openPayload.anchor).toEqual({ subject: d.subject });
    expect(h.calls).not.toContain('compose/fill');
    expect(h.calls).toContain('compose/attach-begin');
    expect(h.progress.find((p) => p.step === 'fill_fields' && p.status === 'skipped')?.label).toBe('주소로 전달됨, 확인 단계에서 대조');
    expect(r.status).toBe('completed');
    expect(r.result?.mode).toBe('url');
    expect(r.result?.fields.every((f) => f.status === 'ok')).toBe(true);
  });

  it('to, cc가 supported false면 prefilled 유지, partial', async () => {
    const mem = await setup();
    const h = harness(mem, gmailHandlers(mem, { ...supportedAll, to: false, cc: false }), { selectorSets: sets() }, gmailSettings());
    const r = await h.run();
    const st = Object.fromEntries((r.result?.fields ?? []).map((f) => [f.field, f.status]));
    expect(st).toMatchObject({ to: 'prefilled', cc: 'prefilled', subject: 'ok', body: 'ok' });
    expect(r.status).toBe('partial');
  });

  it('perFileBytes 초과는 PROVIDER_FILE_LIMIT로 skipped, 릴레이하지 않는다', async () => {
    const mem = await setup();
    const h = harness(mem, gmailHandlers(mem), { selectorSets: sets({ perFileBytes: 5 }) }, gmailSettings());
    const r = await h.run();
    expect(h.calls).not.toContain('compose/attach-begin');
    expect(r.result?.attachments[0]).toMatchObject({ status: 'skipped', error: 'PROVIDER_FILE_LIMIT' });
    expect(r.status).toBe('partial');
  });

  it('totalBytes 초과는 PROVIDER_TOTAL_LIMIT로 skipped', async () => {
    const mem = await setup();
    const h = harness(mem, gmailHandlers(mem), { selectorSets: sets({ totalBytes: 5 }) }, gmailSettings());
    const r = await h.run();
    expect(r.result?.attachments[0]).toMatchObject({ status: 'skipped', error: 'PROVIDER_TOTAL_LIMIT' });
  });

  it('감지 타임아웃은 30초(deps 값보다 plan 우선)', async () => {
    const mem = await setup();
    const hs = gmailHandlers(mem);
    let detects = 0;
    hs['compose/detect'] = () => { detects++; return { frames: [] }; };
    const r = await harness(mem, hs, { selectorSets: sets(), detectTimeoutMs: 999_000 }, gmailSettings()).run();
    expect(r.error?.code).toBe('COMPOSE_NOT_DETECTED');
    expect(detects).toBeGreaterThanOrEqual(30);
    expect(detects).toBeLessThanOrEqual(32);
  });

  it('마지막 reason이 SCOPE_AMBIGUOUS면 안내 메시지, code 유지', async () => {
    const mem = await setup();
    const hs = gmailHandlers(mem);
    hs['compose/detect'] = () => ({ frames: [{ frameId: 0, injected: true, isCompose: true, ready: false, reason: 'SCOPE_AMBIGUOUS' }] });
    const r = await harness(mem, hs, { selectorSets: sets() }, gmailSettings()).run();
    expect(r.error?.code).toBe('COMPOSE_NOT_DETECTED');
    expect(r.error?.message).toBe('같은 제목의 작성 창이 여러 개라 하나로 특정하지 못했습니다. 다른 작성 창을 닫고 다시 시도하세요');
  });
});

describe('runComposeJob naverworks 페이로드 불변', () => {
  it('open에 anchor가 없고 fill에 fields가 없다', async () => {
    const mem = await setup();
    const payloads: Record<string, any> = {};
    const hs = autoHandlers(mem);
    for (const t of ['compose/open', 'compose/fill'] as const) {
      const orig = hs[t]!;
      hs[t] = (p) => { payloads[t] = p; return orig(p); };
    }
    const r = await harness(mem, hs, {}, autoSettings()).run();
    expect(r.status).toBe('completed');
    expect('anchor' in payloads['compose/open']).toBe(false);
    expect('fields' in payloads['compose/fill']).toBe(false);
  });
});

describe('runComposeJob url 본문 길이 비교', () => {
  it('bodyText가 줄바꿈 없이 이어진 텍스트여도 body ok', async () => {
    const mem = await setup();
    const s = defaultSettings();
    s.mail.provider = 'gmail';
    const set: ComposeSelectorSet = {
      ...gmailV1, status: 'verified', version: 'test', compose: { readySelector: '', scope: '.win' },
      subject: { input: '.subj' }, body: { kind: 'contenteditable', editable: '.bd', insert: ['innerHTML'] },
      attach: { item: '.att', itemName: '.nm', methods: ['input'] },
    };
    const hs = autoHandlers(mem);
    hs['compose/verify'] = async () => {
      const st = await okState(mem);
      return { ...st, bodyText: st.bodyText.replace(/\n+/g, ''), supported: { to: true, cc: true, subject: true, body: true, attachments: true } };
    };
    const r = await harness(mem, hs, { selectorSets: { 'gmail-v1': set } }, s).run();
    expect(r.result?.fields.find((f) => f.field === 'body')?.status).toBe('ok');
  });
});

describe('runComposeJob naverworks 자동 첨부 꺼진 셋과 서명 유지', () => {
  it('attach.methods가 비면 첨부를 전송하지 않고 ATTACH_MANUAL로 skipped, 단계는 첨부는 직접', async () => {
    const mem = await setup();
    const noAttach: ComposeSelectorSet = { ...naverworksV1, attach: { ...naverworksV1.attach, methods: [] } };
    const h = harness(mem, autoHandlers(mem), { selectorSets: { 'naverworks-v1': noAttach } });
    const r = await h.run();
    for (const c of ['compose/attach-begin', 'file/chunk', 'file/end', 'compose/attach-status']) expect(h.calls).not.toContain(c);
    expect(r.result?.attachments.length).toBeGreaterThan(0);
    expect(r.result?.attachments.every((a) => a.status === 'skipped' && a.error === 'ATTACH_MANUAL')).toBe(true);
    expect(h.progress.find((p) => p.step === 'attach_files' && p.status === 'skipped')?.label).toBe('첨부는 직접');
    expect(r.result?.mode).toBe('url');
  });
  it('attach.methods가 있는 셋은 기존처럼 전송한다', async () => {
    const mem = await setup();
    const h = harness(mem, autoHandlers(mem));
    const r = await h.run();
    expect(h.calls).toContain('compose/attach-begin');
    expect(h.calls).toContain('file/chunk');
    expect(r.result?.attachments[0]?.status).toBe('uploaded');
  });
  it('setBody가 mismatch/KEEP_LOST면 verify 상태가 본문을 담고 있어도 유지된다', async () => {
    const mem = await setup();
    const hs = autoHandlers(mem);
    hs['compose/fill'] = (p) => okFields(p).map((f) => f.field === 'body' ? { ...f, status: 'mismatch' as const, error: 'KEEP_LOST' } : f);
    const r = await harness(mem, hs).run();
    const body = r.result?.fields.find((f) => f.field === 'body');
    expect(body).toMatchObject({ status: 'mismatch', error: 'KEEP_LOST' });
    expect(r.status).toBe('partial');
  });
});

describe('runComposeJob autoSend', () => {
  const sendCalls = ['compose/send-click', 'compose/send-status', 'compose/close-tab'];
  async function autoSendParams(mem: MemoryStore, over: Partial<NonNullable<ComposeParams['autoSend']>> = {}): Promise<ComposeParams> {
    const fingerprint = draftFingerprint((await prepareMail(mem, { noticeId: 'R1-000' })).draft);
    return { autoSend: { expectSentCount: 0, fingerprint, confirmedAt: '2026-10-18T09:00:00.000Z', ...over } };
  }
  const baseHandlers = (mem: MemoryStore, extra: Record<string, Handler> = {}): Record<string, Handler> => ({
    ...autoHandlers(mem), 'compose/verify': async () => ({ ...(await okState(mem)), attachments: [{ name: '공고문.hwp', uploading: false }] }), 'compose/send-click': () => ({ clicked: true }), 'compose/send-status': () => ({ tabAlive: true, clicked: true, confirmed: true, confirmation: 'ui_gone' }),
    'compose/close-tab': () => ({ closed: true }), ...extra,
  });
  const notCalled = (calls: string[]) => { for (const c of sendCalls) expect(calls).not.toContain(c); };

  it('가드 사유별로 skipped이고 send-click을 호출하지 않으며 focus한다', async () => {
    const cases: Array<{ reason: string; over: (mem: MemoryStore) => Promise<{ params?: ComposeParams; jobOver?: Partial<Job>; extra?: Partial<ComposeJobDeps>; handlers?: Record<string, Handler> }> }> = [
      { reason: 'NOT_SUPPORTED', over: async () => ({ extra: { selectorSets: { 'naverworks-v1': { ...verifiedSet, autoSend: undefined } } } }) },
      { reason: 'RETRY_ATTEMPT', over: async () => ({ jobOver: { attempt: 2 } }) },
      { reason: 'AUTO_JOB', over: async () => ({ jobOver: { auto: { collectJobId: 'c1' } } }) },
      { reason: 'FIELDS_NOT_OK', over: async (mem) => ({ handlers: { 'compose/verify': async () => ({ ...(await okState(mem)), to: ['other@x.com'], attachments: [{ name: '공고문.hwp', uploading: false }] }) } }) },
      { reason: 'ATTACH_NOT_OK', over: async () => ({ handlers: { 'compose/attach-status': (p: any) => ({ done: true, result: { ...attachDone(p).result, status: 'failed' } }) } }) },
      { reason: 'FINGERPRINT_MISMATCH', over: async (mem) => ({ params: await autoSendParams(mem, { fingerprint: 'deadbeef' }) }) },
      { reason: 'SENT_COUNT_CHANGED', over: async () => ({ extra: { sentCount: async () => 1 } }) },
    ];
    for (const c of cases) {
      const mem = await setup();
      const o = await c.over(mem);
      const params = o.params ?? await autoSendParams(mem);
      const h = harness(mem, baseHandlers(mem, o.handlers), o.extra, autoSettings(), { params, ...o.jobOver });
      const r = await h.run();
      expect(r.result?.send, c.reason).toMatchObject({ state: 'skipped', reason: c.reason });
      expect(r.status, c.reason).toBe('partial');
      notCalled(h.calls);
      expect(h.calls.at(-1), c.reason).toBe('compose/focus');
    }
  });

  it('클릭 성공 후 confirmed면 close-tab을 호출하고 focus하지 않는다, 기록이 send-click보다 먼저', async () => {
    const mem = await setup();
    let recordedBeforeClick = false;
    const h = harness(mem, baseHandlers(mem, {
      'compose/send-click': async (p) => { recordedBeforeClick = (await mem.readText(`${FOLDER}/mail.json`)).includes('j1-1') && p.composeRecordId === 'j1-1'; return { clicked: true }; },
    }), {}, autoSettings(), { params: await autoSendParams(mem) });
    const r = await h.run();
    expect(recordedBeforeClick).toBe(true);
    expect(r.status).toBe('completed');
    expect(r.result?.send).toMatchObject({ state: 'sent', confirmation: 'ui_gone', tabClosed: true });
    expect(h.calls.slice(-3)).toEqual(['compose/send-click', 'compose/send-status', 'compose/close-tab']);
    expect(h.calls).not.toContain('compose/focus');
  });

  it('탭이 사라지고 confirmed(onRemoved 경로)면 sent이고 close-tab을 호출하지 않는다', async () => {
    const mem = await setup();
    const h = harness(mem, baseHandlers(mem, { 'compose/send-status': () => ({ tabAlive: false, clicked: true, confirmed: true, confirmation: 'unload' }) }), {}, autoSettings(), { params: await autoSendParams(mem) });
    const r = await h.run();
    expect(r.result?.send).toMatchObject({ state: 'sent', confirmation: 'unload' });
    expect(h.calls).not.toContain('compose/close-tab');
    expect(h.calls).not.toContain('compose/focus');
  });

  it('확인 시간 초과면 unconfirmed, partial, focus', async () => {
    const mem = await setup();
    const h = harness(mem, baseHandlers(mem, { 'compose/send-status': () => ({ tabAlive: true, clicked: true, confirmed: false }) }), {}, autoSettings(), { params: await autoSendParams(mem) });
    const r = await h.run();
    expect(r.status).toBe('partial');
    expect(r.result?.send?.state).toBe('unconfirmed');
    expect(h.calls.filter((c) => c === 'compose/focus')).toHaveLength(1);
    expect(h.calls.at(-1)).toBe('compose/focus');
    expect(h.calls.indexOf('compose/focus')).toBeGreaterThan(h.calls.lastIndexOf('compose/send-status'));
  });

  it('send-click rpc 오류면 unknown이고 재호출하지 않는다', async () => {
    const mem = await setup();
    const h = harness(mem, baseHandlers(mem, { 'compose/send-click': () => { throw new Error('timeout'); } }), {}, autoSettings(), { params: await autoSendParams(mem) });
    const r = await h.run();
    expect(r.result?.send?.state).toBe('unknown');
    expect(r.status).toBe('partial');
    expect(h.calls.filter((c) => c === 'compose/send-click')).toHaveLength(1);
    expect(h.calls).not.toContain('compose/send-status');
    expect(h.calls.at(-1)).toBe('compose/focus');
  });

  it('send-click이 clicked false면 reason으로 skipped, focus', async () => {
    const mem = await setup();
    const h = harness(mem, baseHandlers(mem, { 'compose/send-click': () => ({ clicked: false, reason: 'BUTTON_DISABLED' }) }), {}, autoSettings(), { params: await autoSendParams(mem) });
    const r = await h.run();
    expect(r.result?.send).toMatchObject({ state: 'skipped', reason: 'BUTTON_DISABLED' });
    expect(h.calls.at(-1)).toBe('compose/focus');
  });

  it('send-click 응답 전에 abort돼도 결과는 sent이고 cancelled가 아니다', async () => {
    const mem = await setup();
    const h = harness(mem, baseHandlers(mem, { 'compose/send-click': () => { h.ac.abort(); return { clicked: true }; } }), {}, autoSettings(), { params: await autoSendParams(mem) });
    const r = await h.run();
    expect(r.status).not.toBe('cancelled');
    expect(r.result?.send).toMatchObject({ state: 'sent', confirmation: 'ui_gone' });
  });

  it('클릭 전(가드 단계)에 abort되면 send-click을 호출하지 않는다', async () => {
    const mem = await setup();
    const h = harness(mem, baseHandlers(mem), { sentCount: async () => { h.ac.abort(); return 0; } }, autoSettings(), { params: await autoSendParams(mem) });
    const r = await h.run();
    expect(r.status).toBe('cancelled');
    expect(h.calls).not.toContain('compose/send-click');
  });

  describe('수신자 칩 대조(gmail verified 셋, to/cc는 prefilled)', () => {
    const gmailSet = (chip: boolean): ComposeSelectorSet => ({
      ...gmailV1, status: 'verified', version: 'test', compose: { readySelector: '', scope: '.win' }, subject: { input: '.subj' },
      body: { kind: 'contenteditable', editable: '.bd', insert: ['innerHTML'] }, attach: { item: '.att', itemName: '.nm', methods: ['input'] },
      autoSend: { button: 'button.send', ...(chip ? { recipientLists: { list: '.l', chip: '.c' } } : {}) },
    });
    const gSettings = () => { const s = defaultSettings(); s.mail.provider = 'gmail'; return s; };
    const gHandlers = (mem: MemoryStore, extra: Record<string, Handler> = {}): Record<string, Handler> => baseHandlers(mem, {
      'compose/verify': async () => ({ ...(await okState(mem)), attachments: [{ name: '공고문.hwp', uploading: false }], supported: { to: false, cc: false, subject: true, body: true, attachments: true } }),
      ...extra,
    });

    it('recipientLists가 있으면 prefilled to/cc여도 send-click을 호출하고 payload에 to/cc가 들어간다, 확인되면 completed', async () => {
      const mem = await setup();
      let payload: any;
      const h = harness(mem, gHandlers(mem, { 'compose/send-click': (p) => { payload = p; return { clicked: true }; } }), { selectorSets: { 'gmail-v1': gmailSet(true) } }, gSettings(), { params: await autoSendParams(mem) });
      const r = await h.run();
      const d = (await getDraft(mem, 'R1-000'))!;
      expect(payload).toMatchObject({ to: d.to, cc: d.cc });
      expect(r.result?.outcome).toBe('partial');
      expect(r.result?.send).toMatchObject({ state: 'sent' });
      expect(r.status).toBe('completed');
    });
    it('recipientLists가 없으면 FIELDS_NOT_OK로 skipped', async () => {
      const mem = await setup();
      const h = harness(mem, gHandlers(mem), { selectorSets: { 'gmail-v1': gmailSet(false) } }, gSettings(), { params: await autoSendParams(mem) });
      const r = await h.run();
      expect(r.result?.send).toMatchObject({ state: 'skipped', reason: 'FIELDS_NOT_OK' });
      expect(h.calls).not.toContain('compose/send-click');
    });
  });

  it('autoSend 없는 잡은 send 필드 없이 기존 결과와 같다', async () => {
    const mem = await setup();
    const h = harness(mem, autoHandlers(mem), {}, autoSettings());
    const r = await h.run();
    expect(r.status).toBe('completed');
    expect(r.result?.send).toBeUndefined();
    expect(h.calls.at(-1)).toBe('compose/focus');
    notCalled(h.calls);
    expect(h.progress.find((p) => p.step === 'send_mail')?.status).toBe('skipped');
  });
});
