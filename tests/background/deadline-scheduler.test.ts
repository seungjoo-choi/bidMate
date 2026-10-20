import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type FinalFn = (job: { type: string; status: string }) => void;
const finals: FinalFn[] = [];
vi.mock('../../src/background/job-coordinator', async () => {
  const actual = await vi.importActual<typeof import('../../src/background/job-coordinator')>('../../src/background/job-coordinator');
  return { ...actual, addFinalListener: (fn: FinalFn) => { finals.push(fn); } };
});

import { armDeadlineAlarm, dispatchDue, refreshDeadlines, registerDeadlineScheduler, type DeadlineSchedulerDeps } from '../../src/background/deadline-scheduler';
import type { DeadlineNotice, DeadlinePlan } from '../../src/core/types/deadline';

const RID = 'ext-id';
const NOW = Date.parse('2026-10-21T10:00:00+09:00');
const ms = (s: string): number => Date.parse(s);
const note = (key: string, fireAt: string, o: Partial<DeadlineNotice> = {}): DeadlineNotice => ({
  noticeId: 'R1-000', title: '공고', kind: 'bidClose', at: '2026-10-22T14:00:00+09:00', offset: 1, fireAt: ms(fireAt), key, ...o,
});
const PLAN2: DeadlinePlan = {
  builtAt: '', items: [
    note('deadline:R1-000:bidClose:1', '2026-10-21T09:00:00+09:00'),
    note('deadline:R2-000:bidClose:1', '2026-10-21T09:00:00+09:00', { noticeId: 'R2-000' }),
    note('deadline:R1-000:bidClose:0', '2026-10-22T09:00:00+09:00', { offset: 0 }),
  ],
};

function make(o: { plan?: DeadlinePlan; deadline?: boolean; run?: (type: string, payload: unknown) => unknown; setThrows?: boolean } = {}) {
  const local: Record<string, unknown> = {
    ...(o.plan ? { deadlinePlan: o.plan } : {}),
    settingsCache: { notify: { rank: true, final: true, deadline: o.deadline ?? true } },
  };
  const session: Record<string, unknown> = {};
  const alarms = { create: vi.fn(async () => undefined), clear: vi.fn(async () => true), get: vi.fn(async () => undefined) };
  const notif = { create: vi.fn(async (..._a: unknown[]) => 'id'), clear: vi.fn(async () => true) };
  const off = vi.fn(async (type: string, payload: unknown) => (o.run ? o.run(type, payload) : { builtAt: '', items: [] }));
  const open = vi.fn(async () => 1);
  const pick = (store: Record<string, unknown>) => async (k: string | string[]) => {
    const keys = Array.isArray(k) ? k : [k];
    return Object.fromEntries(keys.filter((x) => x in store).map((x) => [x, store[x]]));
  };
  const d = {
    alarms, notifications: notif,
    storage: {
      local: { get: vi.fn(pick(local)), set: vi.fn(async (v: Record<string, unknown>) => { if (o.setThrows) throw new Error('quota'); Object.assign(local, v); }) },
      session: { get: vi.fn(pick(session)), set: vi.fn(async (v: Record<string, unknown>) => { Object.assign(session, v); }) },
    },
    toOffscreen: off, openDashboard: open, getURL: (p: string) => `chrome-extension://${RID}/${p}`, now: () => NOW,
  } as unknown as DeadlineSchedulerDeps;
  return { d, alarms, notif, off, open, local, session };
}

describe('armDeadlineAlarm', () => {
  it('항상 clear 후 create, 과거는 now+5초', async () => {
    const f = make();
    await armDeadlineAlarm(NOW + 3600_000, f.d);
    expect(f.alarms.clear).toHaveBeenCalledWith('deadline-check');
    expect(f.alarms.create).toHaveBeenCalledWith('deadline-check', { when: NOW + 3600_000 });
    await armDeadlineAlarm(NOW - 1000, f.d);
    expect(f.alarms.create).toHaveBeenLastCalledWith('deadline-check', { when: NOW + 5000 });
    expect(f.alarms.clear).toHaveBeenCalledTimes(2);
  });
});

