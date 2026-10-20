import { deadlineNotificationOf, duePlan, nextKstHour, pruneSent } from '../core/deadline/plan';
import { withDefaults } from '../core/model/default-settings';
import {
  DEADLINE_HOUR_KST, DEADLINE_PLAN_KEY, DEADLINE_SENT_KEY,
  type DeadlinePlan, type DeadlineRefreshSummary,
} from '../core/types/deadline';
import type { Settings } from '../core/types/settings';
import { listen, send } from '../messaging/bus';
import type { MsgType, PayloadOf, ResponseOf } from '../messaging/protocol';
import { openDashboard } from './dashboard-tabs';
import { addFinalListener, assertExtensionSender } from './job-coordinator';
import { openNoticeFromNotification, showNotification } from './notify';
import { ensureOffscreen } from './offscreen-manager';

export const DEADLINE_ALARM = 'deadline-check';
const PLAN_WAIT_MS = 30_000;
const ALARM_MIN_LEAD_MS = 5_000;
const LIST_THROTTLE_MS = 10 * 60_000;
const THROTTLE_KEY = 'deadlineRefreshAt';
const NOTIFY_ID_RE = /^deadline:(.+):(bidClose|registration):(3|1|0)$/;

export type DeadlineRefreshReason = 'alarm' | 'list' | 'manual' | 'startup' | 'job';

export interface DeadlineSchedulerDeps {
  alarms: Pick<typeof chrome.alarms, 'create' | 'clear' | 'get'>;
  notifications: Pick<typeof chrome.notifications, 'create' | 'clear'>;
  storage: { local: Pick<chrome.storage.LocalStorageArea, 'get' | 'set'>; session: Pick<chrome.storage.SessionStorageArea, 'get' | 'set'> };
  /** offscreen 문서를 보장한 뒤 요청을 보낸다. */
  toOffscreen: <T extends MsgType>(type: T, payload: PayloadOf<T>, timeoutMs: number) => Promise<ResponseOf<T>>;
  openDashboard: (hash: string) => Promise<unknown>;
  getURL: (path: string) => string;
  now: () => number;
}

let injected: Partial<DeadlineSchedulerDeps> = {};

async function defaultToOffscreen<T extends MsgType>(type: T, payload: PayloadOf<T>, timeoutMs: number): Promise<ResponseOf<T>> {
  await ensureOffscreen();
  return send(type, payload, { target: 'offscreen', timeoutMs });
}

function deps(): DeadlineSchedulerDeps {
  return {
    alarms: injected.alarms ?? chrome.alarms,
    notifications: injected.notifications ?? chrome.notifications,
    storage: injected.storage ?? chrome.storage,
    toOffscreen: injected.toOffscreen ?? defaultToOffscreen,
    openDashboard: injected.openDashboard ?? ((h) => openDashboard(h)),
    getURL: injected.getURL ?? ((p) => chrome.runtime.getURL(p)),
    now: injected.now ?? Date.now,
  };
}

/** deadline-check 알람을 항상 덮어쓴다(계획이 바뀌면 다음 시각도 바뀌므로 병합하지 않는다). 과거 시각은 now+5초로 올린다. */
export async function armDeadlineAlarm(atMs: number, d: DeadlineSchedulerDeps = deps()): Promise<void> {
  const when = Math.max(atMs, d.now() + ALARM_MIN_LEAD_MS);
  await d.alarms.clear(DEADLINE_ALARM);
  await d.alarms.create(DEADLINE_ALARM, { when });
}

let dispatching: Promise<{ sent: number; nextAlarmAt: number }> | null = null;

async function dispatchInner(d: DeadlineSchedulerDeps): Promise<{ sent: number; nextAlarmAt: number }> {
  const now = d.now();
  let nextAlarmAt = nextKstHour(now, DEADLINE_HOUR_KST);
  let sent = 0;
  try {
    const got = await d.storage.local.get([DEADLINE_PLAN_KEY, DEADLINE_SENT_KEY, 'settingsCache']);
    const plan = got[DEADLINE_PLAN_KEY] as DeadlinePlan | undefined;
    if (plan && Array.isArray(plan.items)) {
      const sentMap = { ...((got[DEADLINE_SENT_KEY] as Record<string, string> | undefined) ?? {}) };
      const enabled = withDefaults(got.settingsCache as Settings | undefined).notify.deadline;
      const r = duePlan(plan, sentMap, now);
      nextAlarmAt = r.nextAlarmAt;
      for (const n of r.due) {
        // 꺼져 있어 안 보낸 것도 기록한다(나중에 켜도 몰아서 보내지 않는다).
        sentMap[n.key] = new Date(now).toISOString();
        if (enabled) { await showNotification(deadlineNotificationOf(n), d); sent++; }
      }
      try { await d.storage.local.set({ [DEADLINE_SENT_KEY]: pruneSent(sentMap, plan, now) }); } catch { /* 기록 실패는 무시 */ }
    }
  } catch { /* 읽기 실패여도 알람은 건다 */ }
  try { await armDeadlineAlarm(nextAlarmAt, d); } catch { /* 알람 실패는 무시 */ }
  return { sent, nextAlarmAt };
}

