import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/background/g2b-failures', () => ({ recordG2bFailure: vi.fn() }));

import { recordG2bFailure } from '../../src/background/g2b-failures';
import { applyDone, armFollowAlarm, notificationOf, refreshResults, registerResultScheduler, type ResultSchedulerDeps } from '../../src/background/result-scheduler';
import { RESULT_RUN_TIMEOUT_MS } from '../../src/core/results/limits';
import type { ResultRunSummary } from '../../src/core/types/result';

const RID = 'ext-id';
const NOW = Date.parse('2026-10-20T12:00:00Z');
const summary = (o: Partial<ResultRunSummary> = {}): ResultRunSummary => ({ ran: true, checked: 1, updated: 1, won: 0, nextFollowCheckAt: null, events: [], ...o });

interface Fakes { d: ResultSchedulerDeps; alarms: { create: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> }; notif: { create: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn> }; off: ReturnType<typeof vi.fn>; session: Record<string, unknown>; open: ReturnType<typeof vi.fn> }

function make(o: { existingAlarm?: number; key?: string | null; bizNo?: string; notify?: { rank: boolean; final: boolean }; run?: (type: string, payload: unknown) => unknown } = {}): Fakes {
  const session: Record<string, unknown> = {};
  const alarms = { create: vi.fn(async () => undefined), clear: vi.fn(async () => true), get: vi.fn(async () => (o.existingAlarm === undefined ? undefined : { name: 'follow-check', scheduledTime: o.existingAlarm })) };
  const notif = { create: vi.fn(async () => 'id'), clear: vi.fn(async () => true) };
  const off = vi.fn(async (type: string, payload: unknown) => (o.run ? o.run(type, payload) : summary()));
  const open = vi.fn(async () => 1);
  const local = {
    get: vi.fn(async () => ({
      ...(o.key === null ? {} : { secrets: { g2bServiceKey: o.key ?? 'SECRETKEY' } }),
      settingsCache: { company: { bizNo: o.bizNo ?? '123-45-67890' }, ...(o.notify ? { notify: o.notify } : {}) },
    })),
  };
  const d = {
    alarms, notifications: notif,
    storage: { local, session: { get: vi.fn(async (k: string) => ({ [k]: session[k] })), set: vi.fn(async (v: Record<string, unknown>) => { Object.assign(session, v); }) } },
    toOffscreen: off, openDashboard: open, getURL: (p: string) => `chrome-extension://${RID}/${p}`, now: () => NOW,
  } as unknown as ResultSchedulerDeps;
  return { d, alarms, notif, off, session, open };
}

describe('armFollowAlarm', () => {
  it('기존 알람이 없으면 create(when), 과거는 now+5초, null이면 아무것도 하지 않는다', async () => {
    const f = make();
    await armFollowAlarm('2026-10-20T13:00:00Z', f.d);
    expect(f.alarms.create).toHaveBeenCalledWith('follow-check', { when: Date.parse('2026-10-20T13:00:00Z') });
    f.alarms.create.mockClear();
    await armFollowAlarm(null, f.d);
    expect(f.alarms.create).not.toHaveBeenCalled();
    await armFollowAlarm('2026-10-20T00:00:00Z', f.d);
    expect(f.alarms.create).toHaveBeenCalledWith('follow-check', { when: NOW + 5000 });
  });

  it('기존 알람이 더 이르거나 같으면(null 포함) 유지하고, 더 늦으면 clear 후 다시 건다', async () => {
    const early = make({ existingAlarm: Date.parse('2026-10-20T12:30:00Z') });
    await armFollowAlarm('2026-10-20T13:00:00Z', early.d);
    await armFollowAlarm('2026-10-20T12:30:00Z', early.d);
    await armFollowAlarm(null, early.d);
    expect(early.alarms.clear).not.toHaveBeenCalled();
    expect(early.alarms.create).not.toHaveBeenCalled();
    const late = make({ existingAlarm: Date.parse('2026-10-20T15:00:00Z') });
    await armFollowAlarm('2026-10-20T13:00:00Z', late.d);
    expect(late.alarms.clear).toHaveBeenCalledWith('follow-check');
    expect(late.alarms.create).toHaveBeenCalledWith('follow-check', { when: Date.parse('2026-10-20T13:00:00Z') });
  });
});

