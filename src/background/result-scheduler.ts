import { redactKey } from '../adapters/g2b/openapi';
import { withDefaults } from '../core/model/default-settings';
import { RESULT_REFRESH_THROTTLE_MS, RESULT_RUN_TIMEOUT_MS } from '../core/results/limits';
import type { ISODate } from '../core/types/common';
import type { NotifyEvent, ResultProbeResult, ResultRunSummary } from '../core/types/result';
import type { Settings } from '../core/types/settings';
import { BusError, isOffscreenAllowedSender, listen, send } from '../messaging/bus';
import type { JobRequest, MsgType, PayloadOf, ResponseOf } from '../messaging/protocol';
import { openDashboard } from './dashboard-tabs';
import { recordG2bFailure } from './g2b-failures';
import { assertExtensionSender, startJob, type StartResult } from './job-coordinator';
import { clipTitle, openNoticeFromNotification, showNotification } from './notify';
import { ensureOffscreen } from './offscreen-manager';

export const FOLLOW_ALARM = 'follow-check';
const PROBE_WAIT_MS = 60_000;
const FOLLOW_SET_WAIT_MS = 25_000;
const ALARM_MIN_LEAD_MS = 5_000;
const BUSY_RETRY_MS = 2 * 60_000;
const FAIL_RETRY_MS = 10 * 60_000;
const NO_FS_RETRY_MS = 60 * 60_000;
const NOTICE_NO_RE = /^R\d{2}[A-Z]{2}\d{8}$/;
const NOTIFY_ID_RE = /^result:(.+):(rank|won|lost|not_participated|no_bid|expired|reannounce|reannounce_expired)$/;
const THROTTLE_KEY = 'resultRefreshAt';

export type RefreshReason = 'alarm' | 'list' | 'manual' | 'follow';

export interface ResultSchedulerDeps {
  alarms: Pick<typeof chrome.alarms, 'create' | 'clear' | 'get'>;
  notifications: Pick<typeof chrome.notifications, 'create' | 'clear'>;
  storage: { local: Pick<chrome.storage.LocalStorageArea, 'get'>; session: Pick<chrome.storage.SessionStorageArea, 'get' | 'set'> };
  /** offscreen 문서를 보장한 뒤 요청을 보낸다. */
  toOffscreen: <T extends MsgType>(type: T, payload: PayloadOf<T>, timeoutMs: number) => Promise<ResponseOf<T>>;
  openDashboard: (hash: string) => Promise<unknown>;
  getURL: (path: string) => string;
  now: () => number;
  /** 재공고 자동 수집 잡 시작 */
  startJob: (req: JobRequest) => Promise<StartResult>;
}

let injected: Partial<ResultSchedulerDeps> = {};

async function defaultToOffscreen<T extends MsgType>(type: T, payload: PayloadOf<T>, timeoutMs: number): Promise<ResponseOf<T>> {
  await ensureOffscreen();
  return send(type, payload, { target: 'offscreen', timeoutMs });
}

function deps(): ResultSchedulerDeps {
  return {
    alarms: injected.alarms ?? chrome.alarms,
    notifications: injected.notifications ?? chrome.notifications,
    storage: injected.storage ?? chrome.storage,
    toOffscreen: injected.toOffscreen ?? defaultToOffscreen,
    openDashboard: injected.openDashboard ?? ((h) => openDashboard(h)),
    getURL: injected.getURL ?? ((p) => chrome.runtime.getURL(p)),
    now: injected.now ?? Date.now,
    startJob: injected.startJob ?? startJob,
  };
}

const emptySummary = (o: Partial<ResultRunSummary> = {}): ResultRunSummary => ({ ran: false, checked: 0, updated: 0, won: 0, nextFollowCheckAt: null, events: [], ...o });

/**
 * follow-check 알람을 병합 규칙으로 다시 건다. 기존 알람이 새 시각보다 이르거나 같으면(nextAt이 null이어도) 유지한다.
 * 이른 알람은 한 번 헛돌아도 그 실행의 result/done이 정확한 값으로 다시 건다. 과거 시각은 now+5초로 올린다.
 */
