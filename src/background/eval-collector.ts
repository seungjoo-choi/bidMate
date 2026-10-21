import { BusError, listen, send, sendToTab } from '../messaging/bus';
import type { EvalCollectResult, EvalProbeResult, EvalRef, MsgType, PayloadOf, ResponseOf } from '../messaging/protocol';
import { EVAL_FETCH_WAIT_MS, EVAL_REUSE_PROBE_MS, EVAL_SAVE_WAIT_MS, EVAL_RETRY_MAX_MS, EVAL_RETRY_MS, EVAL_TAB_LOAD_WAIT_MS } from '../core/evaluation/limits';
import { waitComplete } from './compose-relay';
import { assertExtensionSender, senderKind } from './job-coordinator';
import { ensureOffscreen } from './offscreen-manager';

const G2B_HOME = 'https://www.g2b.go.kr/';
const G2B_MATCH = 'https://www.g2b.go.kr/*';
const LOAD_WAIT_MS = EVAL_TAB_LOAD_WAIT_MS;
const RETRY_MS = EVAL_RETRY_MS;
const RETRY_MAX_MS = EVAL_RETRY_MAX_MS;
const FETCH_WAIT_MS = EVAL_FETCH_WAIT_MS;

const NOTICE_NO_RE = /^R\d{2}[A-Z]{2}\d{8}$/;
const ROUND_RE = /^\d{3}$/;

type Sender = chrome.runtime.MessageSender;

export interface EvalCollectorDeps {
  tabs: Pick<typeof chrome.tabs, 'query' | 'create' | 'update' | 'remove' | 'reload'>;
  sendToTab: typeof sendToTab;
  waitComplete: (tabId: number, timeoutMs: number) => Promise<boolean>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** 서비스키는 SW가 storage에서 읽어 offscreen에 전달한다. */
  readServiceKey?: () => Promise<string | undefined>;
  /** offscreen 문서를 보장한 뒤 요청을 보낸다. */
  toOffscreen?: <T extends MsgType>(type: T, payload: PayloadOf<T>, timeoutMs: number) => Promise<ResponseOf<T>>;
}

let injected: Partial<EvalCollectorDeps> = {};

/** 테스트 주입용. 호출할 때마다 이전 주입을 대체한다. */
export function setEvalCollectorDeps(d: Partial<EvalCollectorDeps>): void {
  injected = d;
}

async function defaultReadServiceKey(): Promise<string | undefined> {
  const { secrets } = await chrome.storage.local.get('secrets');
  return (secrets as { g2bServiceKey?: string } | undefined)?.g2bServiceKey;
}

async function defaultToOffscreen<T extends MsgType>(type: T, payload: PayloadOf<T>, timeoutMs: number): Promise<ResponseOf<T>> {
  await ensureOffscreen();
  return send(type, payload, { target: 'offscreen', timeoutMs });
}

function deps(): Required<EvalCollectorDeps> {
  return {
    tabs: injected.tabs ?? chrome.tabs,
    sendToTab: injected.sendToTab ?? sendToTab,
    waitComplete: injected.waitComplete ?? waitComplete,
    sleep: injected.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))),
    now: injected.now ?? Date.now,
    readServiceKey: injected.readServiceKey ?? defaultReadServiceKey,
    toOffscreen: injected.toOffscreen ?? defaultToOffscreen,
  };
}

const err = (code: string, message: string) => new BusError(code, message);

/** eval/collect: 확장 페이지 또는 나라장터 탭만 허용한다. */
function assertExtensionOrG2b(sender: Sender): void {
  const k = senderKind(sender);
  if (k !== 'extension' && k !== 'g2b') throw err('SENDER_FORBIDDEN', '허용되지 않은 발신자입니다.');
}

/** 공고번호와 차수를 검증하고 차수가 없으면 '000'으로 채운다. */
export function normalizeEvalRef(ref: EvalRef | undefined): { noticeNo: string; round: string } {
  const noticeNo = ref?.noticeNo;
  const round = ref?.round ?? '000';
  if (typeof noticeNo !== 'string' || !NOTICE_NO_RE.test(noticeNo)) throw err('EVAL_BAD_REF', '공고번호 형식이 올바르지 않습니다.');
  if (typeof round !== 'string' || !ROUND_RE.test(round)) throw err('EVAL_BAD_REF', '차수 형식이 올바르지 않습니다.');
  return { noticeNo, round };
}

