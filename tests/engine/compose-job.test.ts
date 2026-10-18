import { describe, expect, it } from 'vitest';
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
