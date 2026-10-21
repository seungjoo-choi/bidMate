import { redactKey } from '../adapters/g2b/openapi';
import { DEFAULT_WEBMAIL_HOST, withDefaults } from '../core/model/default-settings';
import { inboxHost } from '../core/model/mail-provider';
import { refsConflict } from '../core/model/job-conflict';
import { kindOf, noticeIdOf } from '../core/model/ids';
import { COLLECTIBLE_NOTICE_KINDS, type NoticeKind } from '../core/types/notice';
import type { CollectResult, Handoff, Job, JobError, JobEvent, JobLog, JobProgress, JobSendState, JobStatus, StepId, StepState } from '../core/types/job';
import type { AfterCollect, Settings } from '../core/types/settings';
import { listen, send as busSend } from '../messaging/bus';
import type { ActiveJob, Envelope, JobRequest, JobRunPayload } from '../messaging/protocol';
import { ensureOffscreen, hasOffscreen } from './offscreen-manager';

const MAX_JOBS = 20;
const IDS_KEY = 'jobIds';
const jobKey = (id: string) => `jobs.${id}`;
const logKey = (id: string) => `jobLog.${id}`;
const MAX_LOG_EVENTS = 400;
const LABEL_MAX = 200;
const MESSAGE_MAX = 300;
const COLLECT_STEPS: StepId[] = ['fetch_basic', 'download_attachments', 'extract', 'fetch_html'];
const EXTRACT_STEPS: StepId[] = ['extract'];
const COMPOSE_STEPS: StepId[] = ['render_mail', 'open_compose', 'fill_fields', 'attach_files', 'verify', 'send_mail'];

/** 진행 중으로 보는 상태. cancelling도 종결이 아니다. */
export const ACTIVE = new Set<JobStatus>(['queued', 'running', 'cancelling']);

// ---------- 주입 가능한 의존성 (테스트용) ----------
export interface KV {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}
export interface CoordinatorDeps {
  storage: { session: KV; local: Pick<KV, 'get'> };
  send: typeof busSend;
  offscreen: { ensure(): Promise<void>; has(): Promise<boolean>; close(): Promise<void> };
}

let injected: Partial<CoordinatorDeps> = {};
export function setCoordinatorDeps(d: Partial<CoordinatorDeps>): void {
  injected = d;
}
// 주입되지 않은 의존성만 실제 chrome API로 채운다(테스트에서 chrome이 없어도 동작).
const deps = (): CoordinatorDeps => ({
  storage: injected.storage ?? { session: chrome.storage.session as unknown as KV, local: chrome.storage.local as unknown as Pick<KV, 'get'> },
  send: injected.send ?? busSend,
  offscreen: injected.offscreen ?? { ensure: ensureOffscreen, has: hasOffscreen, close: () => chrome.offscreen.closeDocument() },
});

// ---------- 종결 리스너 ----------
type FinalListener = (job: Job) => void;
const finalListeners: FinalListener[] = [];
export function addFinalListener(fn: FinalListener): void {
  finalListeners.push(fn);
}
/** 테스트용. */
export function clearFinalListeners(): void {
  finalListeners.length = 0;
}
/** serial 체인 밖(setTimeout 0)에서 호출한다. 리스너 안에서 startJob을 await해도 체인이 멈추지 않는다. */
function emitFinal(job: Job): void {
  setTimeout(() => {
    for (const fn of [...finalListeners]) {
      try { fn(job); } catch { /* 리스너 예외는 삼킨다 */ }
    }
  }, 0);
}

// storage.session read-modify-write 직렬화. 모든 ledger 쓰기는 serial 안에서 한다.
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.catch(() => undefined).then(fn);
  chain = run;
  return run;
}

