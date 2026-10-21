// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from '../../src/core/types/job';
import { TrackerbotController } from '../../src/ui/trackerbot/controller';
import { ProgressPopup } from '../../src/ui/trackerbot/progress-popup';

const link = (no: string) => `https://www.g2b.go.kr/link/PNPE027_01/single/?bidPbancNo=${no}&bidPbancOrd=000`;
const KEY = 'R26BK01722175-000';
const KEY2 = 'R26BK00000002-000';
const row = (no: string, t: string) => `<tr><td>1</td><td>${t}</td><td><a href="${link(no)}&x=1#h">바로가기</a></td></tr>`;
const H = '<thead><tr><th>번호</th><th>사업명</th><th>링크</th></tr></thead>';
const page = (...rows: string[]) => `<table>${H}<tbody>${rows.join('')}</tbody></table>`;
const at = '2026-10-18T10:00:00.000Z';
const result = { noticeId: KEY, folder: 'f', attachments: [{ name: 'a', savedName: null, status: 'saved', size: null }] };

const job = (p: Partial<Job> = {}): Job => ({
  id: 'j1', type: 'collect', status: 'running', steps: [], attempt: 1, createdAt: at, updatedAt: at, errors: [],
  ref: { noticeNo: 'R26BK01722175', round: '000', origin: 'trackerbot' }, ...p,
});
const later = (n: number) => `2026-10-18T10:00:0${n}.000Z`;

type Handler = (payload: any) => unknown;
let store: Record<string, Job>;
function setup(handlers: Record<string, Handler> = {}, opts: { orphaned?: () => boolean } = {}) {
  const calls: Array<{ type: string; payload: any }> = [];
  const send = vi.fn(async (type: string, payload: any) => {
    calls.push({ type, payload });
    const h = handlers[type];
    if (h) return h(payload);
    if (type === 'notice/lookup-batch') return payload.refs.map(() => ({ found: false }));
    if (type === 'job/list-for-tab') return [];
    if (type === 'notice/lookup') return { found: false };
    if (type === 'job/get') return store[payload.jobId] ?? null;
    return undefined;
  });
  const c = new TrackerbotController(document, { send: send as never, now: () => Date.parse('2026-10-18T10:05:00.000Z'), isOrphaned: opts.orphaned ?? (() => false) });
  const p = new ProgressPopup(document, c);
  const flush = async () => { await c.whenIdle(); await vi.advanceTimersByTimeAsync(0); };
  return { c, p, calls, flush };
}
const host = () => document.querySelector('[data-bidmate="progress"]') as HTMLElement;
const root = () => host().shadowRoot!.querySelector('.root')!;
const items = () => Array.from(root().querySelectorAll('.item'));
const btn = (t: string) => Array.from(root().querySelectorAll('button')).find((b) => b.textContent === t)!;
const stepText = (i = 0) => items()[i]!.querySelector('.step')!.textContent;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
  store = {};
});
afterEach(() => { vi.useRealTimers(); });

