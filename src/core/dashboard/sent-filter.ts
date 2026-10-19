import type { SendSource, SentIndexEntry } from '../types/compose';

export interface SentFilter {
  from?: number;   // epoch ms, 이상
  to?: number;     // epoch ms, 이하
  query: string;
  source: SendSource | 'all';
  includeVoided: boolean;
}

/** 발송 이력 필터. sentAt 내림차순. 검색은 공고명, 공고번호, 제목, 기관의 소문자 부분 일치. */
export function filterSent(entries: SentIndexEntry[], f: SentFilter): SentIndexEntry[] {
  const q = f.query.trim().toLowerCase();
  return entries
    .filter((e) => f.includeVoided || !e.voidedAt)
    .filter((e) => f.source === 'all' || e.source === f.source)
    .filter((e) => {
      const t = Date.parse(e.sentAt);
      if (f.from !== undefined && !(t >= f.from)) return false;
      if (f.to !== undefined && !(t <= f.to)) return false;
      return true;
    })
    .filter((e) => !q || `${e.title} ${e.noticeNo} ${e.subject} ${e.orderingOrg}`.toLowerCase().includes(q))
    .sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt));
}

export type SentPreset = '7d' | '30d' | 'month' | 'all' | 'custom';
const DAY = 86_400_000;

/** `YYYY-MM-DD` 입력값을 로컬 하루의 시작/끝 epoch로 바꾼다. 빈 값이나 잘못된 값이면 undefined. */
export function dayEdge(v: string, end: boolean): number | undefined {
  if (!v) return undefined;
  const [y, m, d] = v.split('-').map(Number);
  if (!y || !m || !d) return undefined;
  return end ? new Date(y, m - 1, d, 23, 59, 59, 999).getTime() : new Date(y, m - 1, d).getTime();
}

/** 기간 프리셋을 from/to로 바꾼다. 7일/30일은 now 기준 경과 시간, 이번 달은 로컬 1일 0시부터. */
export function rangeOf(preset: SentPreset, fromStr: string, toStr: string, now: Date): { from?: number; to?: number } {
  if (preset === '7d') return { from: now.getTime() - 7 * DAY };
  if (preset === '30d') return { from: now.getTime() - 30 * DAY };
  if (preset === 'month') return { from: new Date(now.getFullYear(), now.getMonth(), 1).getTime() };
  if (preset === 'custom') return { from: dayEdge(fromStr, false), to: dayEdge(toStr, true) };
  return {};
}
