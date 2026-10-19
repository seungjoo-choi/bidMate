import { describe, expect, it } from 'vitest';
import { lookupInIndex } from '../../src/engine/notices/lookup';
import type { IndexEntry, IndexFile } from '../../src/core/types/index-file';

const entry = (noticeNo: string, round: string, collectedAt: string): IndexEntry => ({
  noticeId: `${noticeNo}-${round}`, noticeNo, round, title: 't', orderingOrg: 'o', folder: 'f', collectedAt, collectStatus: 'completed',
  attachments: { total: 1, saved: 1, failed: 0 }, extractionStatus: 'none', mailStatus: 'none', isCorrection: false,
} as unknown as IndexEntry);
const idx: IndexFile = {
  schemaVersion: 1, generatedAt: 'x',
  notices: [entry('A', '000', '2026-01-01T00:00:00Z'), entry('A', '001', '2026-02-01T00:00:00Z'), entry('B', '000', '2026-03-01T00:00:00Z')],
};

describe('lookupInIndex', () => {
  it('차수가 있으면 그 차수만 본다', () => {
    expect(lookupInIndex(idx, { noticeNo: 'A', round: '000' })).toMatchObject({ found: true, collectedAt: '2026-01-01T00:00:00Z' });
  });
  it('차수가 없으면 최신 collectedAt', () => {
    expect(lookupInIndex(idx, { noticeNo: 'A' })).toMatchObject({ found: true, collectedAt: '2026-02-01T00:00:00Z' });
  });
  it('없으면 found:false', () => {
    expect(lookupInIndex(idx, { noticeNo: 'Z' })).toEqual({ found: false });
  });
  it('배치 map은 입력 순서를 보존한다', () => {
    const r = [{ noticeNo: 'B' }, { noticeNo: 'Z' }, { noticeNo: 'A', round: '000' }].map((x) => lookupInIndex(idx, x));
    expect(r.map((x) => x.found)).toEqual([true, false, true]);
    expect(r[0]).toMatchObject({ collectedAt: '2026-03-01T00:00:00Z' });
  });
});

describe('lookupInIndex kind 필터', () => {
  const pre = { ...entry('R26BD00273952', '', '2026-04-01T00:00:00Z'), kind: 'prespec' as const };
  const idx2: IndexFile = { schemaVersion: 1, generatedAt: 'x', notices: [...idx.notices, pre, entry('R26BD00273952', '000', '2026-05-01T00:00:00Z')] };
  it('prespec ref는 prespec 엔트리만 본다', () => {
    expect(lookupInIndex(idx2, { kind: 'prespec', noticeNo: 'R26BD00273952' })).toMatchObject({ found: true, collectedAt: '2026-04-01T00:00:00Z' });
    expect(lookupInIndex(idx2, { kind: 'prespec', noticeNo: 'A' })).toEqual({ found: false });
  });
  it('kind 없는 ref와 옛 엔트리는 bid', () => {
    expect(lookupInIndex(idx2, { noticeNo: 'R26BD00273952' })).toMatchObject({ found: true, collectedAt: '2026-05-01T00:00:00Z' });
    expect(lookupInIndex(idx2, { noticeNo: 'A', round: '000' })).toMatchObject({ found: true });
  });
});