describe('dispatchDue', () => {
  it('due 2건을 보내고 sent에 기록, 알람은 다음 fireAt, 재호출은 0회', async () => {
    const f = make({ plan: PLAN2 });
    const r = await dispatchDue(f.d);
    expect(r.sent).toBe(2);
    expect(f.notif.create).toHaveBeenCalledTimes(2);
    expect(f.notif.create.mock.calls[0]![0]).toBe('deadline:R1-000:bidClose:1');
    expect(Object.keys(f.local.deadlineSent as object).sort()).toEqual(['deadline:R1-000:bidClose:1', 'deadline:R2-000:bidClose:1']);
    expect(f.alarms.create).toHaveBeenLastCalledWith('deadline-check', { when: ms('2026-10-22T09:00:00+09:00') });
    await dispatchDue(f.d);
    expect(f.notif.create).toHaveBeenCalledTimes(2);
  });
  it('notify.deadline이 꺼져 있으면 보내지 않지만 sent에는 기록', async () => {
    const f = make({ plan: PLAN2, deadline: false });
    expect((await dispatchDue(f.d)).sent).toBe(0);
    expect(f.notif.create).not.toHaveBeenCalled();
    expect(Object.keys(f.local.deadlineSent as object)).toHaveLength(2);
  });
  it('계획이 없으면 발송 0, 알람은 다음날 09시 KST', async () => {
    const f = make();
    await dispatchDue(f.d);
    expect(f.notif.create).not.toHaveBeenCalled();
    expect(f.alarms.create).toHaveBeenLastCalledWith('deadline-check', { when: ms('2026-10-22T09:00:00+09:00') });
  });
  it('storage.set이 throw해도 resolve', async () => {
    const f = make({ plan: PLAN2, setThrows: true });
    await expect(dispatchDue(f.d)).resolves.toMatchObject({ sent: 2 });
  });
});

describe('refreshDeadlines', () => {
  const planResp = { builtAt: 'x', items: PLAN2.items };
  it('list는 plan 요청 후 저장, 10분 안 두 번째는 offscreen 미호출이지만 dispatchDue 실행', async () => {
    const f = make({ run: () => planResp });
    const r = await refreshDeadlines('list', f.d);
    expect(f.off).toHaveBeenCalledWith('deadline/plan', undefined, 30000);
    expect(f.local.deadlinePlan).toEqual(planResp);
    expect(r.ran).toBe(true);
    expect(f.notif.create).toHaveBeenCalledTimes(2);
    f.alarms.create.mockClear();
    await refreshDeadlines('list', f.d);
    expect(f.off).toHaveBeenCalledTimes(1);
    expect(f.alarms.create).toHaveBeenCalledTimes(1);
  });
  it('manual, alarm, startup, job은 무스로틀', async () => {
    const f = make({ run: () => planResp });
    for (const r of ['manual', 'alarm', 'startup', 'job'] as const) await refreshDeadlines(r, f.d);
    expect(f.off).toHaveBeenCalledTimes(4);
  });
  it('NEEDS_FS_PERMISSION은 NO_FS, 캐시로 dispatchDue와 알람', async () => {
    const f = make({ plan: PLAN2, run: () => { throw Object.assign(new Error('x'), { code: 'NEEDS_FS_PERMISSION' }); } });
    const r = await refreshDeadlines('alarm', f.d);
    expect(r.skipped).toBe('NO_FS');
    expect(f.notif.create).toHaveBeenCalledTimes(2);
    expect(f.alarms.create).toHaveBeenCalled();
  });
  it('일반 throw는 error 문자열, 역시 dispatchDue', async () => {
    const f = make({ plan: PLAN2, run: () => { throw new Error('boom'); } });
    const r = await refreshDeadlines('manual', f.d);
    expect(r.error).toBe('boom');
    expect(f.notif.create).toHaveBeenCalledTimes(2);
  });
});

