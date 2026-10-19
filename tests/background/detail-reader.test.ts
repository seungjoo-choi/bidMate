import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BusError } from '../../src/messaging/bus';
import { readDetail, setDetailReaderDeps } from '../../src/background/detail-reader';
import type { Job } from '../../src/core/types/job';

const html = (v: string) => ({ capturedAt: 't', fields: { projectPeriod: { raw: v, ref: 'r' } } });
const REF = { noticeNo: 'R26BK01722175', round: '000', origin: 'trackerbot' as const };
const mkJob = (extra: Partial<Job> = {}): Job => ({
  id: 'j1', type: 'collect', status: 'running', ref: REF, steps: [], attempt: 1, createdAt: 't', updatedAt: 't', errors: [], ...extra,
});

type Hook = { onTick?: (tick: number) => void };

function setup(o: {
  job?: (id: string) => Job | undefined;
  reply?: (tick: number, call: number) => unknown; // 오류 객체면 throw
  tabUrl?: (tick: number) => string;
  timeoutMs?: number;
  jump?: number; // sleep마다 추가로 흐르는 시간
} & Hook = {}) {
  let clock = 0;
  let tick = 0;
  let call = 0;
  let nextId = 100;
  const removed: Array<(id: number) => void> = [];
  const log: string[] = [];
  const tabs = {
    create: vi.fn(async (p: { url?: string; windowId?: number }) => { log.push('create'); return { id: nextId++, url: p.url } as chrome.tabs.Tab; }),
    get: vi.fn(async (id: number) => ({ id, windowId: 7, url: o.tabUrl?.(tick) ?? 'https://www.g2b.go.kr/x' }) as chrome.tabs.Tab),
    remove: vi.fn(async () => { log.push('remove'); }),
    onRemoved: { addListener: (fn: (id: number) => void) => removed.push(fn), removeListener: (fn: (id: number) => void) => { removed.splice(removed.indexOf(fn), 1); } },
  };
  const windows = { getLastFocused: vi.fn(async () => ({ id: 42 }) as chrome.windows.Window) };
  const sendToTab = vi.fn(async () => {
    const r = o.reply?.(tick, call++) ?? { detected: { noticeNo: REF.noticeNo }, match: true, html: html('A'), readyState: 'complete' };
    if (r instanceof Error) throw r;
    return r;
  });
  setDetailReaderDeps({
    tabs: tabs as never, windows: windows as never, sendToTab: sendToTab as never,
    getJob: async (id) => (o.job ? o.job(id) : mkJob({ id })),
    now: () => clock,
    sleep: async (ms) => { clock += ms + (o.jump ?? 0); tick++; o.onTick?.(tick); },
    pollMs: 700, settleMs: 1500, timeoutMs: o.timeoutMs ?? 45_000,
  });
  return { tabs, windows, sendToTab, removed, log };
}

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: BusError) => e.code);

beforeEach(() => setDetailReaderDeps({}));