/** 캐시된 계획으로 due 알림 발송 + 발송 기록 + 알람 재예약. 파일 접근 없음. throw하지 않는다. 진행 중이면 그 결과를 기다린다. */
export function dispatchDue(d: DeadlineSchedulerDeps = deps()): Promise<{ sent: number; nextAlarmAt: number }> {
  if (dispatching) return dispatching;
  dispatching = dispatchInner(d).finally(() => { dispatching = null; });
  return dispatching;
}

/** offscreen에 계획을 요청해 캐시에 저장하고 dispatchDue를 돌린다. 'list'는 10분 스로틀. throw하지 않는다. */
export async function refreshDeadlines(reason: DeadlineRefreshReason, d: DeadlineSchedulerDeps = deps()): Promise<DeadlineRefreshSummary> {
  let ran = false;
  let skipped: DeadlineRefreshSummary['skipped'];
  let error: string | undefined;
  try {
    let throttled = false;
    if (reason === 'list') {
      const last = ((await d.storage.session.get(THROTTLE_KEY))[THROTTLE_KEY] as number | undefined) ?? 0;
      throttled = d.now() - last < LIST_THROTTLE_MS;
    }
    if (!throttled) {
      try {
        const plan = await d.toOffscreen('deadline/plan', undefined, PLAN_WAIT_MS);
        await d.storage.local.set({ [DEADLINE_PLAN_KEY]: plan });
        if (reason === 'list') await d.storage.session.set({ [THROTTLE_KEY]: d.now() });
        ran = true;
      } catch (e) {
        if ((e as { code?: unknown })?.code === 'NEEDS_FS_PERMISSION') skipped = 'NO_FS';
        else error = e instanceof Error ? e.message : String(e);
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  // 계획 갱신 성공 여부와 무관하게 캐시로 발송/알람을 이어 간다.
  const r = await dispatchDue(d);
  let planned = 0;
  try {
    const got = await d.storage.local.get(DEADLINE_PLAN_KEY);
    planned = (got[DEADLINE_PLAN_KEY] as DeadlinePlan | undefined)?.items?.length ?? 0;
  } catch { /* 건수는 참고용 */ }
  return { ran, planned, nextAlarmAt: new Date(r.nextAlarmAt).toISOString(), ...(skipped ? { skipped } : {}), ...(error ? { error } : {}) };
}

async function onNotificationClicked(id: string): Promise<void> {
  const m = NOTIFY_ID_RE.exec(id);
  if (!m) return;
  await openNoticeFromNotification(m[1]!, id, deps());
}

/** 리스너는 모두 최상위에서 동기로 등록한다. */
export function registerDeadlineScheduler(d: Partial<DeadlineSchedulerDeps> = {}): void {
  injected = d;
  const run = (reason: DeadlineRefreshReason) => { void refreshDeadlines(reason).catch(() => undefined); };
  listen('deadline/refresh', (p, sender) => { assertExtensionSender(sender); return refreshDeadlines(p?.reason === 'manual' ? 'manual' : 'list'); }, 'sw');
  chrome.alarms?.onAlarm?.addListener((a) => { if (a.name === DEADLINE_ALARM) run('alarm'); });
  chrome.notifications?.onClicked?.addListener((id) => { void onNotificationClicked(id); });
  chrome.runtime.onStartup?.addListener(() => run('startup'));
  chrome.runtime.onInstalled?.addListener(() => run('startup'));
  addFinalListener((job) => { if (job.type === 'collect' && job.status === 'completed') run('job'); });
  chrome.storage.onChanged?.addListener((changes, area) => {
    if (area !== 'local' || !changes.settingsCache) return;
    const on = (v: unknown) => (v as { notify?: { deadline?: boolean } } | undefined)?.notify?.deadline;
    if (on(changes.settingsCache.oldValue) === false && on(changes.settingsCache.newValue) === true) void dispatchDue().catch(() => undefined);
  });
}
