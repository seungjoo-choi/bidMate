import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addFinalListener, assertCancelAllowed, assertRetryAllowed, cancelJob, clearFinalListeners, latestJobForSender, registerCoordinator, setHandoff, getJob, getJobForSender, listJobs, listJobsForTab, originTabIdFor, senderKind, onFinish, onProgress, reconcile, setComposeTab, setCoordinatorDeps, startJob, type KV,
} from '../../src/background/job-coordinator';
import type { Job } from '../../src/core/types/job';

class MemKV implements KV {
  data: Record<string, unknown> = {};
  async get(keys: string | string[] | null) {
    if (keys === null) return { ...this.data };
    const ks = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(ks.filter((k) => k in this.data).map((k) => [k, this.data[k]]));
  }
  async set(items: Record<string, unknown>) { Object.assign(this.data, items); }
  async remove(keys: string[]) { for (const k of keys) delete this.data[k]; }
}

let session: MemKV;
const offscreen = { ensure: vi.fn(async () => undefined), has: vi.fn(async () => true), close: vi.fn(async () => undefined) };
let sendImpl: (type: string, payload: unknown) => Promise<unknown>;

const seed = async (id: string, status: Job['status'], attempt = 1, noticeNo = id): Promise<void> => {
  const job: Job = {
    id, type: 'collect', noticeId: `${noticeNo}-000`, ref: { noticeNo, origin: 'g2b' }, status,
    steps: [{ id: 'fetch_basic', status: 'pending' }], attempt, createdAt: 't', updatedAt: 't', errors: [],
  };
  const ids = ((session.data.jobIds as string[] | undefined) ?? []).concat(id);
  await session.set({ [`jobs.${id}`]: job, jobIds: ids });
};
const status = async (id: string) => (await getJob(id))?.status;
const progress = (jobId: string, attempt: number, label = 'L') => ({ jobId, attempt, step: 'fetch_basic' as const, status: 'running' as const, label });

beforeEach(() => {
  session = new MemKV();
  offscreen.ensure.mockClear(); offscreen.close.mockClear();
  offscreen.has.mockImplementation(async () => true);
  sendImpl = async () => { throw new Error('unexpected'); };
  setCoordinatorDeps({
    storage: { session, local: new MemKV() },
    send: ((type: string, payload: unknown) => sendImpl(type, payload)) as never,
    offscreen,
  });
});

describe('progress / finish 수용 규칙', () => {
  it('attempt 불일치 progress/finish는 무시', async () => {
    await seed('a', 'running', 2);
    await onProgress(progress('a', 1, '옛날'));
    expect((await getJob('a'))?.label).toBeUndefined();
    await onFinish({ jobId: 'a', attempt: 1, status: 'failed' });
    expect(await status('a')).toBe('running');
  });
  it('FINAL 상태에는 finish를 무시', async () => {
    await seed('a', 'completed');
    await onFinish({ jobId: 'a', attempt: 1, status: 'failed' });
    expect(await status('a')).toBe('completed');
  });
  it('interrupted는 attempt가 일치하는 finish만 수용', async () => {
    await seed('a', 'interrupted', 2);
    await onFinish({ jobId: 'a', attempt: 1, status: 'completed' });
    expect(await status('a')).toBe('interrupted');
    await onFinish({ jobId: 'a', attempt: 2, status: 'completed' });
    expect(await status('a')).toBe('completed');
  });
  it('cancelling 중 progress는 running으로 되돌리지 않고, finish completed는 그대로 채택', async () => {
    await seed('a', 'cancelling');
    await onProgress(progress('a', 1, '진행'));
    expect(await status('a')).toBe('cancelling');
    expect((await getJob('a'))?.label).toBe('진행');
    await onFinish({ jobId: 'a', attempt: 1, status: 'completed' });
    expect(await status('a')).toBe('completed');
  });
});

