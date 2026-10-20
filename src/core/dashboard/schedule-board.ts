import { isDeadlineTarget } from '../deadline/plan';
import { kindOf } from '../model/ids';
import { latestBids } from '../results/plan';
import type { ISODate } from '../types/common';
import type { IndexEntry } from '../types/index-file';

export type BoardColumn = 'registrationDeadline' | 'bidCloseAt' | 'proposalEvalAt' | 'openingAt';
export const BOARD_COLUMNS: Array<{ key: BoardColumn; label: string }> = [
  { key: 'registrationDeadline', label: '참가등록 마감' }, { key: 'bidCloseAt', label: '입찰 마감' },
  { key: 'proposalEvalAt', label: '제안서 평가' }, { key: 'openingAt', label: '개찰' },
];
export interface BoardRow { entry: IndexEntry; cells: Record<BoardColumn, ISODate | null>; nextAt: ISODate; nextColumn: BoardColumn; notifyTarget: boolean }
export const BOARD_DAYS = 14;

const DAY_MS = 86_400_000;

/** bid만, latestBids, supersededBy 제외. 네 열 중 now 이후이면서 now+14일 이내인 값이 하나라도 있는 공고. nextAt은 그중 가장 이른 값. nextAt 오름차순 */
export function scheduleBoard(entries: IndexEntry[], now: Date): BoardRow[] {
  const nowMs = now.getTime();
  const endMs = nowMs + BOARD_DAYS * DAY_MS;
  const rows: Array<BoardRow & { nextMs: number }> = [];
  for (const e of latestBids(entries)) {
    if (kindOf(e) !== 'bid' || e.supersededBy) continue;
    const cells: Record<BoardColumn, ISODate | null> = {
      registrationDeadline: e.schedule?.registrationDeadline ?? null,
      bidCloseAt: e.bidCloseAt ?? null,
      proposalEvalAt: e.schedule?.proposalEvalAt ?? null,
      openingAt: e.schedule?.openingAt ?? null,
    };
    let best: { col: BoardColumn; ms: number } | null = null;
    for (const { key } of BOARD_COLUMNS) {
      const v = cells[key];
      const ms = v ? Date.parse(v) : NaN;
      if (!Number.isFinite(ms) || ms <= nowMs || ms > endMs) continue;
      if (!best || ms < best.ms) best = { col: key, ms };
    }
    if (!best) continue;
    rows.push({ entry: e, cells, nextAt: cells[best.col] as ISODate, nextColumn: best.col, notifyTarget: isDeadlineTarget(e), nextMs: best.ms });
  }
  rows.sort((a, b) => a.nextMs - b.nextMs);
  return rows.map(({ nextMs: _n, ...r }) => r);
}
