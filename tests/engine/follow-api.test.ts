import { describe, expect, it } from 'vitest';
import type { FollowFile, ResultFile } from '../../src/core/types/result';
import { setFollow } from '../../src/engine/results/follow-api';
import { NOW, seedStore } from '../helpers/result-fixture';
import type { MemoryStore } from '../helpers/memory-store';

const ID = 'R26BK00000001-000';
const rj = (s: MemoryStore): ResultFile => JSON.parse(s.files.get('results.json') as string);
const fj = (s: MemoryStore): FollowFile => JSON.parse(s.files.get('follows.json') as string);
const opts = { now: () => NOW };
const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return (e as { code?: string }).code; } };

describe('setFollow', () => {
  it('일정이 없으면 FOLLOW_NO_SCHEDULE', async () => {
    const s = seedStore([{ id: ID, openingAt: null, bidCloseAt: '2026-10-20T10:00:00+09:00' }]);
    expect(await code(setFollow(s, { noticeId: ID, follow: true }, opts))).toBe('FOLLOW_NO_SCHEDULE');
  });

  it('사전규격은 FOLLOW_UNSUPPORTED, 없는 공고는 NOT_FOUND', async () => {
    const s = seedStore([{ id: ID, openingAt: '2026-10-20T10:00:00+09:00', kind: 'prespec' }]);
    expect(await code(setFollow(s, { noticeId: ID, follow: true }, opts))).toBe('FOLLOW_UNSUPPORTED');
    expect(await code(setFollow(s, { noticeId: 'X-000', follow: true }, opts))).toBe('NOT_FOUND');
  });

  it('종료 상태면 FOLLOW_FINISHED', async () => {
    const s = seedStore([{ id: ID, openingAt: '2026-10-20T10:00:00+09:00' }]);
    s.files.set('results.json', JSON.stringify({ schemaVersion: 1, bizNo: '1', updatedAt: '', entries: { [ID]: { noticeId: ID, status: 'won', startAt: '', nextCheckAt: '', attempts: 0 } } }));
    expect(await code(setFollow(s, { noticeId: ID, follow: true }, opts))).toBe('FOLLOW_FINISHED');
  });

  it('켜면 항목을 만들고 팔로우에 추가, 끄면 결과는 유지', async () => {
    const s = seedStore([{ id: ID, openingAt: '2026-10-20T10:00:00+09:00', proposalEvalAt: '2026-10-20T11:00:00+09:00' }]);
    const on = await setFollow(s, { noticeId: ID, follow: true }, opts);
    const start = new Date(Date.parse('2026-10-20T11:00:00+09:00')).toISOString();
    expect(on).toMatchObject({ following: true, target: 'final', startAt: start });
    expect(fj(s).entries[ID]!.target).toBe('final');
    expect(rj(s).entries[ID]).toMatchObject({ status: 'waiting', startAt: start, proposalEvalAt: '2026-10-20T11:00:00+09:00' });
    expect(fj(s).entries[ID]!.notified).toEqual({});
    expect(on.nextFollowCheckAt).toBe(rj(s).entries[ID]!.nextCheckAt);
    const off = await setFollow(s, { noticeId: ID, follow: false }, opts);
    expect(off).toMatchObject({ following: false, target: null, nextFollowCheckAt: null, startAt: start });
    expect(fj(s).entries[ID]).toBeUndefined();
    expect(rj(s).entries[ID]).toBeDefined();
  });

  it('target rank로 켜면 항목과 응답에 rank가 들어간다', async () => {
    const s = seedStore([{ id: ID, openingAt: '2026-10-20T10:00:00+09:00' }]);
    const on = await setFollow(s, { noticeId: ID, follow: true, target: 'rank' }, opts);
    expect(on.target).toBe('rank');
    expect(fj(s).entries[ID]!.target).toBe('rank');
  });

  it('팔로우 중 target을 바꾸면 followedAt과 notified는 유지된다', async () => {
    const s = seedStore([{ id: ID, openingAt: '2026-10-20T10:00:00+09:00' }]);
    s.files.set('follows.json', JSON.stringify({ schemaVersion: 1, updatedAt: '', entries: { [ID]: { noticeId: ID, followedAt: 'old', target: 'rank', notified: { rank: 'x' } } } }));
    const r = await setFollow(s, { noticeId: ID, follow: true, target: 'final' }, opts);
    expect(r.target).toBe('final');
    expect(fj(s).entries[ID]).toEqual({ noticeId: ID, followedAt: 'old', target: 'final', notified: { rank: 'x' } });
  });

  it('개찰 결과만으로 바꾸면 순위 알림 기록을 비운다', async () => {
    const s = seedStore([{ id: ID, openingAt: '2026-10-20T10:00:00+09:00' }]);
    s.files.set('follows.json', JSON.stringify({ schemaVersion: 1, updatedAt: '', entries: { [ID]: { noticeId: ID, followedAt: 'old', target: 'final', notified: { rank: 'x' } } } }));
    await setFollow(s, { noticeId: ID, follow: true, target: 'rank' }, opts);
    expect(fj(s).entries[ID]).toEqual({ noticeId: ID, followedAt: 'old', target: 'rank', notified: {} });
  });

  it('깨진 항목이 있어도 나머지 팔로우는 살린다', async () => {
    const s = seedStore([{ id: ID, openingAt: '2026-10-20T10:00:00+09:00' }, { id: 'R26BK00000002-000', openingAt: '2026-10-20T10:00:00+09:00' }]);
    s.files.set('follows.json', JSON.stringify({ schemaVersion: 1, updatedAt: '', entries: { BAD: null, [ID]: { noticeId: ID, followedAt: 'old', notified: {} } } }));
    await setFollow(s, { noticeId: 'R26BK00000002-000', follow: true }, opts);
    expect(Object.keys(fj(s).entries).sort()).toEqual([ID, 'R26BK00000002-000']);
  });

  it('ranked 상태에서 rank는 FOLLOW_RANK_DONE, final은 성공', async () => {
    const s = seedStore([{ id: ID, openingAt: '2026-10-20T10:00:00+09:00' }]);
    s.files.set('results.json', JSON.stringify({ schemaVersion: 1, bizNo: '1', updatedAt: '', entries: { [ID]: { noticeId: ID, status: 'ranked', startAt: '', nextCheckAt: '2026-10-20T13:00:00Z', attempts: 1 } } }));
    expect(await code(setFollow(s, { noticeId: ID, follow: true, target: 'rank' }, opts))).toBe('FOLLOW_RANK_DONE');
    expect(await code(setFollow(s, { noticeId: ID, follow: true, target: 'final' }, opts))).toBe('ok');
  });

  it('target 없는 옛 follows.json의 기존 항목은 다른 공고를 켤 때 final로 저장된다', async () => {
    const OLD = 'R26BK00000009-000';
    const s = seedStore([{ id: ID, openingAt: '2026-10-20T10:00:00+09:00' }, { id: OLD, openingAt: '2026-10-20T10:00:00+09:00' }]);
    s.files.set('follows.json', JSON.stringify({ schemaVersion: 1, updatedAt: '', entries: { [OLD]: { noticeId: OLD, followedAt: 'old', notified: {} } } }));
    await setFollow(s, { noticeId: ID, follow: true }, opts);
    expect(fj(s).entries[OLD]!.target).toBe('final');
  });

  it('손상된 follows.json은 corrupt 파일로 남기고 빈 파일로 시작', async () => {
    const s = seedStore([{ id: ID, openingAt: '2026-10-20T10:00:00+09:00' }]);
    s.files.set('follows.json', '{broken');
    await setFollow(s, { noticeId: ID, follow: true }, opts);
    const corrupt = [...s.files.keys()].filter((k) => k.startsWith('follows.corrupt-'));
    expect(corrupt).toHaveLength(1);
    expect(s.files.get(corrupt[0]!)).toBe('{broken');
    expect(Object.keys(fj(s).entries)).toEqual([ID]);
  });
});

