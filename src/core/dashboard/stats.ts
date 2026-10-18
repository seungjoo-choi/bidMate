import type { IndexEntry } from '../types/index-file';

export const DUE_SOON_DAYS_HOME = 7;
export const RECENT_DAYS = 7;
export const MONTHS = 6;

const DAY_MS = 24 * 60 * 60 * 1000;
const LIST_LIMIT = 5;

export interface HomeStats {
  total: number;
  recent: { count: number; items: IndexEntry[] };
  mailPending: { count: number; items: IndexEntry[] };
  collectFailed: { failed: number; partial: number; items: IndexEntry[] };
  dueSoon: { count: number; items: IndexEntry[] };
  needsReview: number;
  monthly: Array<{ month: string; collected: number; failed: number; delivered: number }>;
}

const ms = (s: string | undefined): number => (s ? new Date(s).getTime() : NaN);
const byCollectedDesc = (a: IndexEntry, b: IndexEntry): number => ms(b.collectedAt) - ms(a.collectedAt);
const monthKey = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

export function computeHomeStats(entries: IndexEntry[], now: Date): HomeStats {
  const nowMs = now.getTime();
  const recentFrom = nowMs - RECENT_DAYS * DAY_MS;
  const dueTo = nowMs + DUE_SOON_DAYS_HOME * DAY_MS;

  const recentAll = entries.filter((e) => { const t = ms(e.collectedAt); return t >= recentFrom && t <= nowMs; }).sort(byCollectedDesc);
  const pending = entries
    .filter((e) => e.collectStatus !== 'failed' && (e.mailStatus === 'none' || e.mailStatus === 'drafting') && !e.supersededBy)
    .sort(byCollectedDesc);
  const failedAll = entries.filter((e) => e.collectStatus === 'failed');
  const partialAll = entries.filter((e) => e.collectStatus === 'partial');
  const failedItems = [...failedAll, ...partialAll].sort(byCollectedDesc);
  const due = entries
    .filter((e) => { if (e.supersededBy || !e.bidCloseAt) return false; const t = ms(e.bidCloseAt); return t >= nowMs && t <= dueTo; })
    .sort((a, b) => ms(a.bidCloseAt) - ms(b.bidCloseAt));

  // 최근 6개월(현재 달 포함), 오래된 달부터, 로컬 연월
  const monthly: HomeStats['monthly'] = [];
  for (let i = MONTHS - 1; i >= 0; i--) {
    monthly.push({ month: monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)), collected: 0, failed: 0, delivered: 0 });
  }
  const slot = new Map(monthly.map((m) => [m.month, m]));
  for (const e of entries) {
    const t = ms(e.collectedAt);
    if (Number.isNaN(t)) continue;
    const m = slot.get(monthKey(new Date(t)));
    if (!m) continue;
    m.collected++;
    if (e.collectStatus === 'failed') m.failed++;
    if (e.mailStatus === 'delivered') m.delivered++;
  }

  return {
    total: entries.length,
    recent: { count: recentAll.length, items: recentAll.slice(0, LIST_LIMIT) },
    mailPending: { count: pending.length, items: pending.slice(0, LIST_LIMIT) },
    collectFailed: { failed: failedAll.length, partial: partialAll.length, items: failedItems.slice(0, LIST_LIMIT) },
    dueSoon: { count: due.length, items: due },
    needsReview: entries.filter((e) => e.extractionStatus === 'needs_review').length,
    monthly,
  };
}
