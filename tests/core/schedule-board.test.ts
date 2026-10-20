import { describe, expect, it } from 'vitest';
import { scheduleBoard } from '../../src/core/dashboard/schedule-board';
import type { IndexEntry } from '../../src/core/types/index-file';

const now = new Date('2026-10-20T00:00:00Z');
const day = (n: number): string => new Date(now.getTime() + n * 86_400_000).toISOString();
const mk = (o: Partial<IndexEntry> & { noticeId: string }): IndexEntry => ({
  noticeNo: o.noticeId.split('-')[0] ?? '', round: '000', title: '공고', orderingOrg: '기관', folder: 'f',
  collectedAt: '2026-10-01T00:00:00Z', collectStatus: 'complete' as IndexEntry['collectStatus'],
  attachments: { total: 0, saved: 0, failed: 0 }, extractionStatus: 'not_run', mailStatus: 'none', isCorrection: false, ...o,
});

describe('scheduleBoard', () => {
  it('14일 경계: 정확히 14일 뒤 포함, 15일 제외', () => {
    const r = scheduleBoard([mk({ noticeId: 'A-000', bidCloseAt: day(14) }), mk({ noticeId: 'B-000', bidCloseAt: day(15) })], now);
    expect(r.map((x) => x.entry.noticeId)).toEqual(['A-000']);
  });
  it('지난 일정은 nextAt 후보에서 빼되 cells에는 남긴다', () => {
    const r = scheduleBoard([mk({ noticeId: 'A-000', bidCloseAt: day(5), schedule: { registrationDeadline: day(-1), openingAt: day(7) } })], now)[0]!;
    expect(r.nextColumn).toBe('bidCloseAt');
    expect(r.nextAt).toBe(day(5));
    expect(r.cells.registrationDeadline).toBe(day(-1));
    expect(r.cells.proposalEvalAt).toBeNull();
  });
  it('nextAt 오름차순 정렬', () => {
    const r = scheduleBoard([mk({ noticeId: 'A-000', bidCloseAt: day(9) }), mk({ noticeId: 'B-000', bidCloseAt: day(2) }), mk({ noticeId: 'C-000', schedule: { openingAt: day(4) } })], now);
    expect(r.map((x) => x.entry.noticeId)).toEqual(['B-000', 'C-000', 'A-000']);
  });
  it('사전규격, 대체된 공고, 낮은 round, 일정 없는 공고 제외', () => {
    const r = scheduleBoard([
      mk({ noticeId: 'P', noticeNo: 'P', kind: 'prespec', bidCloseAt: day(2) }),
      mk({ noticeId: 'S-000', noticeNo: 'S', bidCloseAt: day(2), supersededBy: 'S-001' }),
      mk({ noticeId: 'L-000', noticeNo: 'L', round: '000', bidCloseAt: day(2) }),
      mk({ noticeId: 'L-001', noticeNo: 'L', round: '001', bidCloseAt: day(3) }),
      mk({ noticeId: 'N-000' }),
    ], now);
    expect(r.map((x) => x.entry.noticeId)).toEqual(['L-001']);
  });
  it('notifyTarget은 mailStatus delivered', () => {
    const r = scheduleBoard([mk({ noticeId: 'A-000', bidCloseAt: day(1), mailStatus: 'delivered' }), mk({ noticeId: 'B-000', bidCloseAt: day(2) })], now);
    expect(r.map((x) => x.notifyTarget)).toEqual([true, false]);
  });
});
