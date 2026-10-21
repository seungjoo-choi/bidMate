import { BusError, listen } from '../messaging/bus';
import type { PayloadOf, ResponseOf } from '../messaging/protocol';
import type { Job, SendConfirmation, SendSkipReason } from '../core/types/job';
import { ACTIVE, getJob, isOffscreenSender, listJobs, setSendState } from './job-coordinator';
import { getComposeSelectorSet } from './compose-relay';
import { enqueue, recordSignal } from './send-signal';

// 대시보드 [바로 발송]이 보내기 버튼을 누르는 유일한 경로. 채움 엔진(dom-actions)은 계속 보내기를 누르지 못한다.
// 클릭은 ledger에 clickedAt을 먼저 기록한 뒤 이 파일의 clickSend 한 곳에서만 한다.

type Sender = chrome.runtime.MessageSender;
type ClickArgs = { button: string; scope?: string; subjectInput: string; subject: string; recipientLists?: { list: string; chip: string }; to: string[]; cc: string[] };
type ClickOut = { clicked: boolean; reason?: SendSkipReason };

const err = (code: string, message: string) => new BusError(code, message);
function guard(sender: Sender): void {
  if (!isOffscreenSender(sender)) throw err('SENDER_FORBIDDEN', '허용되지 않은 발신자입니다.');
}

