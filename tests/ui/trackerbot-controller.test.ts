// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from '../../src/core/types/job';
import { TrackerbotController } from '../../src/ui/trackerbot/controller';

const BID = 'https://www.g2b.go.kr/link/PNPE027_01/single/?bidPbancNo=R26BK01722175&bidPbancOrd=000';
const KEY = 'R26BK01722175-000';
const H = '<thead><tr><th>번호</th><th>사업명</th><th>링크</th></tr></thead>';
const row = (t: string) => `<tr><td>1</td><td>${t}</td><td><a href="${BID}&x=1#h">바로가기</a></td></tr>`;
const page = (...rows: string[]) => `<table>${H}<tbody>${rows.join('')}</tbody></table>`;

const job = (p: Partial<Job> = {}): Job => ({
  id: 'j1', type: 'collect', status: 'running', steps: [], attempt: 1, createdAt: '', updatedAt: '2026-10-18T10:00:00.000Z', errors: [],
  ref: { noticeNo: 'R26BK01722175', round: '000', origin: 'trackerbot' }, ...p,
});

type Handler = (payload: any) => unknown;
function setup(handlers: Record<string, Handler> = {}, opts: { orphaned?: () => boolean; now?: () => number } = {}) {
  const calls: Array<{ type: string; payload: any }> = [];
  const send = vi.fn(async (type: string, payload: any) => {
    calls.push({ type, payload });
    const h = handlers[type];
    if (h) return h(payload);
    if (type === 'notice/lookup-batch') return payload.refs.map(() => ({ found: false }));
    if (type === 'job/list-for-tab') return [];
    if (type === 'notice/lookup') return { found: false };
    return undefined;
  });
  const c = new TrackerbotController(document, { send: send as never, now: opts.now ?? (() => Date.parse('2026-10-18T10:05:00.000Z')), isOrphaned: opts.orphaned ?? (() => false) });
  return { c, calls, send };
}
const hosts = () => document.querySelectorAll('[data-bidmate="collect"]');
const label = (i = 0) => hosts()[i]!.shadowRoot!.querySelector('button')!.textContent;

beforeEach(() => { document.body.innerHTML = ''; });