async function getIds(): Promise<string[]> {
  return ((await deps().storage.session.get(IDS_KEY))[IDS_KEY] as string[] | undefined) ?? [];
}
export async function getJob(id: string): Promise<Job | undefined> {
  return (await deps().storage.session.get(jobKey(id)))[jobKey(id)] as Job | undefined;
}
async function putJob(job: Job): Promise<void> {
  job.updatedAt = new Date().toISOString(); // 표시용
  await deps().storage.session.set({ [jobKey(job.id)]: job });
}
export async function listJobs(): Promise<Job[]> {
  const ids = await getIds();
  const got = await deps().storage.session.get(ids.map(jobKey));
  return ids.map((id) => got[jobKey(id)] as Job | undefined).filter((j): j is Job => !!j);
}
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type LogItem = DistributiveOmit<JobEvent, 'seq' | 'at' | 'attempt'>;

export async function getJobLog(id: string): Promise<JobLog | undefined> {
  return (await deps().storage.session.get(logKey(id)))[logKey(id)] as JobLog | undefined;
}
const clip = (text: string, max: number): string => (text.length > max ? text.slice(0, max) : text);
async function scrubError(e: JobError): Promise<JobError> {
  return { code: e.code, message: clip(await redact(e.message), MESSAGE_MAX), step: e.step, retryable: e.retryable };
}
/** 기록에 남기기 전 문자열을 가리고(redact) 자른다. */
async function scrubItem(item: LogItem): Promise<LogItem> {
  switch (item.kind) {
    case 'attempt':
    case 'note':
      return { ...item, label: clip(await redact(item.label), LABEL_MAX) };
    case 'step':
      return { ...item, label: clip(await redact(item.label), LABEL_MAX), ...(item.error ? { error: await scrubError(item.error) } : {}) };
    case 'file':
      return { ...item, ...(item.error ? { error: clip(await redact(item.error), MESSAGE_MAX) } : {}) };
    case 'finish':
      return { ...item, ...(item.error ? { error: await scrubError(item.error) } : {}) };
    default:
      return item;
  }
}
/** 상한 초과 시 가장 오래된 회차를 통째로 버린다. 한 회차뿐이면 오래된 file 이벤트부터 버린다. */
function trimLog(events: JobEvent[]): JobEvent[] {
  let out = events;
  while (out.length > MAX_LOG_EVENTS) {
    const attempts = [...new Set(out.map((e) => e.attempt))];
    if (attempts.length > 1) {
      const oldest = Math.min(...attempts);
      out = out.filter((e) => e.attempt !== oldest);
    } else {
      const i = out.findIndex((e) => e.kind === 'file');
      if (i < 0) break;
      out = [...out.slice(0, i), ...out.slice(i + 1)];
    }
  }
  return out;
}
/** serial 안에서만 호출한다. 쓰기 실패는 삼키고 잡 갱신은 유지한다. */
async function appendLog(jobId: string, attempt: number, items: LogItem[]): Promise<void> {
  if (items.length === 0) return;
  try {
    const prev = await getJobLog(jobId);
    const log: JobLog = prev ?? { jobId, seq: 0, events: [] };
    const at = new Date().toISOString();
    const added: JobEvent[] = [];
    for (const it of items) added.push({ ...(await scrubItem(it)), seq: ++log.seq, at, attempt } as JobEvent);
    log.events = trimLog([...log.events, ...added]);
    await deps().storage.session.set({ [logKey(jobId)]: log });
  } catch { /* 기록 실패는 잡 갱신을 막지 않는다 */ }
}

async function addJob(job: Job): Promise<void> {
  let ids = [...(await getIds()).filter((i) => i !== job.id), job.id];
  let drop: string[] = [];
  if (ids.length > MAX_JOBS) {
    // 정리 대상은 ACTIVE가 아닌 잡(FINAL/interrupted) 중 오래된 것부터. ACTIVE는 지우지 않는다.
    const status = new Map((await listJobs()).map((j) => [j.id, j.status]));
    let over = ids.length - MAX_JOBS;
    drop = ids.filter((i) => {
      if (over <= 0 || i === job.id || ACTIVE.has(status.get(i) as JobStatus)) return false;
      over--;
      return true;
    });
    ids = ids.filter((i) => !drop.includes(i));
  }
  await deps().storage.session.set({ [IDS_KEY]: ids });
  if (drop.length) await deps().storage.session.remove(drop.flatMap((i) => [jobKey(i), logKey(i)]));
  await putJob(job);
}
async function deleteJob(id: string): Promise<void> {
  await deps().storage.session.set({ [IDS_KEY]: (await getIds()).filter((i) => i !== id) });
  await deps().storage.session.remove([jobKey(id), logKey(id)]);
}