export async function armFollowAlarm(nextAt: ISODate | null, d: ResultSchedulerDeps = deps()): Promise<void> {
  const t = nextAt ? Date.parse(nextAt) : NaN;
  const target = Number.isFinite(t) ? Math.max(t, d.now() + ALARM_MIN_LEAD_MS) : null;
  const existing = await d.alarms.get(FOLLOW_ALARM);
  if (existing && (target === null || existing.scheduledTime <= target)) return;
  if (target === null) return;
  await d.alarms.clear(FOLLOW_ALARM);
  await d.alarms.create(FOLLOW_ALARM, { when: target });
}

/** 알림 한 건의 id/제목/본문. */
export function notificationOf(ev: NotifyEvent): { id: string; title: string; message: string } {
  const t = clipTitle(ev.title);
  if (ev.kind === 'rank') return { id: `result:${ev.noticeId}:rank`, title: '개찰 순위 확인', message: `${t} 우리 ${ev.rank}위, 참여 ${ev.bidders}개사${ev.followEnded ? ' (팔로우 종료)' : ''}` };
  if (ev.kind === 'expired') return { id: `result:${ev.noticeId}:expired`, title: '추적 종료', message: `${t} 120일 동안 결과가 확정되지 않아 팔로우를 해제했습니다` };
  if (ev.kind === 'reannounce') return { id: `result:${ev.noticeId}:reannounce`, title: '재공고 발견', message: `${t} 재공고 ${ev.noticeNo}가 올라왔습니다` };
  if (ev.kind === 'reannounce_expired') return { id: `result:${ev.noticeId}:reannounce_expired`, title: '재공고 추적 종료', message: `${t} 60일 동안 재공고가 없어 팔로우를 해제했습니다` };
  const id = `result:${ev.noticeId}:${ev.status}`;
  switch (ev.status) {
    case 'won': return { id, title: '낙찰', message: `${t} 낙찰되었습니다` };
    case 'lost': return { id, title: '탈락', message: `${t} 낙찰 업체: ${ev.winnerName ?? '확인 필요'}` };
    case 'not_participated': return { id, title: '결과 확정', message: `${t} 개찰 결과에 우리 회사가 없습니다` };
    case 'no_bid': return { id, title: '유찰', message: `${t} ${ev.inferred ? '재공고가 올라와 유찰로 판단했습니다' : ev.watchingReannounce ? '유찰되었습니다. 재공고를 확인합니다' : '유찰되었습니다'}` };
  }
}

async function notify(events: NotifyEvent[], settings: Settings, d: ResultSchedulerDeps): Promise<void> {
  for (const ev of events) {
    if (ev.kind === 'rank' ? !settings.notify.rank : !settings.notify.final) continue; // 꺼져 있던 이벤트는 버린다
    const n = notificationOf(ev);
    await showNotification(n, d);
  }
}