describe('refreshResults', () => {
  it('키 또는 사업자번호가 없으면 offscreen/알람 없이 skipped', async () => {
    const a = make({ key: null });
    expect((await refreshResults('list', a.d)).skipped).toBe('NO_KEY');
    const b = make({ bizNo: '123' });
    expect((await refreshResults('follow', b.d)).skipped).toBe('NO_BIZNO');
    for (const f of [a, b]) { expect(f.off).not.toHaveBeenCalled(); expect(f.alarms.create).not.toHaveBeenCalled(); expect(f.alarms.clear).not.toHaveBeenCalled(); }
  });

  it('list는 10분 스로틀, follow는 무스로틀, 타임아웃과 키 주입', async () => {
    const f = make();
    await refreshResults('list', f.d);
    expect(f.off).toHaveBeenCalledWith('result/run', { mode: 'list', serviceKey: 'SECRETKEY', bizNo: '1234567890' }, RESULT_RUN_TIMEOUT_MS);
    expect((await refreshResults('list', f.d)).skipped).toBe('THROTTLED');
    expect(f.off).toHaveBeenCalledTimes(1);
    await refreshResults('follow', f.d);
    await refreshResults('alarm', f.d);
    expect(f.off).toHaveBeenCalledTimes(3);
    expect(f.off.mock.calls[1]![1]).toMatchObject({ mode: 'follow' });
  });

  it('BUSY면 now+2분에 다시 건다', async () => {
    const f = make({ run: () => summary({ ran: false, skipped: 'BUSY' }) });
    const r = await refreshResults('follow', f.d);
    expect(r.skipped).toBe('BUSY');
    expect(f.alarms.create).toHaveBeenCalledWith('follow-check', { when: NOW + 120_000 });
  });

  it('실패(throw 또는 응답 error)면 10분 뒤로 재시도 알람을 건다', async () => {
    const a = make({ run: () => { throw new Error('timeout'); } });
    await refreshResults('alarm', a.d);
    expect(a.alarms.create).toHaveBeenCalledWith('follow-check', { when: NOW + 600_000 });
    const b = make({ run: () => summary({ ran: false, error: 'x' }) });
    await refreshResults('alarm', b.d);
    expect(b.alarms.create).toHaveBeenCalledWith('follow-check', { when: NOW + 600_000 });
  });

  it('응답 error와 throw는 result/run 실패로 기록하고 skipped만이면 기록하지 않는다', async () => {
    vi.mocked(recordG2bFailure).mockClear();
    await refreshResults('manual', make({ run: () => summary({ ran: false, error: '개찰 조회 실패' }) }).d);
    expect(recordG2bFailure).toHaveBeenLastCalledWith({ flow: 'result', stage: 'run', code: 'RESULT_RUN_FAILED', message: '개찰 조회 실패', trigger: 'manual' });
    await refreshResults('alarm', make({ run: () => { throw Object.assign(new Error('timeout SECRETKEY'), { code: 'TIMEOUT' }); } }).d);
    const last = vi.mocked(recordG2bFailure).mock.calls.at(-1)![0] as { code: string; message: string; trigger: string };
    expect(last).toMatchObject({ flow: 'result', stage: 'run', code: 'TIMEOUT', trigger: 'alarm' });
    expect(last.message).not.toContain('SECRETKEY');
    vi.mocked(recordG2bFailure).mockClear();
    await refreshResults('follow', make({ run: () => summary({ ran: false, skipped: 'BUSY' }) }).d);
    await refreshResults('list', make({ key: null }).d);
    expect(recordG2bFailure).not.toHaveBeenCalled();
  });

  it('알람 실패 같은 result/run 밖의 예외는 기록하지 않는다', async () => {
    vi.mocked(recordG2bFailure).mockClear();
    const f = make({ run: () => summary({ ran: false, skipped: 'BUSY' }) });
    f.alarms.get.mockRejectedValue(new Error('alarm fail'));
    const r = await refreshResults('follow', f.d);
    expect(r.error).toBe('alarm fail');
    expect(recordG2bFailure).not.toHaveBeenCalled();
  });

  it('정상 응답은 알림을 직접 보내지 않고(result/done 담당) 알람만 병합 규칙으로 한 번 더 건다', async () => {
    const events = [{ kind: 'final' as const, noticeId: 'R26BK00000001-000', title: '공고', status: 'won' as const }];
    const f = make({ run: () => summary({ events, nextFollowCheckAt: '2026-10-20T13:00:00Z' }) });
    await refreshResults('follow', f.d);
    expect(f.notif.create).not.toHaveBeenCalled();
    expect(f.alarms.create).toHaveBeenCalledWith('follow-check', { when: Date.parse('2026-10-20T13:00:00Z') });
  });
});