/** own: 요청을 보낸 나라장터 탭 자신, reused: 열려 있던 다른 나라장터 탭, created: 이번에 만든 탭 */
interface AcquiredTab { tabId: number; kind: 'own' | 'reused' | 'created' }

async function acquireG2bTab(sender: Sender): Promise<AcquiredTab> {
  const d = deps();
  if (senderKind(sender) === 'g2b' && sender.tab?.id !== undefined) return { tabId: sender.tab.id, kind: 'own' };
  const existing = await d.tabs.query({ url: G2B_MATCH });
  const found = existing.find((t) => t.id !== undefined);
  if (found) return { tabId: found.id as number, kind: 'reused' };
  return createG2bTab();
}

async function createG2bTab(): Promise<AcquiredTab> {
  const d = deps();
  const tab = await d.tabs.create({ url: G2B_HOME, active: false });
  if (tab.id === undefined) throw err('EVAL_TAB_FAILED', '나라장터 탭을 열지 못했습니다.');
  const tabId = tab.id;
  if (!(await d.waitComplete(tabId, LOAD_WAIT_MS))) {
    try { await d.tabs.remove(tabId); } catch { /* 이미 닫힘 */ }
    throw err('EVAL_TAB_TIMEOUT', '나라장터 탭 로딩이 지연되었습니다.');
  }
  return { tabId, kind: 'created' };
}

const isNoReceiver = (e: unknown): boolean =>
  (e as { code?: unknown })?.code === 'NO_RECEIVER' || /Receiving end does not exist|Could not establish connection/i.test(e instanceof Error ? e.message : '');

const unreachable = () => err('EVAL_CS_UNREACHABLE', '나라장터 탭에 연결하지 못했습니다.');

type EvalFetchPayload = { noticeNo: string; round: string; withoutIdHeaders?: boolean };

/** CS가 아직 뜨지 않았으면 700ms 간격으로 maxMs까지 재시도한다. */
async function sendEvalFetch(tabId: number, payload: EvalFetchPayload, maxMs = RETRY_MAX_MS): Promise<ResponseOf<'g2b/eval-fetch'>> {
  const d = deps();
  const start = d.now();
  for (;;) {
    try {
      return await d.sendToTab(tabId, 'g2b/eval-fetch', payload, { timeoutMs: FETCH_WAIT_MS });
    } catch (e) {
      if (!isNoReceiver(e) || d.now() - start >= maxMs) throw e;
      await d.sleep(RETRY_MS);
    }
  }
}

/** 탭을 새로고침하고 로드 완료를 기다린다. 탭이 닫혔거나 로딩이 늦으면 false */
async function reloadAndWait(tabId: number): Promise<boolean> {
  const d = deps();
  const loaded = d.waitComplete(tabId, LOAD_WAIT_MS); // complete 이벤트를 놓치지 않게 새로고침 전에 건다
  try { await d.tabs.reload(tabId); } catch { return false; }
  return loaded;
}

/**
 * 열려 있던 탭은 확장을 다시 불러오기 전에 열렸거나 잠들어(discarded) CS가 없을 수 있다.
 * 잠깐 응답이 없으면 새로고침해 CS를 다시 띄우고, 새로고침도 안 되면 새 탭을 연다.
 * 새 탭으로 바꾸면 onSwitch로 알린다.
 */
async function sendWithRecovery(tab: AcquiredTab, payload: EvalFetchPayload, onSwitch: (t: AcquiredTab) => void): Promise<ResponseOf<'g2b/eval-fetch'>> {
  const last = async (tabId: number) => {
    try { return await sendEvalFetch(tabId, payload); } catch (e) { throw isNoReceiver(e) ? unreachable() : e; }
  };
  if (tab.kind !== 'reused') return last(tab.tabId);
  try {
    return await sendEvalFetch(tab.tabId, payload, EVAL_REUSE_PROBE_MS);
  } catch (e) {
    if (!isNoReceiver(e)) throw e;
  }
  if (await reloadAndWait(tab.tabId)) return last(tab.tabId);
  const fresh = await createG2bTab();
  onSwitch(fresh);
  return last(fresh.tabId);
}

