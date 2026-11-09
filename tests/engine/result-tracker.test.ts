import { afterEach, describe, expect, it, vi } from 'vitest';
import * as awardApi from '../../src/adapters/g2b/award-api';
import type { FollowFile, ResultFile } from '../../src/core/types/result';
import { backoffMs } from '../../src/core/results/judge';
import { runResultRefresh, type ResultTrackerDeps } from '../../src/engine/results/result-tracker';
import { fakeG2b, NOW, OURS, seedStore, type Seed } from '../helpers/result-fixture';
import type { MemoryStore } from '../helpers/memory-store';

vi.mock('../../src/adapters/g2b/award-api', async (orig) => {
  const m = await orig<typeof import('../../src/adapters/g2b/award-api')>();
  return { ...m, fetchFailing: vi.fn(m.fetchFailing) };
});

const PAST = '2026-10-20T09:00:00+09:00';
const R1 = 'R26BK00000001-000';
const R2 = 'R26BK00000002-000';
const rj = (s: MemoryStore): ResultFile => JSON.parse(s.files.get('results.json') as string);
const fj = (s: MemoryStore): FollowFile => JSON.parse(s.files.get('follows.json') as string);
const opening = (rank: number | null, bizNo = OURS) => [{ prcbdrBizno: bizNo, opengRank: rank === null ? '' : String(rank), totalEvlAmtVal: rank === null ? '' : '90' }];
const deps = (store: MemoryStore, fetchFn: typeof fetch, o: Partial<ResultTrackerDeps> = {}): ResultTrackerDeps =>
  ({ store, fetch: fetchFn, serviceKey: 'KEY', bizNo: '123-45-67890', now: () => NOW, checkPermission: async () => true, ...o });
const sched = (id: string, openingAt = PAST): Seed => ({ id, openingAt });
const follow = (store: MemoryStore, id: string, notified = {}, target?: 'rank' | 'final' | 'reannounce') => store.files.set('follows.json', JSON.stringify({ schemaVersion: 1, updatedAt: '', entries: { [id]: { noticeId: id, followedAt: PAST, ...(target ? { target } : {}), notified } } }));