describe('startJob', () => {
  const req = { type: 'collect' as const, ref: { noticeNo: 'X', origin: 'g2b' as const } };
  it('accepted:false → ledger에 잡이 남지 않고 JOB_ALREADY_RUNNING + conflictJobId', async () => {
    sendImpl = async () => ({ accepted: false, code: 'JOB_ALREADY_RUNNING', conflictJobId: 'other', active: [{ jobId: 'other', attempt: 1 }] });
    const r = await startJob(req);
    expect(r).toEqual({ jobId: 'other', code: 'JOB_ALREADY_RUNNING' });
    expect(await listJobs()).toHaveLength(0);
  });
  it('accepted:true, active:[]인데 ledger에 다른 running이 있으면 그 잡은 interrupted', async () => {
    await seed('old', 'running');
    sendImpl = async () => ({ accepted: true, active: [] });
    const r = await startJob(req);
    expect(r.code).toBeUndefined();
    expect(await status('old')).toBe('interrupted');
    expect(await status(r.jobId)).toBe('running');
  });
  it('job/run 전송 실패 → failed(OFFSCREEN_ERROR)', async () => {
    sendImpl = async () => { throw new Error('boom'); };
    const r = await startJob(req);
    const j = await getJob(r.jobId);
    expect(j?.status).toBe('failed');
    expect(j?.errors[0]?.code).toBe('OFFSCREEN_ERROR');
  });
});

describe('reconcile', () => {
  it('offscreen 없음 → ACTIVE 전부 interrupted', async () => {
    await seed('a', 'running'); await seed('b', 'queued'); await seed('c', 'completed');
    offscreen.has.mockImplementation(async () => false);
    await reconcile();
    expect([await status('a'), await status('b'), await status('c')]).toEqual(['interrupted', 'interrupted', 'completed']);
  });
  it('일부만 활성이면 나머지만 interrupted', async () => {
    await seed('a', 'running'); await seed('b', 'running');
    sendImpl = async () => ({ active: [{ jobId: 'a', attempt: 1 }] });
    await reconcile();
    expect([await status('a'), await status('b')]).toEqual(['running', 'interrupted']);
  });
  it('질의 실패 → 변화 없음', async () => {
    await seed('a', 'running');
    sendImpl = async () => { throw new Error('x'); };
    await reconcile();
    expect(await status('a')).toBe('running');
  });
});

describe('cancelJob', () => {
  it('known:false → cancelled', async () => {
    await seed('a', 'running');
    sendImpl = async () => ({ known: false });
    expect(await cancelJob('a')).toEqual({ status: 'cancelled' });
    expect(await status('a')).toBe('cancelled');
  });
  it('known:true → cancelling', async () => {
    await seed('a', 'running');
    sendImpl = async () => ({ known: true });
    expect(await cancelJob('a')).toEqual({ status: 'cancelling' });
    expect(await status('a')).toBe('cancelling');
  });
  it('offscreen 없음 → cancelled', async () => {
    await seed('a', 'queued');
    offscreen.has.mockImplementation(async () => false);
    expect((await cancelJob('a')).status).toBe('cancelled');
  });
  it('종결된 잡은 no-op', async () => {
    await seed('a', 'completed');
    expect(await cancelJob('a')).toEqual({ status: 'completed' });
  });
  it('force → closeDocument, 대상 cancelled, 나머지 ACTIVE는 interrupted', async () => {
    await seed('a', 'cancelling'); await seed('b', 'running');
    expect(await cancelJob('a', true)).toEqual({ status: 'cancelled' });
    expect(offscreen.close).toHaveBeenCalledTimes(1);
    expect([await status('a'), await status('b')]).toEqual(['cancelled', 'interrupted']);
  });
});

describe('cancelJob force 보강', () => {
  it('offscreen이 없으면 closeDocument를 호출하지 않고 cancelled', async () => {
    await seed('a', 'cancelling');
    offscreen.has.mockImplementation(async () => false);
    expect(await cancelJob('a', true)).toEqual({ status: 'cancelled' });
    expect(offscreen.close).not.toHaveBeenCalled();
    expect(await status('a')).toBe('cancelled');
  });
  it('close가 reject돼도 cancelled, 나머지 ACTIVE는 interrupted', async () => {
    await seed('a', 'cancelling'); await seed('b', 'queued');
    offscreen.close.mockImplementationOnce(async () => { throw new Error('close 실패'); });
    expect(await cancelJob('a', true)).toEqual({ status: 'cancelled' });
    expect([await status('a'), await status('b')]).toEqual(['cancelled', 'interrupted']);
  });
  it('cancelling이 아닌 잡에 force를 주면 일반 취소 경로(job/abort)로 처리', async () => {
    await seed('a', 'running');
    const calls: string[] = [];
    sendImpl = async (type) => { calls.push(type); return { known: true }; };
    expect(await cancelJob('a', true)).toEqual({ status: 'cancelling' });
    expect(calls).toEqual(['job/abort']);
    expect(offscreen.close).not.toHaveBeenCalled();
  });
});