async function getSettings(): Promise<Settings> {
  const { settingsCache } = await deps().storage.local.get('settingsCache');
  return withDefaults(settingsCache as Settings | undefined);
}

/** 저장/전달되는 모든 오류/라벨 문자열에서 서비스키를 가린다. */
async function redact(text: string): Promise<string> {
  const { secrets } = await deps().storage.local.get('secrets');
  return redactKey(text, (secrets as { g2bServiceKey?: string } | undefined)?.g2bServiceKey);
}
async function redactError(e: JobError): Promise<JobError> {
  return { ...e, message: await redact(e.message), detail: undefined };
}

function notifyTab(job: Job, payload: JobProgress): void {
  if (job.originTabId === undefined) return;
  try {
    const env: Envelope = { id: crypto.randomUUID(), type: 'job/progress', payload, ts: Date.now(), target: 'sw' };
    void globalThis.chrome?.tabs?.sendMessage(job.originTabId, env)?.catch?.(() => undefined);
  } catch { /* 탭 전달 실패는 무시 */ }
}

/** 종료 등 상태 스냅샷을 탭에 푸시한다(job/progress와 구분). 실패는 무시. */
function notifyUpdate(job: Job): void {
  if (job.originTabId === undefined) return;
  try {
    const env: Envelope = { id: crypto.randomUUID(), type: 'job/update', payload: { job }, ts: Date.now(), target: 'content' };
    void globalThis.chrome?.tabs?.sendMessage(job.originTabId, env)?.catch?.(() => undefined);
  } catch { /* 탭 전달 실패는 무시 */ }
}

// ---------- 발신자 판별/탭 소유 검사 ----------
export type SenderKind = 'extension' | 'g2b' | 'webmail' | 'unknown';
/** 사이트 content script 발신(자기 탭 잡만 다룬다). */
export const isSiteKind = (k: SenderKind): boolean => k === 'g2b' || k === 'webmail';
type Sender = Pick<chrome.runtime.MessageSender, 'id' | 'url' | 'tab'>;

/** extension: 우리 확장 페이지(대시보드 등), g2b: 나라장터 탭, webmail: 설정 호스트 웹메일 탭, 그 외 unknown. */
export function senderKind(sender: Sender, runtimeId: string | undefined = globalThis.chrome?.runtime?.id, webmailHost?: string): SenderKind {
  if (runtimeId && sender.id === runtimeId && sender.url?.startsWith(`chrome-extension://${runtimeId}/`)) return 'extension';
  if (sender.tab) {
    try {
      const u = new URL(sender.url ?? '');
      if (u.origin === 'https://www.g2b.go.kr') return 'g2b';
      if (webmailHost && u.protocol === 'https:' && u.hostname === webmailHost) return 'webmail';
    } catch { /* unknown */ }
  }
  return 'unknown';
}

const forbid = (code: string, message: string) => Object.assign(new Error(message), { code });
/** 설정된 수신 서비스 호스트를 반영해 발신자 종류를 판정한다. */
async function resolveKind(sender: Sender): Promise<SenderKind> {
  const runtimeId = globalThis.chrome?.runtime?.id;
  const k = senderKind(sender, runtimeId);
  if (k !== 'unknown' || !sender.tab) return k; // 웹메일 판정이 필요할 때만 설정을 읽는다
  let host = DEFAULT_WEBMAIL_HOST;
  try { host = inboxHost(await getSettings()); } catch { /* 설정 읽기 실패 시 기본 호스트 */ }
  return senderKind(sender, runtimeId, host);
}
/** job/* 요청은 확장 페이지, 나라장터 탭, 웹메일 탭만 허용한다. */
async function kindOrThrow(sender: Sender): Promise<SenderKind> {
  const k = await resolveKind(sender);
  if (k === 'unknown') throw forbid('SENDER_FORBIDDEN', '허용되지 않은 발신자입니다.');
  return k;
}

