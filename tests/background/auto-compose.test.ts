import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/messaging/bus', () => ({ listen: vi.fn(), send: vi.fn() }));

import { QUEUE_KEY, dequeue, onFinal, pump, registerAutoCompose, setAutoComposeDeps } from '../../src/background/auto-compose';
import { clearFinalListeners } from '../../src/background/job-coordinator';
import { withDefaults } from '../../src/core/model/default-settings';
import type { Handoff, Job } from '../../src/core/types/job';
import type { AutoComposeSettings } from '../../src/core/types/settings';
import { listen } from '../../src/messaging/bus';

class MemKV {
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
let auto: Partial<AutoComposeSettings>;
let ledger: Job[];
let handoffs: Record<string, Handoff>;
let granted: boolean;
const startJob = vi.fn();
const openDashboard = vi.fn();
const contains = vi.fn();
let seq = 0;
let base: Parameters<typeof setAutoComposeDeps>[0];

const collect = (id: string, patch: Partial<Job> = {}): Job => ({
  id, type: 'collect', noticeId: `${id}-000`, ref: { noticeNo: id, origin: 'g2b' }, status: 'completed', originTabId: 9,
  steps: [], attempt: 1, createdAt: 't', updatedAt: 't', errors: [], result: { noticeId: `${id}-000`, attachments: [] }, ...patch,
});
const compose = (id: string, status: Job['status'], noticeId = 'x'): Job => ({
  id, type: 'compose', noticeId, status, steps: [], attempt: 1, createdAt: 't', updatedAt: 't', errors: [],
});
const queue = async () => (session.data[QUEUE_KEY] as Array<{ collectJobId: string }> | undefined) ?? [];

beforeEach(() => {
  session = new MemKV();
  auto = { enabled: true, afterCollect: 'compose' };
  ledger = [];
  handoffs = {};
  granted = true;
  seq = 0;
  startJob.mockReset().mockImplementation(async (req) => {
    const jobId = `c${++seq}`;
    ledger.push({ ...compose(jobId, 'running', req.noticeId), auto: req.auto });
    return { jobId };
  });
  openDashboard.mockReset().mockResolvedValue(3);
  contains.mockReset().mockImplementation(async () => granted);
  base = {
    storage: { session, local: new MemKV() },
    startJob,
    listJobs: async () => ledger,
    getJob: async (id) => ledger.find((j) => j.id === id),
    setHandoff: async (id, h) => { handoffs[id] = h; },
    permissions: { contains } as never,
    openDashboard,
    getComposeHost: async () => 'mail.example.com',
    getSettings: async () => withDefaults({ autoCompose: auto } as never),
    now: () => 'NOW',
  };
  setAutoComposeDeps(base);
});

describe('onFinal collect', () => {
  it('disabled면 none(disabled)', async () => {
    auto = { enabled: false };
    await onFinal(collect('a'));
    expect(handoffs.a).toMatchObject({ action: 'none', reason: 'disabled' });
    expect(startJob).not.toHaveBeenCalled();
  });
  it("설정 afterCollect 'compose'여도 startJob 없이 edit handoff(대시보드를 열지 않음)", async () => {
    auto = { enabled: true, afterCollect: 'compose' };
    await onFinal(collect('a'));
    expect(startJob).not.toHaveBeenCalled();
    expect(contains).not.toHaveBeenCalled();
    expect(openDashboard).not.toHaveBeenCalled();
    expect(handoffs.a).toMatchObject({ action: 'edit', opened: false });
    expect(await queue()).toHaveLength(0);
  });
  it("설정 afterCollect 'ask'여도 ask가 아니라 edit handoff", async () => {
    auto = { enabled: true, afterCollect: 'ask' };
    await onFinal(collect('a'));
    expect(handoffs.a).toMatchObject({ action: 'edit', opened: false });
    expect(openDashboard).not.toHaveBeenCalled();
    expect(startJob).not.toHaveBeenCalled();
  });
  it('게이트에 걸리면 review handoff', async () => {
    auto = { enabled: true, afterCollect: 'compose', reviewGate: 'any_review' };
    await onFinal(collect('a', { result: { noticeId: 'a-000', attachments: [], extraction: { status: 'needs_review', reviewCount: 2, conflictCount: 1 } } }));
    expect(handoffs.a).toMatchObject({ action: 'review', reasons: ['needs_review'] });
    expect(startJob).not.toHaveBeenCalled();
  });
  it('partial이면 검수 화면을 열지 않고 review handoff', async () => {
    const job = collect('a', { status: 'partial', result: { noticeId: 'a-000', attachments: [{ status: 'failed' }] } });
    await onFinal(job);
    expect(openDashboard).not.toHaveBeenCalled();
    expect(handoffs.a).toMatchObject({ action: 'review', reasons: ['attachments_failed'], opened: false });
    expect(startJob).not.toHaveBeenCalled();
    openDashboard.mockResolvedValue(undefined);
    await onFinal(collect('b', { status: 'partial', result: { noticeId: 'b-000', attachments: [{ status: 'failed' }] } }));
    expect(handoffs.b).toMatchObject({ action: 'review', opened: false });
  });
  it('handoff가 있는 잡은 무시(멱등)', async () => {
    await onFinal(collect('a', { handoff: { action: 'none', reason: 'disabled', at: 't' } }));
    expect(handoffs.a).toBeUndefined();
    expect(startJob).not.toHaveBeenCalled();
  });
});

describe('큐 직렬화', () => {
  it('세션 큐는 SW 재시작 후 pump로 복구된다', async () => {
    await session.set({ [QUEUE_KEY]: [{ collectJobId: 'a', noticeId: 'a-000', originTabId: 9, enqueuedAt: 'x' }] });
    await pump();
    expect(startJob).toHaveBeenCalledTimes(1);
    expect(handoffs.a).toMatchObject({ state: 'started' });
  });
});

describe('복구', () => {
  it('큐에 없는 queued handoff는 start_failed, 큐에 있는 것은 그대로', async () => {
    vi.stubGlobal('chrome', { runtime: { id: 'ext' }, storage: { onChanged: { addListener: vi.fn() } }, permissions: { contains } });
    clearFinalListeners();
    const queued: Handoff = { action: 'compose', state: 'queued', at: 't' };
    ledger.push(collect('lost', { handoff: queued }), collect('kept', { handoff: queued }));
    ledger.push(compose('m', 'running', 'other')); // pump가 시작하지 못하게
    await session.set({ [QUEUE_KEY]: [{ collectJobId: 'kept', noticeId: 'kept-000', enqueuedAt: 'x' }] });
    registerAutoCompose();
    await pump(); // 복구 체인이 먼저 끝난 뒤 실행된다
    expect(handoffs.lost).toMatchObject({ action: 'none', reason: 'start_failed' });
    expect(handoffs.kept).toBeUndefined();
    expect(await queue()).toHaveLength(1);
    vi.unstubAllGlobals();
  });
});

describe('dequeue', () => {
  const seed = () => session.set({ [QUEUE_KEY]: [{ collectJobId: 'a', noticeId: 'a-000', originTabId: 9, enqueuedAt: 'x' }] });
  it('큐에서 제거하고 none(dequeued), 없으면 false', async () => {
    ledger.push(compose('m', 'running', 'other'));
    await seed();
    expect(await dequeue('a')).toBe(true);
    expect(handoffs.a).toMatchObject({ action: 'none', reason: 'dequeued' });
    expect(await dequeue('a')).toBe(false);
  });
  it('리스너: 확장 발신자는 허용, 사이트 발신자는 자기 탭 잡이 아니면 removed:false', async () => {
    vi.stubGlobal('chrome', {
      runtime: { id: 'ext' }, storage: { onChanged: { addListener: vi.fn() } },
      permissions: { contains },
    });
    clearFinalListeners();
    registerAutoCompose();
    const call = vi.mocked(listen).mock.calls.find((c) => c[0] === 'auto-compose/dequeue')!;
    const h = call[1] as unknown as (p: unknown, s: unknown) => Promise<{ removed: boolean }>;
    ledger.push(compose('m', 'running', 'other'));
    await seed();
    // 사이트 발신자: getJobForSender는 coordinator 실제 스토리지를 쓰므로 unknown 발신자로 거부 확인
    await expect(h({ collectJobId: 'a' }, { tab: { id: 1 }, url: 'https://evil.example/' })).rejects.toMatchObject({ code: 'SENDER_FORBIDDEN' });
    expect(await queue()).toHaveLength(1);
    await expect(h({ collectJobId: 'a' }, { id: 'ext', url: 'chrome-extension://ext/dashboard.html' })).resolves.toEqual({ removed: true });
    vi.unstubAllGlobals();
  });
});

describe('edit 분기', () => {
  it('afterCollect dashboard면 편집 화면을 열지 않고 edit handoff(opened false), 권한 검사와 큐를 타지 않는다', async () => {
    auto = { enabled: true, afterCollect: 'dashboard' };
    await onFinal(collect('a'));
    expect(handoffs.a).toMatchObject({ action: 'edit', opened: false });
    openDashboard.mockResolvedValue(undefined);
    await onFinal(collect('b'));
    expect(handoffs.b).toMatchObject({ action: 'edit', opened: false });
    expect(openDashboard).not.toHaveBeenCalled();
    expect(contains).not.toHaveBeenCalled();
    expect(startJob).not.toHaveBeenCalled();
    expect(await queue()).toHaveLength(0);
  });
  it('잡 스냅샷이 설정보다 우선한다', async () => {
    auto = { enabled: true, afterCollect: 'compose' };
    await onFinal(collect('a', { afterCollect: 'dashboard' }));
    expect(handoffs.a).toMatchObject({ action: 'edit' });
  });
});

describe('auto-compose/choose', () => {
  const setup = () => {
    vi.stubGlobal('chrome', { runtime: { id: 'ext' }, storage: { onChanged: { addListener: vi.fn() } }, permissions: { contains } });
    clearFinalListeners();
    registerAutoCompose();
    const call = vi.mocked(listen).mock.calls.filter((c) => c[0] === 'auto-compose/choose').at(-1)!;
    return call[1] as unknown as (p: unknown, s: unknown) => Promise<{ applied: boolean }>;
  };
  it('타 사이트 발신자는 거부, 확장 발신자는 setAfterCollect 결과를 반환', async () => {
    const setAfterCollect = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    setAutoComposeDeps({ ...base, setAfterCollect } as never);
    const h = setup();
    await expect(h({ collectJobId: 'a', afterCollect: 'dashboard' }, { tab: { id: 1 }, url: 'https://evil.example/' })).rejects.toMatchObject({ code: 'SENDER_FORBIDDEN' });
    expect(setAfterCollect).not.toHaveBeenCalled();
    const ext = { id: 'ext', url: 'chrome-extension://ext/dashboard.html' };
    await expect(h({ collectJobId: 'a', afterCollect: 'dashboard' }, ext)).resolves.toEqual({ applied: true });
    expect(setAfterCollect).toHaveBeenCalledWith('a', 'dashboard');
    await expect(h({ collectJobId: 'a', afterCollect: 'compose' }, ext)).resolves.toEqual({ applied: false });
    expect(startJob).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
describe('끝난 잡 choose', () => {
  const ext = { id: 'ext', url: 'chrome-extension://ext/dashboard.html' };
  it("끝난 잡에 choose('compose'|'dashboard')를 보내면 applied:false", async () => {
    setAutoComposeDeps({ ...base, setAfterCollect: (async () => false) as never });
    vi.stubGlobal('chrome', { runtime: { id: 'ext' }, storage: { onChanged: { addListener: vi.fn() } }, permissions: { contains } });
    clearFinalListeners();
    registerAutoCompose();
    const h = vi.mocked(listen).mock.calls.filter((c) => c[0] === 'auto-compose/choose').at(-1)![1] as unknown as (p: unknown, s: unknown) => Promise<{ applied: boolean }>;
    auto = { enabled: true, afterCollect: 'ask' };
    const j = collect('a');
    ledger.push(j);
    await onFinal(j);
    for (const afterCollect of ['compose', 'dashboard']) {
      await expect(h({ collectJobId: 'a', afterCollect }, ext)).resolves.toEqual({ applied: false });
    }
    expect(startJob).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
