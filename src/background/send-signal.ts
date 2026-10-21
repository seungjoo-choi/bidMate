import { listen, send } from '../messaging/bus';
import type { MsgType, PayloadOf, ResponseOf } from '../messaging/protocol';
import type { ComposeResult, Job, SendConfirmation } from '../core/types/job';
import type { SendWatchConfig } from '../adapters/naverworks/types';
import { SELECTOR_SETS } from '../adapters/naverworks/selectors';
import { getJob, listJobs, setSendState } from './job-coordinator';
import { ensureOffscreen } from './offscreen-manager';

const WATCH_FILE = 'send-watch.js';
const OFFSCREEN_WAIT_MS = 15_000;

type Sender = chrome.runtime.MessageSender;

// jobId별 sendWatch(재주입용). SW가 재시작되면 사라지고, 그때는 잡 provider의 기본 셀렉터셋 값으로 대신한다.
const watches = new Map<string, SendWatchConfig>();

export function rememberSendWatch(jobId: string, sw: SendWatchConfig): void {
  watches.set(jobId, sw);
}

/** send-watch를 주입하고 configure한다. 이미 주입돼 있으면 가드가 중복을 막고 configure만 갱신된다. */
export async function injectSendWatch(tabId: number, jobId: string, sendWatch?: SendWatchConfig): Promise<void> {
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: [WATCH_FILE] });
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: (cfg: { jobId: string; sendWatch?: SendWatchConfig }) =>
      (window as unknown as { __bidMateSendWatch?: { configure(c: unknown): void } }).__bidMateSendWatch?.configure(cfg),
    args: [{ jobId, ...(sendWatch ? { sendWatch } : {}) }],
  });
}

export interface SendSignalDeps {
  toOffscreen: <T extends MsgType>(type: T, payload: PayloadOf<T>, timeoutMs: number) => Promise<ResponseOf<T>>;
}
let injected: Partial<SendSignalDeps> = {};
/** 테스트 주입용. */
export function setSendSignalDeps(d: Partial<SendSignalDeps>): void { injected = d; }

async function defaultToOffscreen<T extends MsgType>(type: T, payload: PayloadOf<T>, timeoutMs: number): Promise<ResponseOf<T>> {
  await ensureOffscreen();
  return send(type, payload, { target: 'offscreen', timeoutMs });
}

// 같은 jobId의 신호는 도착 순서대로 처리한다(1차 신호의 기록이 끝난 뒤 confirm이 실행되게).
const chains = new Map<string, Promise<void>>();

/** 같은 jobId 체인에 fn을 직렬로 태운다. CS 신호와 send-trigger 기록이 순서를 공유한다. */
export function enqueue<T>(jobId: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(jobId) ?? Promise.resolve();
  const run = prev.then(fn);
  const next = run.then(() => undefined, () => undefined);
  chains.set(jobId, next);
  void next.then(() => { if (chains.get(jobId) === next) chains.delete(jobId); });
  return run;
}

export function handleSendSignal(p: PayloadOf<'mail/send-signal'>, sender: Sender): Promise<void> {
  return enqueue(p.jobId, () => processSignal(p, sender));
}

/** 신호 처리. 수용 조건을 통과해야만 ledger 값으로 offscreen에 전달하고, 모든 실패는 삼킨다. */
async function processSignal(p: PayloadOf<'mail/send-signal'>, sender: Sender): Promise<void> {
  try {
    if (!globalThis.chrome?.runtime?.id || sender.id !== chrome.runtime.id) return;
    const tabId = sender.tab?.id;
    if (tabId === undefined) return;
    const job = await getJob(p.jobId);
    if (!job || job.type !== 'compose' || job.composeTabId !== tabId) return;
    await recordSignal(job, p.kind, p.confirmation);
  } catch { /* 기록 실패는 사용자 흐름과 무관하다 */ }
}

/** 발송 신호를 offscreen 발송 이력에 기록하고, 잡에 send가 있으면 ledger 상태도 갱신한다. 실패는 삼킨다. */
export async function recordSignal(job: Job, kind: 'click' | 'hotkey' | 'auto' | 'confirm', confirmation?: SendConfirmation): Promise<void> {
  try {
    const result = job.result as ComposeResult | undefined;
    const noticeId = result?.noticeId ?? job.noticeId;
    if (!noticeId) return;
    const recordId = job.send?.composeRecordId ?? result?.recordId;
    const toOffscreen = injected.toOffscreen ?? defaultToOffscreen;
    await toOffscreen('mail/sent-record', {
      noticeId, jobId: job.id,
      ...(recordId ? { composeRecordId: recordId } : {}),
      ...(result?.provider ? { provider: result.provider } : {}),
      kind,
      ...(kind === 'confirm' && confirmation ? { confirmation } : {}),
    }, OFFSCREEN_WAIT_MS);
    if (job.send) {
      await setSendState(job.id, {
        confirmed: kind === 'confirm' || job.send.confirmed,
        ...(confirmation ? { confirmation } : {}),
        lastSignalAt: new Date().toISOString(),
      });
    }
  } catch { /* 기록 실패는 사용자 흐름과 무관하다 */ }
}

/** 로드가 끝난 탭이 ledger compose 잡의 작성 탭이면 send-watch를 다시 주입한다. */
export async function reinjectIfComposeTab(tabId: number): Promise<void> {
  try {
    const job = (await listJobs()).find((j) => j.type === 'compose' && j.composeTabId === tabId);
    if (!job) return;
    const provider = (job.result as ComposeResult | undefined)?.provider;
    const remembered = watches.get(job.id);
    if (!remembered && !provider) return;   // 서비스를 알 수 없으면 재주입하지 않는다
    const sw = remembered ?? SELECTOR_SETS[provider === 'gmail' ? 'gmail-v1' : 'naverworks-v1']?.sendWatch;
    await injectSendWatch(tabId, job.id, sw);
  } catch { /* 재주입 실패는 무시 */ }
}

export function registerSendSignal(): void {
  listen('mail/send-signal', (p, s) => handleSendSignal(p, s), 'sw');
  chrome.tabs.onUpdated.addListener((tabId, info) => { if (info.status === 'complete') void reinjectIfComposeTab(tabId); });
}
