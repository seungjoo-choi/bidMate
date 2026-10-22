import { detailUrlOf } from '../adapters/g2b/link';
import type { HtmlFields, Job } from '../core/types/job';
import { BusError, listen, sendToTab } from '../messaging/bus';
import type { ResponseOf } from '../messaging/protocol';
import { recordG2bFailure } from './g2b-failures';
import { ACTIVE, getJob, isOffscreenSender } from './job-coordinator';

const G2B_HOST = 'www.g2b.go.kr';

export interface DetailReaderDeps {
  tabs: Pick<typeof chrome.tabs, 'create' | 'get' | 'remove' | 'onRemoved'>;
  windows: Pick<typeof chrome.windows, 'getLastFocused'>;
  sendToTab: typeof sendToTab;
  getJob: (id: string) => Promise<Job | undefined>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  pollMs?: number;     // 700
  settleMs?: number;   // 1500
  timeoutMs?: number;  // 45_000
  log?: (...a: unknown[]) => void;  // console.info
}

const TRACE_MAX = 120;

let injected: Partial<DetailReaderDeps> = {};

/** 테스트 주입용. 호출할 때마다 이전 주입을 대체한다. */
export function setDetailReaderDeps(d: Partial<DetailReaderDeps>): void {
  injected = d;
}

function deps(): DetailReaderDeps {
  return {
    tabs: injected.tabs ?? chrome.tabs,
    windows: injected.windows ?? chrome.windows,
    sendToTab: injected.sendToTab ?? sendToTab,
    getJob: injected.getJob ?? getJob,
    now: injected.now, sleep: injected.sleep,
    pollMs: injected.pollMs, settleMs: injected.settleMs, timeoutMs: injected.timeoutMs,
    log: injected.log,
  };
}

const err = (code: string, message: string) => new BusError(code, message);
const hostOf = (url: string | undefined): string => { try { return new URL(url ?? '').hostname; } catch { return ''; } };

/** offscreen의 g2b/read-detail 송신 타임아웃(offscreen/main.ts runCollect와 같은 값). 큐 대기를 포함한다. */
const REQUEST_WAIT_MS = 240_000;

