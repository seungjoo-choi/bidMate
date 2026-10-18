import { describe, expect, it } from 'vitest';
import { computeHomeStats } from '../../src/core/dashboard/stats';
import type { IndexEntry } from '../../src/core/types/index-file';

const NOW = new Date(2026, 9, 18, 12, 0, 0); // 로컬 2026-10-18 12:00
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

const entry = (id: string, over: Partial<IndexEntry> = {}): IndexEntry => ({
  noticeId: id, noticeNo: id, round: '00', title: id, orderingOrg: 'org', folder: id,
  collectedAt: iso(NOW.getTime() - DAY), collectStatus: 'collected',
  attachments: { total: 0, saved: 0, failed: 0 },
  extractionStatus: 'verified', mailStatus: 'none', isCorrection: false, ...over,
});

describe('computeHomeStats', () => {
  it('total과 빈 입력', () => {
    const s = computeHomeStats([], NOW);
    expect(s.total).toBe(0);
    expect(s.monthly).toHaveLength(6);
    expect(computeHomeStats([entry('a'), entry('b')], NOW).total).toBe(2);
  });

  it('recent 7일 경계(정확히 7일 전 포함)와 최신 5개', () => {
    const list = [
      entry('in', { collectedAt: iso(NOW.getTime() - 7 * DAY) }),
      entry('out', { collectedAt: iso(NOW.getTime() - 7 * DAY - 1) }),
      ...[1, 2, 3, 4, 5].map((n) => entry(`r${n}`, { collectedAt: iso(NOW.getTime() - n * 1000) })),
    ];
    const s = computeHomeStats(list, NOW);
    expect(s.recent.count).toBe(6);
    expect(s.recent.items.map((e) => e.noticeId)).toEqual(['r1', 'r2', 'r3', 'r4', 'r5']);
  });

  it('mailPending 포함/제외 규칙', () => {
    const s = computeHomeStats([
      entry('none', { mailStatus: 'none' }),
      entry('draft', { mailStatus: 'drafting' }),
      entry('ready', { mailStatus: 'ready_for_review' }),
      entry('done', { mailStatus: 'delivered' }),
      entry('failed', { collectStatus: 'failed' }),
      entry('partial', { collectStatus: 'partial' }),
      entry('sup', { supersededBy: 'x' }),
    ], NOW);
    expect(s.mailPending.items.map((e) => e.noticeId).sort()).toEqual(['draft', 'none', 'partial']);
    expect(s.mailPending.count).toBe(3);
  });

  it('collectFailed와 needsReview', () => {
    const s = computeHomeStats([
      entry('f1', { collectStatus: 'failed' }),
      entry('f2', { collectStatus: 'failed' }),
      entry('p1', { collectStatus: 'partial' }),
      entry('n1', { extractionStatus: 'needs_review' }),
    ], NOW);
    expect(s.collectFailed.failed).toBe(2);
    expect(s.collectFailed.partial).toBe(1);
    expect(s.collectFailed.items).toHaveLength(3);
    expect(s.needsReview).toBe(1);
  });

  it('dueSoon 경계와 정렬, supersededBy 제외', () => {
    const s = computeHomeStats([
      entry('far', { bidCloseAt: iso(NOW.getTime() + 3 * DAY) }),
      entry('near', { bidCloseAt: iso(NOW.getTime() + 1 * DAY) }),
      entry('now', { bidCloseAt: iso(NOW.getTime()) }),
      entry('edge', { bidCloseAt: iso(NOW.getTime() + 7 * DAY) }),
      entry('over', { bidCloseAt: iso(NOW.getTime() + 7 * DAY + 1) }),
      entry('past', { bidCloseAt: iso(NOW.getTime() - 1) }),
      entry('sup', { bidCloseAt: iso(NOW.getTime() + DAY), supersededBy: 'x' }),
    ], NOW);
    expect(s.dueSoon.items.map((e) => e.noticeId)).toEqual(['now', 'near', 'far', 'edge']);
    expect(s.dueSoon.count).toBe(4);
  });

  it('monthly 빈 달, delivered, 로컬 연월', () => {
    const at = (y: number, m: number, d: number) => new Date(y, m, d, 10).toISOString();
    const s = computeHomeStats([
      entry('a', { collectedAt: at(2026, 9, 1), mailStatus: 'delivered' }),
      entry('b', { collectedAt: at(2026, 9, 2), collectStatus: 'failed' }),
      entry('c', { collectedAt: at(2026, 7, 31) }),
      entry('old', { collectedAt: at(2026, 3, 30) }), // 범위 밖(4월)
      // 로컬 월초 00:30은 UTC로 전월일 수 있다. 로컬 연월로 세야 한다(리뷰 지적).
      entry('early', { collectedAt: new Date(2026, 6, 1, 0, 30).toISOString() }),
    ], NOW);
    expect(s.monthly.map((m) => m.month)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    expect(s.monthly[5]).toEqual({ month: '2026-10', collected: 2, failed: 1, delivered: 1 });
    expect(s.monthly[3]).toEqual({ month: '2026-08', collected: 1, failed: 0, delivered: 0 });
    expect(s.monthly[0]).toEqual({ month: '2026-05', collected: 0, failed: 0, delivered: 0 });
    expect(s.monthly[1]).toEqual({ month: '2026-06', collected: 0, failed: 0, delivered: 0 });
    expect(s.monthly[2]).toEqual({ month: '2026-07', collected: 1, failed: 0, delivered: 0 });
  });

  it('bidCloseAt 없는 항목 안전 처리', () => {
    const s = computeHomeStats([entry('a')], NOW);
    expect(s.dueSoon.count).toBe(0);
  });
});