/** 결과 확인. throw하지 않는다. 키/사업자번호가 없으면 offscreen도 띄우지 않고 알람도 건드리지 않는다. */
export async function refreshResults(reason: RefreshReason, d: ResultSchedulerDeps = deps()): Promise<ResultRunSummary> {
  let serviceKey: string | undefined;
  try {
    const { secrets, settingsCache } = await d.storage.local.get(['secrets', 'settingsCache']);
    serviceKey = (secrets as { g2bServiceKey?: string } | undefined)?.g2bServiceKey?.trim();
    const settings = withDefaults(settingsCache as Settings | undefined);
    if (!serviceKey) return emptySummary({ skipped: 'NO_KEY' });
    const bizNo = (settings.company?.bizNo ?? '').replace(/\D/g, '');
    if (bizNo.length !== 10) return emptySummary({ skipped: 'NO_BIZNO' });
    const mode = reason === 'list' || reason === 'manual' ? 'list' : 'follow';
    if (reason === 'list') {
      const last = ((await d.storage.session.get(THROTTLE_KEY))[THROTTLE_KEY] as number | undefined) ?? 0;
      if (d.now() - last < RESULT_REFRESH_THROTTLE_MS) return emptySummary({ skipped: 'THROTTLED' });
    }
    let r: ResultRunSummary;
    try {
      r = await d.toOffscreen('result/run', { mode, serviceKey, bizNo }, RESULT_RUN_TIMEOUT_MS);
    } catch (e) {
      const code = (e as { code?: unknown })?.code;
      void recordG2bFailure({ flow: 'result', stage: 'run', code: typeof code === 'string' ? code : 'INTERNAL', message: redactKey(e instanceof Error ? e.message : String(e), serviceKey), trigger: reason });
      throw e;
    }
    // 알림과 알람 재예약은 offscreen의 result/done이 맡는다. 여기서는 BUSY와 실패 재시도만 건다.
    if (r.skipped === 'BUSY') {
      await armFollowAlarm(new Date(d.now() + BUSY_RETRY_MS).toISOString(), d);
      return r;
    }
    if (r.ran && reason === 'list') await d.storage.session.set({ [THROTTLE_KEY]: d.now() });
    if (r.error) void recordG2bFailure({ flow: 'result', stage: 'run', code: 'RESULT_RUN_FAILED', message: r.error, trigger: reason });
    if (r.error) await armFollowAlarm(new Date(d.now() + FAIL_RETRY_MS).toISOString(), d);
    // result/done 송신이 실패해도 알람이 걸리게 응답으로도 한 번 건다(병합 규칙이라 두 번 걸어도 같다).
    else if (r.ran) await armFollowAlarm(r.nextFollowCheckAt, d);
    return r;
  } catch (e) {
    const message = redactKey(e instanceof Error ? e.message : String(e), serviceKey);
    // 응답이 늦거나 실패해도 팔로우 확인이 멈추지 않게 재시도 알람을 건다.
    try { await armFollowAlarm(new Date(d.now() + FAIL_RETRY_MS).toISOString(), d); } catch { /* 알람 실패는 무시 */ }
    return emptySummary({ error: message });
  }
}

async function followSet(p: { noticeId: string; follow: boolean; target?: unknown }) {
  const d = deps();
  if (typeof p?.noticeId !== 'string' || p.noticeId === '') throw new BusError('FOLLOW_BAD_REF', '공고 ID가 올바르지 않습니다.');
  if (p.target !== undefined && p.target !== 'rank' && p.target !== 'final' && p.target !== 'reannounce') throw new BusError('FOLLOW_BAD_TARGET', '팔로우 범위가 올바르지 않습니다.');
  const target = p.target ?? 'final';
  const { secrets } = await d.storage.local.get('secrets');
  const key = (secrets as { g2bServiceKey?: string } | undefined)?.g2bServiceKey;
  let r: ResponseOf<'follow/set'>;
  try {
    r = await d.toOffscreen('follow/set', { noticeId: p.noticeId, follow: !!p.follow, target }, FOLLOW_SET_WAIT_MS);
  } catch (e) {
    const code = (e as { code?: unknown })?.code;
    throw new BusError(typeof code === 'string' ? code : 'INTERNAL', redactKey(e instanceof Error ? e.message : String(e), key));
  }
  return r;
}

/** offscreen의 실행 완료 알림. 알림은 notify 설정으로 거르고, 알람은 병합 규칙으로 다시 건다. */
export async function applyDone(p: PayloadOf<'result/done'>, d: ResultSchedulerDeps = deps()): Promise<void> {
  try {
    const { settingsCache } = await d.storage.local.get('settingsCache');
    await notify(Array.isArray(p.events) ? p.events : [], withDefaults(settingsCache as Settings | undefined), d);
  } catch { /* 설정 읽기 실패여도 알람은 건다 */ }
  // 알람 재예약을 먼저 끝낸다. 자동 수집이 오래 걸리거나 실패해도 팔로우 확인은 이어져야 한다.
  try {
    if (p.skipped === 'NO_FS') await armFollowAlarm(new Date(d.now() + NO_FS_RETRY_MS).toISOString(), d);
    else if (p.skipped !== 'KEY_INVALID') await armFollowAlarm(p.nextFollowCheckAt ?? null, d);
  } finally {
    // 재공고가 발견되면 자동 수집한다(알림 설정과 독립). 이미 다른 잡이 돌고 있으면 상세 화면의 수집 버튼으로 한다.
    for (const ev of Array.isArray(p.events) ? p.events : []) {
      if (ev.kind !== 'reannounce') continue;
      try { await d.startJob({ type: 'collect', ref: { noticeNo: ev.noticeNo, round: ev.round, origin: 'g2b' } }); } catch { /* 무시 */ }
    }
  }
}

