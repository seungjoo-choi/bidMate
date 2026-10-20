import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/messaging/bus', () => ({ listen: vi.fn(), send: vi.fn() }));
vi.mock('../../src/background/offscreen-manager', () => ({ ensureOffscreen: vi.fn(), hasOffscreen: vi.fn() }));
vi.mock('../../src/background/dashboard-tabs', () => ({ openDashboard: vi.fn() }));

import { EXTENSION_ONLY_TYPES, registerRouter } from '../../src/background/router';
import { ensureOffscreen, hasOffscreen } from '../../src/background/offscreen-manager';
import { listen, send } from '../../src/messaging/bus';
import { defaultSettings } from '../../src/core/model/default-settings';
import { AI_BATCH_MAX, AI_BATCH_SESSION_KEY, type AiBatchState } from '../../src/core/types/ai';

const RID = 'abcdefghijklmnop';
const KEY = 'sk-batch-router-SECRET-1';
const tabSender = { id: RID, url: 'https://www.g2b.go.kr/', tab: { id: 1 } };
const dash = { id: RID, url: `chrome-extension://${RID}/dashboard.html` };
const offscreenSender = { id: RID, url: `chrome-extension://${RID}/offscreen.html` };
type H = (payload: unknown, sender: unknown) => Promise<unknown>;
const handlerOf = (type: string): H => {
  const call = vi.mocked(listen).mock.calls.find((c) => c[0] === type && c[2] === 'sw');
  if (!call) throw new Error(`핸들러 없음: ${type}`);
  return call[1] as unknown as H;
};

let session: Record<string, unknown>;
function stubChrome(o: { key?: string | undefined; models?: Record<string, string>; granted?: boolean } = {}) {
  const s = defaultSettings();
  s.ai.provider = 'claude';
  if (o.models) s.ai.models = o.models;
  const secrets = 'key' in o ? (o.key === undefined ? {} : { ai: { claude: o.key } }) : { ai: { claude: KEY } };
  const sessionApi = {
    get: vi.fn(async (k: string) => (k in session ? { [k]: session[k] } : {})),
    set: vi.fn(async (v: Record<string, unknown>) => { Object.assign(session, v); }),
    remove: vi.fn(async (k: string) => { delete session[k]; }),
  };
  vi.stubGlobal('chrome', {
    runtime: { id: RID },
    storage: { local: { get: vi.fn().mockResolvedValue({ secrets, settingsCache: s }) }, session: sessionApi },
    permissions: { contains: vi.fn().mockResolvedValue(o.granted ?? true) },
  });
  return sessionApi;
}
const batchState = (over: Partial<AiBatchState> = {}): AiBatchState => ({
  batchId: 'b-old', provider: 'claude', model: 'm', status: 'running', startedAt: 't0', updatedAt: 't0',
  items: [{ noticeId: 'n1', status: 'done', attempts: 1 }, { noticeId: 'n2', status: 'running', attempts: 1 }, { noticeId: 'n3', status: 'queued', attempts: 0 }],
  currentIndex: 1, ...over,
});