/** offscreen 엔진 문서에서 보낸 메시지인지. */
export function isOffscreenSender(sender: Sender, runtimeId: string | undefined = globalThis.chrome?.runtime?.id): boolean {
  return senderKind(sender, runtimeId) === 'extension' && !!sender.url && new URL(sender.url).pathname === '/offscreen.html';
}

/** 확장 페이지 발신만 허용한다(notice/*, extraction/* 중계용). */
export function assertExtensionSender(sender: Sender): void {
  if (senderKind(sender) !== 'extension') throw forbid('SENDER_FORBIDDEN', '허용되지 않은 발신자입니다.');
}

/** originTabId는 사이트 탭(나라장터/웹메일)이 보낸 경우에만 채운다(대시보드 잡은 비움). */
export function originTabIdFor(kind: SenderKind, sender: Sender): number | undefined {
  return isSiteKind(kind) ? sender.tab?.id : undefined;
}

/** 사이트 탭의 retryOf: 같은 공고이고, 같은 탭(또는 탭 없는 잡)이어야 한다. 확장 페이지는 검사하지 않는다. */
export async function assertRetryAllowed(req: JobRequest, sender: Sender): Promise<void> {
  const kind = await kindOrThrow(sender);
  // 단독 추출 잡은 확장 페이지만 시작/재시도할 수 있다.
  if ((req.type === 'extract' || req.type === 'compose') && kind !== 'extension') throw forbid('SENDER_FORBIDDEN', '허용되지 않은 발신자입니다.');
  if (!req.retryOf || !isSiteKind(kind)) return;
  const prev = await getJob(req.retryOf);
  if (prev?.type === 'extract' || prev?.type === 'compose') throw forbid('SENDER_FORBIDDEN', '허용되지 않은 발신자입니다.');
  if (!prev) return; // 없으면 startJob이 JOB_NOT_FOUND를 던진다
  const refOk = !!prev.ref && !!req.ref && refsConflict(prev.ref, req.ref);
  const tabOk = prev.originTabId === undefined || prev.originTabId === sender.tab?.id;
  if (!refOk || !tabOk) throw forbid('JOB_RETRY_FORBIDDEN', '이 잡을 재시도할 수 없습니다.');
}

/** 사이트 탭은 자기 탭의 잡만 조회할 수 있다. */
export async function getJobForSender(jobId: string, sender: Sender): Promise<Job | null> {
  const kind = await kindOrThrow(sender);
  const j = await getJob(jobId);
  if (!j) return null;
  if (isSiteKind(kind) && j.originTabId !== sender.tab?.id) return null;
  return j;
}

export async function latestJobForSender(ref: { kind?: NoticeKind; noticeNo: string; round?: string }, sender: Sender): Promise<Job | null> {
  if (!isSiteKind(await kindOrThrow(sender))) return null;
  const jobs = (await listJobs()).filter((j) => j.type !== 'compose' && j.originTabId === sender.tab?.id && j.ref && refsConflict(j.ref, ref));
  jobs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return jobs[0] ?? null;
}

/** 이 탭이 시작한 collect 잡(updatedAt 내림차순). 사이트 탭이 아니면 빈 배열. */
export async function listJobsForTab(sender: Sender): Promise<Job[]> {
  if (!isSiteKind(await resolveKind(sender))) return [];
  const jobs = (await listJobs()).filter((j) => j.originTabId === sender.tab?.id && j.type === 'collect');
  jobs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return jobs;
}

/** 사이트 탭은 자기 탭의 잡만 취소할 수 있다. */
export async function assertCancelAllowed(jobId: string, sender: Sender): Promise<void> {
  const kind = await kindOrThrow(sender);
  if (!isSiteKind(kind)) return;
  const j = await getJob(jobId);
  if (j && j.originTabId !== sender.tab?.id) throw forbid('JOB_CANCEL_FORBIDDEN', '이 잡을 취소할 수 없습니다.');
}

