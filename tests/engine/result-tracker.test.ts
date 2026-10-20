import { describe, expect, it } from 'vitest';
import type { FollowFile, ResultFile } from '../../src/core/types/result';
import { backoffMs } from '../../src/core/results/judge';
import { runResultRefresh, type ResultTrackerDeps } from '../../src/engine/results/result-tracker';
import { fakeG2b, NOW, OURS, seedStore, type Seed } from '../helpers/result-fixture';
import type { MemoryStore } from '../helpers/memory-store';

const PAST = '2026-10-20T09:00:00+09:00';
const R1 = 'R26BK00000001-000';
const R2 = 'R26BK00000002-000';
const rj = (s: MemoryStore): ResultFile => JSON.parse(s.files.get('results.json') as string);
const fj = (s: MemoryStore): FollowFile => JSON.parse(s.files.get('follows.json') as string);
const opening = (rank: number | null, bizNo = OURS) => [{ prcbdrBizno: bizNo, opengRank: rank === null ? '' : String(rank), totalEvlAmtVal: rank === null ? '' : '90' }];
const deps = (store: MemoryStore, fetchFn: typeof fetch, o: Partial<ResultTrackerDeps> = {}): ResultTrackerDeps =>
  ({ store, fetch: fetchFn, serviceKey: 'KEY', bizNo: '123-45-67890', now: () => NOW, checkPermission: async () => true, ...o });
const sched = (id: string, openingAt = PAST): Seed => ({ id, openingAt });
const follow = (store: MemoryStore, id: string, notified = {}, target?: 'rank' | 'final') => store.files.set('follows.json', JSON.stringify({ schemaVersion: 1, updatedAt: '', entries: { [id]: { noticeId: id, followedAt: PAST, ...(target ? { target } : {}), notified } } }));

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
