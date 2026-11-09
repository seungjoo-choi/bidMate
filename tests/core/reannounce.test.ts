import { describe, expect, it } from 'vitest';
import { ensureWatches, linkCollected, normalizeTitle } from '../../src/core/results/reannounce';
import type { IndexEntry } from '../../src/core/types/index-file';
import type { ResultEntry, ResultFile } from '../../src/core/types/result';

const NOW = new Date('2026-10-20T12:00:00+09:00');
const ORIG = 'R26BK00000001';
const idx = (noticeNo: string, round = '000', extra: Partial<IndexEntry> = {}): IndexEntry =>
  ({ noticeId: `${noticeNo}-${round}`, noticeNo, round, title: `제목 ${noticeNo}`, ...extra }) as unknown as IndexEntry;
const res = (o: Partial<ResultEntry> = {}, noticeNo = ORIG, round = '000'): ResultEntry =>
  ({ noticeId: `${noticeNo}-${round}`, noticeNo, round, status: 'waiting', openingAt: 'o', startAt: 's', attempts: 2, nextCheckAt: 'n', ...o });
const file = (...es: ResultEntry[]): ResultFile => ({ schemaVersion: 1, bizNo: '1', updatedAt: '', entries: Object.fromEntries(es.map((e) => [e.noticeId, e])) });
const RE = idx('R26BK00000002', '000', { reannounceOf: ORIG });

describe('normalizeTitle', () => {
  it('긴급과 재공고 표기, 공백을 없앤다', () => {
    expect(normalizeTitle('[긴급] A 용역 (재공고)')).toBe(normalizeTitle('A 용역'));
  });
});

describe('linkCollected', () => {
  it('원 공고에 found를 기록하고 via는 collect', () => {
    const f = file(res({ status: 'lost' }));
    const r = linkCollected([idx(ORIG), RE], f, NOW);
    expect(r).toEqual([{ id: `${ORIG}-000`, prevStatus: 'lost' }]);
    expect(f.entries[`${ORIG}-000`]!.reannounce).toMatchObject({ status: 'found', found: { noticeNo: 'R26BK00000002', round: '000', noticeId: 'R26BK00000002-000', via: 'collect' } });
  });

  it('waiting은 no_bid로 바꾸고 inferredNoBid를 표시한다', () => {
    const f = file(res({ status: 'waiting', rank: 1, bidders: 3, lastError: { code: 'x', message: 'y' } }));
    linkCollected([idx(ORIG), RE], f, NOW);
    const e = f.entries[`${ORIG}-000`]!;
    expect(e).toMatchObject({ status: 'no_bid', attempts: 0, checkedAt: NOW.toISOString() });
    expect(e.rank).toBeUndefined();
    expect(e.bidders).toBeUndefined();
    expect(e.lastError).toBeUndefined();
    expect(e.reannounce?.inferredNoBid).toBe(true);
  });

  it('expired도 no_bid로 바꾼다', () => {
    const f = file(res({ status: 'expired' }));
    linkCollected([idx(ORIG), RE], f, NOW);
    expect(f.entries[`${ORIG}-000`]).toMatchObject({ status: 'no_bid', reannounce: { inferredNoBid: true } });
  });

  it('lost는 상태를 바꾸지 않고 found만 기록한다', () => {
    const f = file(res({ status: 'lost' }));
    linkCollected([idx(ORIG), RE], f, NOW);
    const e = f.entries[`${ORIG}-000`]!;
    expect(e.status).toBe('lost');
    expect(e.reannounce?.status).toBe('found');
    expect(e.reannounce?.inferredNoBid).toBeUndefined();
  });

  it('이미 found면 바꾸지 않고 반환 목록에도 없다', () => {
    const f = file(res({ status: 'no_bid', reannounce: { status: 'found', since: 's', nextCheckAt: 'n', attempts: 0 } }));
    expect(linkCollected([idx(ORIG), RE], f, NOW)).toEqual([]);
    expect(f.entries[`${ORIG}-000`]!.reannounce?.nextCheckAt).toBe('n');
  });

  it('원 공고 결과 항목이 없으면 건너뛴다', () => {
    const f = file();
    expect(linkCollected([idx(ORIG), RE], f, NOW)).toEqual([]);
    expect(Object.keys(f.entries)).toHaveLength(0);
  });

  it('원 공고 round 000과 001 중 최신에 연결한다', () => {
    const f = file(res({ status: 'no_bid' }, ORIG, '000'), res({ status: 'no_bid' }, ORIG, '001'));
    const r = linkCollected([idx(ORIG, '000'), idx(ORIG, '001'), RE], f, NOW);
    expect(r.map((c) => c.id)).toEqual([`${ORIG}-001`]);
    expect(f.entries[`${ORIG}-000`]!.reannounce).toBeUndefined();
  });
});

describe('ensureWatches', () => {
  const D = (d: string) => new Date(`${d}T12:00:00+09:00`);
  it('no_bid이고 감시가 없으면 checkedAt을 since로 watching을 만든다', () => {
    const f = file(res({ status: 'no_bid', checkedAt: '2026-10-18T10:00:00+09:00', openingAt: '2026-10-10T10:00:00+09:00' }));
    expect(ensureWatches(f, D('2026-10-20'))).toEqual([`${ORIG}-000`]);
    expect(f.entries[`${ORIG}-000`]!.reannounce).toMatchObject({ status: 'watching', since: '2026-10-18T10:00:00+09:00', attempts: 0, nextCheckAt: D('2026-10-20').toISOString() });
  });
  it('checkedAt이 없으면 openingAt을 since로 쓴다', () => {
    const f = file(res({ status: 'no_bid', openingAt: '2026-10-10T10:00:00+09:00' }));
    ensureWatches(f, D('2026-10-20'));
    expect(f.entries[`${ORIG}-000`]!.reannounce!.since).toBe('2026-10-10T10:00:00+09:00');
  });
  it('61일 지난 것은 호출 없이 expired', () => {
    const f = file(res({ status: 'no_bid', checkedAt: '2026-08-01T10:00:00+09:00' }));
    ensureWatches(f, D('2026-10-20'));
    expect(f.entries[`${ORIG}-000`]!.reannounce!.status).toBe('expired');
  });
  it('이미 감시가 있으면 불변, 반환 목록에도 없다', () => {
    const f = file(res({ status: 'no_bid', reannounce: { status: 'watching', since: 's', nextCheckAt: 'n', attempts: 3 } }));
    expect(ensureWatches(f, D('2026-10-20'))).toEqual([]);
    expect(f.entries[`${ORIG}-000`]!.reannounce!.attempts).toBe(3);
  });
  it('won은 불변', () => {
    const f = file(res({ status: 'won' }));
    expect(ensureWatches(f, D('2026-10-20'))).toEqual([]);
    expect(f.entries[`${ORIG}-000`]!.reannounce).toBeUndefined();
  });
});