function newJob(req: JobRequest, noticeId: string): Job {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(), type: req.type, noticeId, ref: req.ref, status: 'queued',
    steps: (req.type === 'extract' ? EXTRACT_STEPS : req.type === 'compose' ? COMPOSE_STEPS : COLLECT_STEPS).map((id): StepState => ({ id, status: 'pending' })),
    attempt: 1, originTabId: req.originTabId, createdAt: now, updatedAt: now, errors: [],
    ...(req.type === 'compose' && req.params ? { params: { groupId: req.params.groupId, templateId: req.params.templateId, recipients: req.params.recipients, ...(req.params.autoSend ? { autoSend: req.params.autoSend } : {}) } } : {}),
    ...(req.type === 'compose' && req.auto ? { auto: { collectJobId: req.auto.collectJobId } } : {}),
  };
}

/** serial 안에서 호출: offscreen이 모른다고 답한 ACTIVE 잡을 interrupted로 바꾼다. */
async function syncActive(active: ActiveJob[], exceptId?: string): Promise<void> {
  const ids = new Set(active.map((a) => a.jobId));
  for (const j of await listJobs()) {
    if (ACTIVE.has(j.status) && !ids.has(j.id) && j.id !== exceptId) {
      const next: Job = { ...j, status: 'interrupted' };
      await putJob(next);
      await appendLog(next.id, next.attempt, [{ kind: 'finish', status: 'interrupted' }]);
      emitFinal(next);
    }
  }
}

/** compose 잡의 탭/프레임을 ledger에 기록한다. 잡이 ACTIVE일 때만. */
export function setComposeTab(jobId: string, patch: { composeTabId?: number; composeFrameId?: number }): Promise<void> {
  return serial(async () => {
    const cur = await getJob(jobId);
    if (!cur || !ACTIVE.has(cur.status)) return;
    await putJob({ ...cur, ...patch });
  });
}

/** compose 잡의 발송 상태를 병합 기록한다. 잡이 ACTIVE일 때만. send가 없으면 patch로 생성한다. */
export function setSendState(jobId: string, patch: Partial<JobSendState>): Promise<void> {
  return serial(async () => {
    const cur = await getJob(jobId);
    if (!cur || !ACTIVE.has(cur.status)) return;
    const send = { ...(cur.send ?? { clickedAt: new Date().toISOString(), confirmed: false }), ...patch } as JobSendState;
    await putJob({ ...cur, send });
  });
}

/** collect 잡의 handoff만 기록한다. status/attempt/result/errors는 바꾸지 않는다. */
export function setHandoff(jobId: string, handoff: Handoff): Promise<void> {
  return serial(async () => {
    const cur = await getJob(jobId);
    if (!cur) return;
    const next: Job = { ...cur, handoff };
    await putJob(next);
    await appendLog(next.id, next.attempt, [{ kind: 'handoff', handoff }]);
    notifyUpdate(next);
  });
}

/** collect 잡의 수집 후 동작을 바꾼다. collect이고 ACTIVE일 때만 적용하고 적용 여부를 반환한다. */
export function setAfterCollect(jobId: string, afterCollect: AfterCollect): Promise<boolean> {
  return serial(async () => {
    const cur = await getJob(jobId);
    if (!cur || cur.type !== 'collect' || !ACTIVE.has(cur.status)) return false;
    const next: Job = { ...cur, afterCollect };
    await putJob(next);
    notifyUpdate(next);
    return true;
  });
}

export type StartResult = { jobId: string; code?: 'JOB_ALREADY_RUNNING' };

