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
  it('게이트 통과 시 startJob 인자(params, auto, originTabId)와 handoff started', async () => {
    auto = { enabled: true, afterCollect: 'compose', recipients: { mode: 'group', groupId: 'g1' }, templateId: 't1' };
    await onFinal(collect('a'));
    expect(startJob).toHaveBeenCalledWith({
      type: 'compose', noticeId: 'a-000', ref: { noticeNo: 'a', origin: 'g2b' }, originTabId: 9,
      params: { groupId: 'g1', templateId: 't1' }, auto: { collectJobId: 'a' },
    });
    expect(handoffs.a).toMatchObject({ action: 'compose', state: 'started', jobId: 'c1' });
    expect(contains).toHaveBeenCalledWith({ origins: ['https://mail.example.com/*'] });
  });
  it('custom 수신자는 recipients로, default는 빈 params', async () => {
    auto = { enabled: true, afterCollect: 'compose', recipients: { mode: 'custom', members: [{ recipientId: 'r1', role: 'cc' }] } };
    await onFinal(collect('a'));
    expect(startJob.mock.calls[0]![0].params).toEqual({ recipients: [{ recipientId: 'r1', role: 'cc' }] });
    ledger.length = 0;
    auto = { enabled: true, afterCollect: 'compose' };
    await onFinal(collect('b'));
    expect(startJob.mock.calls[1]![0].params).toEqual({});
  });
  it('사전규격 공고는 prespecTemplateId를 쓰고 비어 있으면 templateId를 보내지 않는다', async () => {
    auto = { enabled: true, afterCollect: 'compose', templateId: 't1', prespecTemplateId: 'p1' };
    await onFinal(collect('a', { ref: { kind: 'prespec', noticeNo: 'R26BD00273952', origin: 'g2b' } }));
    expect(startJob.mock.calls[0]![0].params).toEqual({ templateId: 'p1' });
    ledger.length = 0;
    auto = { enabled: true, afterCollect: 'compose', templateId: 't1' };
    await onFinal(collect('b', { ref: { kind: 'prespec', noticeNo: 'R26BD00273953', origin: 'g2b' } }));
    expect(startJob.mock.calls[1]![0].params).toEqual({});
  });
  it('partial이면 검수 화면을 열고 review handoff', async () => {
    const job = collect('a', { status: 'partial', result: { noticeId: 'a-000', attachments: [{ status: 'failed' }] } });
    await onFinal(job);
    expect(openDashboard).toHaveBeenCalledWith('#/review/a-000?handoff=attachments_failed', { nearTabId: 9 });
    expect(handoffs.a).toMatchObject({ action: 'review', reasons: ['attachments_failed'], opened: true });
    expect(startJob).not.toHaveBeenCalled();
    openDashboard.mockResolvedValue(undefined);
    await onFinal(collect('b', { status: 'partial', result: { noticeId: 'b-000', attachments: [{ status: 'failed' }] } }));
    expect(handoffs.b).toMatchObject({ action: 'review', opened: false });
  });
  it('사이트 권한이 없으면 none(needs_site_permission)', async () => {
    granted = false;
    await onFinal(collect('a'));
    expect(handoffs.a).toMatchObject({ action: 'none', reason: 'needs_site_permission' });
    expect(startJob).not.toHaveBeenCalled();
  });
  it('이미 작성한 공고도 compose를 시작한다', async () => {
    await onFinal(collect('a', { result: { noticeId: 'a-000', attachments: [], mailStatus: 'delivered' } }));
    expect(handoffs.a).toMatchObject({ action: 'compose' });
    expect(startJob).toHaveBeenCalledTimes(1);
  });
  it('handoff가 있는 잡은 무시(멱등)', async () => {
    await onFinal(collect('a', { handoff: { action: 'none', reason: 'disabled', at: 't' } }));
    expect(handoffs.a).toBeUndefined();
    expect(startJob).not.toHaveBeenCalled();
  });
  it('같은 noticeId가 큐에 있거나 ACTIVE compose가 있으면 none(compose_running)', async () => {
    ledger.push(compose('m1', 'running', 'a-000'));
    await onFinal(collect('a'));
    expect(handoffs.a).toMatchObject({ action: 'none', reason: 'compose_running' });
    ledger.length = 0;
    ledger.push(compose('m2', 'running', 'other'));
    await onFinal(collect('b')); // 수동 compose ACTIVE라 큐에 대기
    await onFinal(collect('b2', { noticeId: 'b-000' }));
    expect(handoffs.b).toMatchObject({ action: 'compose', state: 'queued' });
    expect(handoffs.b2).toMatchObject({ action: 'none', reason: 'compose_running' });
    expect(await queue()).toHaveLength(1);
  });
  it('startJob이 throw하면 start_failed', async () => {
    startJob.mockRejectedValueOnce(new Error('x'));
    await onFinal(collect('a'));
    expect(handoffs.a).toMatchObject({ action: 'none', reason: 'start_failed' });
  });
  it('JOB_ALREADY_RUNNING 응답이면 큐 선두에 남고 handoff를 바꾸지 않는다', async () => {
    startJob.mockResolvedValueOnce({ jobId: 'zz', code: 'JOB_ALREADY_RUNNING' });
    await onFinal(collect('b'));
    expect((await queue()).map((e) => e.collectJobId)).toEqual(['b']);
    expect(handoffs.b).toMatchObject({ action: 'compose', state: 'queued' });
  });
  it('JOB_ALREADY_RUNNING throw도 같다', async () => {
    startJob.mockRejectedValueOnce(Object.assign(new Error('r'), { code: 'JOB_ALREADY_RUNNING' }));
    await onFinal(collect('b'));
    expect((await queue()).map((e) => e.collectJobId)).toEqual(['b']);
    expect(handoffs.b).toMatchObject({ action: 'compose', state: 'queued' });
  });
});