describe('setFollow 재공고까지', () => {
  const putResult = (s: MemoryStore, e: Record<string, unknown>) => s.files.set('results.json', JSON.stringify({ schemaVersion: 1, bizNo: '1', updatedAt: '', entries: { [ID]: { noticeId: ID, noticeNo: 'R26BK00000001', round: '000', startAt: '2026-10-20T10:00:00+09:00', openingAt: '2026-10-20T10:00:00+09:00', nextCheckAt: '', attempts: 0, ...e } } }));
  const seed = () => seedStore([{ id: ID, openingAt: '2026-10-20T10:00:00+09:00' }]);
  const FIRST = new Date(NOW.getTime() + 10 * 60_000).toISOString();

  it('유찰 공고에 reannounce를 허용하고 watching을 만들며 startAt이 nextCheckAt이다', async () => {
    const s = seed();
    putResult(s, { status: 'no_bid' });
    const r = await setFollow(s, { noticeId: ID, follow: true, target: 'reannounce' }, opts);
    expect(r).toMatchObject({ following: true, target: 'reannounce', startAt: FIRST, nextFollowCheckAt: FIRST });
    expect(rj(s).entries[ID]!.reannounce).toMatchObject({ status: 'watching', since: NOW.toISOString(), nextCheckAt: FIRST, attempts: 0 });
    expect(fj(s).entries[ID]!.target).toBe('reannounce');
  });

  it('유찰 공고에 final은 FOLLOW_FINISHED', async () => {
    const s = seed();
    putResult(s, { status: 'no_bid' });
    expect(await code(setFollow(s, { noticeId: ID, follow: true, target: 'final' }, opts))).toBe('FOLLOW_FINISHED');
  });

  it('재공고가 확인된 유찰은 FOLLOW_REANNOUNCED', async () => {
    const s = seed();
    putResult(s, { status: 'no_bid', reannounce: { status: 'found', since: 's', nextCheckAt: 'n', attempts: 0 } });
    expect(await code(setFollow(s, { noticeId: ID, follow: true, target: 'reannounce' }, opts))).toBe('FOLLOW_REANNOUNCED');
  });

  it('expired 감시에 다시 켜면 since를 다시 시작한다', async () => {
    const s = seed();
    putResult(s, { status: 'no_bid', reannounce: { status: 'expired', since: '2026-01-01T00:00:00+09:00', nextCheckAt: 'n', attempts: 5, orgCode: 'B1' } });
    await setFollow(s, { noticeId: ID, follow: true, target: 'reannounce' }, opts);
    expect(rj(s).entries[ID]!.reannounce).toMatchObject({ status: 'watching', since: NOW.toISOString(), attempts: 0, orgCode: 'B1' });
  });

  it('옛 파일의 target reannounce는 그대로 유지된다', async () => {
    const OLD = 'R26BK00000009-000';
    const s = seedStore([{ id: ID, openingAt: '2026-10-20T10:00:00+09:00' }, { id: OLD, openingAt: '2026-10-20T10:00:00+09:00' }]);
    s.files.set('follows.json', JSON.stringify({ schemaVersion: 1, updatedAt: '', entries: { [OLD]: { noticeId: OLD, followedAt: 'old', target: 'reannounce', notified: {} } } }));
    await setFollow(s, { noticeId: ID, follow: true }, opts);
    expect(fj(s).entries[OLD]!.target).toBe('reannounce');
  });
});