/** ensureOffscreen → ledger queued → job/run 왕복 → ledger 확정 → 정합까지 한 serial 구간. */
export function startJob(req: JobRequest): Promise<StartResult> {
  return serial(async (): Promise<StartResult> => {
    let prevRecord: Job | undefined;
    let job: Job;
    if (req.retryOf) {
      prevRecord = await getJob(req.retryOf);
      if (!prevRecord) throw Object.assign(new Error('재시도할 잡을 찾을 수 없습니다.'), { code: 'JOB_NOT_FOUND' });
      if (ACTIVE.has(prevRecord.status)) return { jobId: prevRecord.id, code: 'JOB_ALREADY_RUNNING' };
      // 실패한 step부터 재개: done은 유지, 나머지는 pending
      job = {
        ...prevRecord, status: 'queued', attempt: prevRecord.attempt + 1, errors: [], currentStep: undefined, label: undefined,
        steps: prevRecord.steps.map((s) => (s.status === 'done' && prevRecord!.type !== 'compose' ? s : { id: s.id, status: 'pending' as const })),
        originTabId: req.originTabId ?? prevRecord.originTabId,
      };
      delete job.handoff; // 재시도 결과로 자동 작성을 다시 판정한다
      // compose 재시도는 이전 탭을 재사용하지 않는다.
      // 이전 시도의 발송 상태(clickedAt 등)도 물려받지 않는다. 남으면 새 탭의 닫힘·사용자 발송이 이전 기록에 잘못 붙는다.
      if (job.type === 'compose') { delete job.composeTabId; delete job.composeFrameId; delete job.send; }
    } else {
      // extract/compose 잡은 ref 없이 noticeId만으로 시작한다.
      if (!req.ref && !((req.type === 'extract' || req.type === 'compose') && req.noticeId)) throw Object.assign(new Error('공고 참조(ref)가 필요합니다.'), { code: 'INVALID_REQUEST' });
      if (req.ref && !COLLECTIBLE_NOTICE_KINDS.has(kindOf(req.ref))) throw Object.assign(new Error('수집할 수 없는 공고 종류입니다.'), { code: 'INVALID_REQUEST' });
      // 정규화: bid는 kind 생략, 그 외 종류는 round 제거(noticeIdOf는 round를 무시하므로 충돌 비교와 맞춘다). 원본은 바꾸지 않는다.
      const ref = req.ref && (() => {
        const { kind, round, ...rest } = req.ref;
        return kind && kind !== 'bid' ? { ...rest, kind } : { ...rest, ...(round !== undefined ? { round } : {}) };
      })();
      const nreq: JobRequest = ref ? { ...req, ref } : req;
      job = newJob(nreq, req.noticeId ?? noticeIdOf(nreq.ref!));
      // collect 잡은 시작 시점의 수집 후 동작을 스냅샷한다(자동 작성이 꺼져 있으면 기록하지 않는다). 재시도는 이전 값을 승계한다.
      if (job.type === 'collect') {
        const ac = (await getSettings()).autoCompose;
        if (ac.enabled) job.afterCollect = ac.afterCollect;
      }
    }
    try {
      await deps().offscreen.ensure();
    } catch (e) {
      throw Object.assign(new Error(await redact(e instanceof Error ? e.message : String(e))), { code: 'OFFSCREEN_ERROR' });
    }
    // 거부되면 되돌리도록 재시도 전 기록을 잡아 둔다(attempt 이벤트로 상한 절단이 일어나 이전 회차가 지워질 수 있음).
    const prevLog = prevRecord ? await getJobLog(job.id).catch(() => undefined) : undefined;
    await addJob(job);
    await appendLog(job.id, job.attempt, [{ kind: 'attempt', label: job.type === 'compose' ? '메일 작성 시작' : req.retryOf ? '다시 시도' : '수집 시작' }]);
    const payload: JobRunPayload = {
      job, html: req.html,
      secrets: ((await deps().storage.local.get('secrets')).secrets as JobRunPayload['secrets'] | undefined) ?? {},
      settings: await getSettings(),
    };
    let resp;
    try {
      resp = await deps().send('job/run', payload, { target: 'offscreen' });
    } catch (e) {
      const cur = await getJob(job.id);
      if (cur) {
        const failed: Job = { ...cur, status: 'failed', errors: [await redactError({ code: 'OFFSCREEN_ERROR', message: e instanceof Error ? e.message : String(e), retryable: true })] };
        await putJob(failed);
        await appendLog(failed.id, failed.attempt, [{ kind: 'finish', status: 'failed', error: failed.errors[0] }]);
        emitFinal(failed);
      }
      return { jobId: job.id };
    }
    if (!resp.accepted) {
      // 거부: 이번에 만든 기록은 남기지 않는다(재시도였다면 이전 기록 복원).
      if (prevRecord) {
        await putJob(prevRecord);
        // 이번 attempt 이전의 기록으로 되돌린다.
        try {
          if (prevLog) await deps().storage.session.set({ [logKey(job.id)]: prevLog });
          else await deps().storage.session.remove([logKey(job.id)]);
        } catch { /* 기록 실패는 무시 */ }
      } else await deleteJob(job.id);
      await syncActive(resp.active, job.id);
      return { jobId: resp.conflictJobId, code: resp.code };
    }
    const cur = await getJob(job.id);
    if (cur && cur.status === 'queued') await putJob({ ...cur, status: 'running' });
    await syncActive(resp.active, job.id);
    return { jobId: job.id };
  });
}