async function readOne(jobId: string, requestedAt: number, meta: { noticeNo?: string; round?: string }): Promise<ResponseOf<'g2b/read-detail'>> {
  const d = deps();
  const now = d.now ?? Date.now;
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pollMs = d.pollMs ?? 700;
  const settleMs = d.settleMs ?? 1500;
  const timeoutMs = d.timeoutMs ?? 45_000;
  const log = d.log ?? ((...a: unknown[]) => console.info(...a));
  const start = now();
  // 큐에서 오래 기다려 요청자가 이미 타임아웃됐을 항목은 탭을 열지 않는다.
  if (start - requestedAt + timeoutMs > REQUEST_WAIT_MS) throw err('DETAIL_TIMEOUT', '상세화면 읽기 대기가 길어 건너뛰었습니다.');

  // cancelling도 ACTIVE에 포함되지만, 취소 요청 뒤에는 탭을 붙잡지 않는다.
  const isActive = async (): Promise<Job | undefined> => {
    const j = await d.getJob(jobId);
    return j && j.status !== 'cancelling' && ACTIVE.has(j.status) ? j : undefined;
  };
  const job = await isActive();
  if (!job) throw err('DETAIL_CANCELLED', '잡이 취소되었습니다.');
  const url = job.ref ? detailUrlOf(job.ref) : null;
  if (!url || !job.ref) throw err('DETAIL_NO_URL', '상세화면 주소를 만들 수 없습니다.');
  const { noticeNo, round } = job.ref;
  meta.noticeNo = noticeNo;
  if (round) meta.round = round;

  let windowId: number | undefined;
  let openerTabId: number | undefined;
  try {
    if (job.originTabId !== undefined) {
      try {
        windowId = (await d.tabs.get(job.originTabId)).windowId;
        openerTabId = job.originTabId;
      } catch { /* 원본 탭이 닫힘: 마지막 포커스 창 사용 */ }
    }
    if (windowId === undefined) windowId = (await d.windows.getLastFocused()).id;
  } catch { /* 창을 알 수 없으면 브라우저 기본 창 */ }

  const trace: unknown[] = [];
  let tabId: number | undefined;
  let closed = false;
  const onRemoved = (id: number) => { if (id === tabId) closed = true; };
  d.tabs.onRemoved.addListener(onRemoved);
  try {
    let tab: chrome.tabs.Tab;
    try {
      tab = await d.tabs.create({
        ...(windowId !== undefined ? { windowId } : {}), url, active: false,
        ...(openerTabId !== undefined ? { openerTabId } : {}),
      });
    } catch (e) {
      throw err('DETAIL_READ_FAILED', e instanceof Error ? e.message : String(e));
    }
    if (tab.id === undefined) throw err('DETAIL_READ_FAILED', '탭을 열지 못했습니다.');
    const id = tab.id;
    tabId = id;

    let firstMatchAt: number | undefined;
    let prev: string | undefined;
    let last: HtmlFields | undefined;
    const done = (stableAt: number = now()): ResponseOf<'g2b/read-detail'> => ({
      html: last as HtmlFields,
      elapsedMs: { detect: (firstMatchAt ?? start) - start, stable: stableAt - start },
    });

    // 안정 판정이 끝난 뒤 전문만 1회 더 읽어 붙인다. 실패·TIMEOUT·불일치면 전문 없이 진행한다(trace에는 넣지 않는다).
    const finish = async (): Promise<ResponseOf<'g2b/read-detail'>> => {
      const stableAt = now(); // 전문 읽기 시간은 stable에 섞지 않는다
      try {
        const r = await d.sendToTab(id, 'g2b/read-html', { noticeNo, ...(round ? { round } : {}), withText: true }, { timeoutMs: 2000 });
        const { pageText, pageTextTruncated } = r.html ?? {};
        if (r.match && pageText && last) last = { ...last, pageText, ...(pageTextTruncated ? { pageTextTruncated: true } : {}) };
      } catch { /* 전문 없이 진행 */ }
      return done(stableAt);
    };

    for (;;) {
      if (closed) throw err('DETAIL_TAB_CLOSED', '상세화면 탭이 닫혔습니다.');
      if (now() - start >= timeoutMs) {
        if (last) return done(); // 타임아웃 경로는 전문 읽기로 시간을 더 쓰지 않는다(240s 송신 한도 보호)
        throw err('DETAIL_TIMEOUT', '상세화면에서 공고를 찾지 못했습니다.');
      }

      let cur: chrome.tabs.Tab;
      try { cur = await d.tabs.get(id); } catch { throw err('DETAIL_TAB_CLOSED', '상세화면 탭이 닫혔습니다.'); }
      const curUrl = cur.url || cur.pendingUrl || '';
      if (curUrl && curUrl !== 'about:blank' && hostOf(curUrl) !== G2B_HOST) {
        throw err('DETAIL_REDIRECTED', '상세화면이 다른 주소로 이동했습니다.');
      }
      if (!(await isActive())) throw err('DETAIL_CANCELLED', '잡이 취소되었습니다.');

      const pushTick = (result: unknown) => {
        const tick = { t: now() - start, tabStatus: cur.status, discarded: cur.discarded, url: curUrl, result };
        trace.push(tick);
        if (trace.length > TRACE_MAX) trace.shift();
        log('[detail-reader]', jobId, tick);
      };
      try {
        const r = await d.sendToTab(id, 'g2b/read-html', { noticeNo, ...(round ? { round } : {}) }, { timeoutMs: 2000 });
        pushTick({ match: r.match, fieldKeys: Object.keys(r.html?.fields ?? {}), diag: r.diag });
        if (r.match && r.html) {
          const snap = JSON.stringify(r.html.fields);
          firstMatchAt ??= now();
          last = r.html;
          if (prev === snap && now() - firstMatchAt >= settleMs) return finish();
          prev = snap;
        } else {
          prev = undefined;
        }
      } catch (e) {
        /* 수신자 없음/타임아웃은 로딩 중의 일시 상태 */
        pushTick(e instanceof BusError && e.code === 'TIMEOUT' ? 'TIMEOUT' : 'NO_RECEIVER');
      }

      await sleep(pollMs);
    }
  } finally {
    log('[detail-reader] trace', jobId, JSON.stringify(trace));
    d.tabs.onRemoved.removeListener(onRemoved);
    if (tabId !== undefined) {
      try { await d.tabs.remove(tabId); } catch { /* 이미 닫힘 */ }
    }
  }
}

// 동시 1개 FIFO. 앞 항목의 성패와 무관하게 다음 항목을 시작한다.
let chain: Promise<unknown> = Promise.resolve();

export function readDetail(jobId: string): Promise<ResponseOf<'g2b/read-detail'>> {
  const now = injected.now ?? Date.now;
  const requestedAt = now();
  const meta: { noticeNo?: string; round?: string } = {};
  const p = chain.then(() => readOne(jobId, requestedAt, meta)).catch((e) => {
    const code = (e as { code?: unknown })?.code;
    if (code !== 'DETAIL_CANCELLED') {
      void recordG2bFailure({
        flow: 'detail', stage: 'read', code: typeof code === 'string' ? code : 'DETAIL_READ_FAILED',
        message: e instanceof Error ? e.message : String(e), jobId, ...meta, ms: now() - requestedAt,
      });
    }
    throw e;
  });
  chain = p.catch(() => undefined);
  return p;
}

export function registerDetailReader(): void {
  listen('g2b/read-detail', (p, sender) => {
    if (!isOffscreenSender(sender)) throw err('SENDER_FORBIDDEN', '허용되지 않은 발신자입니다.');
    return readDetail(p.jobId);
  }, 'sw');
}