/** result/done은 offscreen 문서만 보낼 수 있다(대시보드 탭 등은 거부). */
function assertOffscreenSender(sender: chrome.runtime.MessageSender, d: ResultSchedulerDeps = deps()): void {
  const path = (u: string) => { try { const x = new URL(u); return `${x.origin}${x.pathname}`; } catch { return ''; } };
  const ok = isOffscreenAllowedSender(sender) && path(sender.url ?? '') === path(d.getURL('offscreen.html'));
  if (!ok) throw new BusError('SENDER_FORBIDDEN', '허용되지 않은 발신자입니다.');
}

async function probe(p: { noticeNo: string }): Promise<ResultProbeResult> {
  const d = deps();
  const noticeNo = typeof p.noticeNo === 'string' ? p.noticeNo.trim() : '';
  if (!NOTICE_NO_RE.test(noticeNo)) throw new BusError('RESULT_BAD_REF', '공고번호 형식이 올바르지 않습니다.');
  const { secrets } = await d.storage.local.get('secrets');
  const serviceKey = (secrets as { g2bServiceKey?: string } | undefined)?.g2bServiceKey;
  if (!serviceKey) throw new BusError('G2B_KEY_MISSING', '나라장터 서비스키가 설정되지 않았습니다.');
  try {
    return await d.toOffscreen('result/probe', { noticeNo, serviceKey }, PROBE_WAIT_MS);
  } catch (e) {
    const code = (e as { code?: unknown })?.code;
    throw new BusError(typeof code === 'string' ? code : 'INTERNAL', redactKey(e instanceof Error ? e.message : String(e), serviceKey));
  }
}

async function onNotificationClicked(id: string): Promise<void> {
  const m = NOTIFY_ID_RE.exec(id);
  if (!m) return;
  await openNoticeFromNotification(m[1]!, id, deps());
}

/** 리스너는 모두 최상위에서 동기로 등록한다. */
export function registerResultScheduler(d: Partial<ResultSchedulerDeps> = {}): void {
  injected = d;
  const run = (reason: RefreshReason) => { void refreshResults(reason).catch(() => undefined); };
  listen('result/refresh', (p, sender) => { assertExtensionSender(sender); return refreshResults(p?.reason === 'manual' ? 'manual' : 'list'); }, 'sw');
  listen('follow/set', (p, sender) => { assertExtensionSender(sender); return followSet(p); }, 'sw');
  listen('result/done', (p, sender) => { assertOffscreenSender(sender); return applyDone(p); }, 'sw');
  listen('result/probe', (p, sender) => { assertExtensionSender(sender); return probe(p); }, 'sw');
  chrome.alarms?.onAlarm?.addListener((a) => { if (a.name === FOLLOW_ALARM) run('alarm'); });
  chrome.notifications?.onClicked?.addListener((id) => { void onNotificationClicked(id); });
  chrome.runtime.onStartup?.addListener(() => run('follow'));
  chrome.runtime.onInstalled?.addListener(() => run('follow'));
  chrome.storage.onChanged?.addListener((changes, area) => {
    if (area !== 'local') return;
    // 서비스키 또는 사업자번호가 실제로 바뀐 경우에만 실행한다.
    const key = (v: unknown) => (v as { g2bServiceKey?: string } | undefined)?.g2bServiceKey;
    const biz = (v: unknown) => (v as { company?: { bizNo?: string } } | undefined)?.company?.bizNo;
    const s = changes.secrets;
    const c = changes.settingsCache;
    if ((s && key(s.oldValue) !== key(s.newValue)) || (c && biz(c.oldValue) !== biz(c.newValue))) run('follow');
  });
}