export function onProgress(p: JobProgress): Promise<void> {
  return serial(async () => {
    const cur = await getJob(p.jobId);
    if (!cur || !ACTIVE.has(cur.status) || p.attempt !== cur.attempt) return;
    const safe: JobProgress = { ...p, label: await redact(p.label) };
    const now = new Date().toISOString();
    const prevStatus = cur.steps.find((s) => s.id === safe.step)?.status;
    let ms: number | undefined;
    const steps = cur.steps.map((s) => {
      if (s.id !== safe.step) return s;
      const n: StepState = { ...s, status: safe.status, progress: safe.progress ?? s.progress, bytes: safe.bytes };
      if (safe.status === 'running' && !n.startedAt) n.startedAt = now;
      if (safe.status === 'done' || safe.status === 'failed' || safe.status === 'skipped') {
        n.endedAt = now;
        ms = safe.ms ?? (n.startedAt ? Math.max(0, Date.parse(now) - Date.parse(n.startedAt)) : undefined);
      }
      return n;
    });
    await putJob({
      ...cur, status: cur.status === 'cancelling' ? 'cancelling' : 'running', // cancelling을 running으로 되돌리지 않는다
      steps, currentStep: safe.step, label: safe.label,
    });
    const items: LogItem[] = [];
    if (safe.status !== prevStatus && safe.status !== 'pending') {
      items.push({ kind: 'step', step: safe.step, status: safe.status, label: safe.label, ...(ms !== undefined ? { ms } : {}) });
    }
    if (safe.event) items.push(safe.event);
    await appendLog(cur.id, cur.attempt, items);
    notifyTab(cur, safe);
  });
}

export function onFinish(f: { jobId: string; attempt: number; status: JobStatus; result?: unknown; error?: JobError }): Promise<Job | undefined> {
  return serial(async (): Promise<Job | undefined> => {
    const cur = await getJob(f.jobId);
    if (!cur || f.attempt !== cur.attempt) return undefined;
    if (!ACTIVE.has(cur.status) && cur.status !== 'interrupted') return undefined; // FINAL은 덮어쓰지 않는다
    const result = f.result as CollectResult | undefined;
    const error = f.error ? await redactError(f.error) : undefined;
    const steps = cur.steps.map((s) => (error?.step === s.id ? { ...s, error } : s));
    const safeResult = result
      ? { ...result, attachments: await Promise.all((result.attachments ?? []).map(async (a) => (a.error ? { ...a, error: await redact(a.error) } : a))) }
      : f.result;
    const next: Job = {
      ...cur, status: f.status, result: safeResult, steps, currentStep: undefined, label: undefined,
      noticeId: result?.noticeId ?? cur.noticeId,
      errors: error ? [error] : [],
    };
    await putJob(next);
    await appendLog(next.id, next.attempt, [{ kind: 'finish', status: f.status, ...(error ? { error } : {}) }]);
    notifyUpdate(next);
    emitFinal(next);
    return next;
  });
}