describe('applyDone', () => {
  const events = [
    { kind: 'rank' as const, noticeId: 'R26BK00000001-000', title: '공고', rank: 2, bidders: 5 },
    { kind: 'final' as const, noticeId: 'R26BK00000001-000', title: '공고', status: 'won' as const },
  ];

  it('알림을 띄우고 알람을 건다', async () => {
    const f = make();
    await applyDone({ events, nextFollowCheckAt: '2026-10-20T13:00:00Z' }, f.d);
    expect(f.notif.create).toHaveBeenCalledTimes(2);
    expect(f.notif.create.mock.calls[0]).toEqual(['result:R26BK00000001-000:rank', { type: 'basic', iconUrl: `chrome-extension://${RID}/icon/128.png`, title: '개찰 순위 확인', message: '공고 우리 2위, 참여 5개사' }]);
    expect(f.alarms.create).toHaveBeenCalledWith('follow-check', { when: Date.parse('2026-10-20T13:00:00Z') });
  });

  it('notify 설정으로 거른다', async () => {
    const off = make({ notify: { rank: false, final: false } });
    await applyDone({ events, nextFollowCheckAt: null }, off.d);
    expect(off.notif.create).not.toHaveBeenCalled();
    const onlyFinal = make({ notify: { rank: false, final: true } });
    await applyDone({ events, nextFollowCheckAt: null }, onlyFinal.d);
    expect(onlyFinal.notif.create).toHaveBeenCalledTimes(1);
  });

  it('NO_FS는 1시간 뒤, KEY_INVALID는 재예약 없음', async () => {
    const a = make();
    await applyDone({ events: [], nextFollowCheckAt: null, skipped: 'NO_FS' }, a.d);
    expect(a.alarms.create).toHaveBeenCalledWith('follow-check', { when: NOW + 3600_000 });
    const b = make();
    await applyDone({ events: [], nextFollowCheckAt: '2026-10-20T13:00:00Z', skipped: 'KEY_INVALID' }, b.d);
    expect(b.alarms.create).not.toHaveBeenCalled();
  });
});

describe('refreshResults 기타', () => {
  it('throw하지 않고 오류의 키를 가린다', async () => {
    const f = make({ run: () => { throw new Error('fail serviceKey=SECRETKEY SECRETKEY'); } });
    const r = await refreshResults('manual', f.d);
    expect(r.ran).toBe(false);
    expect(r.error).not.toContain('SECRETKEY');
    expect(f.alarms.create).toHaveBeenCalledWith('follow-check', { when: NOW + 600_000 }); // 실패 재시도
  });
});

