import { clipTitle } from '../model/notify-text';
import { latestBids } from '../results/plan';
import { KST_OFFSET_MS, kstParts } from '../results/schedule';
import {
  DEADLINE_HOUR_KST, DEADLINE_OFFSETS,
  type DeadlineItem, type DeadlineKind, type DeadlineNotice, type DeadlineOffset, type DeadlinePlan,
} from '../types/deadline';
import type { IndexEntry } from '../types/index-file';

const DAY_MS = 86_400_000;
const HOUR_MS = 3600_000;
const SENT_KEEP_MS = 7 * DAY_MS;

const parsable = (v: string | undefined): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));

/** 마감 알림 대상 공고: 메일 전달을 마쳤거나 팔로우 중(following은 listNotices가 병합하는 파생 필드). */
export const isDeadlineTarget = (e: Pick<IndexEntry, 'mailStatus' | 'following'>): boolean => e.mailStatus === 'delivered' || e.following !== undefined;

/** 알림 대상 일정. bid만, noticeNo별 최대 round, supersededBy 없음, 메일 전달 완료이거나 팔로우 중. 해석 불가 날짜는 제외 */
export function deadlineItemsOf(entries: IndexEntry[]): DeadlineItem[] {
  const out: DeadlineItem[] = [];
  for (const e of latestBids(entries)) {
    if (e.supersededBy || !isDeadlineTarget(e)) continue;
    if (parsable(e.bidCloseAt)) out.push({ noticeId: e.noticeId, title: e.title, kind: 'bidClose', at: e.bidCloseAt });
    const reg = e.schedule?.registrationDeadline;
    if (parsable(reg)) out.push({ noticeId: e.noticeId, title: e.title, kind: 'registration', at: reg });
  }
  return out;
}

/** 마감일 KST 달력 날짜의 (offset)일 전 hour:00 KST(UTC ms) */
export function fireTimeOf(atIso: string, offset: DeadlineOffset, hour: number = DEADLINE_HOUR_KST): number {
  const { dayStartMs } = kstParts(Date.parse(atIso));
  return dayStartMs - offset * DAY_MS + hour * HOUR_MS;
}

const keyOf = (i: DeadlineItem, offset: DeadlineOffset): string => `deadline:${i.noticeId}:${i.kind}:${offset}`;
const sameKstDay = (a: number, b: number): boolean => kstParts(a).dayStartMs === kstParts(b).dayStartMs;

export function buildPlan(entries: IndexEntry[], nowMs: number): DeadlinePlan {
  const items: DeadlineNotice[] = [];
  for (const it of deadlineItemsOf(entries)) {
    if (!(Date.parse(it.at) > nowMs)) continue;
    for (const offset of DEADLINE_OFFSETS) {
      const fireAt = fireTimeOf(it.at, offset);
      if (fireAt > nowMs || sameKstDay(fireAt, nowMs)) items.push({ ...it, offset, fireAt, key: keyOf(it, offset) });
    }
  }
  items.sort((a, b) => a.fireAt - b.fireAt || Date.parse(a.at) - Date.parse(b.at) || (a.noticeId < b.noticeId ? -1 : a.noticeId > b.noticeId ? 1 : 0));
  return { builtAt: new Date(nowMs).toISOString(), items };
}

/** now보다 큰 다음 KST hour:00(주말 포함) */
export function nextKstHour(nowMs: number, hour: number): number {
  const t = kstParts(nowMs).dayStartMs + hour * HOUR_MS;
  return t > nowMs ? t : t + DAY_MS;
}

export function duePlan(plan: DeadlinePlan, sent: Record<string, string>, nowMs: number): { due: DeadlineNotice[]; nextAlarmAt: number } {
  const due = plan.items.filter((n) => n.fireAt <= nowMs && sameKstDay(n.fireAt, nowMs) && Date.parse(n.at) > nowMs && !(n.key in sent));
  let next = nextKstHour(nowMs, DEADLINE_HOUR_KST);
  for (const n of plan.items) if (n.fireAt > nowMs && n.fireAt < next) next = n.fireAt;
  return { due, nextAlarmAt: next };
}

/** 마감이 지난 key 제거. 남길 기준: plan.items에 key가 있거나 보낸 지 7일 이내 */
export function pruneSent(sent: Record<string, string>, plan: DeadlinePlan, nowMs: number): Record<string, string> {
  const inPlan = new Set(plan.items.map((n) => n.key));
  const out: Record<string, string> = {};
  for (const [k, at] of Object.entries(sent)) {
    const t = Date.parse(at);
    if (inPlan.has(k) || (Number.isFinite(t) && nowMs - t <= SENT_KEEP_MS)) out[k] = at;
  }
  return out;
}

const KIND_LABEL: Record<DeadlineKind, string> = { bidClose: '입찰 마감', registration: '참가등록 마감' };
const pad = (n: number): string => String(n).padStart(2, '0');

export function deadlineNotificationOf(n: DeadlineNotice): { id: string; title: string; message: string } {
  const label = KIND_LABEL[n.kind];
  const title = n.offset === 0 ? `오늘 ${label}` : `${label} D-${n.offset}`;
  const ms = Date.parse(n.at);
  const { dayStartMs, hour, minute } = kstParts(ms);
  const d = new Date(dayStartMs + KST_OFFSET_MS);
  const when = `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ${pad(hour)}:${pad(minute)}`;
  return { id: n.key, title, message: `${clipTitle(n.title)} ${when} 마감` };
}
