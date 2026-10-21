import { withDefaults } from '../core/model/default-settings';
import { decideHandoff, type Verdict } from '../core/model/handoff';
import type { ISODate } from '../core/types/common';
import type { ComposeParams, Handoff, HandoffSkip, Job } from '../core/types/job';
import { kindOf } from '../core/model/ids';
import type { NoticeKind, NoticeRef } from '../core/types/notice';
import type { AfterCollect, AutoComposeSettings, Settings } from '../core/types/settings';
import { listen } from '../messaging/bus';
import type { JobRequest } from '../messaging/protocol';
import { openDashboard } from './dashboard-tabs';
import {
  ACTIVE, addFinalListener, getJob, getJobForSender, listJobs, senderKind, setAfterCollect, setHandoff, startJob, type KV, type StartResult,
} from './job-coordinator';
import { getComposeHost } from './site-registry';

export const QUEUE_KEY = 'autoComposeQueue';

export interface QueueEntry { collectJobId: string; noticeId: string; ref?: NoticeRef; originTabId?: number; enqueuedAt: ISODate }

export interface AutoComposeDeps {
  storage: { session: KV; local: Pick<KV, 'get'> };
  startJob: (req: JobRequest) => Promise<StartResult>;
  listJobs: () => Promise<Job[]>;
  getJob: (id: string) => Promise<Job | undefined>;
  setHandoff: (jobId: string, handoff: Handoff) => Promise<void>;
  setAfterCollect: (jobId: string, afterCollect: AfterCollect) => Promise<boolean>;
  permissions: Pick<typeof chrome.permissions, 'contains'>;
  openDashboard: typeof openDashboard;
  getComposeHost: () => Promise<string>;
  getSettings: () => Promise<Settings>;
  now: () => ISODate;
}

let injected: Partial<AutoComposeDeps> = {};
/** 테스트용 의존성 주입. */
export function setAutoComposeDeps(d: Partial<AutoComposeDeps>): void {
  injected = d;
}
const deps = (): AutoComposeDeps => {
  const storage = injected.storage ?? { session: chrome.storage.session as unknown as KV, local: chrome.storage.local as unknown as Pick<KV, 'get'> };
  return {
    storage,
    startJob: injected.startJob ?? startJob,
    listJobs: injected.listJobs ?? listJobs,
    getJob: injected.getJob ?? getJob,
    setHandoff: injected.setHandoff ?? setHandoff,
    setAfterCollect: injected.setAfterCollect ?? setAfterCollect,
    permissions: injected.permissions ?? chrome.permissions,
    openDashboard: injected.openDashboard ?? openDashboard,
    getComposeHost: injected.getComposeHost ?? getComposeHost,
    getSettings: injected.getSettings ?? (async () => withDefaults(((await storage.local.get('settingsCache')).settingsCache as Settings | undefined))),
    now: injected.now ?? (() => new Date().toISOString()),
  };
};

// 큐 읽기/쓰기와 pump 직렬화. 이 체인 안에서 다시 q()를 호출하지 않는다.
let chain: Promise<unknown> = Promise.resolve();
function q<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.catch(() => undefined).then(fn);
  chain = run;
  return run;
}

async function readQueue(): Promise<QueueEntry[]> {
  return ((await deps().storage.session.get(QUEUE_KEY))[QUEUE_KEY] as QueueEntry[] | undefined) ?? [];
}
async function writeQueue(list: QueueEntry[]): Promise<void> {
  await deps().storage.session.set({ [QUEUE_KEY]: list });
}

const none = (reason: HandoffSkip): Handoff => ({ action: 'none', reason, at: deps().now() });
const activeCompose = async (): Promise<Job[]> => (await deps().listJobs()).filter((j) => j.type === 'compose' && ACTIVE.has(j.status));

function paramsOf(s: AutoComposeSettings, kind: NoticeKind): ComposeParams {
  const p: ComposeParams = {};
  if (s.recipients.mode === 'group') p.groupId = s.recipients.groupId;
  else if (s.recipients.mode === 'custom') p.recipients = s.recipients.members.map((m) => ({ ...m }));
  const tplId = kind === 'prespec' ? s.prespecTemplateId : s.templateId;
  if (tplId) p.templateId = tplId;
  return p;
}

async function pumpInner(): Promise<void> {
  const d = deps();
  for (;;) {
    const settings = (await d.getSettings()).autoCompose;
    let queue = await readQueue();
    if (!settings.enabled) {
      if (queue.length === 0) return;
      await writeQueue([]);
      for (const e of queue) await d.setHandoff(e.collectJobId, none('disabled'));
      return;
    }
    if (queue.length === 0) return;
    if ((await activeCompose()).length > 0) return; // 수동 시작 포함, 끝나면 종결 리스너가 다시 pump한다
    const [head, ...rest] = queue;
    if (!head) return;
    queue = rest;
    await writeQueue(queue);
    let reason: HandoffSkip | undefined;
    let busy = false;
    try {
      const r = await d.startJob({
        type: 'compose', noticeId: head.noticeId, ref: head.ref, originTabId: head.originTabId,
        params: paramsOf(settings, kindOf(head.ref)), auto: { collectJobId: head.collectJobId },
      });
      if (r.code === 'JOB_ALREADY_RUNNING') busy = true;
      else await d.setHandoff(head.collectJobId, { action: 'compose', state: 'started', jobId: r.jobId, at: d.now() });
    } catch (e) {
      if ((e as { code?: string })?.code === 'JOB_ALREADY_RUNNING') busy = true;
      else reason = 'start_failed';
    }
    // 그사이 다른 compose가 시작됐으면 선두로 되돌린다. 그 잡의 종결 리스너가 다시 pump한다.
    if (busy) { await writeQueue([head, ...(await readQueue())]); return; }
    if (reason) await d.setHandoff(head.collectJobId, none(reason));
    // 시작 실패는 종결 이벤트가 없으므로 다음 항목을 이어서 시도한다(큐가 줄어드므로 유한). 그 외에는 다음 pump에서.
    if (reason !== 'start_failed') return;
  }
}