describe('readDetail', () => {
  it('(1) 2회 동일 스냅샷 + 1.5s 경과 후 성공, remove 1회', async () => {
    const s = setup();
    const r = await readDetail('j1');
    expect(r.html).toEqual(html('A'));
    expect(r.elapsedMs.detect).toBe(0);
    expect(r.elapsedMs.stable).toBeGreaterThanOrEqual(1500);
    expect(s.tabs.remove).toHaveBeenCalledTimes(1);
    expect(s.removed).toHaveLength(0);
    expect(s.tabs.create.mock.calls[0]![0]).toMatchObject({ active: false, url: expect.stringContaining('bidPbancNo=R26BK01722175') });
  });

  it('(2) match 없음 45s → DETAIL_TIMEOUT, 탭 닫힘', async () => {
    const s = setup({ reply: () => ({ detected: null, match: false, html: null, readyState: 'loading' }) });
    expect(await code(readDetail('j1'))).toBe('DETAIL_TIMEOUT');
    expect(s.tabs.remove).toHaveBeenCalledTimes(1);
  });

  it('(3) onRemoved → DETAIL_TAB_CLOSED', async () => {
    const s = setup({ onTick: (t) => { if (t === 2) s.removed.slice().forEach((fn) => fn(100)); }, reply: () => ({ detected: null, match: false, html: null, readyState: 'loading' }) });
    expect(await code(readDetail('j1'))).toBe('DETAIL_TAB_CLOSED');
    expect(s.removed).toHaveLength(0);
  });

  it('(4) 폴링 중 잡 취소 → DETAIL_CANCELLED, 탭 닫힘', async () => {
    let cancelled = false;
    const s = setup({ job: () => mkJob({ status: cancelled ? 'cancelled' : 'running' }), onTick: (t) => { if (t === 1) cancelled = true; }, reply: () => ({ detected: null, match: false, html: null, readyState: 'loading' }) });
    expect(await code(readDetail('j1'))).toBe('DETAIL_CANCELLED');
    expect(s.tabs.remove).toHaveBeenCalledTimes(1);
  });

  it('(5) URL 호스트 변경 → DETAIL_REDIRECTED', async () => {
    const s = setup({ tabUrl: (t) => (t >= 1 ? 'https://login.example.com/' : 'about:blank') });
    expect(await code(readDetail('j1'))).toBe('DETAIL_REDIRECTED');
    expect(s.tabs.remove).toHaveBeenCalledTimes(1);
  });

  it('(6) 동시 2요청 → 두 번째 create는 첫 remove 이후', async () => {
    const s = setup();
    const [a, b] = await Promise.all([readDetail('j1'), readDetail('j1')]);
    expect(a.html).toBeTruthy();
    expect(b.html).toBeTruthy();
    expect(s.log).toEqual(['create', 'remove', 'create', 'remove']);
  });

  it('(7) 수신자 없음 3회 후 응답 → 성공', async () => {
    const s = setup({ reply: (_t, c) => (c < 3 ? new BusError('NO_RECEIVER', 'x') : { detected: { noticeNo: REF.noticeNo }, match: true, html: html('A'), readyState: 'complete' }) });
    const r = await readDetail('j1');
    expect(r.html).toEqual(html('A'));
    expect(r.elapsedMs.detect).toBeGreaterThanOrEqual(3 * 700);
    expect(s.sendToTab.mock.calls.length).toBeGreaterThan(3);
  });

  it('(8) 매 틱 다른 스냅샷 → 45s에 마지막 스냅샷으로 성공', async () => {
    setup({ reply: (_t, c) => ({ detected: { noticeNo: REF.noticeNo }, match: true, html: html(`v${c}`), readyState: 'complete' }) });
    const r = await readDetail('j1');
    expect(r.html.fields.projectPeriod?.raw).toMatch(/^v\d+$/);
    expect(r.elapsedMs.stable).toBeGreaterThanOrEqual(45_000);
  });

  it('(9) 큐 대기 중 잡 취소 → create 없이 DETAIL_CANCELLED', async () => {
    const s = setup({ job: (id) => mkJob({ id, status: id === 'j2' ? 'cancelled' : 'running' }) });
    const a = readDetail('j1');
    const b = readDetail('j2');
    expect(await code(a)).toBe('ok');
    expect(await code(b)).toBe('DETAIL_CANCELLED');
    expect(s.tabs.create).toHaveBeenCalledTimes(1);
  });

  it('(11) 폴링 중 잡이 cancelling으로 바뀌면 DETAIL_CANCELLED, 탭 닫힘', async () => {
    let cancelling = false;
    const s = setup({ job: () => mkJob({ status: cancelling ? 'cancelling' : 'running' }), onTick: (t) => { if (t === 1) cancelling = true; }, reply: () => ({ detected: null, match: false, html: null, readyState: 'loading' }) });
    expect(await code(readDetail('j1'))).toBe('DETAIL_CANCELLED');
    expect(s.tabs.remove).toHaveBeenCalledTimes(1);
  });

  it('(12) 시작 시 이미 cancelling이면 create 없이 DETAIL_CANCELLED', async () => {
    const s = setup({ job: () => mkJob({ status: 'cancelling' }) });
    expect(await code(readDetail('j1'))).toBe('DETAIL_CANCELLED');
    expect(s.tabs.create).not.toHaveBeenCalled();
  });

  it('(13) 큐 대기가 길어 now-requestedAt+timeout > 240s이면 create 없이 DETAIL_TIMEOUT', async () => {
    const s = setup({ jump: 200_000 });
    const a = readDetail('j1');
    const b = readDetail('j2');
    expect(await code(a)).toBe('ok');
    expect(await code(b)).toBe('DETAIL_TIMEOUT');
    expect(s.tabs.create).toHaveBeenCalledTimes(1);
  });

  it('(10) originTabId 창 사용 / 없으면 lastFocused', async () => {
    const s = setup({ job: () => mkJob({ originTabId: 5 }) });
    await readDetail('j1');
    expect(s.tabs.create.mock.calls[0]![0]).toMatchObject({ windowId: 7, openerTabId: 5 });
    expect(s.windows.getLastFocused).not.toHaveBeenCalled();

    const s2 = setup();
    await readDetail('j1');
    expect(s2.tabs.create.mock.calls[0]![0]).toMatchObject({ windowId: 42 });
    expect(s2.tabs.create.mock.calls[0]![0]).not.toHaveProperty('openerTabId');
  });
});
