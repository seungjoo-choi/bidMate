import type { ComposeDetect, ComposeSelectorConfig, MsgType, PayloadOf, ResponseOf } from '../messaging/protocol';
import { BusError, listen, sendToTab } from '../messaging/bus';
import { getJob, isOffscreenSender, setComposeTab } from './job-coordinator';
import { getSettingsCache } from './site-registry';

const LOAD_WAIT_MS = 20_000;
const CS_FILE = 'naverworks-compose.js';

type Sender = chrome.runtime.MessageSender;
// CS의 ComposeCsConfig와 같은 꼴: jobId로 CS를 잡에 묶고, maxFileMB로 FileBuffer 상한을 정한다.
type Cfg = ComposeSelectorConfig & { jobId?: string; maxFileMB?: number; anchor?: { subject: string } };

// jobId별 셀렉터 설정(재주입용). SW가 재시작되면 사라지지만 detect는 offscreen 폴링으로 재시도된다.
const selectors = new Map<string, Cfg>();

const err = (code: string, message: string) => new BusError(code, message);

function guard(sender: Sender): void {
  if (!isOffscreenSender(sender)) throw err('SENDER_FORBIDDEN', '허용되지 않은 발신자입니다.');
}

async function inject(tabId: number, selector: Cfg): Promise<void> {
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: [CS_FILE] });
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: (cfg: Cfg) => (window as unknown as { __bidMateCompose?: { configure(c: Cfg): void } }).__bidMateCompose?.configure(cfg),
      args: [selector],
    });
  } catch (e) {
    throw err('COMPOSE_INJECT_FAILED', e instanceof Error ? e.message : String(e));
  }
}

/** 탭 로드 완료를 최대 timeoutMs 기다린다. 넘어도 에러 없이 진행(완료=true, 시간 초과=false). */
export function waitComplete(tabId: number, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const done = (ok: boolean) => { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(fn); resolve(ok); };
    const fn = (id: number, info: { status?: string }) => { if (id === tabId && info.status === 'complete') done(true); };
    const timer = setTimeout(() => done(false), timeoutMs);
    chrome.tabs.onUpdated.addListener(fn);
  });
}

async function tabOrThrow(jobId: string): Promise<{ tabId: number; windowId?: number }> {
  const job = await getJob(jobId);
  if (!job || job.composeTabId === undefined) throw err('COMPOSE_TAB_CLOSED', '작성 탭을 찾을 수 없습니다.');
  try {
    const tab = await chrome.tabs.get(job.composeTabId);
    return { tabId: job.composeTabId, windowId: tab?.windowId };
  } catch {
    throw err('COMPOSE_TAB_CLOSED', '작성 탭이 닫혔습니다.');
  }
}

async function open(p: PayloadOf<'compose/open'>): Promise<{ tabId: number }> {
  let u: URL;
  try { u = new URL(p.url); } catch { throw err('COMPOSE_BAD_URL', '작성 주소가 올바르지 않습니다.'); }
  if (u.protocol !== 'https:') throw err('COMPOSE_BAD_URL', '작성 주소는 https여야 합니다.');
  const origin = `${u.origin}/*`;
  if (!(await chrome.permissions.contains({ origins: [origin] }))) throw err('NEEDS_SITE_PERMISSION', `${u.host} 접근 권한이 필요합니다.`);
  const win = await chrome.windows.getLastFocused();
  const tab = await chrome.tabs.create({ windowId: win.id, url: p.url, active: true });
  const tabId = tab.id as number;
  await setComposeTab(p.jobId, { composeTabId: tabId });
  if (!p.selector) {   // 주소 방식: 셀렉터 저장과 주입 없이 로딩만 기다린다
    await waitComplete(tabId, LOAD_WAIT_MS);
    return { tabId };
  }
  const maxFileMB = (await getSettingsCache())?.download.maxFileMB;
  const cfg: Cfg = { ...p.selector, jobId: p.jobId, ...(maxFileMB ? { maxFileMB } : {}), ...(p.anchor ? { anchor: p.anchor } : {}) };
  selectors.set(p.jobId, cfg);
  await waitComplete(tabId, LOAD_WAIT_MS);
  try { await inject(tabId, cfg); } catch { /* 주입 실패는 detect 폴링의 재주입에 맡긴다 */ }
  return { tabId };
}