describe('TrackerbotController', () => {
  it('재스캔 멱등: 앵커당 host 1개', async () => {
    document.body.innerHTML = page(row('A'));
    const { c } = setup();
    c.scan(); c.scan(); c.scan();
    await c.whenIdle();
    expect(hosts()).toHaveLength(1);
    expect(c.getEntry(KEY)?.title).toBe('A');
  });

  it('같은 키 두 버튼 상태 공유', async () => {
    document.body.innerHTML = page(row('A'), row('A'));
    const { c } = setup({ 'notice/lookup-batch': (p) => p.refs.map(() => ({ found: true, collectedAt: '2026-10-17T00:00:00.000Z' })) });
    c.scan();
    await c.whenIdle();
    expect(hosts()).toHaveLength(2);
    expect(label(0)).toBe('다시 수집');
    expect(label(1)).toBe('다시 수집');
  });

  it('클릭 시 job/start payload', async () => {
    document.body.innerHTML = page(row('A'));
    const { c, calls } = setup({ 'job/start': () => ({ jobId: 'j1' }), 'job/get': () => job() });
    c.scan();
    await c.whenIdle();
    hosts()[0]!.shadowRoot!.querySelector('button')!.click();
    await c.whenIdle();
    await vi.waitFor(() => expect(calls.some((x) => x.type === 'job/get')).toBe(true));
    const start = calls.find((x) => x.type === 'job/start')!;
    expect(start.payload).toEqual({ type: 'collect', ref: { noticeNo: 'R26BK01722175', round: '000', detailUrl: BID, origin: 'trackerbot' } });
    expect(start.payload).not.toHaveProperty('html');
    expect(c.getEntry(KEY)?.job?.id).toBe('j1');
    c.stop();
  });

  it('JOB_ALREADY_RUNNING: 이 탭 잡이면 붙인다', async () => {
    document.body.innerHTML = page(row('A'));
    const { c } = setup({ 'job/start': () => ({ jobId: 'j9', code: 'JOB_ALREADY_RUNNING' }), 'job/get': () => job({ id: 'j9' }) });
    c.scan();
    await c.whenIdle();
    await c.collect(KEY);
    expect(c.getEntry(KEY)?.job?.id).toBe('j9');
    expect(c.getEntry(KEY)?.otherTab).toBe(false);
    c.stop();
  });

  it('JOB_ALREADY_RUNNING: 조회 결과 null이면 otherTab', async () => {
    document.body.innerHTML = page(row('A'));
    const { c } = setup({ 'job/start': () => ({ jobId: 'j9', code: 'JOB_ALREADY_RUNNING' }), 'job/get': () => null });
    c.scan();
    await c.whenIdle();
    await c.collect(KEY);
    expect(c.getEntry(KEY)?.job).toBeNull();
    expect(c.getEntry(KEY)?.otherTab).toBe(true);
  });

  it('applyJob 순서 가드', async () => {
    document.body.innerHTML = page(row('A'));
    const { c } = setup({ 'job/list-for-tab': () => [job()] });
    c.scan();
    await c.whenIdle();
    c.onJobUpdate(job({ status: 'completed', attempt: 2, updatedAt: '2026-10-18T10:01:00.000Z' }));
    c.onJobUpdate(job({ status: 'running', attempt: 1, updatedAt: '2026-10-18T10:02:00.000Z' }));
    expect(c.getEntry(KEY)?.job?.status).toBe('completed');
    c.onJobUpdate(job({ status: 'running', attempt: 2, updatedAt: '2026-10-18T10:03:00.000Z' }));
    expect(c.getEntry(KEY)?.job?.status).toBe('completed');
    c.onJobUpdate(job({ status: 'completed', attempt: 2, updatedAt: '2026-10-18T09:00:00.000Z' }));
    expect(c.getEntry(KEY)?.job?.updatedAt).toBe('2026-10-18T10:01:00.000Z');
    c.stop();
  });

  it('FINAL 전이 후 notice/lookup 재조회', async () => {
    document.body.innerHTML = page(row('A'));
    const { c, calls } = setup({ 'job/list-for-tab': () => [job()] });
    c.scan();
    await c.whenIdle();
    c.onJobUpdate(job({ status: 'completed', updatedAt: '2026-10-18T10:01:00.000Z' }));
    await c.whenIdle();
    expect(calls.filter((x) => x.type === 'notice/lookup')).toHaveLength(1);
    c.stop();
  });

  it('list-for-tab 복원: ACTIVE는 항상, FINAL은 10분 창', async () => {
    const other = 'https://www.g2b.go.kr/link/PNPE027_01/single/?bidPbancNo=R26BK00000001&bidPbancOrd=000';
    document.body.innerHTML = page(row('A'), `<tr><td>2</td><td>B</td><td><a href="${other}">바로가기</a></td></tr>`);
    const { c } = setup({
      'job/list-for-tab': () => [
        job({ id: 'a', status: 'completed', updatedAt: '2026-10-18T09:00:00.000Z' }),
        job({ id: 'b', status: 'completed', updatedAt: '2026-10-18T10:00:00.000Z', ref: { noticeNo: 'R26BK00000001', round: '000', origin: 'trackerbot' } }),
      ],
    });
    c.scan();
    await c.whenIdle();
    expect(c.getEntry(KEY)?.job).toBeNull();
    expect(c.getEntry('R26BK00000001-000')?.job?.id).toBe('b');
  });

  it('표 재렌더 후 새 앵커에 기존 상태 렌더', async () => {
    document.body.innerHTML = page(row('A'));
    const { c } = setup({ 'job/list-for-tab': () => [job({ status: 'completed', updatedAt: '2026-10-18T10:04:00.000Z', result: { noticeId: KEY, folder: 'f', attachments: [] } })] });
    c.scan();
    await c.whenIdle();
    expect(label()).toContain('수집 완료');
    document.body.innerHTML = page(row('A'));
    c.scan();
    await c.whenIdle();
    expect(hosts()).toHaveLength(1);
    expect(label()).toContain('수집 완료');
  });

  it('고아 시 disabled', async () => {
    document.body.innerHTML = page(row('A'));
    let orphan = false;
    const { c } = setup({}, { orphaned: () => orphan });
    c.scan();
    await c.whenIdle();
    expect(label()).toBe('공고 수집');
    orphan = true;
    c.onJobUpdate(job());
    c.scan();
    document.body.innerHTML = page(row('A'));
    c.scan();
    await c.whenIdle();
    expect(label()).toBe('새로고침 필요');
  });

  it('첫 scan 때 본문이 비어 있다가 표가 추가되면 ACTIVE 잡 복원, 이후 job/update 반영', async () => {
    const { c } = setup({ 'job/list-for-tab': () => [job()] });
    c.scan();
    await c.whenIdle();
    expect(c.getEntry(KEY)).toBeUndefined();
    document.body.innerHTML = page(row('A'));
    c.scan();
    await c.whenIdle();
    expect(c.getEntry(KEY)?.job?.status).toBe('running');
    c.onJobUpdate(job({ status: 'completed', updatedAt: '2026-10-18T10:01:00.000Z' }));
    expect(c.getEntry(KEY)?.job?.status).toBe('completed');
    c.stop();
  });

  it('웹메일이 host만 지우면 다음 scan에서 버튼 재생성(앵커당 1개)', async () => {
    document.body.innerHTML = page(row('A'));
    const { c } = setup();
    c.scan();
    await c.whenIdle();
    hosts()[0]!.remove();
    expect(hosts()).toHaveLength(0);
    c.scan();
    await c.whenIdle();
    expect(hosts()).toHaveLength(1);
    c.scan();
    await c.whenIdle();
    expect(hosts()).toHaveLength(1);
  });

  it('새 키가 없는 재scan은 조회하지 않는다', async () => {
    document.body.innerHTML = page(row('A'));
    const { c, send } = setup();
    c.scan();
    await c.whenIdle();
    send.mockClear();
    c.scan();
    await c.whenIdle();
    expect(send).not.toHaveBeenCalled();
  });
});

