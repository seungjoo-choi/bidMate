import { refsConflict } from '../../core/model/job-conflict';
import type { CollectResult, Job } from '../../core/types/job';
import type { G2bDetected, NoticeLookup } from '../../messaging/protocol';

export const ACTIVE = new Set<Job['status']>(['queued', 'running', 'cancelling']);

export interface Focus { noticeId: string; tabId: number; at: string }

export const noticeIdOf = (j: Job | null | undefined): string | undefined => j?.noticeId ?? (j?.result as CollectResult | undefined)?.noticeId;

/**
 * 사이드 패널에 보여 줄 잡과 공고(순수 함수). collectJobs는 collect/download_retry 잡을 최근 순으로 준다.
 * 순서: 1 감지된 공고, 2 활성 탭에서 시작한 진행 중 잡(focus가 없거나 focus보다 늦게 시작), 3 이 탭의 focus,
 * 4 아무 진행 중 잡, 5 가장 최근 잡.
 */
export function pickTarget(collectJobs: Job[], notice: G2bDetected | null, lookup: NoticeLookup, focus: Focus | null, tabId: number | null): { job: Job | null; noticeId: string | undefined } {
  if (notice) {
    const mine = collectJobs.find((j) => !!j.ref && refsConflict(j.ref, notice)) ?? null;
    return { job: mine, noticeId: noticeIdOf(mine) ?? lookup.noticeId };
  }
  const f = focus && tabId !== null && focus.tabId === tabId ? focus : null;
  const focusAt = f ? Date.parse(f.at) : NaN;
  const sameTab = tabId === null ? undefined : collectJobs.find((j) =>
    ACTIVE.has(j.status) && j.originTabId === tabId && (!f || !(focusAt >= Date.parse(j.createdAt))));
  if (sameTab) return { job: sameTab, noticeId: noticeIdOf(sameTab) };
  if (f) return { job: collectJobs.find((j) => noticeIdOf(j) === f.noticeId) ?? null, noticeId: f.noticeId };
  const active = collectJobs.find((j) => ACTIVE.has(j.status));
  if (active) return { job: active, noticeId: noticeIdOf(active) };
  const latest = collectJobs[0] ?? null;
  return { job: latest, noticeId: noticeIdOf(latest) };
}