describe('runResultRefresh', () => {
  it('키/사업자번호/권한이 없으면 호출 없이 skipped', async () => {
    const s = seedStore([sched(R1)]);
    const g = fakeG2b(() => []);
    expect((await runResultRefresh(deps(s, g.fetch, { serviceKey: '' }), { mode: 'list' })).skipped).toBe('NO_KEY');
    expect((await runResultRefresh(deps(s, g.fetch, { bizNo: '123' }), { mode: 'list' })).skipped).toBe('NO_BIZNO');
    expect((await runResultRefresh(deps(s, g.fetch, { checkPermission: async () => false }), { mode: 'list' })).skipped).toBe('NO_FS');
    expect(g.calls).toHaveLength(0);
    expect(s.files.has('results.json')).toBe(false);
  });

  it('배치 상한 15, 개찰일 내림차순 우선', async () => {
    const seeds = Array.from({ length: 17 }, (_, i) => sched(`R26BK${String(i + 1).padStart(8, '0')}-000`, new Date(Date.parse(PAST) - i * 3600_000).toISOString()));
    const s = seedStore(seeds);
    const g = fakeG2b(() => []);
    const r = await runResultRefresh(deps(s, g.fetch), { mode: 'list' });
    expect(r.checked).toBe(15);
    expect(g.calls).toHaveLength(15);
    const called = new Set(g.calls.map((u) => new URL(u).searchParams.get('bidNtceNo')));
    expect(called.has('R26BK00000017')).toBe(false); // 가장 오래된 2건 제외
    expect(called.has('R26BK00000016')).toBe(false);
    expect(called.has('R26BK00000001')).toBe(true);
  });

  it('종료 상태는 다시 호출하지 않고, 1순위는 2단계 listOp를 기억한다', async () => {
    const s = seedStore([sched(R1)]);
    const g = fakeG2b((op) => (op.includes('Openg') ? opening(1) : op.endsWith('Thng') ? [{ bidwinnrBizno: '999-99-99999', bidwinnrNm: '타사' }] : []));
    const r = await runResultRefresh(deps(s, g.fetch), { mode: 'list' });
    expect(r.checked).toBe(1);
    expect(rj(s).entries[R1]).toMatchObject({ status: 'lost', listOp: 'getScsbidListSttusThng', winnerBizNo: '9999999999' });
    expect(g.calls.some((u) => u.includes('getScsbidListSttusServc'))).toBe(true);
    const n = g.calls.length;
    await runResultRefresh(deps(s, g.fetch, { now: () => new Date(NOW.getTime() + 48 * 3600_000) }), { mode: 'list' });
    expect(g.calls).toHaveLength(n); // 종료 후 재호출 없음
  });

  it('listOp가 있으면 그 op만 호출한다', async () => {
    const s = seedStore([sched(R1)]);
    let ranked = true;
    const g = fakeG2b((op) => (op.includes('Openg') ? opening(1) : op.endsWith('Cnstwk') && !ranked ? [{ bidwinnrBizno: OURS }] : []));
    await runResultRefresh(deps(s, g.fetch), { mode: 'list' }); // 4개 op 모두 빈 응답 -> ranked
    expect(rj(s).entries[R1]!.status).toBe('ranked');
    ranked = false;
    g.calls.length = 0;
    const file = rj(s); file.entries[R1]!.listOp = 'getScsbidListSttusCnstwk'; file.entries[R1]!.nextCheckAt = PAST;
    s.files.set('results.json', JSON.stringify(file));
    await runResultRefresh(deps(s, g.fetch), { mode: 'list' });
    expect(g.calls.filter((u) => u.includes('getScsbidListSttus'))).toHaveLength(1);
    expect(rj(s).entries[R1]!.status).toBe('won');
  });

  it('KEY_INVALID면 중단하고 진행분은 저장한다', async () => {
    const s = seedStore([sched(R1, PAST), sched(R2, '2026-10-20T08:00:00+09:00')]);
    const g = fakeG2b((_op, no) => (no === 'R26BK00000001' ? opening(null) : 'KEY_INVALID'));
    const r = await runResultRefresh(deps(s, g.fetch), { mode: 'list' });
    expect(r.skipped).toBe('KEY_INVALID');
    expect(r.checked).toBe(1);
    expect(rj(s).entries[R1]!.attempts).toBe(1);
  });

  it('index에 없는 항목은 prune', async () => {
    const s = seedStore([sched(R1)]);
    s.files.set('results.json', JSON.stringify({ schemaVersion: 1, bizNo: OURS, updatedAt: '', entries: { 'GONE-000': { noticeId: 'GONE-000', status: 'waiting' } } }));
    follow(s, 'GONE-000');
    await runResultRefresh(deps(s, fakeG2b(() => []).fetch), { mode: 'list' });
    expect(rj(s).entries['GONE-000']).toBeUndefined();
    expect(fj(s).entries['GONE-000']).toBeUndefined();
  });

  it('follow 모드는 일반 대상을 호출하지 않는다', async () => {
    const s = seedStore([sched(R1), sched(R2)]);
    const first = fakeG2b(() => []);
    await runResultRefresh(deps(s, first.fetch), { mode: 'list' });
    follow(s, R1);
    const file = rj(s);
    for (const e of Object.values(file.entries)) e.nextCheckAt = PAST;
    s.files.set('results.json', JSON.stringify(file));
    const g = fakeG2b(() => opening(null));
    const r = await runResultRefresh(deps(s, g.fetch), { mode: 'follow' });
    expect(r.checked).toBe(1);
    expect(g.calls).toHaveLength(1);
    expect(g.calls[0]).toContain('R26BK00000001');
  });

  it('list 모드는 팔로우 공고의 개찰일 변경을 반영한다', async () => {
    const s = seedStore([sched(R1)]);
    await runResultRefresh(deps(s, fakeG2b(() => []).fetch), { mode: 'list' });
    follow(s, R1);
    const later = '2026-10-21T10:00:00+09:00';
    s.files.set(`notices/${R1}/notice.json`, JSON.stringify({ schedule: { openingAt: { value: later } } }));
    const r = await runResultRefresh(deps(s, fakeG2b(() => []).fetch), { mode: 'list' });
    expect(rj(s).entries[R1]!.startAt).toBe(new Date(Date.parse(later)).toISOString());
    expect(r.checked).toBe(0);
    expect(r.nextFollowCheckAt).toBe(new Date(Date.parse(later) + 10 * 60_000).toISOString());
  });

  it('더 큰 round가 수집되면 팔로우를 옮기고 notified를 승계한다', async () => {
    const R1b = 'R26BK00000001-001';
    const s = seedStore([sched(R1), sched(R1b)]);
    follow(s, R1, { rank: PAST });
    await runResultRefresh(deps(s, fakeG2b(() => []).fetch), { mode: 'list' });
    const f = fj(s);
    expect(f.entries[R1]).toBeUndefined();
    expect(f.entries[R1b]!.notified.rank).toBe(PAST);
  });

  it('이벤트는 팔로우 공고에만, notified로 중복 방지, final이면 자동 해제', async () => {
    const s = seedStore([sched(R1)]);
    await runResultRefresh(deps(s, fakeG2b(() => []).fetch), { mode: 'list' }); // 결과 항목만 만든다
    const seeded = rj(s); seeded.entries[R1]!.nextCheckAt = PAST; s.files.set('results.json', JSON.stringify(seeded));
    follow(s, R1);
    let mode: 'rank' | 'won' = 'rank';
    const g = fakeG2b((op) => (op.includes('Openg') ? opening(1) : mode === 'won' && op.endsWith('Servc') ? [{ bidwinnrBizno: OURS }] : []));
    const r1 = await runResultRefresh(deps(s, g.fetch), { mode: 'list' });
    expect(r1.events).toEqual([{ kind: 'rank', noticeId: R1, title: `제목 ${R1}`, rank: 1, bidders: 1 }]);
    expect(fj(s).entries[R1]!.notified.rank).toBeTruthy();
    expect(r1.nextFollowCheckAt).toBeTruthy();
    // 상태를 waiting으로 되돌려 rank 이벤트가 다시 나는 상황: notified 때문에 중복 안 됨
    const file = rj(s); file.entries[R1]!.status = 'waiting'; file.entries[R1]!.nextCheckAt = PAST;
    s.files.set('results.json', JSON.stringify(file));
    expect((await runResultRefresh(deps(s, g.fetch), { mode: 'list' })).events).toEqual([]);
    mode = 'won';
    const file2 = rj(s); file2.entries[R1]!.nextCheckAt = PAST; s.files.set('results.json', JSON.stringify(file2));
    const r3 = await runResultRefresh(deps(s, g.fetch), { mode: 'list' });
    expect(r3.events).toMatchObject([{ kind: 'final', status: 'won' }]);
    expect(r3.won).toBe(1);
    expect(fj(s).entries[R1]).toBeUndefined();
    expect(r3.nextFollowCheckAt).toBeNull();
  });

  it('target rank 팔로우는 순위 알림 뒤 해제되고 일반 backoff로 돌아간다', async () => {
    const s = seedStore([sched(R1)]);
    await runResultRefresh(deps(s, fakeG2b(() => []).fetch), { mode: 'list' });
    const seeded = rj(s); seeded.entries[R1]!.nextCheckAt = PAST; s.files.set('results.json', JSON.stringify(seeded));
    follow(s, R1, {}, 'rank');
    const r = await runResultRefresh(deps(s, fakeG2b((op) => (op.includes('Openg') ? opening(1) : [])).fetch), { mode: 'list' });
    expect(r.events).toEqual([{ kind: 'rank', noticeId: R1, title: `제목 ${R1}`, rank: 1, bidders: 1, followEnded: true }]);
    expect(fj(s).entries[R1]).toBeUndefined();
    expect(r.nextFollowCheckAt).toBeNull();
    const e = rj(s).entries[R1]!;
    expect(e.status).toBe('ranked');
    expect(e.nextCheckAt).toBe(new Date(NOW.getTime() + backoffMs(e.attempts)).toISOString());
  });

  it('target rank 팔로우도 순위 없이 바로 미참여면 final 알림 1회 뒤 해제된다', async () => {
    const s = seedStore([sched(R1)]);
    await runResultRefresh(deps(s, fakeG2b(() => []).fetch), { mode: 'list' });
    const seeded = rj(s); seeded.entries[R1]!.nextCheckAt = PAST; s.files.set('results.json', JSON.stringify(seeded));
    follow(s, R1, {}, 'rank');
    const r = await runResultRefresh(deps(s, fakeG2b((op) => (op.includes('Openg') ? opening(1, '9999999999') : [])).fetch), { mode: 'list' });
    expect(r.events).toMatchObject([{ kind: 'final', status: 'not_participated' }]);
    expect(fj(s).entries[R1]).toBeUndefined();
  });

  it('round 이전 시 target rank가 승계된다', async () => {
    const R1b = 'R26BK00000001-001';
    const s = seedStore([sched(R1), sched(R1b)]);
    follow(s, R1, {}, 'rank');
    await runResultRefresh(deps(s, fakeG2b(() => []).fetch), { mode: 'list' });
    expect(fj(s).entries[R1b]!.target).toBe('rank');
  });

  it('일반 공고는 이벤트가 없다', async () => {
    const s = seedStore([sched(R1)]);
    const r = await runResultRefresh(deps(s, fakeG2b((op) => (op.includes('Openg') ? opening(1) : [])).fetch), { mode: 'list' });
    expect(r.events).toEqual([]);
  });

  it('nextFollowCheckAt은 남은 팔로우의 최솟값', async () => {
    const s = seedStore([sched(R1), sched(R2)]);
    s.files.set('follows.json', JSON.stringify({ schemaVersion: 1, updatedAt: '', entries: { [R1]: { noticeId: R1, followedAt: PAST, notified: {} }, [R2]: { noticeId: R2, followedAt: PAST, notified: {} } } }));
    const r = await runResultRefresh(deps(s, fakeG2b(() => opening(null)).fetch), { mode: 'list' });
    const f = rj(s);
    expect(r.nextFollowCheckAt).toBe([f.entries[R1]!.nextCheckAt, f.entries[R2]!.nextCheckAt].sort()[0]);
  });

  it('저장 순서는 results.json 다음 follows.json', async () => {
    const s = seedStore([sched(R1)]);
    follow(s, R1);
    const order: string[] = [];
    const orig = s.writeText.bind(s);
    s.writeText = async (p: string, t: string) => { order.push(p); return orig(p, t); };
    await runResultRefresh(deps(s, fakeG2b(() => opening(null)).fetch), { mode: 'list' });
    expect(order).toEqual(['results.json', 'follows.json']);
  });

  it('round 이전으로 옮긴 팔로우는 팔로우 주기로 nextCheckAt을 당긴다(min)', async () => {
    const R1b = 'R26BK00000001-001';
    const s = seedStore([sched(R1), sched(R1b)]);
    await runResultRefresh(deps(s, fakeG2b(() => []).fetch), { mode: 'list' });
    const file = rj(s);
    file.entries[R1b]!.nextCheckAt = new Date(NOW.getTime() + 24 * 3600_000).toISOString();
    s.files.set('results.json', JSON.stringify(file));
    follow(s, R1);
    await runResultRefresh(deps(s, fakeG2b(() => []).fetch), { mode: 'list' });
    expect(Date.parse(rj(s).entries[R1b]!.nextCheckAt)).toBe(NOW.getTime() + 10 * 60_000);
    expect(fj(s).entries[R1b]).toBeDefined();
  });

  it('실행 중 해제된 팔로우는 되살리지 않는다', async () => {
    const s = seedStore([sched(R1)]);
    await runResultRefresh(deps(s, fakeG2b(() => []).fetch), { mode: 'list' });
    const seeded = rj(s); seeded.entries[R1]!.nextCheckAt = PAST; s.files.set('results.json', JSON.stringify(seeded));
    follow(s, R1);
    const g = fakeG2b((op) => {
      if (op.includes('Openg')) s.files.set('follows.json', JSON.stringify({ schemaVersion: 1, updatedAt: '', entries: {} })); // 실행 중 해제
      return op.includes('Openg') ? opening(1) : [];
    });
    const r = await runResultRefresh(deps(s, g.fetch), { mode: 'list' });
    expect(r.events).toHaveLength(1);
    expect(fj(s).entries[R1]).toBeUndefined();
  });

  it('실행 중 낙찰까지로 바꾸면 순위 알림 뒤에도 팔로우가 남는다', async () => {
    const s = seedStore([sched(R1)]);
    await runResultRefresh(deps(s, fakeG2b(() => []).fetch), { mode: 'list' });
    const seeded = rj(s); seeded.entries[R1]!.nextCheckAt = PAST; s.files.set('results.json', JSON.stringify(seeded));
    follow(s, R1, {}, 'rank');
    const g = fakeG2b((op) => {
      if (op.includes('Openg')) follow(s, R1, {}, 'final'); // 실행 중 범위 변경
      return op.includes('Openg') ? opening(1) : [];
    });
    await runResultRefresh(deps(s, g.fetch), { mode: 'list' });
    expect(fj(s).entries[R1]).toMatchObject({ target: 'final', notified: { rank: expect.any(String) } });
  });

  it('실행 중 개찰 결과만으로 바꾸면 순위 확인으로 해제된다', async () => {
    const s = seedStore([sched(R1)]);
    await runResultRefresh(deps(s, fakeG2b(() => []).fetch), { mode: 'list' });
    const seeded = rj(s); seeded.entries[R1]!.nextCheckAt = PAST; s.files.set('results.json', JSON.stringify(seeded));
    follow(s, R1);
    const g = fakeG2b((op) => {
      if (op.includes('Openg')) follow(s, R1, {}, 'rank'); // 실행 중 범위 변경
      return op.includes('Openg') ? opening(1) : [];
    });
    await runResultRefresh(deps(s, g.fetch), { mode: 'list' });
    expect(fj(s).entries[R1]).toBeUndefined();
  });

  it('사업자번호 이력이 없는 파일은 초기화하지 않는다', async () => {
    const s = seedStore([sched(R1)]);
    const future = new Date(NOW.getTime() + 3600_000).toISOString();
    s.files.set('results.json', JSON.stringify({ schemaVersion: 1, bizNo: '', updatedAt: '', entries: { [R1]: { noticeId: R1, noticeNo: 'R26BK00000001', round: '000', status: 'waiting', openingAt: PAST, startAt: PAST, attempts: 0, nextCheckAt: future } } }));
    const g = fakeG2b(() => []);
    await runResultRefresh(deps(s, g.fetch), { mode: 'list' });
    expect(g.calls).toHaveLength(0);
    expect(rj(s).entries[R1]!.nextCheckAt).toBe(future);
  });

  describe('onFailure 보고', () => {
    it('개찰 조회 실패 시 1회 보고한다(noticeId·endpoint)', async () => {
      const s = seedStore([sched(R1)]);
      const calls: unknown[] = [];
      await runResultRefresh(deps(s, fakeG2b(() => new Error('network')).fetch, { onFailure: (f) => calls.push(f) }), { mode: 'list' });
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ flow: 'result', stage: 'opening', noticeNo: 'R26BK00000001', round: '000', noticeId: R1, trigger: 'list', endpoint: expect.any(String) });
    });

    it('낙찰 조회 실패 시 stage award로 보고한다', async () => {
      const s = seedStore([sched(R1)]);
      const calls: Array<{ stage: string }> = [];
      const g = fakeG2b((op) => (op.includes('Openg') ? opening(1) : new Error('network')));
      await runResultRefresh(deps(s, g.fetch, { onFailure: (f) => calls.push(f) }), { mode: 'list' });
      expect(calls.some((c) => c.stage === 'award')).toBe(true);
      expect(calls.some((c) => c.stage === 'opening')).toBe(false);
    });

    it('onFailure가 throw해도 run은 완료된다', async () => {
      const s = seedStore([sched(R1)]);
      const r = await runResultRefresh(deps(s, fakeG2b(() => new Error('network')).fetch, { onFailure: () => { throw new Error('boom'); } }), { mode: 'list' });
      expect(r.error).toBeUndefined();
      expect(r.checked).toBe(1);
    });
  });

  describe('투찰금액 백필', () => {
    const wonEntry = (id: string, o: Record<string, unknown> = {}) => ({ noticeId: id, noticeNo: id.slice(0, 13), round: '000', status: 'won', rank: 1, openingAt: PAST, startAt: PAST, attempts: 0, nextCheckAt: PAST, ...o });
    const seed = (ids: string[], o: Record<string, unknown> = {}): MemoryStore => {
      const s = seedStore(ids.map((id) => sched(id)));
      s.files.set('results.json', JSON.stringify({ schemaVersion: 1, bizNo: OURS, updatedAt: '', entries: Object.fromEntries(ids.map((id) => [id, wonEntry(id, o)])) }));
      return s;
    };
    const withAmt = [{ prcbdrBizno: OURS, opengRank: '1', totalEvlAmtVal: '90', bidprcAmt: '291,990,000' }, { prcbdrBizno: '9998887776', opengRank: '2', totalEvlAmtVal: '80', bidprcAmt: '1' }];
    const openingCalls = (g: { calls: string[] }) => g.calls.filter((u) => u.includes('Openg')).length;

    it('list 모드에서 종료 won 항목은 1단계 1회 호출 후 ourAmount 저장, 2단계 미호출, 상태 유지, updated 증가, 재실행 시 재호출 없음', async () => {
      const s = seed([R1]);
      const g = fakeG2b((op) => (op.includes('Openg') ? withAmt : []));
      const r = await runResultRefresh(deps(s, g.fetch), { mode: 'list' });
      expect(g.calls).toHaveLength(1);
      expect(g.calls.some((u) => u.includes('Sttus'))).toBe(false);
      expect(rj(s).entries[R1]).toMatchObject({ status: 'won', rank: 1, ourAmount: 291990000, bidders: 2, amountCheckedAt: NOW.toISOString() });
      expect(r.updated).toBe(1);
      expect(r.checked).toBe(0);
      await runResultRefresh(deps(s, g.fetch), { mode: 'list' });
      expect(g.calls).toHaveLength(1);
    });

    it('follow 모드에서는 호출하지 않는다', async () => {
      const s = seed([R1]);
      const g = fakeG2b(() => withAmt);
      await runResultRefresh(deps(s, g.fetch), { mode: 'follow' });
      expect(g.calls).toHaveLength(0);
    });

    it('API 오류면 amountCheckedAt을 기록하지 않는다', async () => {
      const s = seed([R1]);
      const g = fakeG2b(() => new Error('network'));
      await runResultRefresh(deps(s, g.fetch), { mode: 'list' });
      expect(rj(s).entries[R1]!.amountCheckedAt).toBeUndefined();
      expect(rj(s).entries[R1]!.ourAmount).toBeUndefined();
    });

    it('키 오류면 KEY_INVALID로 중단한다', async () => {
      const s = seed([R1, R2]);
      const g = fakeG2b(() => 'KEY_INVALID');
      const r = await runResultRefresh(deps(s, g.fetch), { mode: 'list' });
      expect(r.skipped).toBe('KEY_INVALID');
      expect(openingCalls(g)).toBe(1);
    });

    it('상한 10건', async () => {
      const ids = Array.from({ length: 12 }, (_, i) => `R26BK${String(i + 1).padStart(8, '0')}-000`);
      const s = seed(ids);
      const g = fakeG2b(() => withAmt);
      await runResultRefresh(deps(s, g.fetch), { mode: 'list' });
      expect(g.calls).toHaveLength(10);
    });
  });
});