describe('notificationOf', () => {
  it('명세 문구와 60자 말줄임', () => {
    const long = 'ㄱ'.repeat(70);
    expect(notificationOf({ kind: 'final', noticeId: 'X', title: long, status: 'lost', winnerName: '타사' })).toEqual({ id: 'result:X:lost', title: '탈락', message: `${'ㄱ'.repeat(60)}… 낙찰 업체: 타사` });
    expect(notificationOf({ kind: 'final', noticeId: 'X', title: 't', status: 'not_participated' })).toMatchObject({ title: '결과 확정', message: 't 개찰 결과에 우리 회사가 없습니다' });
    expect(notificationOf({ kind: 'final', noticeId: 'X', title: 't', status: 'no_bid' })).toMatchObject({ title: '유찰', message: 't 유찰되었습니다' });
    expect(notificationOf({ kind: 'rank', noticeId: 'X', title: 't', rank: 1, bidders: 5, followEnded: true }).message).toBe('t 우리 1위, 참여 5개사 (팔로우 종료)');
    expect(notificationOf({ kind: 'rank', noticeId: 'X', title: 't', rank: 1, bidders: 5 }).message).toBe('t 우리 1위, 참여 5개사');
    expect(notificationOf({ kind: 'expired', noticeId: 'X', title: 't' })).toMatchObject({ id: 'result:X:expired', title: '추적 종료', message: 't 120일 동안 결과가 확정되지 않아 팔로우를 해제했습니다' });
  });
});