describe('일괄 실행 SW 릴레이', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session = {};
    stubChrome();
    vi.mocked(hasOffscreen).mockResolvedValue(true);
    registerRouter();
  });

  it('ai/batch-exec·ai/batch-status 외 batch-cancel은 EXTENSION_ONLY, batch-exec는 SW에 없다', () => {
    const registered = vi.mocked(listen).mock.calls.filter((c) => c[2] === 'sw').map((c) => c[0] as string);
    expect(registered).not.toContain('ai/batch-exec');
    for (const t of ['ai/batch-run', 'ai/batch-get', 'ai/batch-status', 'ai/batch-clear', 'ai/batch-cancel']) expect(registered).toContain(t);
    expect(EXTENSION_ONLY_TYPES as readonly string[]).toContain('ai/batch-cancel');
  });

  it('batch-run: 탭 발신 거부, 배열·문자열 검사, 빈 배열 거부, 중복 제거, 상한 초과 PAYLOAD_TOO_LARGE', async () => {
    await expect(handlerOf('ai/batch-run')({ noticeIds: ['a'] }, tabSender)).rejects.toMatchObject({ code: 'SENDER_FORBIDDEN' });
    await expect(handlerOf('ai/batch-run')({ noticeIds: 'a' }, dash)).rejects.toMatchObject({ code: 'INVALID_VALUE' });
    await expect(handlerOf('ai/batch-run')({ noticeIds: ['a', 3] }, dash)).rejects.toMatchObject({ code: 'INVALID_VALUE' });
    await expect(handlerOf('ai/batch-run')({ noticeIds: [''] }, dash)).rejects.toMatchObject({ code: 'INVALID_VALUE' });
    await expect(handlerOf('ai/batch-run')({ noticeIds: [] }, dash)).rejects.toMatchObject({ code: 'NOTHING_TO_REVIEW' });
    const many = Array.from({ length: AI_BATCH_MAX + 1 }, (_, i) => `n${i}`);
    await expect(handlerOf('ai/batch-run')({ noticeIds: many }, dash)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    expect(session[AI_BATCH_SESSION_KEY]).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });

  it('batch-run: 키·모델·권한 없음은 ai/run과 같은 코드로 거부하고 세션·offscreen은 건드리지 않는다', async () => {
    stubChrome({ key: undefined });
    await expect(handlerOf('ai/batch-run')({ noticeIds: ['a'] }, dash)).rejects.toMatchObject({ code: 'AI_KEY_MISSING' });
    stubChrome({ models: { claude: '' } });
    await expect(handlerOf('ai/batch-run')({ noticeIds: ['a'] }, dash)).rejects.toMatchObject({ code: 'AI_MODEL_MISSING' });
    stubChrome({ granted: false });
    await expect(handlerOf('ai/batch-run')({ noticeIds: ['a'] }, dash)).rejects.toMatchObject({ code: 'AI_PERMISSION_MISSING' });
    expect(session[AI_BATCH_SESSION_KEY]).toBeUndefined();
    expect(ensureOffscreen).not.toHaveBeenCalled();
  });

  it('batch-run 성공: 초기 상태(전부 queued, running)를 세션에 먼저 쓰고 중복 제거한 id와 키를 batch-exec로 주입, 세션에는 키 없음', async () => {
    let sessionAtExec: unknown;
    vi.mocked(send).mockImplementation((async (type: string) => { if (type === 'ai/batch-exec') sessionAtExec = structuredClone(session[AI_BATCH_SESSION_KEY]); return { batchId: 'x' }; }) as never);
    vi.mocked(hasOffscreen).mockResolvedValue(false);
    const r = (await handlerOf('ai/batch-run')({ noticeIds: ['a', 'b', 'a'] }, dash)) as { batchId: string };
    expect(r.batchId).toMatch(/[0-9a-f-]{36}/);
    const init = sessionAtExec as AiBatchState;
    expect(init).toMatchObject({ batchId: r.batchId, provider: 'claude', model: 'claude-sonnet-5-5', status: 'running' });
    expect(init.items).toEqual([{ noticeId: 'a', status: 'queued', attempts: 0 }, { noticeId: 'b', status: 'queued', attempts: 0 }]);
    expect(vi.mocked(send)).toHaveBeenCalledWith('ai/batch-exec', { batchId: r.batchId, noticeIds: ['a', 'b'], provider: 'claude', api: { key: KEY, model: 'claude-sonnet-5-5', sendFullText: true } }, expect.objectContaining({ target: 'offscreen', timeoutMs: 25_000 }));
    expect(JSON.stringify(session)).not.toContain(KEY);
  });

  it('batch-run: batch-exec 실패 시 세션을 stopped로 닫고 오류의 키는 가려 던진다', async () => {
    vi.mocked(hasOffscreen).mockResolvedValue(false);
    vi.mocked(send).mockRejectedValue(Object.assign(new Error(`down ${KEY}`), { code: 'AI_BATCH_BUSY' }));
    const e = await handlerOf('ai/batch-run')({ noticeIds: ['a', 'b'] }, dash).catch((x: Error) => x);
    expect(e).toMatchObject({ code: 'AI_BATCH_BUSY' });
    expect((e as Error).message).not.toContain(KEY);
    const s = session[AI_BATCH_SESSION_KEY] as AiBatchState;
    expect(s.status).toBe('stopped');
    expect(s.items.map((i) => [i.status, i.error?.code])).toEqual([['skipped', 'AI_BATCH_STOPPED'], ['skipped', 'AI_BATCH_STOPPED']]);
    expect(JSON.stringify(session)).not.toContain(KEY);
  });

  it('batch-run: 살아 있는 배치가 있으면 AI_BATCH_BUSY, 고아(offscreen 없음)면 덮어쓰고 시작', async () => {
    session[AI_BATCH_SESSION_KEY] = batchState();
    vi.mocked(hasOffscreen).mockResolvedValue(true);
    vi.mocked(send).mockImplementation((async (type: string) => (type === 'ai/batch-get' ? batchState() : { batchId: 'x' })) as never);
    await expect(handlerOf('ai/batch-run')({ noticeIds: ['a'] }, dash)).rejects.toMatchObject({ code: 'AI_BATCH_BUSY' });
    expect((session[AI_BATCH_SESSION_KEY] as AiBatchState).batchId).toBe('b-old');

    vi.mocked(hasOffscreen).mockResolvedValue(false);
    vi.mocked(send).mockResolvedValue({ batchId: 'x' } as never);
    const r = (await handlerOf('ai/batch-run')({ noticeIds: ['a'] }, dash)) as { batchId: string };
    expect((session[AI_BATCH_SESSION_KEY] as AiBatchState).batchId).toBe(r.batchId);
  });

  it('batch-status: offscreen.html만 수용해 세션에 쓴다(대시보드·탭 거부)', async () => {
    const st = batchState({ status: 'waiting' });
    await expect(handlerOf('ai/batch-status')(st, dash)).rejects.toMatchObject({ code: 'SENDER_FORBIDDEN' });
    await expect(handlerOf('ai/batch-status')(st, tabSender)).rejects.toMatchObject({ code: 'SENDER_FORBIDDEN' });
    expect(session[AI_BATCH_SESSION_KEY]).toBeUndefined();
    await handlerOf('ai/batch-status')(st, offscreenSender);
    expect(session[AI_BATCH_SESSION_KEY]).toEqual(st);
  });

  it('batch-get: 세션이 없으면 null, 끝난 배치는 그대로, 탭 발신은 거부', async () => {
    await expect(handlerOf('ai/batch-get')({}, tabSender)).rejects.toMatchObject({ code: 'SENDER_FORBIDDEN' });
    expect(await handlerOf('ai/batch-get')({}, dash)).toBeNull();
    const done = batchState({ status: 'done' });
    session[AI_BATCH_SESSION_KEY] = done;
    expect(await handlerOf('ai/batch-get')({}, dash)).toEqual(done);
    expect(hasOffscreen).not.toHaveBeenCalled();
  });

  it('batch-get 고아: offscreen이 없으면 ensure하지 않고 stopped(AI_INTERRUPTED)로 덮어쓴다', async () => {
    session[AI_BATCH_SESSION_KEY] = batchState();
    vi.mocked(hasOffscreen).mockResolvedValue(false);
    const r = (await handlerOf('ai/batch-get')({}, dash)) as AiBatchState;
    expect(ensureOffscreen).not.toHaveBeenCalled();
    expect(r).toMatchObject({ status: 'stopped', stopReason: { code: 'AI_INTERRUPTED' } });
    expect(r.items.map((i) => [i.status, i.error?.code])).toEqual([['done', undefined], ['failed', 'AI_INTERRUPTED'], ['skipped', 'AI_BATCH_STOPPED']]);
    expect(r.currentIndex).toBeUndefined();
    expect(session[AI_BATCH_SESSION_KEY]).toEqual(r);
  });

  it('batch-get 고아: offscreen은 있어도 그 배치가 없으면 고아, 같은 배치가 살아 있으면 그 상태를 돌려준다', async () => {
    session[AI_BATCH_SESSION_KEY] = batchState();
    vi.mocked(hasOffscreen).mockResolvedValue(true);
    vi.mocked(send).mockResolvedValue(null as never);
    expect(((await handlerOf('ai/batch-get')({}, dash)) as AiBatchState).status).toBe('stopped');

    session[AI_BATCH_SESSION_KEY] = batchState();
    const live = batchState({ status: 'waiting', updatedAt: 't9' });
    vi.mocked(send).mockResolvedValue(live as never);
    expect(await handlerOf('ai/batch-get')({}, dash)).toEqual(live);
    expect(session[AI_BATCH_SESSION_KEY]).toEqual(live); // 같은 batchId면 그 상태가 최신이므로 세션에도 쓴다
    expect(vi.mocked(send)).toHaveBeenLastCalledWith('ai/batch-get', {}, expect.objectContaining({ target: 'offscreen' }));
  });

  it('batch-get: offscreen이 같은 batchId의 done을 돌려주면 고아로 덮지 않고 done을 유지·기록한다', async () => {
    session[AI_BATCH_SESSION_KEY] = batchState();
    const finished = batchState({ status: 'done', updatedAt: 't9', finishedAt: 't9', items: batchState().items.map((i) => ({ ...i, status: 'done' as const })) });
    vi.mocked(send).mockResolvedValue(finished as never);
    expect(await handlerOf('ai/batch-get')({}, dash)).toEqual(finished);
    expect(session[AI_BATCH_SESSION_KEY]).toEqual(finished);
  });

  it('batch-get: offscreen 응답이 타임아웃·오류면 고아로 보지 않고 세션을 그대로 돌려준다', async () => {
    const cur = batchState();
    session[AI_BATCH_SESSION_KEY] = cur;
    vi.mocked(send).mockRejectedValue(Object.assign(new Error('timeout'), { code: 'TIMEOUT' }));
    expect(await handlerOf('ai/batch-get')({}, dash)).toEqual(cur);
    expect(session[AI_BATCH_SESSION_KEY]).toEqual(cur);
  });

  it('batch-get: 응답을 기다리는 사이 세션이 갱신되면 고아 판정이어도 덮어쓰지 않는다', async () => {
    session[AI_BATCH_SESSION_KEY] = batchState();
    const pushed = batchState({ updatedAt: 't5', status: 'waiting' });
    vi.mocked(send).mockImplementation((async () => { session[AI_BATCH_SESSION_KEY] = pushed; return null; }) as never);
    expect(await handlerOf('ai/batch-get')({}, dash)).toEqual(pushed);
    expect(session[AI_BATCH_SESSION_KEY]).toEqual(pushed);
  });

  it('batch-run 동시 요청: 하나만 진행하고 다른 하나는 AI_BATCH_BUSY, 세션은 첫 배치가 유지된다', async () => {
    vi.mocked(hasOffscreen).mockResolvedValue(false);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    vi.mocked(send).mockImplementation((async () => { await gate; return { batchId: 'x' }; }) as never);
    const first = handlerOf('ai/batch-run')({ noticeIds: ['a'] }, dash);
    const second = handlerOf('ai/batch-run')({ noticeIds: ['b'] }, dash);
    await expect(second).rejects.toMatchObject({ code: 'AI_BATCH_BUSY' });
    await new Promise((r) => setTimeout(r, 10));
    release();
    const { batchId } = (await first) as { batchId: string };
    expect((session[AI_BATCH_SESSION_KEY] as AiBatchState).batchId).toBe(batchId);
    expect((session[AI_BATCH_SESSION_KEY] as AiBatchState).items.map((i) => i.noticeId)).toEqual(['a']);
    // 끝나면 플래그가 풀려 다시 요청할 수 있다
    vi.mocked(send).mockResolvedValue({ batchId: 'y' } as never);
    session[AI_BATCH_SESSION_KEY] = batchState({ status: 'done' });
    await expect(handlerOf('ai/batch-run')({ noticeIds: ['c'] }, dash)).resolves.toBeTruthy();
  });

  it('batch-run: batch-exec가 BUSY로 거절돼도 세션이 남의 배치면 덮어쓰지 않는다', async () => {
    vi.mocked(hasOffscreen).mockResolvedValue(false);
    const other = batchState({ batchId: 'other-batch' });
    vi.mocked(send).mockImplementation((async () => { session[AI_BATCH_SESSION_KEY] = other; throw Object.assign(new Error('busy'), { code: 'AI_BATCH_BUSY' }); }) as never);
    await expect(handlerOf('ai/batch-run')({ noticeIds: ['a'] }, dash)).rejects.toMatchObject({ code: 'AI_BATCH_BUSY' });
    expect(session[AI_BATCH_SESSION_KEY]).toEqual(other);
  });

  it('batch-clear: 실행 중이면 AI_BATCH_BUSY, 끝났으면 세션 삭제, 다른 batchId는 무시, 탭 발신 거부', async () => {
    session[AI_BATCH_SESSION_KEY] = batchState();
    await expect(handlerOf('ai/batch-clear')({ batchId: 'b-old' }, tabSender)).rejects.toMatchObject({ code: 'SENDER_FORBIDDEN' });
    await expect(handlerOf('ai/batch-clear')({ batchId: 'b-old' }, dash)).rejects.toMatchObject({ code: 'AI_BATCH_BUSY' });
    session[AI_BATCH_SESSION_KEY] = batchState({ status: 'waiting' });
    await expect(handlerOf('ai/batch-clear')({ batchId: 'b-old' }, dash)).rejects.toMatchObject({ code: 'AI_BATCH_BUSY' });
    session[AI_BATCH_SESSION_KEY] = batchState({ status: 'stopped' });
    await handlerOf('ai/batch-clear')({ batchId: 'other' }, dash);
    expect(session[AI_BATCH_SESSION_KEY]).toBeDefined();
    await handlerOf('ai/batch-clear')({ batchId: 'b-old' }, dash);
    expect(session[AI_BATCH_SESSION_KEY]).toBeUndefined();
  });

  it('batch-cancel은 확장 페이지만, offscreen으로 중계한다', async () => {
    await expect(handlerOf('ai/batch-cancel')({ batchId: 'b' }, tabSender)).rejects.toMatchObject({ code: 'SENDER_FORBIDDEN' });
    vi.mocked(send).mockResolvedValue({ cancelled: true } as never);
    expect(await handlerOf('ai/batch-cancel')({ batchId: 'b' }, dash)).toEqual({ cancelled: true });
    expect(vi.mocked(send)).toHaveBeenLastCalledWith('ai/batch-cancel', { batchId: 'b' }, expect.objectContaining({ target: 'offscreen' }));
  });
});