describe('runResultRefresh 유찰 목록 조회', () => {
  const failingOk: awardApi.FailingResult = { ok: true, rows: [], fetchedAt: NOW.toISOString(), called: true };
  afterEach(async () => {
    const actual = await vi.importActual<typeof awardApi>('../../src/adapters/g2b/award-api');
    vi.mocked(awardApi.fetchFailing).mockReset().mockImplementation(actual.fetchFailing);
  });

  it('1차 판정이 waiting일 때만 유찰 목록을 조회한다', async () => {
    const spy = vi.mocked(awardApi.fetchFailing).mockResolvedValue(failingOk);
    const s = seedStore([sched(R1), sched(R2)]);
    const g = fakeG2b((_op, no) => (no === 'R26BK00000001' ? opening(null) : opening(1, '999')));
    await runResultRefresh(deps(s, g.fetch), { mode: 'list' });
    expect(spy.mock.calls.map((c) => c[0])).toEqual(['R26BK00000001']);
  });

  it('ranked와 not_participated는 유찰 목록을 조회하지 않는다', async () => {
    const spy = vi.mocked(awardApi.fetchFailing).mockResolvedValue(failingOk);
    const s = seedStore([sched(R1), sched(R2)]);
    const g = fakeG2b((_op, no) => (no === 'R26BK00000001' ? opening(1) : opening(1, '999')));
    await runResultRefresh(deps(s, g.fetch), { mode: 'list' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('유찰 목록 키 오류면 KEY_INVALID로 중단한다', async () => {
    vi.mocked(awardApi.fetchFailing).mockResolvedValue({ ok: false, error: { code: 'G2B_KEY_INVALID', message: 'x', step: 'fetch_basic', retryable: false } });
    const s = seedStore([sched(R1), sched(R2, '2026-10-20T08:00:00+09:00')]);
    const g = fakeG2b(() => opening(null));
    const r = await runResultRefresh(deps(s, g.fetch), { mode: 'list' });
    expect(r.skipped).toBe('KEY_INVALID');
    expect(r.checked).toBe(0);
  });
});

describe('runResultRefresh 재공고 연결', () => {
  const setReannounceOf = (s: MemoryStore, id: string, of: string) => {
    const idx = JSON.parse(s.files.get('index.json') as string);
    idx.notices.find((e: { noticeId: string }) => e.noticeId === id).reannounceOf = of;
    s.files.set('index.json', JSON.stringify(idx));
  };
  const seed = () => {
    const s = seedStore([sched(R1), sched(R2)]);
    setReannounceOf(s, R2, 'R26BK00000001');
    return s;
  };

  it('list 모드에서 재공고가 index에 있으면 원 공고에 found를 기록하고 updated가 늘어난다', async () => {
    const s = seed();
    const g = fakeG2b(() => []);
    const r = await runResultRefresh(deps(s, g.fetch), { mode: 'list' });
    expect(rj(s).entries[R1]).toMatchObject({ status: 'no_bid', reannounce: { status: 'found', inferredNoBid: true, found: { noticeId: R2, via: 'collect' } } });
    expect(r.updated).toBeGreaterThanOrEqual(1);
  });

  it('팔로우 중인 원 공고가 추정 유찰이면 final 이벤트에 inferred를 달고 해제한다', async () => {
    const s = seed();
    follow(s, R1);
    const g = fakeG2b(() => []);
    const r = await runResultRefresh(deps(s, g.fetch), { mode: 'list' });
    expect(r.events).toContainEqual({ kind: 'final', noticeId: R1, title: `제목 ${R1}`, status: 'no_bid', inferred: true });
    expect(fj(s).entries[R1]).toBeUndefined();
  });

  it('follow 모드에서는 연결하지 않는다', async () => {
    const s = seed();
    follow(s, R1);
    const g = fakeG2b(() => opening(null));
    await runResultRefresh(deps(s, g.fetch), { mode: 'follow' });
    expect(rj(s).entries[R1]?.reannounce).toBeUndefined();
  });
});

describe('runResultRefresh 재공고 감시', () => {
  const NB = 'R26BK00000001-000';
  const NB2 = 'R26BK00000002-000';
  const NEW = 'R26BK00000099-000';
  const nobid = (id: string, w: Record<string, unknown> | null = {}, o: Record<string, unknown> = {}) => ({
    noticeId: id, noticeNo: id.slice(0, 13), round: '000', status: 'no_bid', openingAt: PAST, startAt: PAST, attempts: 0, nextCheckAt: PAST, checkedAt: PAST,
    ...(w ? { reannounce: { status: 'watching', since: '2026-10-19T00:00:00+09:00', nextCheckAt: PAST, attempts: 0, orgCode: 'B1', opKind: 'Servc', ...w } } : {}),
    ...o,
  });
  const put = (s: MemoryStore, ...es: Array<Record<string, unknown>>) =>
    s.files.set('results.json', JSON.stringify({ schemaVersion: 1, bizNo: OURS, updatedAt: '', entries: Object.fromEntries(es.map((e) => [e.noticeId as string, e])) }));
  const hitItem = { bidNtceNo: 'R26BK00000099', bidNtceOrd: '000', bidNtceNm: '새 공고', befBidBbancNo: 'R26BK00000001', reNtceYn: 'Y', bidNtceDt: '2026-10-20 09:00:00' };
  const searching = (items: unknown[] = [hitItem]) => (op: string): unknown[] => (op.endsWith('PPSSrch') ? items : []);
  const searchCalls = (calls: string[]) => calls.filter((u) => u.includes('PPSSrch'));

  it('no_bid 판정 시 팔로우가 없어도 watching을 만든다', async () => {
    const s = seedStore([sched(R1)]);
    const g = fakeG2b(() => [{ prcbdrBizno: '9999999999', opengRsltDivNm: '유찰' }]);
    await runResultRefresh(deps(s, g.fetch), { mode: 'list' });
    expect(rj(s).entries[R1]).toMatchObject({ status: 'no_bid', reannounce: { status: 'watching', attempts: 0 } });
  });

  it('no_bid와 target reannounce면 watchingReannounce 이벤트를 내고 팔로우를 유지한다', async () => {
    const s = seedStore([sched(R1)]);
    await runResultRefresh(deps(s, fakeG2b(() => []).fetch), { mode: 'list' }); // 결과 항목만 만든다
    const seeded = rj(s); seeded.entries[R1]!.nextCheckAt = PAST; s.files.set('results.json', JSON.stringify(seeded));
    follow(s, R1, {}, 'reannounce');
    const g = fakeG2b(() => [{ prcbdrBizno: '9999999999', opengRsltDivNm: '유찰' }]);
    const r = await runResultRefresh(deps(s, g.fetch), { mode: 'list' });
    expect(r.events).toEqual([{ kind: 'final', noticeId: R1, title: `제목 ${R1}`, status: 'no_bid', watchingReannounce: true }]);
    expect(fj(s).entries[R1]).toMatchObject({ target: 'reannounce', notified: { final: expect.any(String) } });
    expect(rj(s).entries[R1]!.reannounce!.status).toBe('watching');
  });

  it('no_bid와 target final이면 해제된다', async () => {
    const s = seedStore([sched(R1)]);
    await runResultRefresh(deps(s, fakeG2b(() => []).fetch), { mode: 'list' }); // 결과 항목만 만든다
    const seeded = rj(s); seeded.entries[R1]!.nextCheckAt = PAST; s.files.set('results.json', JSON.stringify(seeded));
    follow(s, R1, {}, 'final');
    const g = fakeG2b(() => [{ prcbdrBizno: '9999999999', opengRsltDivNm: '유찰' }]);
    const r = await runResultRefresh(deps(s, g.fetch), { mode: 'list' });
    expect(r.events[0]).toMatchObject({ kind: 'final', status: 'no_bid' });
    expect((r.events[0] as { watchingReannounce?: true }).watchingReannounce).toBeUndefined();
    expect(fj(s).entries[R1]).toBeUndefined();
  });

  it('감시 틱: 기관 코드가 없으면 notice.json codes를 쓴다', async () => {
    const s = seedStore([sched(NB)]);
    put(s, nobid(NB, { orgCode: undefined, opKind: undefined }));
    const nj = JSON.parse(s.files.get(`notices/${NB}/notice.json`) as string);
    s.files.set(`notices/${NB}/notice.json`, JSON.stringify({ ...nj, codes: { demandOrgCode: 'B9', opKind: 'Thng' } }));
    const g = fakeG2b(searching([]));
    await runResultRefresh(deps(s, g.fetch), { mode: 'list' });
    const calls = searchCalls(g.calls);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('getBidPblancListInfoThngPPSSrch');
    expect(calls[0]).toContain('dminsttCd=B9');
    expect(g.calls.some((u) => u.includes('inqryDiv=2'))).toBe(false);
  });

  it('감시 틱: codes도 없으면 공고정보를 1회 조회해 orgCode와 opKind를 저장한다', async () => {
    const s = seedStore([sched(NB)]);
    put(s, nobid(NB, { orgCode: undefined, opKind: undefined }));
    const g = fakeG2b((op) => (op === 'getBidPblancListInfoServc' ? [{ bidNtceNo: 'R26BK00000001', bidNtceOrd: '000', dminsttCd: 'B7' }] : []));
    await runResultRefresh(deps(s, g.fetch), { mode: 'list' });
    expect(g.calls.filter((u) => u.includes('inqryDiv=2'))).toHaveLength(1);
    expect(rj(s).entries[NB]!.reannounce).toMatchObject({ orgCode: 'B7', opKind: 'Servc' });
    expect(searchCalls(g.calls)[0]).toContain('dminsttCd=B7');
  });

  it('팔로우 hit는 found와 reannounce 이벤트 1회, 두 번째 실행은 이벤트가 없다', async () => {
    const s = seedStore([sched(NB)]);
    put(s, nobid(NB));
    follow(s, NB, {}, 'reannounce');
    const g = fakeG2b(searching());
    const r1 = await runResultRefresh(deps(s, g.fetch), { mode: 'follow' });
    expect(r1.events).toEqual([{ kind: 'reannounce', noticeId: NB, title: `제목 ${NB}`, noticeNo: 'R26BK00000099', round: '000', newTitle: '새 공고' }]);
    expect(rj(s).entries[NB]!.reannounce).toMatchObject({ status: 'found', found: { noticeNo: 'R26BK00000099', noticeId: NEW, via: 'search' } });
    expect(fj(s).entries[NB]!.notified.reannounce).toBeTruthy();
    const r2 = await runResultRefresh(deps(s, g.fetch), { mode: 'follow' });
    expect(r2.events).toEqual([]);
  });

  it('비팔로우 hit는 found만 기록하고 이벤트가 없으며 updated가 늘어난다', async () => {
    const s = seedStore([sched(NB)]);
    put(s, nobid(NB));
    const g = fakeG2b(searching());
    const r = await runResultRefresh(deps(s, g.fetch), { mode: 'list' });
    expect(r.events).toEqual([]);
    expect(r.updated).toBeGreaterThanOrEqual(1);
    expect(rj(s).entries[NB]!.reannounce!.status).toBe('found');
  });

  it('follow 모드에서는 비팔로우를 검색하지 않는다', async () => {
    const s = seedStore([sched(NB)]);
    put(s, nobid(NB));
    const g = fakeG2b(searching());
    await runResultRefresh(deps(s, g.fetch), { mode: 'follow' });
    expect(searchCalls(g.calls)).toHaveLength(0);
  });

  it('list 모드 비팔로우는 한 실행에 5건까지', async () => {
    const ids = Array.from({ length: 7 }, (_, i) => `R26BK0000010${i}-000`);
    const s = seedStore(ids.map((id) => sched(id)));
    put(s, ...ids.map((id) => nobid(id)));
    const g = fakeG2b(searching([]));
    await runResultRefresh(deps(s, g.fetch), { mode: 'list' });
    expect(searchCalls(g.calls)).toHaveLength(5);
  });

  it('키 오류면 KEY_INVALID로 중단한다', async () => {
    const s = seedStore([sched(NB)]);
    put(s, nobid(NB));
    const g = fakeG2b((op) => (op.endsWith('PPSSrch') ? 'KEY_INVALID' : []));
    const r = await runResultRefresh(deps(s, g.fetch), { mode: 'list' });
    expect(r.skipped).toBe('KEY_INVALID');
  });

  it('61일이 지나면 팔로우는 expired 이벤트와 해제, 비팔로우는 expired만', async () => {
    const since = '2026-08-01T00:00:00+09:00';
    const s = seedStore([sched(NB), sched(NB2)]);
    put(s, nobid(NB, { since }), nobid(NB2, { since }));
    follow(s, NB, {}, 'reannounce');
    const g = fakeG2b(searching([]));
    const r = await runResultRefresh(deps(s, g.fetch), { mode: 'list' });
    expect(r.events).toEqual([{ kind: 'reannounce_expired', noticeId: NB, title: `제목 ${NB}` }]);
    expect(fj(s).entries[NB]).toBeUndefined();
    expect(rj(s).entries[NB]!.reannounce!.status).toBe('expired');
    expect(rj(s).entries[NB2]!.reannounce!.status).toBe('expired');
  });

  it('승계: 재공고가 index에 있으면 새 공고로 팔로우를 넘긴다', async () => {
    const s = seedStore([sched(NB), sched(NEW)]);
    put(s, nobid(NB, { status: 'found', found: { noticeNo: 'R26BK00000099', round: '000', title: 't', noticeId: NEW, foundAt: PAST, via: 'search' } }));
    follow(s, NB, { final: PAST }, 'reannounce');
    const g = fakeG2b(() => []);
    await runResultRefresh(deps(s, g.fetch), { mode: 'list' });
    expect(fj(s).entries[NB]).toBeUndefined();
    expect(fj(s).entries[NEW]).toMatchObject({ noticeId: NEW, target: 'reannounce', notified: {} });
    expect(rj(s).entries[NB]!.reannounce!.status).toBe('found');
  });

  it('승계: 원 공고가 no_bid가 아니거나 target이 reannounce가 아니면 팔로우를 그대로 둔다', async () => {
    const s = seedStore([sched(NB), sched(NEW)]);
    const found = { status: 'found', found: { noticeNo: 'R26BK00000099', round: '000', title: 't', noticeId: NEW, foundAt: PAST, via: 'search' } };
    put(s, nobid(NB, found, { status: 'ranked', nextCheckAt: new Date(NOW.getTime() + 3600_000).toISOString() }));
    follow(s, NB, {}, 'final');
    const g = fakeG2b(() => []);
    await runResultRefresh(deps(s, g.fetch), { mode: 'list' });
    expect(fj(s).entries[NB]).toBeDefined();
    expect(fj(s).entries[NEW]).toBeUndefined();
  });

  it('감시 기간(61일)을 넘기면 코드가 없어도 API 호출 없이 만료 처리한다', async () => {
    const s = seedStore([sched(NB)]);
    put(s, nobid(NB, { since: '2026-08-01T00:00:00+09:00', orgCode: undefined, opKind: undefined }));
    follow(s, NB, {}, 'reannounce');
    const g = fakeG2b(searching());
    const r = await runResultRefresh(deps(s, g.fetch), { mode: 'list' });
    expect(g.calls.filter((u) => u.includes('PPSSrch') || u.includes('inqryDiv=2'))).toHaveLength(0);
    expect(rj(s).entries[NB]!.reannounce!.status).toBe('expired');
    expect(r.events).toEqual([{ kind: 'reannounce_expired', noticeId: NB, title: `제목 ${NB}` }]);
    expect(fj(s).entries[NB]).toBeUndefined();
  });

  it('nextFollowCheckAt은 팔로우 감시를 포함하고 비팔로우 감시는 포함하지 않는다', async () => {
    const later = new Date(NOW.getTime() + 3 * 3600_000).toISOString();
    const s = seedStore([sched(NB)]);
    put(s, nobid(NB, { nextCheckAt: later }));
    const g = fakeG2b(() => []);
    expect((await runResultRefresh(deps(s, g.fetch), { mode: 'list' })).nextFollowCheckAt).toBeNull();
    follow(s, NB, {}, 'reannounce');
    expect((await runResultRefresh(deps(s, g.fetch), { mode: 'list' })).nextFollowCheckAt).toBe(later);
  });

  it('감시 루프는 투찰금액 백필보다 먼저 실행된다', async () => {
    const s = seedStore([sched(NB), sched(R2)]);
    put(s, nobid(NB), { noticeId: R2, noticeNo: R2.slice(0, 13), round: '000', status: 'lost', openingAt: PAST, startAt: PAST, attempts: 0, nextCheckAt: PAST });
    const g = fakeG2b(searching([]));
    await runResultRefresh(deps(s, g.fetch), { mode: 'list' });
    const search = g.calls.findIndex((u) => u.includes('PPSSrch'));
    const backfill = g.calls.findIndex((u) => u.includes('OpengCompt') && u.includes('R26BK00000002'));
    expect(search).toBeGreaterThanOrEqual(0);
    expect(backfill).toBeGreaterThan(search);
  });

  it('비팔로우 found 항목은 알림 이벤트가 없어 startJob 경로를 타지 않는다', async () => {
    const s = seedStore([sched(NB)]);
    put(s, nobid(NB));
    const g = fakeG2b(searching());
    const r = await runResultRefresh(deps(s, g.fetch), { mode: 'list' });
    expect(rj(s).entries[NB]!.reannounce!.status).toBe('found');
    expect(r.events.filter((e) => e.kind === 'reannounce')).toEqual([]);
  });
});