async function runDetect(tabId: number): Promise<Array<{ frameId: number; result: unknown }>> {
  const res = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => (window as unknown as { __bidMateCompose?: { detect(): unknown } }).__bidMateCompose?.detect() ?? null,
  });
  return res.map((r) => ({ frameId: r.frameId, result: r.result }));
}

async function detect(p: PayloadOf<'compose/detect'>): Promise<{ frames: ComposeDetect[] }> {
  const { tabId } = await tabOrThrow(p.jobId);
  let res = await runDetect(tabId);
  const sel = selectors.get(p.jobId);
  if (res.some((r) => r.result == null) && sel) {
    await inject(tabId, sel);
    res = await runDetect(tabId);
  }
  const frames = res.map((r): ComposeDetect => {
    const d = r.result as { isCompose?: boolean; ready?: boolean; reason?: string } | null;
    return { frameId: r.frameId, injected: d != null, isCompose: !!d?.isCompose, ready: !!d?.ready, ...(d?.reason ? { reason: d.reason } : {}) };
  });
  return { frames };
}

async function relay<T extends MsgType>(type: T, p: PayloadOf<T> & { jobId: string }, timeoutMs: number): Promise<ResponseOf<T>> {
  const job = await getJob(p.jobId);
  if (!job || job.composeTabId === undefined || job.composeFrameId === undefined) throw err('COMPOSE_TAB_CLOSED', '작성 탭을 찾을 수 없습니다.');
  try {
    return await sendToTab(job.composeTabId, type, p as unknown as PayloadOf<T>, { frameId: job.composeFrameId, timeoutMs });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('Receiving end does not exist')) throw err('COMPOSE_CS_UNREACHABLE', '작성 화면 스크립트에 연결할 수 없습니다.');
    throw e;
  }
}

export function registerComposeRelay(): void {
  listen('compose/open', (p, s) => { guard(s); return open(p); }, 'sw');
  listen('compose/detect', (p, s) => { guard(s); return detect(p); }, 'sw');
  listen('compose/bind', async (p, s) => { guard(s); await setComposeTab(p.jobId, { composeFrameId: p.frameId }); }, 'sw');
  listen('compose/focus', async (p, s) => {
    guard(s);
    try {
      const { tabId, windowId } = await tabOrThrow(p.jobId);
      await chrome.tabs.update(tabId, { active: true });
      if (windowId !== undefined) await chrome.windows.update(windowId, { focused: true });
    } catch { /* 포커스 실패는 무시 */ }
  }, 'sw');
  listen('compose/abort', async (p, s) => {
    guard(s);
    try { await relay('compose/abort', p, 5_000); } catch { /* CS 전달 실패는 무시 */ }
    selectors.delete(p.jobId);
  }, 'sw');
  listen('compose/fill', (p, s) => { guard(s); return relay('compose/fill', p, 85_000); }, 'sw');
  listen('compose/attach-begin', (p, s) => { guard(s); return relay('compose/attach-begin', p, 15_000); }, 'sw');
  listen('file/chunk', (p, s) => { guard(s); return relay('file/chunk', p, 30_000); }, 'sw');
  listen('file/end', (p, s) => { guard(s); return relay('file/end', p, 15_000); }, 'sw');
  listen('compose/attach-status', (p, s) => { guard(s); return relay('compose/attach-status', p, 10_000); }, 'sw');
  listen('compose/verify', (p, s) => { guard(s); return relay('compose/verify', p, 15_000); }, 'sw');
}