describe('TrackerbotController handoff', () => {
  const at = '2026-10-18T10:00:00.000Z';
  const doneJob = (handoff?: Job['handoff']) => job({ status: 'completed', result: { noticeId: KEY, folder: 'f', attachments: [] }, ...(handoff ? { handoff } : {}) });
  const compose = (p: Partial<Job> = {}): Job => job({ id: 'cp1', type: 'compose', status: 'running', ...p });
  const started: Job['handoff'] = { action: 'compose', state: 'started', jobId: 'cp1', at };

  it('restore: handoff.jobId로 job/get 후 compose 반영', async () => {
    document.body.innerHTML = page(row('A'));
    const { c, calls } = setup({
      'job/list-for-tab': () => [doneJob(started)],
      'job/get': (p) => (p.jobId === 'cp1' ? compose({ status: 'completed' }) : null),
    });
    c.scan();
    await c.whenIdle();
    await vi.waitFor(() => expect(c.getEntry(KEY)?.compose?.id).toBe('cp1'));
    expect(calls.filter((x) => x.type === 'job/get').map((x) => x.payload)).toEqual([{ jobId: 'cp1' }]);
    expect(label()).toBe('메일 작성됨');
    c.stop();
  });

  it('compose job/update 반영', async () => {
    document.body.innerHTML = page(row('A'));
    const { c } = setup({ 'job/list-for-tab': () => [doneJob(started)], 'job/get': () => compose() });
    c.scan();
    await c.whenIdle();
    await vi.waitFor(() => expect(label()).toBe('메일 작성 중'));
    c.onJobUpdate(compose({ status: 'completed', updatedAt: '2026-10-18T10:01:00.000Z' }));
    expect(c.getEntry(KEY)?.compose?.status).toBe('completed');
    expect(label()).toBe('메일 작성됨');
    c.onJobUpdate(compose({ status: 'running', updatedAt: '2026-10-18T10:02:00.000Z' }));
    expect(c.getEntry(KEY)?.compose?.status).toBe('completed');
    c.stop();
  });

  it('collect 갱신으로 handoff.jobId가 생기면 조회', async () => {
    document.body.innerHTML = page(row('A'));
    const { c } = setup({
      'job/list-for-tab': () => [doneJob({ action: 'compose', state: 'queued', at })],
      'job/get': () => compose(),
    });
    c.scan();
    await c.whenIdle();
    expect(c.getEntry(KEY)?.compose).toBeNull();
    expect(label()).toBe('수집 완료');
    c.onJobUpdate({ ...doneJob(started), updatedAt: '2026-10-18T10:00:30.000Z' });
    await c.whenIdle();
    expect(c.getEntry(KEY)?.compose?.id).toBe('cp1');
    c.stop();
  });

  it('busy 중 취소는 compose id', async () => {
    document.body.innerHTML = page(row('A'));
    const { c, calls } = setup({ 'job/list-for-tab': () => [doneJob(started)], 'job/get': () => compose() });
    c.scan();
    await c.whenIdle();
    await vi.waitFor(() => expect(c.getEntry(KEY)?.compose?.id).toBe('cp1'));
    await c.cancel(KEY);
    expect(calls.find((x) => x.type === 'job/cancel')?.payload).toEqual({ jobId: 'cp1' });
    c.stop();
  });

  it('열기 버튼 -> ui/open mail', async () => {
    document.body.innerHTML = page(row('A'));
    const { c, calls } = setup({ 'job/list-for-tab': () => [doneJob(started)], 'job/get': () => compose({ status: 'completed' }) });
    c.scan();
    await c.whenIdle();
    await vi.waitFor(() => expect(label()).toBe('메일 작성됨'));
    const btns = hosts()[0]!.shadowRoot!.querySelectorAll('button');
    expect(btns[1]!.textContent).toBe('열기');
    btns[1]!.click();
    await vi.waitFor(() => expect(calls.find((x) => x.type === 'ui/open')?.payload).toEqual({ page: 'mail', noticeId: KEY }));
    c.stop();
  });

  it('검수 버튼 -> ui/open review', async () => {
    document.body.innerHTML = page(row('A'));
    const rv: Job['handoff'] = { action: 'review', reasons: ['needs_review'], opened: true, at };
    const { c, calls } = setup({ 'job/list-for-tab': () => [doneJob(rv)] });
    c.scan();
    await c.whenIdle();
    await vi.waitFor(() => expect(label()).toBe('검수 필요'));
    hosts()[0]!.shadowRoot!.querySelectorAll('button')[1]!.click();
    await vi.waitFor(() => expect(calls.find((x) => x.type === 'ui/open')?.payload).toEqual({ page: 'review', noticeId: KEY }));
    c.stop();
  });
});