/** 작성 탭 안에서 실행된다. 직렬화되어 주입되므로 import·클로저를 쓰지 않는다. */
function clickSend(a: ClickArgs): ClickOut {
  const w = (window as unknown as { __bidMateSendWatch?: { state(): { fired: boolean }; markSent(k: 'auto'): { armed: boolean } } }).__bidMateSendWatch;
  if (!w) return { clicked: false, reason: 'CLICK_FAILED' };
  if (w.state().fired) return { clicked: false, reason: 'ALREADY_FIRED' };
  const root: ParentNode | null = a.scope ? document.querySelector(a.scope) : document;
  const btn = root ? root.querySelector<HTMLButtonElement>(a.button) : null;
  if (!btn) return { clicked: false, reason: 'BUTTON_NOT_FOUND' };
  if (btn.disabled || btn.getClientRects().length === 0) return { clicked: false, reason: 'BUTTON_DISABLED' };
  const input = (root ?? document).querySelector<HTMLInputElement>(a.subjectInput);
  if (!input || input.value.trim() !== a.subject.trim()) return { clicked: false, reason: 'SUBJECT_MISMATCH' };
  // 화면 주소 목록을 칸별로 대조한다: 1번째 = 받는사람, 2번째 = 참조, 3번째 이후(숨은참조)는 비어 있어야 한다.
  // 칩 하나에 주소가 정확히 하나여야 하고, 중복 칩이나 주소를 못 읽는 칩이 있으면 불일치로 본다.
  if (a.recipientLists) {
    const lists = [...document.querySelectorAll(a.recipientLists.list)];
    if (lists.length < 2) return { clicked: false, reason: 'RECIPIENT_MISMATCH' };
    const want = [a.to, a.cc];
    for (let i = 0; i < lists.length; i++) {
      const got: string[] = [];
      for (const el of lists[i]!.querySelectorAll(a.recipientLists.chip)) {
        const m = (el.textContent ?? '').match(/[^\s<>"'(),;]+@[^\s<>"'(),;]+/g);
        if (!m || m.length !== 1) return { clicked: false, reason: 'RECIPIENT_MISMATCH' };
        got.push(m[0].toLowerCase());
      }
      const w = [...new Set((want[i] ?? []).map((x) => x.trim().toLowerCase()).filter(Boolean))].sort();
      const h = [...new Set(got)].sort();
      if (got.length !== h.length || w.join(',') !== h.join(',')) return { clicked: false, reason: 'RECIPIENT_MISMATCH' };
    }
    if (a.to.length === 0) return { clicked: false, reason: 'RECIPIENT_MISMATCH' };
  }
  if (!w.markSent('auto').armed) return { clicked: false, reason: 'ALREADY_FIRED' };
  btn.click();
  return { clicked: true };
}

/** 숨은 탭 타이머 스로틀 대비: SW가 직접 gone/toast를 평가한다. */
function probeConfirm(a: { gone?: string; toast?: { selector: string; textPattern: string } }): SendConfirmation | null {
  if (a.gone && !document.querySelector(a.gone)) return 'ui_gone';
  if (a.toast) {
    try {
      const re = new RegExp(a.toast.textPattern);
      for (const el of document.querySelectorAll(a.toast.selector)) if (re.test(el.textContent ?? '')) return 'toast';
    } catch { /* 잘못된 패턴은 건너뛴다 */ }
  }
  return null;
}

async function sendClick(p: PayloadOf<'compose/send-click'>): Promise<ClickOut> {
  const job = await getJob(p.jobId);
  if (job?.send) return { clicked: false, reason: 'ALREADY_FIRED' };
  // 취소 중인 잡은 누르지 않는다(사용자가 취소를 누른 뒤 메일이 나가지 않게)
  if (!job || job.type !== 'compose' || !ACTIVE.has(job.status) || job.status === 'cancelling' || !job.params?.autoSend || job.auto
    || job.composeTabId === undefined || job.composeFrameId === undefined) return { clicked: false, reason: 'CLICK_FAILED' };
  const set = getComposeSelectorSet(p.jobId);
  const button = set?.autoSend?.button;
  if (!set || !button) return { clicked: false, reason: 'CLICK_FAILED' };
  // 멱등성의 핵심: 클릭 전에 기록한다. 순서를 바꾸지 말 것.
  await setSendState(p.jobId, { clickedAt: new Date().toISOString(), ...(p.composeRecordId ? { composeRecordId: p.composeRecordId } : {}), confirmed: false });
  // 실행 예외는 던진다(클릭됐을 수 있으므로 offscreen이 unknown으로 처리).
  const res = await chrome.scripting.executeScript({
    target: { tabId: job.composeTabId, frameIds: [job.composeFrameId] },
    func: clickSend,
    args: [{
      button, ...(set.compose.scope ? { scope: set.compose.scope } : {}), subjectInput: set.subject.input, subject: p.subject,
      ...(set.autoSend?.recipientLists ? { recipientLists: set.autoSend.recipientLists } : {}), to: p.to, cc: p.cc,
    }],
  });
  const out = res[0]?.result as ClickOut | undefined;
  return out ?? { clicked: false, reason: 'CLICK_FAILED' };
}

async function tabAlive(tabId: number | undefined): Promise<boolean> {
  if (tabId === undefined) return false;
  try { return !!(await chrome.tabs.get(tabId)); } catch { return false; }
}

const statusOf = (job: Job | undefined, alive: boolean): ResponseOf<'compose/send-status'> => ({
  tabAlive: alive,
  clicked: !!job?.send?.clickedAt,
  confirmed: !!job?.send?.confirmed,
  ...(job?.send?.confirmation ? { confirmation: job.send.confirmation } : {}),
});

async function sendStatus(p: PayloadOf<'compose/send-status'>): Promise<ResponseOf<'compose/send-status'>> {
  let job = await getJob(p.jobId);
  const alive = await tabAlive(job?.composeTabId);
  if (job?.send?.clickedAt && !job.send.confirmed && alive && job.composeTabId !== undefined && job.composeFrameId !== undefined) {
    try {
      const sw = getComposeSelectorSet(p.jobId)?.sendWatch;
      if (sw && (sw.gone || sw.toast)) {
        const res = await chrome.scripting.executeScript({
          target: { tabId: job.composeTabId, frameIds: [job.composeFrameId] },
          func: probeConfirm,
          args: [{ ...(sw.gone ? { gone: sw.gone } : {}), ...(sw.toast ? { toast: sw.toast } : {}) }],
        });
        const conf = res[0]?.result as SendConfirmation | null | undefined;
        if (conf) {
          await enqueue(p.jobId, async () => {
            const fresh = await getJob(p.jobId);
            if (fresh?.send && !fresh.send.confirmed) await recordSignal(fresh, 'confirm', conf);
          });
          job = await getJob(p.jobId);
        }
      }
    } catch { /* 평가 실패는 무시 */ }
  }
  return statusOf(job, alive);
}

async function closeTab(p: PayloadOf<'compose/close-tab'>): Promise<{ closed: boolean }> {
  const job = await getJob(p.jobId);
  if (!job || job.type !== 'compose' || job.composeTabId === undefined) return { closed: false };
  let tab: chrome.tabs.Tab | undefined;
  try { tab = await chrome.tabs.get(job.composeTabId); } catch { return { closed: true }; }
  if (!tab) return { closed: true };
  const hostPattern = getComposeSelectorSet(p.jobId)?.hostPattern;
  let host = '';
  try { host = new URL(tab.url ?? '').host; } catch { /* 잘못된 URL이면 닫지 않는다 */ }
  if (!hostPattern || !host || (host !== hostPattern && !host.endsWith(`.${hostPattern}`))) return { closed: false };
  const siblings = await chrome.tabs.query({ windowId: tab.windowId });
  if (siblings.length < 2) return { closed: false };
  try { await chrome.tabs.remove(job.composeTabId); } catch { /* 이미 닫힘 */ }
  return { closed: true };
}

/**
 * 클릭 뒤 확인 대기 중에 작성 탭이 사라지면 발송 확인으로 본다(숨은 탭은 보낸 뒤 스스로 닫힌다).
 * 잡이 끝난 뒤(미확인으로 탭을 앞으로 넘긴 뒤 사용자가 닫는 경우)는 발송 증거가 아니므로 무시한다.
 */
async function onTabRemoved(tabId: number): Promise<void> {
  try {
    const job = (await listJobs()).find((j) => j.type === 'compose' && j.composeTabId === tabId && ACTIVE.has(j.status));
    if (!job?.send?.clickedAt || job.send.confirmed || !ACTIVE.has(job.status)) return;
    await enqueue(job.id, async () => {
      const fresh = await getJob(job.id);
      if (!fresh?.send?.clickedAt || fresh.send.confirmed || !ACTIVE.has(fresh.status)) return;
      await recordSignal(fresh, 'confirm', 'unload');
      await setSendState(job.id, { tabRemoved: true });
    });
  } catch { /* 탭 제거 처리 실패는 무시 */ }
}

export function registerSendTrigger(): void {
  listen('compose/send-click', (p, s) => { guard(s); return sendClick(p); }, 'sw');
  listen('compose/send-status', (p, s) => { guard(s); return sendStatus(p); }, 'sw');
  listen('compose/close-tab', (p, s) => { guard(s); return closeTab(p); }, 'sw');
  chrome.tabs.onRemoved.addListener((tabId) => { void onTabRemoved(tabId); });
}