describe('registerDeadlineScheduler 리스너', () => {
  let startup: (() => void) | undefined;
  let installed: (() => void) | undefined;
  let clicked: ((id: string) => void) | undefined;
  let alarmFn: ((a: { name: string }) => void) | undefined;
  let changed: ((c: Record<string, unknown>, area: string) => void) | undefined;
  type MsgFn = (msg: unknown, sender: unknown, reply: (r: unknown) => void) => boolean;
  const messageFns: MsgFn[] = [];

  beforeEach(() => {
    messageFns.length = 0;
    finals.length = 0;
    vi.stubGlobal('chrome', {
      runtime: { id: RID, onMessage: { addListener: (f: MsgFn) => { messageFns.push(f); } }, onStartup: { addListener: (f: () => void) => { startup = f; } }, onInstalled: { addListener: (f: () => void) => { installed = f; } } },
      alarms: { onAlarm: { addListener: (f: typeof alarmFn) => { alarmFn = f; } } },
      notifications: { onClicked: { addListener: (f: typeof clicked) => { clicked = f; } } },
      storage: { onChanged: { addListener: (f: typeof changed) => { changed = f; } } },
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); });
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('알람, 시작, 설치, 잡 종결에서 refresh', async () => {
    const f = make();
    registerDeadlineScheduler(f.d);
    alarmFn!({ name: 'other' });
    await flush();
    expect(f.off).not.toHaveBeenCalled();
    alarmFn!({ name: 'deadline-check' });
    await flush();
    expect(f.off).toHaveBeenCalledTimes(1);
    startup!();
    await flush();
    expect(f.off).toHaveBeenCalledTimes(2);
    installed!();
    await flush();
    expect(f.off).toHaveBeenCalledTimes(3);
    finals[0]!({ type: 'compose', status: 'completed' });
    finals[0]!({ type: 'collect', status: 'failed' });
    await flush();
    expect(f.off).toHaveBeenCalledTimes(3);
    finals[0]!({ type: 'collect', status: 'completed' });
    await flush();
    expect(f.off).toHaveBeenCalledTimes(4);
  });

  it('notify.deadline false에서 true로 바뀔 때만 dispatchDue', async () => {
    const f = make({ plan: PLAN2 });
    registerDeadlineScheduler(f.d);
    const ch = (o: unknown, n: unknown) => ({ settingsCache: { oldValue: { notify: { deadline: o } }, newValue: { notify: { deadline: n } } } });
    changed!(ch(true, false), 'local');
    changed!(ch(false, true), 'sync');
    changed!({ other: {} }, 'local');
    await flush();
    expect(f.alarms.create).not.toHaveBeenCalled();
    changed!(ch(false, true), 'local');
    await flush();
    expect(f.alarms.create).toHaveBeenCalledTimes(1);
  });

  it('알림 클릭은 deadline 접두어만 처리', async () => {
    const f = make();
    registerDeadlineScheduler(f.d);
    clicked!('deadline:R26BK00000001-000:bidClose:1');
    await flush();
    expect(f.open).toHaveBeenCalledWith('#/notices/R26BK00000001-000/overview');
    expect(f.notif.clear).toHaveBeenCalledWith('deadline:R26BK00000001-000:bidClose:1');
    f.open.mockClear();
    clicked!('result:R26BK00000001-000:won');
    await flush();
    expect(f.open).not.toHaveBeenCalled();
  });

  it('deadline/refresh 릴레이는 extension 발신자만', async () => {
    const f = make();
    registerDeadlineScheduler(f.d);
    const call = (sender: unknown) => new Promise<{ ok: boolean; error?: { code: string } }>((res) => {
      for (const fn of messageFns) if (fn({ id: '1', type: 'deadline/refresh', payload: { reason: 'manual' }, ts: 0, target: 'sw' }, sender, res as (r: unknown) => void)) break;
    });
    expect(await call({ id: RID, tab: { id: 1 }, url: 'https://www.g2b.go.kr/' })).toMatchObject({ ok: false, error: { code: 'SENDER_FORBIDDEN' } });
    expect((await call({ id: RID, url: `chrome-extension://${RID}/dashboard.html` })).ok).toBe(true);
  });
});
