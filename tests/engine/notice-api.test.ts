import { describe, expect, it } from 'vitest';
import { listNotices } from '../../src/engine/notices/notice-api';
import { seedStore } from '../helpers/result-fixture';

const A = 'R26BK00000001-000';
const B = 'R26BK00000002-000';

describe('listNotices 결과 병합', () => {
  it('results.json과 follows.json을 result/following으로 합친다', async () => {
    const s = seedStore([{ id: A }, { id: B }]);
    s.files.set('results.json', JSON.stringify({ schemaVersion: 1, bizNo: '1', updatedAt: '', entries: { [A]: { noticeId: A, status: 'won', rank: 2, bidders: 5, awardedAt: '2026-10-20T10:00:00+09:00', amount: 100, startAt: 's', nextCheckAt: 'n', attempts: 0 } } }));
    s.files.set('follows.json', JSON.stringify({ schemaVersion: 1, updatedAt: '', entries: { [B]: { noticeId: B, followedAt: '', notified: {} } } }));
    const list = await listNotices(s);
    expect(list.find((e) => e.noticeId === A)).toMatchObject({ result: { status: 'won', rank: 2, bidders: 5, amount: 100, startAt: 's', nextCheckAt: 'n' } });
    expect(list.find((e) => e.noticeId === A)!.following).toBeUndefined();
    expect(list.find((e) => e.noticeId === B)).toMatchObject({ following: 'final' });
    expect(list.find((e) => e.noticeId === B)!.result).toBeUndefined();
  });

  it('following은 target 값을 따르고 없으면 final, 팔로우가 아니면 없다', async () => {
    const C = 'R26BK00000003-000';
    const s = seedStore([{ id: A }, { id: B }, { id: C }]);
    s.files.set('follows.json', JSON.stringify({ schemaVersion: 1, updatedAt: '', entries: {
      [A]: { noticeId: A, followedAt: '', notified: {} },
      [B]: { noticeId: B, followedAt: '', target: 'rank', notified: {} },
    } }));
    const list = await listNotices(s);
    expect(list.find((e) => e.noticeId === A)!.following).toBe('final');
    expect(list.find((e) => e.noticeId === B)!.following).toBe('rank');
    expect(list.find((e) => e.noticeId === C)!.following).toBeUndefined();
  });

  it('ourAmount와 openingAt을 값이 있을 때만 병합한다', async () => {
    const s = seedStore([{ id: A }, { id: B }]);
    s.files.set('results.json', JSON.stringify({ schemaVersion: 1, bizNo: '1', updatedAt: '', entries: {
      [A]: { noticeId: A, status: 'won', ourAmount: 700, openingAt: '2026-10-20T10:00:00+09:00', startAt: 's', nextCheckAt: 'n', attempts: 0 },
      [B]: { noticeId: B, status: 'lost', startAt: 's', nextCheckAt: 'n', attempts: 0 },
    } }));
    const list = await listNotices(s);
    expect(list.find((e) => e.noticeId === A)!.result).toMatchObject({ ourAmount: 700, openingAt: '2026-10-20T10:00:00+09:00' });
    const b = list.find((e) => e.noticeId === B)!.result!;
    expect('ourAmount' in b).toBe(false);
    expect('openingAt' in b).toBe(false);
  });

  it('파일이 손상됐으면 result 없이 반환한다', async () => {
    const s = seedStore([{ id: A }]);
    s.files.set('results.json', '{broken');
    s.files.set('follows.json', '[1');
    const list = await listNotices(s);
    expect(list).toHaveLength(1);
    expect(list[0]!.result).toBeUndefined();
    expect(list[0]!.following).toBeUndefined();
  });
});

describe('listNotices 재공고 병합', () => {
  const O = 'R26BK00000010-000';
  const N = 'R26BK00000011-000';
  const setIndexReannounceOf = (s: ReturnType<typeof seedStore>, id: string, of: string) => {
    const idx = JSON.parse(s.files.get('index.json') as string);
    idx.notices.find((e: { noticeId: string }) => e.noticeId === id).reannounceOf = of;
    s.files.set('index.json', JSON.stringify(idx));
  };
  const results = (found: unknown) => JSON.stringify({ schemaVersion: 1, bizNo: '1', updatedAt: '', entries: { [O]: { noticeId: O, status: 'no_bid', startAt: 's', nextCheckAt: 'n', attempts: 0, reannounce: { status: 'found', since: 's', nextCheckAt: 'n', attempts: 0, found } } } });

  it('found의 noticeId는 index에 있을 때만 병합한다', async () => {
    const found = { noticeNo: 'R26BK00000011', round: '000', title: '재공고', noticeId: N, foundAt: 'f', via: 'collect' };
    const s = seedStore([{ id: O }, { id: N }]);
    s.files.set('results.json', results(found));
    expect((await listNotices(s)).find((e) => e.noticeId === O)!.result!.reannounce).toEqual({ status: 'found', noticeNo: 'R26BK00000011', round: '000', title: '재공고', noticeId: N });
    const s2 = seedStore([{ id: O }]);
    s2.files.set('results.json', results(found));
    expect((await listNotices(s2)).find((e) => e.noticeId === O)!.result!.reannounce).toEqual({ status: 'found', noticeNo: 'R26BK00000011', round: '000', title: '재공고' });
  });

  it('reannounceOfId는 원 공고가 index에 있을 때만 채운다', async () => {
    const s = seedStore([{ id: O }, { id: N }]);
    setIndexReannounceOf(s, N, 'R26BK00000010');
    expect((await listNotices(s)).find((e) => e.noticeId === N)!.reannounceOfId).toBe(O);
    const s2 = seedStore([{ id: N }]);
    setIndexReannounceOf(s2, N, 'R26BK00000010');
    expect((await listNotices(s2)).find((e) => e.noticeId === N)!.reannounceOfId).toBeUndefined();
  });
});