describe('registerResultScheduler 리스너', () => {
  let startup: (() => void) | undefined;
  let clicked: ((id: string) => void) | undefined;
  let alarmFn: ((a: { name: string }) => void) | undefined;
  let changed: ((c: Record<string, unknown>, area: string) => void) | undefined;
  type MsgFn = (msg: unknown, sender: unknown, reply: (r: unknown) => void) => boolean;
  const messageFns: MsgFn[] = [];

  beforeEach(() => {
    messageFns.length = 0;
    vi.stubGlobal('chrome', {
      runtime: { id: RID, onMessage: { addListener: (f: MsgFn) => { messageFns.push(f); } }, onStartup: { addListener: (f: () => void) => { startup = f; } }, onInstalled: { addListener: vi.fn() } },
      alarms: { onAlarm: { addListener: (f: typeof alarmFn) => { alarmFn = f; } } },
      notifications: { onClicked: { addListener: (f: typeof clicked) => { clicked = f; } } },
      storage: { onChanged: { addListener: (f: typeof changed) => { changed = f; } } },
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); });
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('onStartup, 알람, storage 변경에서 follow 모드로 1회 실행한다', async () => {
    const f = make();
    registerResultScheduler(f.d);
    startup!();
    await flush();
    expect(f.off).toHaveBeenCalledTimes(1);
    expect(f.off.mock.calls[0]![1]).toMatchObject({ mode: 'follow' });
    alarmFn!({ name: 'other' });
    alarmFn!({ name: 'follow-check' });
    changed!({ secrets: { oldValue: { g2bServiceKey: 'a' }, newValue: { g2bServiceKey: 'b' } } }, 'local');
    changed!({ secrets: { oldValue: { g2bServiceKey: 'a' }, newValue: { g2bServiceKey: 'a' } } }, 'local'); // 키 변화 없음
    changed!({ settingsCache: { oldValue: { company: { bizNo: '1' }, x: 1 }, newValue: { company: { bizNo: '1' }, x: 2 } } }, 'local'); // 사업자번호 변화 없음
    changed!({ settingsCache: { oldValue: { company: { bizNo: '1' } }, newValue: { company: { bizNo: '2' } } } }, 'local');
    changed!({ other: {} }, 'local');
    changed!({ secrets: { oldValue: {}, newValue: { g2bServiceKey: 'z' } } }, 'sync');
    await flush();
    expect(f.off).toHaveBeenCalledTimes(4); // startup, alarm, 키 변경, 사업자번호 변경
  });

  it('알림 클릭은 상세 overview를 열고 알림을 지운다', async () => {
    const f = make();
    registerResultScheduler(f.d);
    clicked!('result:R26BK00000001-000:won');
    await flush();
    expect(f.open).toHaveBeenCalledWith('#/notices/R26BK00000001-000/overview');
    expect(f.notif.clear).toHaveBeenCalledWith('result:R26BK00000001-000:won');
    f.open.mockClear();
    clicked!('other:id');
    await flush();
    expect(f.open).not.toHaveBeenCalled();
  });

  it('follow/set 릴레이는 확장 페이지만 허용하고 응답으로 알람을 건다', async () => {
    const f = make({ run: () => ({ following: true, nextFollowCheckAt: '2026-10-20T13:00:00Z', startAt: null }) });
    registerResultScheduler(f.d);
    const call = (sender: unknown) => new Promise<{ ok: boolean; error?: { code: string } }>((res) => {
      for (const fn of messageFns) if (fn({ id: '1', type: 'follow/set', payload: { noticeId: 'R26BK00000001-000', follow: true }, ts: 0, target: 'sw' }, sender, res as (r: unknown) => void)) break;
    });
    const bad = await call({ id: RID, tab: { id: 1 }, url: 'https://www.g2b.go.kr/' });
    expect(bad).toMatchObject({ ok: false, error: { code: 'SENDER_FORBIDDEN' } });
    const good = await call({ id: RID, url: `chrome-extension://${RID}/dashboard.html` });
    expect(good.ok).toBe(true);
    expect(f.alarms.create).not.toHaveBeenCalled(); // 알람은 result/done이 건다
  });

  it('follow/set 릴레이는 target을 검증하고 없으면 final로 보낸다', async () => {
    const f = make({ run: () => ({ following: true, target: 'final', nextFollowCheckAt: null, startAt: null }) });
    registerResultScheduler(f.d);
    const call = (extra: Record<string, unknown>) => new Promise<{ ok: boolean; error?: { code: string } }>((res) => {
      for (const fn of messageFns) if (fn({ id: '1', type: 'follow/set', payload: { noticeId: 'R26BK00000001-000', follow: true, ...extra }, ts: 0, target: 'sw' }, { id: RID, url: `chrome-extension://${RID}/dashboard.html` }, res as (r: unknown) => void)) break;
    });
    expect((await call({})).ok).toBe(true);
    expect(f.off).toHaveBeenLastCalledWith('follow/set', { noticeId: 'R26BK00000001-000', follow: true, target: 'final' }, expect.any(Number));
    expect((await call({ target: 'rank' })).ok).toBe(true);
    expect(f.off).toHaveBeenLastCalledWith('follow/set', { noticeId: 'R26BK00000001-000', follow: true, target: 'rank' }, expect.any(Number));
    f.off.mockClear();
    expect(await call({ target: 'x' })).toMatchObject({ ok: false, error: { code: 'FOLLOW_BAD_TARGET' } });
    expect(f.off).not.toHaveBeenCalled();
  });

  it('result/done은 offscreen 문서 발신만 허용한다', async () => {
    const f = make();
    registerResultScheduler(f.d);
    const call = (sender: unknown) => new Promise<{ ok: boolean; error?: { code: string } }>((res) => {
      for (const fn of messageFns) if (fn({ id: '1', type: 'result/done', payload: { events: [], nextFollowCheckAt: '2026-10-20T13:00:00Z' }, ts: 0, target: 'sw' }, sender, res as (r: unknown) => void)) break;
    });
    expect(await call({ id: RID, tab: { id: 3 }, url: `chrome-extension://${RID}/dashboard.html` })).toMatchObject({ ok: false, error: { code: 'SENDER_FORBIDDEN' } });
    expect(await call({ id: RID, url: `chrome-extension://${RID}/dashboard.html` })).toMatchObject({ ok: false });
    expect(f.alarms.create).not.toHaveBeenCalled();
    expect((await call({ id: RID, url: `chrome-extension://${RID}/offscreen.html` })).ok).toBe(true);
    expect(f.alarms.create).toHaveBeenCalledWith('follow-check', { when: Date.parse('2026-10-20T13:00:00Z') });
  });
});