export function pump(): Promise<void> {
  return q(pumpInner);
}

/** SW 재시작 복구: 큐에서 꺼낸 뒤 handoff를 기록하기 전에 SW가 내려가면 queued가 남는다. 큐에 없는 queued는 시작 실패로 정리한다. */
async function recoverInner(): Promise<void> {
  const d = deps();
  const queued = new Set((await readQueue()).map((e) => e.collectJobId));
  for (const j of await d.listJobs()) {
    if (j.type === 'collect' && j.handoff?.action === 'compose' && j.handoff.state === 'queued' && !queued.has(j.id)) {
      await d.setHandoff(j.id, none('start_failed'));
    }
  }
}

/** 판정을 적용한다. 호출자가 이미 q() 안에 있어야 하며, 여기서 q()를 부르지 않는다. */
async function applyVerdict(job: Job, verdict: Verdict): Promise<void> {
  const d = deps();
  if (verdict.kind === 'skip') return d.setHandoff(job.id, none(verdict.reason));
  const noticeId = job.noticeId ?? (job.result as { noticeId?: string } | undefined)?.noticeId;
  if (!noticeId) return d.setHandoff(job.id, none('no_notice'));
  // 대시보드는 저절로 열지 않는다. 완료 카드의 [상세]/[메일 작성]/[검수]를 눌러야 간다(사용자 결정 2026-10-21)
  if (verdict.kind === 'review') return d.setHandoff(job.id, { action: 'review', reasons: verdict.reasons, opened: false, at: d.now() });
  if (verdict.kind === 'ask') return d.setHandoff(job.id, { action: 'ask', at: d.now() });
  if (verdict.kind === 'edit') return d.setHandoff(job.id, { action: 'edit', opened: false, at: d.now() });
  // compose: 중복 확인, 적재, pump (호출자의 q() 직렬화 구간 안)
  let granted = false;
  try { granted = await d.permissions.contains({ origins: [`https://${await d.getComposeHost()}/*`] }); } catch { /* 권한 확인 실패는 없음으로 본다 */ }
  if (!granted) return d.setHandoff(job.id, none('needs_site_permission'));
  const queue = await readQueue();
  if (queue.some((e) => e.noticeId === noticeId) || (await activeCompose()).some((j) => j.noticeId === noticeId)) {
    return d.setHandoff(job.id, none('compose_running'));
  }
  await writeQueue([...queue, { collectJobId: job.id, noticeId, ref: job.ref, originTabId: job.originTabId, enqueuedAt: d.now() }]);
  await d.setHandoff(job.id, { action: 'compose', state: 'queued', at: d.now() });
  await pumpInner();
}

async function handleCollect(job: Job): Promise<void> {
  if (job.handoff) return; // 멱등
  const verdict = decideHandoff(job, (await deps().getSettings()).autoCompose);
  if (!verdict) return;
  await q(() => applyVerdict(job, verdict));
}

/** handoff ask 대기 중인 수집 잡에 사용자의 선택을 적용한다. 적용했으면 true. */
export function resolveChoice(collectJobId: string, value: 'dashboard' | 'compose'): Promise<boolean> {
  return q(async () => {
    const d = deps();
    const job = await d.getJob(collectJobId);
    if (!job || job.type !== 'collect' || job.handoff?.action !== 'ask') return false;
    const verdict = decideHandoff({ ...job, afterCollect: value }, (await d.getSettings()).autoCompose);
    if (!verdict) return false;
    await applyVerdict(job, verdict);
    return true;
  });
}

export async function onFinal(job: Job): Promise<void> {
  if (job.type === 'compose') return pump();
  if (job.type === 'collect') return handleCollect(job);
}

/** 대기 중인 자동 작성을 취소한다. 큐에 있어 제거했으면 true. */
export function dequeue(collectJobId: string): Promise<boolean> {
  return q(async () => {
    const queue = await readQueue();
    if (!queue.some((e) => e.collectJobId === collectJobId)) return false;
    await writeQueue(queue.filter((e) => e.collectJobId !== collectJobId));
    await deps().setHandoff(collectJobId, none('dequeued'));
    return true;
  });
}

export function registerAutoCompose(): void {
  addFinalListener((job) => { void onFinal(job).catch(() => undefined); });
  listen('auto-compose/dequeue', async ({ collectJobId }, sender) => {
    if (senderKind(sender) !== 'extension' && !(await getJobForSender(collectJobId, sender))) return { removed: false };
    return { removed: await dequeue(collectJobId) };
  }, 'sw');
  listen('auto-compose/choose', async ({ collectJobId, afterCollect }, sender) => {
    if (senderKind(sender) !== 'extension' && !(await getJobForSender(collectJobId, sender))) return { applied: false };
    if (await deps().setAfterCollect(collectJobId, afterCollect)) return { applied: true }; // ACTIVE면 종전 동작
    if (afterCollect === 'ask') return { applied: false };
    return { applied: await resolveChoice(collectJobId, afterCollect) };
  }, 'sw');
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && 'settingsCache' in changes) void pump().catch(() => undefined);
  });
  void q(recoverInner).catch(() => undefined).then(() => pump()).catch(() => undefined); // SW 재시작 복구
}