describe('큐 직렬화', () => {
  it('2건은 하나씩 시작하고 compose 종결로 다음을 시작한다', async () => {
    await onFinal(collect('a'));
    await onFinal(collect('b'));
    expect(startJob).toHaveBeenCalledTimes(1);
    expect(handoffs.b).toMatchObject({ action: 'compose', state: 'queued' });
    expect((await queue()).map((e) => e.collectJobId)).toEqual(['b']);
    ledger[0]!.status = 'completed';
    await onFinal(ledger[0]!);
    expect(startJob).toHaveBeenCalledTimes(2);
    expect(startJob.mock.calls[1]![0].noticeId).toBe('b-000');
    expect(handoffs.b).toMatchObject({ action: 'compose', state: 'started', jobId: 'c2' });
    expect(await queue()).toEqual([]);
  });
  it('수동 compose가 ACTIVE면 시작하지 않고 대기한다', async () => {
    ledger.push(compose('m', 'running', 'other'));
    await onFinal(collect('a'));
    expect(startJob).not.toHaveBeenCalled();
    ledger[0]!.status = 'completed';
    await onFinal(ledger[0]!);
    expect(startJob).toHaveBeenCalledTimes(1);
  });
  it('세션 큐는 SW 재시작 후 pump로 복구된다', async () => {
    await session.set({ [QUEUE_KEY]: [{ collectJobId: 'a', noticeId: 'a-000', originTabId: 9, enqueuedAt: 'x' }] });
    await pump();
    expect(startJob).toHaveBeenCalledTimes(1);
    expect(handoffs.a).toMatchObject({ state: 'started' });
  });
  it('설정이 꺼지면 큐를 비우고 none(disabled)', async () => {
    ledger.push(compose('m', 'running', 'other'));
    await onFinal(collect('a'));
    await onFinal(collect('b'));
    auto = { enabled: false };
    await pump();
    expect(await queue()).toEqual([]);
    expect(handoffs.a).toMatchObject({ reason: 'disabled' });
    expect(handoffs.b).toMatchObject({ reason: 'disabled' });
    expect(startJob).not.toHaveBeenCalled();
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
  it('큐에서 제거하고 none(dequeued), 없으면 false', async () => {
    ledger.push(compose('m', 'running', 'other'));
    await onFinal(collect('a'));
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
    await onFinal(collect('a'));
    // 사이트 발신자: getJobForSender는 coordinator 실제 스토리지를 쓰므로 unknown 발신자로 거부 확인
    await expect(h({ collectJobId: 'a' }, { tab: { id: 1 }, url: 'https://evil.example/' })).rejects.toMatchObject({ code: 'SENDER_FORBIDDEN' });
    expect(await queue()).toHaveLength(1);
    await expect(h({ collectJobId: 'a' }, { id: 'ext', url: 'chrome-extension://ext/dashboard.html' })).resolves.toEqual({ removed: true });
    vi.unstubAllGlobals();
  });
});

describe('edit 분기', () => {
  it('afterCollect dashboard면 편집 화면을 열고 edit handoff(opened true/false), 권한 검사와 큐를 타지 않는다', async () => {
    auto = { enabled: true, afterCollect: 'dashboard' };
    await onFinal(collect('a'));
    expect(openDashboard).toHaveBeenCalledWith('#/mail/a-000?from=collect', { nearTabId: 9 });
    expect(handoffs.a).toMatchObject({ action: 'edit', opened: true });
    openDashboard.mockResolvedValue(undefined);
    await onFinal(collect('b'));
    expect(handoffs.b).toMatchObject({ action: 'edit', opened: false });
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

describe('ask 선택', () => {
  const ext = { id: 'ext', url: 'chrome-extension://ext/dashboard.html' };
  const setupAsk = (setAfterCollect: (id: string, a: string) => Promise<boolean> = async () => false) => {
    setAutoComposeDeps({
      ...base,
      setAfterCollect: setAfterCollect as never,
      setHandoff: async (id, h) => { handoffs[id] = h; const j = ledger.find((x) => x.id === id); if (j) j.handoff = h; },
    });
    vi.stubGlobal('chrome', { runtime: { id: 'ext' }, storage: { onChanged: { addListener: vi.fn() } }, permissions: { contains } });
    clearFinalListeners();
    registerAutoCompose();
    const call = vi.mocked(listen).mock.calls.filter((c) => c[0] === 'auto-compose/choose').at(-1)!;
    return call[1] as unknown as (p: unknown, s: unknown) => Promise<{ applied: boolean }>;
  };
  const askJob = async (id = 'a', patch: Partial<Job> = {}) => {
    const j = collect(id, patch);
    ledger.push(j);
    await onFinal(j);
    return j;
  };
  const unstub = () => vi.unstubAllGlobals();

  it('onFinal ask면 handoff ask만 기록하고 openDashboard·startJob·권한 확인을 하지 않는다', async () => {
    auto = { enabled: true, afterCollect: 'ask' };
    await onFinal(collect('a'));
    expect(handoffs.a).toEqual({ action: 'ask', at: 'NOW' });
    expect(openDashboard).not.toHaveBeenCalled();
    expect(startJob).not.toHaveBeenCalled();
    expect(contains).not.toHaveBeenCalled();
  });
  it("choose 'compose'면 권한 검사, 큐 적재, startJob, handoff compose started", async () => {
    auto = { enabled: true, afterCollect: 'ask' };
    const h = setupAsk();
    await askJob();
    await expect(h({ collectJobId: 'a', afterCollect: 'compose' }, ext)).resolves.toEqual({ applied: true });
    expect(contains).toHaveBeenCalled();
    expect(startJob).toHaveBeenCalledTimes(1);
    expect(startJob.mock.calls[0]![0]).toMatchObject({ type: 'compose', noticeId: 'a-000', auto: { collectJobId: 'a' } });
    expect(handoffs.a).toMatchObject({ action: 'compose', state: 'started' });
    unstub();
  });
  it('ask 선택 뒤 compose도 사전규격이면 prespecTemplateId를 쓰고 비어 있으면 templateId를 보내지 않는다', async () => {
    auto = { enabled: true, afterCollect: 'ask', templateId: 't1', prespecTemplateId: 'p1' };
    const h = setupAsk();
    await askJob('a', { ref: { kind: 'prespec', noticeNo: 'R26BD00273952', origin: 'g2b' } });
    await h({ collectJobId: 'a', afterCollect: 'compose' }, ext);
    expect(startJob.mock.calls[0]![0].params).toEqual({ templateId: 'p1' });
    ledger.length = 0;
    auto = { enabled: true, afterCollect: 'ask', templateId: 't1' };
    await askJob('b', { ref: { kind: 'prespec', noticeNo: 'R26BD00273953', origin: 'g2b' } });
    await h({ collectJobId: 'b', afterCollect: 'compose' }, ext);
    expect(startJob.mock.calls[1]![0].params).toEqual({});
    unstub();
  });
  it("choose 'dashboard'면 편집 화면을 열고 handoff edit", async () => {
    auto = { enabled: true, afterCollect: 'ask' };
    const h = setupAsk();
    await askJob();
    await expect(h({ collectJobId: 'a', afterCollect: 'dashboard' }, ext)).resolves.toEqual({ applied: true });
    expect(openDashboard).toHaveBeenCalledWith('#/mail/a-000?from=collect', { nearTabId: 9 });
    expect(handoffs.a).toMatchObject({ action: 'edit', opened: true });
    expect(startJob).not.toHaveBeenCalled();
    unstub();
  });
  it('같은 잡에 choose 2회면 두 번째는 applied:false', async () => {
    auto = { enabled: true, afterCollect: 'ask' };
    const h = setupAsk();
    await askJob();
    await expect(h({ collectJobId: 'a', afterCollect: 'compose' }, ext)).resolves.toEqual({ applied: true });
    await expect(h({ collectJobId: 'a', afterCollect: 'compose' }, ext)).resolves.toEqual({ applied: false });
    expect(startJob).toHaveBeenCalledTimes(1);
    unstub();
  });
  it('handoff가 edit·none·compose인 끝난 잡에 choose하면 false', async () => {
    const h = setupAsk();
    const handoffsOf: Handoff[] = [
      { action: 'edit', opened: true, at: 'T' },
      { action: 'none', reason: 'disabled', at: 'T' },
      { action: 'compose', state: 'started', jobId: 'c9', at: 'T' },
    ];
    for (const [i, handoff] of handoffsOf.entries()) ledger.push(collect(`k${i}`, { handoff }));
    for (const [i] of handoffsOf.entries()) {
      await expect(h({ collectJobId: `k${i}`, afterCollect: 'compose' }, ext)).resolves.toEqual({ applied: false });
    }
    expect(startJob).not.toHaveBeenCalled();
    expect(openDashboard).not.toHaveBeenCalled();
    unstub();
  });
  it("끝난 잡에 'ask'를 고르면 false", async () => {
    auto = { enabled: true, afterCollect: 'ask' };
    const h = setupAsk();
    await askJob();
    await expect(h({ collectJobId: 'a', afterCollect: 'ask' }, ext)).resolves.toEqual({ applied: false });
    expect(handoffs.a).toMatchObject({ action: 'ask' });
    unstub();
  });
  it('ACTIVE 잡에 choose하면 종전처럼 setAfterCollect', async () => {
    const setAfterCollect = vi.fn().mockResolvedValue(true);
    const h = setupAsk(setAfterCollect);
    await expect(h({ collectJobId: 'a', afterCollect: 'compose' }, ext)).resolves.toEqual({ applied: true });
    expect(setAfterCollect).toHaveBeenCalledWith('a', 'compose');
    expect(startJob).not.toHaveBeenCalled();
    unstub();
  });
  it('사이트 발신자는 자기 탭 잡이 아니면 거부', async () => {
    auto = { enabled: true, afterCollect: 'ask' };
    const h = setupAsk();
    await askJob();
    await expect(h({ collectJobId: 'a', afterCollect: 'compose' }, { tab: { id: 1 }, url: 'https://evil.example/' })).rejects.toMatchObject({ code: 'SENDER_FORBIDDEN' });
    expect(startJob).not.toHaveBeenCalled();
    unstub();
  });
  it("설정이 disabled인 상태에서 choose 'compose'면 handoff none(disabled)", async () => {
    auto = { enabled: true, afterCollect: 'ask' };
    const h = setupAsk();
    await askJob();
    auto = { enabled: false, afterCollect: 'ask' };
    await expect(h({ collectJobId: 'a', afterCollect: 'compose' }, ext)).resolves.toEqual({ applied: true });
    expect(handoffs.a).toMatchObject({ action: 'none', reason: 'disabled' });
    expect(startJob).not.toHaveBeenCalled();
    unstub();
  });
});