/** 정합: ledger의 ACTIVE 잡 중 offscreen이 모르는 것만 interrupted로 바꾼다. 질의 실패 시 변화 없음. */
export function reconcile(): Promise<void> {
  return serial(async () => {
    const active = (await listJobs()).filter((j) => ACTIVE.has(j.status));
    if (active.length === 0) return;
    if (!(await deps().offscreen.has())) {
      for (const j of active) {
        const next: Job = { ...j, status: 'interrupted' };
        await putJob(next);
        await appendLog(next.id, next.attempt, [{ kind: 'finish', status: 'interrupted' }]);
        emitFinal(next);
      }
      return;
    }
    let r;
    try {
      r = await deps().send('job/status', {}, { target: 'offscreen' });
    } catch {
      return;
    }
    await syncActive(r.active);
  });
}

/** 취소. force는 cancelling 상태에서 offscreen 문서를 닫아 강제 중단한다. */
export function cancelJob(jobId: string, force = false): Promise<{ status: JobStatus }> {
  return serial(async () => {
    const cur = await getJob(jobId);
    if (!cur) throw Object.assign(new Error('잡을 찾을 수 없습니다.'), { code: 'JOB_NOT_FOUND' });
    if (!ACTIVE.has(cur.status)) return { status: cur.status };
    // force는 cancelling 상태에서만 허용한다. 그 외에는 일반 취소 경로로 처리한다.
    if (force && cur.status === 'cancelling') {
      // offscreen이 이미 없거나 close가 실패해도 상태 전이는 항상 수행한다.
      try {
        if (await deps().offscreen.has()) await deps().offscreen.close();
      } catch { /* 무시 */ }
      for (const j of await listJobs()) {
        if (!ACTIVE.has(j.status)) continue;
        const next: Job = { ...j, status: j.id === jobId ? 'cancelled' : 'interrupted' };
        await putJob(next);
        await appendLog(next.id, next.attempt, [{ kind: 'finish', status: next.status }]);
        emitFinal(next);
      }
      return { status: 'cancelled' };
    }
    let next: JobStatus = 'cancelled';
    if (await deps().offscreen.has()) {
      try {
        const r = await deps().send('job/abort', { jobId }, { target: 'offscreen' });
        if (r.known) next = 'cancelling';
      } catch { /* 전송 실패 → cancelled */ }
    }
    const updated: Job = { ...cur, status: next };
    await putJob(updated);
    if (next === 'cancelled') {
      await appendLog(updated.id, updated.attempt, [{ kind: 'finish', status: 'cancelled' }]);
      emitFinal(updated);
    }
    return { status: next };
  });
}

export function registerCoordinator(): void {
  // originTabId는 보낸 탭(content script)에서 채운다. 위조 방지를 위해 항상 sender를 우선한다.
  listen('job/start', async (req, sender) => {
    await assertRetryAllowed(req, sender);
    // auto는 SW 내부 전용이므로 외부 메시지의 값은 버린다.
    const { auto: _ignored, ...safe } = req;
    const kind = await resolveKind(sender);
    // autoSend도 확장 페이지 발신만 인정한다(auto와 같은 취급).
    if (kind !== 'extension' && safe.params?.autoSend) {
      const { autoSend: _drop, ...params } = safe.params;
      safe.params = params;
    }
    return startJob({ ...safe, originTabId: originTabIdFor(kind, sender) });
  }, 'sw');
  listen('job/get', ({ jobId }, sender) => getJobForSender(jobId, sender), 'sw');
  listen('job/latest-for-tab', (ref, sender) => latestJobForSender(ref, sender), 'sw');
  listen('job/list-for-tab', (_, sender) => listJobsForTab(sender), 'sw');
  listen('job/cancel', async ({ jobId, force }, sender) => {
    await assertCancelAllowed(jobId, sender);
    return cancelJob(jobId, force);
  }, 'sw');
  // 엔진 보고(progress/finish/ready)는 offscreen 문서에서 온 것만 받는다.
  listen('job/progress', (p, sender) => (isOffscreenSender(sender) ? onProgress(p) : undefined), 'sw');
  listen('job/finish', (f, sender) => (isOffscreenSender(sender) ? onFinish(f).then(() => undefined) : undefined), 'sw');
  listen('engine/ready', (_, sender) => (isOffscreenSender(sender) ? reconcile() : undefined), 'sw');
  void reconcile();
}