describe('ledger 정리', () => {
  it('MAX_JOBS 초과 시 ACTIVE 잡은 지우지 않고 오래된 종결 잡부터 지운다', async () => {
    await seed('active', 'running');          // 가장 오래됐지만 ACTIVE
    for (let i = 0; i < 19; i++) await seed(`done${i}`, 'completed');
    sendImpl = async () => ({ accepted: true, active: [{ jobId: 'active', attempt: 1 }] });
    const r = await startJob({ type: 'collect', ref: { noticeNo: 'NEW', origin: 'g2b' } });
    const ids = (await listJobs()).map((j) => j.id);
    expect(ids).toHaveLength(20);
    expect(ids).toContain('active');
    expect(ids).toContain(r.jobId);
    expect(ids).not.toContain('done0');
  });
});


describe('발신자 검증', () => {
  const RID = 'extid';
  const ext = { id: RID, url: `chrome-extension://${RID}/dashboard.html` };
  const g2b = (tabId: number) => ({ tab: { id: tabId } as chrome.tabs.Tab, url: 'https://www.g2b.go.kr/' });
  const unknown = { tab: { id: 9 } as chrome.tabs.Tab, url: 'https://evil.example/' };
  const setTab = (id: string, tabId?: number) => { (session.data[`jobs.${id}`] as Job).originTabId = tabId; };
  beforeEach(() => { vi.stubGlobal('chrome', { runtime: { id: RID } }); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('확장 페이지는 ref 없이 retryOf 가능', async () => {
    await seed('a', 'failed'); setTab('a', 5);
    await expect(assertRetryAllowed({ type: 'collect', retryOf: 'a' }, ext)).resolves.toBeUndefined();
  });
  it('g2b 탭이 다른 탭의 잡을 retryOf하면 거부', async () => {
    await seed('a', 'failed'); setTab('a', 5);
    const req = { type: 'collect' as const, retryOf: 'a', ref: { noticeNo: 'a', origin: 'g2b' as const } };
    await expect(assertRetryAllowed(req, g2b(6))).rejects.toMatchObject({ code: 'JOB_RETRY_FORBIDDEN' });
    await expect(assertRetryAllowed(req, g2b(5))).resolves.toBeUndefined();
  });
  it('g2b 탭의 job/cancel: 자기 잡 허용, 남의 잡 거부', async () => {
    await seed('a', 'running'); setTab('a', 5);
    await expect(assertCancelAllowed('a', g2b(5))).resolves.toBeUndefined();
    await expect(assertCancelAllowed('a', g2b(6))).rejects.toMatchObject({ code: 'JOB_CANCEL_FORBIDDEN' });
  });
  it('unknown 발신자는 거부', async () => {
    await seed('a', 'running');
    await expect(assertRetryAllowed({ type: 'collect', retryOf: 'a' }, unknown)).rejects.toMatchObject({ code: 'SENDER_FORBIDDEN' });
    await expect(assertCancelAllowed('a', unknown)).rejects.toMatchObject({ code: 'SENDER_FORBIDDEN' });
  });
});

describe('compose 잡', () => {
  const RID = 'extid';
  const ext = { id: RID, url: `chrome-extension://${RID}/dashboard.html` };
  const g2b = { tab: { id: 5 } as chrome.tabs.Tab, url: 'https://www.g2b.go.kr/' };
  beforeEach(() => { vi.stubGlobal('chrome', { runtime: { id: RID } }); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('ref 없이 noticeId만으로 시작하고 compose steps 5개를 만든다', async () => {
    sendImpl = async () => ({ accepted: true, active: [] });
    const r = await startJob({ type: 'compose', noticeId: 'N-000' });
    const j = await getJob(r.jobId);
    expect(j?.type).toBe('compose');
    expect(j?.steps.map((s) => s.id)).toEqual(['render_mail', 'open_compose', 'fill_fields', 'attach_files', 'verify']);
  });
  it('retryOf는 done step도 전부 pending으로 초기화하고 이전 탭 정보를 지운다', async () => {
    const prev: Job = {
      id: 'c1', type: 'compose', noticeId: 'N-000', status: 'failed', attempt: 1, createdAt: 't', updatedAt: 't', errors: [],
      steps: [{ id: 'render_mail', status: 'done' }, { id: 'open_compose', status: 'failed' }], composeTabId: 7, composeFrameId: 2,
    };
    await session.set({ 'jobs.c1': prev, jobIds: ['c1'] });
    sendImpl = async () => ({ accepted: true, active: [] });
    await startJob({ type: 'compose', noticeId: 'N-000', retryOf: 'c1' });
    const j = await getJob('c1');
    expect(j?.steps.every((s) => s.status === 'pending')).toBe(true);
    expect(j?.composeTabId).toBeUndefined();
    expect(j?.composeFrameId).toBeUndefined();
  });
  it('g2b 발신 compose는 거부, 확장 페이지는 허용', async () => {
    const req = { type: 'compose' as const, noticeId: 'N-000' };
    await expect(assertRetryAllowed(req, g2b)).rejects.toMatchObject({ code: 'SENDER_FORBIDDEN' });
    await expect(assertRetryAllowed(req, ext)).resolves.toBeUndefined();
  });
  it('setComposeTab은 ACTIVE 잡에만 기록한다', async () => {
    await seed('a', 'running');
    await seed('b', 'completed');
    await setComposeTab('a', { composeTabId: 3, composeFrameId: 1 });
    await setComposeTab('b', { composeTabId: 3 });
    expect((await getJob('a'))?.composeTabId).toBe(3);
    expect((await getJob('a'))?.composeFrameId).toBe(1);
    expect((await getJob('b'))?.composeTabId).toBeUndefined();
  });
});

describe('webmail 발신자', () => {
  const RID = 'abcdefghijklmnop';
  const HOST = 'mail.example.com';
  const mail = (tabId: number, url = `https://${HOST}/read/1`) => ({ tab: { id: tabId } as chrome.tabs.Tab, url });
  const g2b = { tab: { id: 5 } as chrome.tabs.Tab, url: 'https://www.g2b.go.kr/' };
  beforeEach(async () => {
    vi.stubGlobal('chrome', { runtime: { id: RID } });
    const local = new MemKV();
    await local.set({ settingsCache: { sites: { naverworks: { host: HOST } } } });
    setCoordinatorDeps({ storage: { session, local }, send: ((t: string, p: unknown) => sendImpl(t, p)) as never, offscreen });
  });

  it('설정 호스트의 같은 탭 발신은 webmail이고 collect 시작/originTabId를 허용한다', async () => {
    expect(senderKind(mail(7), RID, HOST)).toBe('webmail');
    expect(originTabIdFor('webmail', mail(7))).toBe(7);
    await expect(assertRetryAllowed({ type: 'collect' }, mail(7))).resolves.toBeUndefined();
  });
  it('다른 호스트 또는 http는 SENDER_FORBIDDEN', async () => {
    await expect(assertRetryAllowed({ type: 'collect' }, mail(7, 'https://other.example.com/'))).rejects.toMatchObject({ code: 'SENDER_FORBIDDEN' });
    await expect(assertRetryAllowed({ type: 'collect' }, mail(7, `http://${HOST}/`))).rejects.toMatchObject({ code: 'SENDER_FORBIDDEN' });
  });
  it('inbox가 gmail이면 mail.google.com 탭이 webmail, naverworks 호스트는 unknown', async () => {
    const local = new MemKV();
    await local.set({ settingsCache: { sites: { trackerbot: { provider: 'gmail' } } } });
    setCoordinatorDeps({ storage: { session, local }, send: ((t: string, p: unknown) => sendImpl(t, p)) as never, offscreen });
    await expect(assertRetryAllowed({ type: 'collect' }, mail(7, 'https://mail.google.com/mail/u/0/'))).resolves.toBeUndefined();
    await expect(assertRetryAllowed({ type: 'collect' }, mail(7, 'https://mail.worksmobile.com/'))).rejects.toMatchObject({ code: 'SENDER_FORBIDDEN' });
  });
  it('작성 gmail, 수신 naverworks면 mail.google.com 탭은 unknown', async () => {
    const local = new MemKV();
    await local.set({ settingsCache: { mail: { provider: 'gmail' }, sites: { trackerbot: { provider: 'naverworks' } } } });
    setCoordinatorDeps({ storage: { session, local }, send: ((t: string, p: unknown) => sendImpl(t, p)) as never, offscreen });
    await expect(assertRetryAllowed({ type: 'collect' }, mail(7, 'https://mail.google.com/'))).rejects.toMatchObject({ code: 'SENDER_FORBIDDEN' });
  });
  it('extract/compose 시작은 금지', async () => {
    await expect(assertRetryAllowed({ type: 'extract' } as never, mail(7))).rejects.toMatchObject({ code: 'SENDER_FORBIDDEN' });
    await expect(assertRetryAllowed({ type: 'compose' } as never, mail(7))).rejects.toMatchObject({ code: 'SENDER_FORBIDDEN' });
  });
  it('자기 탭 잡만 조회/취소 가능', async () => {
    await seed('a', 'running');
    await session.set({ 'jobs.a': { ...(await getJob('a')), originTabId: 7 } });
    await expect(getJobForSender('a', mail(7))).resolves.toMatchObject({ id: 'a' });
    await expect(getJobForSender('a', mail(8))).resolves.toBeNull();
    await expect(assertCancelAllowed('a', mail(8))).rejects.toMatchObject({ code: 'JOB_CANCEL_FORBIDDEN' });
  });
  it('job/list-for-tab은 자기 탭 collect 잡만 updatedAt 내림차순', async () => {
    const put = async (id: string, patch: Partial<Job>) => {
      await seed(id, 'completed');
      await session.set({ [`jobs.${id}`]: { ...(await getJob(id)), ...patch } });
    };
    await put('old', { originTabId: 7, updatedAt: '2026-01-01T00:00:00Z' });
    await put('new', { originTabId: 7, updatedAt: '2026-02-01T00:00:00Z' });
    await put('other', { originTabId: 8, updatedAt: '2026-03-01T00:00:00Z' });
    await put('ext', { originTabId: 7, type: 'extract', updatedAt: '2026-04-01T00:00:00Z' });
    expect((await listJobsForTab(mail(7))).map((j) => j.id)).toEqual(['new', 'old']);
    expect(await listJobsForTab(g2b)).toEqual([]);
    expect(await listJobsForTab({ tab: { id: 7 } as chrome.tabs.Tab, url: 'https://evil.example/' })).toEqual([]);
  });
});

describe('종결 리스너 / setHandoff / auto', () => {
  const RID = 'extid';
  const ext = { id: RID, url: `chrome-extension://${RID}/dashboard.html` };
  const g2b = { tab: { id: 5 } as chrome.tabs.Tab, url: 'https://www.g2b.go.kr/' };
  const tick = () => new Promise<void>((r) => setTimeout(r, 5));
  let listeners: Array<(msg: unknown, sender: unknown, send: (r: unknown) => void) => unknown>;
  beforeEach(async () => {
    await tick(); // 앞선 테스트의 보류 중인 종결 dispatch를 비운다
    listeners = [];
    clearFinalListeners();
    vi.stubGlobal('chrome', {
      runtime: { id: RID, onMessage: { addListener: (f: never) => listeners.push(f) } },
      tabs: { sendMessage: vi.fn(async () => undefined) },
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); clearFinalListeners(); });

  const call = (type: string, payload: unknown, sender: unknown) => new Promise<{ ok: boolean; data?: unknown }>((resolve) => {
    for (const l of listeners) l({ id: 'x', type, payload, ts: 0, target: 'sw' }, sender, resolve as never);
  });

  it('onFinish는 확정한 Job을 반환하고 FINAL 재호출은 undefined', async () => {
    await seed('a', 'running');
    const j = await onFinish({ jobId: 'a', attempt: 1, status: 'completed' });
    expect(j).toMatchObject({ id: 'a', status: 'completed' });
    expect(await onFinish({ jobId: 'a', attempt: 1, status: 'failed' })).toBeUndefined();
  });
  it('final 리스너는 serial 밖에서 호출되고 리스너 안 startJob이 멈추지 않는다', async () => {
    await seed('a', 'running');
    sendImpl = async () => ({ accepted: true, active: [] });
    let started: string | undefined;
    addFinalListener((job) => {
      if (started) return;
      started = 'pending';
      void startJob({ type: 'collect', ref: { noticeNo: 'Z', origin: 'g2b' } }).then((r) => { started = r.jobId + ':' + job.id; });
    });
    const before = vi.fn();
    addFinalListener(before);
    await onFinish({ jobId: 'a', attempt: 1, status: 'completed' });
    expect(before).not.toHaveBeenCalled(); // 아직 setTimeout 이전
    await tick();
    expect(before).toHaveBeenCalledTimes(1);
    expect(started).toMatch(/:a$/);
  });
  it('리스너 예외는 삼키고 다음 리스너를 호출한다', async () => {
    await seed('a', 'running');
    const ok = vi.fn();
    addFinalListener(() => { throw new Error('boom'); });
    addFinalListener(ok);
    await onFinish({ jobId: 'a', attempt: 1, status: 'completed' });
    await tick();
    expect(ok).toHaveBeenCalled();
  });
  it('reconcile이 interrupted로 바꾼 잡과 force 취소 잡마다 리스너 호출', async () => {
    await seed('a', 'running');
    await seed('b', 'running');
    offscreen.has.mockImplementation(async () => false);
    const seen: string[] = [];
    addFinalListener((j) => seen.push(`${j.id}:${j.status}`));
    await reconcile();
    await tick();
    expect(seen.sort()).toEqual(['a:interrupted', 'b:interrupted']);
    seen.length = 0;
    await seed('c', 'cancelling');
    await seed('d', 'running');
    offscreen.has.mockImplementation(async () => true);
    await cancelJob('c', true);
    await tick();
    expect(seen.sort()).toEqual(['c:cancelled', 'd:interrupted']);
  });
  it('setHandoff는 status/result/errors를 보존하고 job/update를 알린다', async () => {
    await seed('a', 'completed');
    await session.set({ 'jobs.a': { ...(await getJob('a')), originTabId: 3, result: { noticeId: 'x' }, errors: [{ code: 'E', message: 'm', retryable: false }] } });
    await setHandoff('a', { action: 'none', reason: 'disabled', at: 't' });
    const j = await getJob('a');
    expect(j).toMatchObject({ status: 'completed', attempt: 1, result: { noticeId: 'x' }, handoff: { action: 'none', reason: 'disabled' } });
    expect(j?.errors).toHaveLength(1);
    expect(vi.mocked(chrome.tabs.sendMessage).mock.calls.at(-1)?.[1]).toMatchObject({ type: 'job/update', payload: { job: { id: 'a' } } });
    await expect(setHandoff('none', { action: 'none', reason: 'disabled', at: 't' })).resolves.toBeUndefined();
    expect(await getJob('none')).toBeUndefined();
  });
  it('job/start는 외부 auto를 버리고, SW 내부 startJob은 auto와 params를 복사한다', async () => {
    sendImpl = async () => ({ accepted: true, active: [] });
    registerCoordinator();
    const r = await call('job/start', { type: 'collect', ref: { noticeNo: 'Q', origin: 'g2b' }, auto: { collectJobId: 'evil' } }, ext);
    expect(r.ok).toBe(true);
    const job = await getJob((r.data as { jobId: string }).jobId);
    expect(job?.auto).toBeUndefined();
    const own = await startJob({ type: 'compose', noticeId: 'N-000', params: { groupId: 'g', templateId: 't', recipients: [{ recipientId: 'r', role: 'cc' }] }, auto: { collectJobId: 'c1' } });
    expect(await getJob(own.jobId)).toMatchObject({ auto: { collectJobId: 'c1' }, params: { groupId: 'g', templateId: 't', recipients: [{ recipientId: 'r', role: 'cc' }] } });
  });
  it('latest-for-tab은 compose 잡을 돌려주지 않는다', async () => {
    const ref = { noticeNo: 'L', origin: 'g2b' as const };
    const put = async (id: string, patch: Partial<Job>) => {
      await seed(id, 'completed', 1, 'L');
      await session.set({ [`jobs.${id}`]: { ...(await getJob(id)), originTabId: 5, ref, ...patch } });
    };
    await put('col', { updatedAt: '2026-01-01T00:00:00Z' });
    await put('cmp', { type: 'compose', updatedAt: '2026-02-01T00:00:00Z' });
    // putJob가 아닌 직접 set이라 updatedAt이 유지된다
    expect((await latestJobForSender(ref, g2b))?.id).toBe('col');
  });
  it('handoff가 있는 collect 잡을 재시도하면 handoff가 지워진다', async () => {
    await seed('a', 'failed');
    await session.set({ 'jobs.a': { ...(await getJob('a')), handoff: { action: 'none', reason: 'disabled', at: 't' } } });
    sendImpl = async () => ({ accepted: true, active: [] });
    await startJob({ type: 'collect', ref: { noticeNo: 'a', origin: 'g2b' }, retryOf: 'a' });
    const j = await getJob('a');
    expect(j?.attempt).toBe(2);
    expect(j?.handoff).toBeUndefined();
  });
});
