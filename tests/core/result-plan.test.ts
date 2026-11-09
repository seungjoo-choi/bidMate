import { describe, expect, it } from 'vitest';
import { planReannounce } from '../../src/core/results/plan';
import type { IndexEntry } from '../../src/core/types/index-file';
import type { FollowFile, ReannounceWatch, ResultEntry, ResultFile } from '../../src/core/types/result';

const NOW = new Date('2026-10-20T12:00:00+09:00');
const H = 3600_000;
const no = (i: number) => `R26BK0000${String(i).padStart(3, '0')}`;
const idx = (n: number, round = '000'): IndexEntry => ({ noticeId: `${no(n)}-${round}`, noticeNo: no(n), round, title: 't' }) as unknown as IndexEntry;
const entry = (n: number, w: Partial<ReannounceWatch> | null, o: Partial<ResultEntry> = {}, round = '000'): ResultEntry => ({
  noticeId: `${no(n)}-${round}`, noticeNo: no(n), round, status: 'no_bid', openingAt: 'o', startAt: 's', attempts: 0, nextCheckAt: 'n',
  ...(w ? { reannounce: { status: 'watching', since: new Date(NOW.getTime() - 24 * H).toISOString(), nextCheckAt: new Date(NOW.getTime() - H).toISOString(), attempts: 0, ...w } } : {}),
  ...o,
});
const results = (...es: ResultEntry[]): ResultFile => ({ schemaVersion: 1, bizNo: '1', updatedAt: '', entries: Object.fromEntries(es.map((e) => [e.noticeId, e])) });
const follows = (...ids: Array<[string, 'reannounce' | 'final']>): FollowFile => ({ schemaVersion: 1, updatedAt: '', entries: Object.fromEntries(ids.map(([id, target]) => [id, { noticeId: id, followedAt: '', target, notified: {} }])) });
const plan = (index: IndexEntry[], r: ResultFile, f: FollowFile, mode: 'list' | 'follow') => planReannounce({ index, results: r, follows: f, now: NOW, mode });

describe('planReannounce', () => {
  it('팔로우와 일반을 나눈다', () => {
    const r = results(entry(1, {}), entry(2, {}));
    const p = plan([idx(1), idx(2)], r, follows([`${no(1)}-000`, 'reannounce']), 'list');
    expect(p).toEqual({ followed: [`${no(1)}-000`], general: [`${no(2)}-000`] });
  });
  it('follow 모드에서는 general이 비어 있다', () => {
    const r = results(entry(1, {}), entry(2, {}));
    const p = plan([idx(1), idx(2)], r, follows([`${no(1)}-000`, 'reannounce']), 'follow');
    expect(p.followed).toHaveLength(1);
    expect(p.general).toEqual([]);
  });
  it('target final 팔로우는 general로 본다', () => {
    const r = results(entry(1, {}));
    const p = plan([idx(1)], r, follows([`${no(1)}-000`, 'final']), 'list');
    expect(p).toEqual({ followed: [], general: [`${no(1)}-000`] });
  });
  it('watching이 아니거나 due가 아닌 항목은 제외한다', () => {
    const r = results(entry(1, { status: 'found' }), entry(2, { nextCheckAt: new Date(NOW.getTime() + H).toISOString() }), entry(3, null), entry(4, {}, { status: 'lost' }));
    expect(plan([idx(1), idx(2), idx(3), idx(4)], r, follows(), 'list')).toEqual({ followed: [], general: [] });
  });
  it('general은 since 내림차순 상한 5', () => {
    const es = [1, 2, 3, 4, 5, 6, 7].map((n) => entry(n, { since: new Date(NOW.getTime() - n * H).toISOString() }));
    const p = plan(es.map((e, i) => idx(i + 1)), results(...es), follows(), 'list');
    expect(p.general).toEqual([1, 2, 3, 4, 5].map((n) => `${no(n)}-000`));
  });
  it('followed는 nextCheckAt 오름차순 상한 10', () => {
    const es = Array.from({ length: 12 }, (_, i) => entry(i + 1, { nextCheckAt: new Date(NOW.getTime() - (i + 1) * H).toISOString() }));
    const p = plan(es.map((_, i) => idx(i + 1)), results(...es), follows(...es.map((e) => [e.noticeId, 'reannounce'] as [string, 'reannounce'])), 'follow');
    expect(p.followed).toHaveLength(10);
    expect(p.followed[0]).toBe(`${no(12)}-000`);
  });
  it('000과 001 중 최신 001만 대상', () => {
    const r = results(entry(1, {}, {}, '000'), entry(1, {}, {}, '001'));
    const p = plan([idx(1, '000'), idx(1, '001')], r, follows(), 'list');
    expect(p.general).toEqual([`${no(1)}-001`]);
  });
});