describe('ProgressPopup', () => {
  it('job/start -> job/get running -> active 1항목', async () => {
    document.body.innerHTML = page(row('R26BK01722175', 'A'));
    store.j1 = job({ currentStep: 'fetch_basic' });
    const { c, p, flush } = setup({ 'job/start': () => ({ jobId: 'j1' }) });
    p.start(); c.scan(); await flush();
    await c.collect(KEY); await flush();
    expect(items()).toHaveLength(1);
    expect(items()[0]!.querySelector('.step.active')).not.toBeNull();
    p.stop(); c.stop();
  });

  it('completed -> ok, 8초 뒤 hidden. hover 중에는 유지, 해제 후 2초 뒤 소멸', async () => {
    document.body.innerHTML = page(row('R26BK01722175', 'A'));
    store.j1 = job();
    const { c, p, flush } = setup({ 'job/start': () => ({ jobId: 'j1' }) });
    p.start(); c.scan(); await flush();
    await c.collect(KEY); await flush();
    c.onJobUpdate(job({ status: 'completed', updatedAt: later(1), result })); await flush();
    expect(stepText()).toBe('수집 완료');
    await vi.advanceTimersByTimeAsync(7000);
    host().dispatchEvent(new Event('mouseenter'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(items()).toHaveLength(1);
    host().dispatchEvent(new Event('mouseleave'));
    await vi.advanceTimersByTimeAsync(2000);
    expect(items()).toHaveLength(0);
    p.stop(); c.stop();
  });

  it('hover 없으면 8초 뒤 소멸', async () => {
    document.body.innerHTML = page(row('R26BK01722175', 'A'));
    store.j1 = job();
    const { c, p, flush } = setup({ 'job/start': () => ({ jobId: 'j1' }) });
    p.start(); c.scan(); await flush();
    await c.collect(KEY); await flush();
    c.onJobUpdate(job({ status: 'completed', updatedAt: later(1), result })); await flush();
    await vi.advanceTimersByTimeAsync(7900);
    expect(items()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(items()).toHaveLength(0);
    p.stop(); c.stop();
  });

  it('partial -> warn 유지, 닫기 -> hidden, 새 jobId running -> 다시 표시', async () => {
    document.body.innerHTML = page(row('R26BK01722175', 'A'));
    store.j1 = job();
    const { c, p, flush } = setup({ 'job/start': (pl) => ({ jobId: pl.retryOf ? 'j2' : 'j1' }) });
    p.start(); c.scan(); await flush();
    await c.collect(KEY); await flush();
    c.onJobUpdate(job({ status: 'partial', updatedAt: later(1), result: { ...result, attachments: [{ name: 'a', savedName: null, status: 'failed', size: null }] } })); await flush();
    expect(items()[0]!.querySelector('.step.warn')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(30000);
    expect(items()).toHaveLength(1);
    btn('닫기').click(); await flush();
    expect(items()).toHaveLength(0);
    store.j2 = job({ id: 'j2', createdAt: later(5), updatedAt: later(5) });
    await c.collect(KEY, 'j1'); await flush();
    expect(items()).toHaveLength(1);
    expect(items()[0]!.querySelector('.step.active')).not.toBeNull();
    p.stop(); c.stop();
  });

  it('복원된 끝난 잡 -> hidden', async () => {
    document.body.innerHTML = page(row('R26BK01722175', 'A'));
    const { c, p, flush } = setup({ 'job/list-for-tab': () => [job({ status: 'completed', updatedAt: '2026-10-18T10:04:00.000Z', result })] });
    p.start(); c.scan(); await flush();
    expect(c.getEntry(KEY)?.job?.status).toBe('completed');
    expect(items()).toHaveLength(0);
    p.stop(); c.stop();
  });

  it('completed + handoff queued -> 대기 중 유지 -> compose running -> completed -> ok -> 8초 뒤 소멸', async () => {
    document.body.innerHTML = page(row('R26BK01722175', 'A'));
    store.j1 = job();
    const { c, p, flush } = setup({ 'job/start': () => ({ jobId: 'j1' }) });
    p.start(); c.scan(); await flush();
    await c.collect(KEY); await flush();
    const queued = job({ status: 'completed', updatedAt: later(1), result, handoff: { action: 'compose', state: 'queued', at } });
    store.j1 = queued;
    c.onJobUpdate(queued); await flush();
    expect(stepText()).toBe('메일 작성 대기 중');
    await vi.advanceTimersByTimeAsync(20000);
    expect(stepText()).toBe('메일 작성 대기 중');

    const started = job({ status: 'completed', updatedAt: later(2), result, handoff: { action: 'compose', state: 'started', jobId: 'c1', at } });
    const compose = job({ id: 'c1', type: 'compose', status: 'running', currentStep: 'fill_fields', updatedAt: later(2) });
    store.j1 = started; store.c1 = compose;
    c.onJobUpdate(started); await flush();
    expect(items()).toHaveLength(1);
    expect(items()[0]!.querySelector('.chip')!.textContent).toBe('메일 작성');
    expect(items()[0]!.querySelector('.step.active')).not.toBeNull();

    const done = job({ id: 'c1', type: 'compose', status: 'completed', updatedAt: later(3) });
    store.c1 = done;
    c.onJobUpdate(done); await flush();
    expect(stepText()).toBe('메일 작성됨');
    await vi.advanceTimersByTimeAsync(8000);
    expect(items()).toHaveLength(0);
    p.stop(); c.stop();
  });

  it('접기 -> pill, 새 잡 시작해도 pill 유지, 클릭 -> card', async () => {
    document.body.innerHTML = page(row('R26BK01722175', 'A'), row('R26BK00000002', 'B'));
    store.j1 = job();
    store.j2 = job({ id: 'j2', ref: { noticeNo: 'R26BK00000002', round: '000', origin: 'trackerbot' } });
    const { c, p, flush } = setup({ 'job/start': (pl) => ({ jobId: pl.ref.noticeNo === 'R26BK01722175' ? 'j1' : 'j2' }) });
    p.start(); c.scan(); await flush();
    await c.collect(KEY); await flush();
    btn('접기').click(); await flush();
    expect(root().querySelector('.pill')!.textContent).toBe('작업 1건 진행 중');
    await c.collect(KEY2); await flush();
    expect(root().querySelector('.pill')!.textContent).toBe('작업 2건 진행 중');
    (root().querySelector('.pill') as HTMLButtonElement).click(); await flush();
    expect(items()).toHaveLength(2);
    p.stop(); c.stop();
  });

  it('orphaned -> hidden', async () => {
    document.body.innerHTML = page(row('R26BK01722175', 'A'));
    store.j1 = job();
    let orphan = false;
    const { c, p, flush } = setup({ 'job/start': () => ({ jobId: 'j1' }) }, { orphaned: () => orphan });
    p.start(); c.scan(); await flush();
    await c.collect(KEY); await flush();
    expect(items()).toHaveLength(1);
    orphan = true;
    c.onJobUpdate(job({ updatedAt: later(1) })); await flush();
    expect(items()).toHaveLength(0);
    p.stop(); c.stop();
  });

  const askJob = (p: Partial<Job> = {}) => job({ status: 'completed', updatedAt: later(1), result, handoff: { action: 'ask', at }, ...p });

  it('끝난 ask 항목: 메일 작성/상세 클릭 -> ui/open', async () => {
    document.body.innerHTML = page(row('R26BK01722175', 'A'));
    store.j1 = job();
    const { c, p, calls, flush } = setup({ 'job/start': () => ({ jobId: 'j1' }) });
    p.start(); c.scan(); await flush();
    await c.collect(KEY); await flush();
    store.j1 = askJob();
    c.onJobUpdate(store.j1); await flush();
    expect(stepText()).toBe('수집 완료');
    expect(btn('바로 작성')).toBeUndefined();
    expect(btn('대시보드 편집')).toBeUndefined();
    btn('메일 작성').click(); await flush();
    expect(calls.filter((x) => x.type === 'ui/open').map((x) => x.payload)).toMatchObject([{ page: 'mail' }]);
    btn('상세').click(); await flush();
    expect(calls.filter((x) => x.type === 'ui/open').map((x) => x.payload)).toMatchObject([{ page: 'mail' }, { page: 'notice' }]);
    p.stop(); c.stop();
  });

  it('ask 항목은 8초 뒤에도 닫히지 않음', async () => {
    document.body.innerHTML = page(row('R26BK01722175', 'A'));
    store.j1 = job();
    const { c, p, flush } = setup({ 'job/start': () => ({ jobId: 'j1' }) });
    p.start(); c.scan(); await flush();
    await c.collect(KEY); await flush();
    c.onJobUpdate(askJob()); await flush();
    await vi.advanceTimersByTimeAsync(30000);
    expect(items()).toHaveLength(1);
    expect(btn('메일 작성')).toBeDefined();
    p.stop(); c.stop();
  });

  it('시작 시 seen에 없던 ask handoff 잡도 보임', async () => {
    document.body.innerHTML = page(row('R26BK01722175', 'A'));
    const { c, p, flush } = setup({ 'job/list-for-tab': () => [askJob({ updatedAt: '2026-10-18T10:04:00.000Z' })] });
    p.start(); c.scan(); await flush();
    expect(items()).toHaveLength(1);
    expect(btn('메일 작성')).toBeDefined();
    expect(btn('상세')).toBeDefined();
    expect(btn('바로 작성')).toBeUndefined();
    p.stop(); c.stop();
  });

  it('ask 항목도 닫기 뒤에는 숨김', async () => {
    document.body.innerHTML = page(row('R26BK01722175', 'A'));
    const { c, p, flush } = setup({ 'job/list-for-tab': () => [askJob({ updatedAt: '2026-10-18T10:04:00.000Z' })] });
    p.start(); c.scan(); await flush();
    btn('닫기').click(); await flush();
    expect(items()).toHaveLength(0);
    p.stop(); c.stop();
  });

  it('취소 클릭 -> job/cancel (compose active면 compose id)', async () => {
    document.body.innerHTML = page(row('R26BK01722175', 'A'));
    store.j1 = job();
    const { c, p, calls, flush } = setup({ 'job/start': () => ({ jobId: 'j1' }) });
    p.start(); c.scan(); await flush();
    await c.collect(KEY); await flush();
    btn('취소').click(); await flush();
    expect(calls.filter((x) => x.type === 'job/cancel').map((x) => x.payload)).toEqual([{ jobId: 'j1' }]);

    const started = job({ status: 'completed', updatedAt: later(2), result, handoff: { action: 'compose', state: 'started', jobId: 'c1', at } });
    store.j1 = started; store.c1 = job({ id: 'c1', type: 'compose', status: 'running', currentStep: 'fill_fields', updatedAt: later(2) });
    c.onJobUpdate(started); await flush();
    btn('취소').click(); await flush();
    expect(calls.filter((x) => x.type === 'job/cancel').map((x) => x.payload).at(-1)).toEqual({ jobId: 'c1' });
    p.stop(); c.stop();
  });

  it('접은 상태에서도 ok는 8초 뒤 소멸(pill -> hidden)', async () => {
    document.body.innerHTML = page(row('R26BK01722175', 'A'));
    store.j1 = job();
    const { c, p, flush } = setup({ 'job/start': () => ({ jobId: 'j1' }) });
    p.start(); c.scan(); await flush();
    await c.collect(KEY); await flush();
    c.onJobUpdate(job({ status: 'completed', updatedAt: later(1), result })); await flush();
    btn('접기').click(); await flush();
    expect(root().querySelector('.pill')!.textContent).toBe('완료 1건');
    await vi.advanceTimersByTimeAsync(8000);
    expect(root().childElementCount).toBe(0);
    p.stop(); c.stop();
  });

  // 7개 공고를 모두 완료시킨다(화면에는 5개만 보인다)
  const completeSeven = async () => {
    const nos = Array.from({ length: 7 }, (_, i) => `R26BK0000000${i + 1}`);
    document.body.innerHTML = page(...nos.map((n) => row(n, n)));
    const ref = (n: string) => ({ noticeNo: n, round: '000', origin: 'trackerbot' as const });
    nos.forEach((n, i) => { store[`j${i}`] = job({ id: `j${i}`, ref: ref(n) }); });
    const t = setup({ 'job/start': (pl) => ({ jobId: `j${nos.indexOf(pl.ref.noticeNo)}` }) });
    t.p.start(); t.c.scan(); await t.flush();
    for (const n of nos) await t.c.collect(`${n}-000`);
    await t.flush();
    nos.forEach((n, i) => t.c.onJobUpdate(job({ id: `j${i}`, ref: ref(n), status: 'completed', updatedAt: later(i + 1), result })));
    await t.flush();
    return t;
  };

  it('5개 초과로 잘린 ok 항목도 8초 뒤 소멸', async () => {
    const { c, p } = await completeSeven();
    expect(items()).toHaveLength(5);
    await vi.advanceTimersByTimeAsync(8000);
    expect(items()).toHaveLength(0);
    expect(root().childElementCount).toBe(0);
    p.stop(); c.stop();
  });

  it('모두 닫기가 잘린 끝난 항목까지 닫음', async () => {
    const { c, p, flush } = await completeSeven();
    btn('모두 닫기').click(); await flush();
    expect(items()).toHaveLength(0);
    expect(root().childElementCount).toBe(0);
    p.stop(); c.stop();
  });

  it('job/start 직후 첫 job/get이 failed여도 error 항목이 남음', async () => {
    document.body.innerHTML = page(row('R26BK01722175', 'A'));
    store.j1 = job({ status: 'failed', errors: [{ code: 'X', message: 'm', retryable: true }] });
    const { c, p, flush } = setup({ 'job/start': () => ({ jobId: 'j1' }) });
    p.start(); c.scan(); await flush();
    await c.collect(KEY); await flush();
    expect(items()).toHaveLength(1);
    expect(items()[0]!.querySelector('.step.error')).not.toBeNull();
    p.stop(); c.stop();
  });

  it('복원된 completed 잡이 있는 행에서 job/start가 reject돼도 hidden 유지', async () => {
    document.body.innerHTML = page(row('R26BK01722175', 'A'));
    const { c, p, flush } = setup({
      'job/list-for-tab': () => [job({ status: 'completed', updatedAt: '2026-10-18T10:04:00.000Z', result })],
      'job/start': () => { throw new Error('boom'); },
    });
    p.start(); c.scan(); await flush();
    await c.collect(KEY); await flush();
    expect(c.getEntry(KEY)?.job?.status).toBe('completed');
    expect(items()).toHaveLength(0);
    expect(p.getSession().seen.size).toBe(0);
    p.stop(); c.stop();
  });

  it('첫 수집에서 job/start reject 후에도 이후 정상 시작이 동작', async () => {
    document.body.innerHTML = page(row('R26BK01722175', 'A'));
    store.j1 = job();
    let fail = true;
    const { c, p, flush } = setup({ 'job/start': () => { if (fail) throw new Error('boom'); return { jobId: 'j1' }; } });
    p.start(); c.scan(); await flush();
    await c.collect(KEY); await flush();
    expect(items()).toHaveLength(0);
    fail = false;
    await c.collect(KEY); await flush();
    expect(items()).toHaveLength(1);
    expect(items()[0]!.querySelector('.step.active')).not.toBeNull();
    p.stop(); c.stop();
  });
});