async function fetchRawOnce(sender: Sender, ref: { noticeNo: string; round: string }, withoutIdHeaders: boolean): Promise<ResponseOf<'g2b/eval-fetch'>> {
  const d = deps();
  let tab = await acquireG2bTab(sender);
  let keep = tab.kind !== 'created';
  try {
    return await sendWithRecovery(tab, { ...ref, ...(withoutIdHeaders ? { withoutIdHeaders } : {}) }, (t) => { tab = t; keep = false; });
  } catch (e) {
    if (tab.kind === 'created' && (e as { code?: unknown })?.code === 'EVAL_NOT_LOGGED_IN') {
      // 사용자가 로그인할 수 있게 만든 탭을 남기고 앞으로 가져온다.
      keep = true;
      try { await d.tabs.update(tab.tabId, { active: true }); } catch { /* 무시 */ }
    }
    throw e;
  } finally {
    if (!keep) { try { await d.tabs.remove(tab.tabId); } catch { /* 이미 닫힘 */ } }
  }
}

// 동시 1개 FIFO. 앞 항목의 성패와 무관하게 다음 항목을 시작한다.
let chain: Promise<unknown> = Promise.resolve();

export function fetchEvalViaTab(sender: Sender, ref: { noticeNo: string; round: string }, withoutIdHeaders = false): Promise<ResponseOf<'g2b/eval-fetch'>> {
  const p = chain.then(() => fetchRawOnce(sender, ref, withoutIdHeaders));
  chain = p.catch(() => undefined);
  return p;
}

/** CS 오류 메시지의 "[단계 N]" 접두를 분리한다. */
function splitStep(message: string): { step?: number; message: string } {
  const m = /^\[단계 (\d)\] ?/.exec(message);
  return m ? { step: Number(m[1]), message: message.slice(m[0].length) } : { message };
}

async function probe(sender: Sender, p: { ref: EvalRef; withoutIdHeaders?: boolean }): Promise<EvalProbeResult> {
  const ref = normalizeEvalRef(p.ref);
  const d = deps();
  const t0 = d.now();
  try {
    const { raw } = await fetchEvalViaTab(sender, ref, !!p.withoutIdHeaders);
    return {
      ok: true, ms: d.now() - t0,
      counts: {
        targets: raw.targets.length, members: raw.members.length, items: raw.items.length, scores: raw.scores.length,
        sheets: new Set(raw.items.map((i) => i.evstNo)).size,
      },
    };
  } catch (e) {
    const code = (e as { code?: unknown })?.code;
    const { step, message } = splitStep(e instanceof Error ? e.message : String(e));
    return { ok: false, ms: d.now() - t0, code: typeof code === 'string' ? code : 'INTERNAL', message, ...(step !== undefined ? { step } : {}) };
  }
}

/** CS 오류의 단계 접두를 떼어 "(단계 N)" 꼴로 메시지 끝에 붙인다. */
function withStep(e: unknown): never {
  if (!(e instanceof Error)) throw e;
  const { step, message } = splitStep(e.message);
  const code = (e as { code?: unknown }).code;
  throw new BusError(typeof code === 'string' ? code : 'INTERNAL', step !== undefined ? `${message} (단계 ${step})` : message);
}

async function collect(sender: Sender, p: { ref: EvalRef }): Promise<EvalCollectResult> {
  const ref = normalizeEvalRef(p.ref);
  const d = deps();
  let fetched: ResponseOf<'g2b/eval-fetch'>;
  try { fetched = await fetchEvalViaTab(sender, ref); } catch (e) { return withStep(e); }
  const serviceKey = await d.readServiceKey();
  return d.toOffscreen('eval/save', { ref, raw: fetched.raw, ...(serviceKey ? { serviceKey } : {}), ...(fetched.warnings.length > 0 ? { fetchWarnings: fetched.warnings } : {}) }, EVAL_SAVE_WAIT_MS);
}

export function registerEvalCollector(d: Partial<EvalCollectorDeps> = {}): void {
  injected = d;
  listen('eval/probe', (p, sender) => { assertExtensionSender(sender); return probe(sender, p); }, 'sw');
  listen('eval/collect', (p, sender) => { assertExtensionOrG2b(sender); return collect(sender, p); }, 'sw');
  // 저장소 조회와 삭제는 확장 페이지만 offscreen으로 중계한다.
  listen('eval/list', (p, sender) => { assertExtensionSender(sender); return deps().toOffscreen('eval/list', p, 25_000); }, 'sw');
  listen('eval/get', (p, sender) => { assertExtensionSender(sender); return deps().toOffscreen('eval/get', p, 25_000); }, 'sw');
  listen('eval/get-many', (p, sender) => { assertExtensionSender(sender); return deps().toOffscreen('eval/get-many', p, 25_000); }, 'sw');
  listen('eval/delete', (p, sender) => { assertExtensionSender(sender); return deps().toOffscreen('eval/delete', p, 25_000); }, 'sw');
}
