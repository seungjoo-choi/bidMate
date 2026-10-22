import { fetchNotice, redactKey } from '../../adapters/g2b/openapi';
import { fetchPrespec, mapPrespecItem } from '../../adapters/g2b/prespec-api';
import { buildPlan } from '../../core/deadline/plan';
import { loadRules } from '../../core/extraction/rules/load';
import { SELECTOR_SETS } from '../../adapters/naverworks/selectors';
import { runCollectJob } from '../../engine/jobs/collect-job';
import type { JobError, JobStatus } from '../../core/types/job';
import type { G2bFailureInput } from '../../core/diagnostics/g2b-failure';
import { runComposeJob } from '../../engine/jobs/compose-job';
import { runExtractJob } from '../../engine/jobs/extract-job';
import { createParserRegistry } from '../../engine/parsers/registry';
import { createRfpService } from '../../engine/rfp/rfp-service';
import { editExtraction, editNoticeField, getNotice, listNotices, readExtractionText } from '../../engine/notices/notice-api';
import { repairConfig } from '../../engine/config/config-store';
import { deletePerformance, importPerformances, listPerformances, savePerformance } from '../../engine/config/performances-api';
import { deleteGroup, deleteRecipient, importRecipients, listRecipients, saveGroup, saveRecipient, setDefaultGroup } from '../../engine/config/recipients-api';
import { deleteTemplate, listTemplates, saveTemplate, setDefaultTemplate } from '../../engine/config/templates-api';
import { getDraft, getEdits, prepareMail } from '../../engine/mail/prepare';
import { SentStore } from '../../engine/mail/sent-store';
import { deleteNotices } from '../../engine/notices/delete-notice';
import { jobsConflict } from '../../core/model/job-conflict';
import { JobRegistry } from '../../engine/jobs/job-registry';
import { listen, send } from '../../messaging/bus';
import { fileStore } from '../../engine/file-store/file-store';
import { setFollow } from '../../engine/results/follow-api';
import { runResultRefresh } from '../../engine/results/result-tracker';
import type { ResultRunSummary } from '../../core/types/result';
import { probeResult } from '../../engine/results/result-probe';
import { saveEval } from '../../engine/evaluation/eval-api';
import { EvalStore } from '../../engine/evaluation/eval-store';
import { lookupInIndex } from '../../engine/notices/lookup';
import { NoticeStore } from '../../engine/notices/notice-store';
import type { NoticeKind } from '../../core/types/notice';
import { applySuggestion, dismissSuggestion, finishRun, getPrompt, getReview, listModels } from '../../engine/ai/ai-review-api';
import { AiBatch } from '../../engine/ai/ai-batch';
import { AiRunner } from '../../engine/ai/ai-runner';
import type { G2bTestResult, NoticeLookup, JobRunPayload, SmokeTestResult } from '../../messaging/protocol';

async function smokeTest(): Promise<SmokeTestResult> {
  const steps = { write: false, read: false, delete: false };
  const path = `bidmate-test/smoke-${Date.now()}.txt`;
  const content = `bidmate smoke ${new Date().toISOString()}`;
  try {
    // 권한이 granted가 아니면 NEEDS_FS_PERMISSION이 던져진다(호출 측에 전달).
    await fileStore.withLock(path, async () => {
      try {
        await fileStore.writeText(path, content);
        steps.write = true;
        if ((await fileStore.readText(path)) !== content) throw new Error('읽은 내용이 쓴 내용과 다릅니다.');
        steps.read = true;
      } finally {
        // 실패해도 남은 파일을 지우려고 시도한다(쓰기 전 실패 시 삭제 오류는 무시).
        try {
          await fileStore.remove(path);
          steps.delete = true;
        } catch (e) {
          if (steps.write) throw e;
        }
      }
    });
    return { ok: true, steps };
  } catch (e) {
    if ((e as { code?: string }).code === 'NEEDS_FS_PERMISSION') throw e;
    return { ok: false, steps, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  }
}

listen('fs/status', () => fileStore.status(), 'offscreen');
listen('fs/root-updated', async () => { await fileStore.reload(); }, 'offscreen');
listen('fs/smoke-test', () => smokeTest(), 'offscreen');
listen('notice/lookup', async (ref): Promise<NoticeLookup> => {
  try {
    return lookupInIndex(await new NoticeStore(fileStore).loadIndex(), ref);
  } catch {
    return { found: false }; // 권한 없음 등은 미수집으로 취급
  }
}, 'offscreen');
listen('notice/lookup-batch', async ({ refs }): Promise<NoticeLookup[]> => {
  try {
    const idx = await new NoticeStore(fileStore).loadIndex(); // index는 1회만 읽는다
    return refs.map((r) => lookupInIndex(idx, r));
  } catch {
    return refs.map(() => ({ found: false }));
  }
}, 'offscreen');

const FIXTURE_NOTICE_NO = 'R26BK01722175';
const FIXTURE_PRESPEC_NO = 'R26BD00273952'; // 추정: 실측(S0) 전

async function g2bTest(serviceKey?: string, kind?: NoticeKind): Promise<G2bTestResult> {
  const ctx = { serviceKey, fetch: (...a: Parameters<typeof fetch>) => fetch(...a) };
  if (kind === 'prespec') {
    const r = await fetchPrespec(FIXTURE_PRESPEC_NO, ctx);
    if (!r.ok) return { ok: false, error: { code: r.error.code, message: r.error.message } };
    return { ok: true, title: (mapPrespecItem(r.item, r.fetchedAt).specName?.value as string | null | undefined) ?? undefined };
  }
  const r = await fetchNotice(FIXTURE_NOTICE_NO, undefined, ctx);
  if (!r.ok) return { ok: false, error: { code: r.error.code, message: r.error.message } };
  return { ok: true, title: r.item.bidNtceNm };
}

// 실행 중 잡의 권위. job/run 수신 시 동기적으로 입장 검사한다.
const registry = new JobRegistry();

// pdfjs worker/cmaps/fonts는 public 자산(dist/chrome-mv3/pdfjs/)을 확장 URL로 읽는다.
const parsers = createParserRegistry({
  pdf: {
    workerSrc: chrome.runtime.getURL('pdfjs/pdf.worker.min.mjs'),
    cMapUrl: chrome.runtime.getURL('pdfjs/cmaps/'),
    standardFontDataUrl: chrome.runtime.getURL('pdfjs/standard_fonts/'),
  },
  parseXml: (x) => new DOMParser().parseFromString(x, 'application/xml'),
});

/** 루트 config/extraction-rules.json이 있으면 기본 규칙에 병합한다. 읽기/파싱 실패는 warning으로 남기고 기본 규칙을 쓴다. */
async function loadExtractionRules() {
  let user: unknown;
  let note: string | undefined;
  try {
    user = JSON.parse(await fileStore.readText('config/extraction-rules.json'));
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name !== 'NotFoundError' && (e as { code?: string }).code !== 'NOT_FOUND') note = `사용자 규칙 무시: 읽기 실패(${e instanceof Error ? e.message : String(e)})`;
  }
  const rules = loadRules(user);
  if (note) rules.warnings.push(note);
  return rules;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** finish는 SW가 ack할 때까지 1s 간격으로 최대 3회 재시도한다. */
async function sendFinish(payload: Parameters<typeof send<'job/finish'>>[1]): Promise<void> {
  for (let i = 0; i < 4; i++) {
    try {
      await send('job/finish', payload, { target: 'sw' });
      return;
    } catch {
      if (i < 3) await sleep(1000);
    }
  }
}

const checkPermission = async () => {
  const st = await fileStore.status();
  if (!st.hasRoot || st.permission !== 'granted') {
    throw Object.assign(new Error('저장 폴더 접근 권한이 필요합니다.'), { code: 'NEEDS_FS_PERMISSION' });
  }
};
const emitProgress = (progress: Parameters<typeof send<'job/progress'>>[1]) => { void send('job/progress', progress, { target: 'sw' }).catch(() => undefined); };

type Outcome = { status: JobStatus; result?: unknown; error?: JobError };

async function runJob(p: JobRunPayload): Promise<void> {
  const key = p.secrets.g2bServiceKey;
  const run = p.job.type === 'extract' ? runExtractOnly(p) : p.job.type === 'compose' ? runCompose(p) : runCollect(p);
  const out = await run.catch((e): Outcome => ({
    status: 'failed',
    error: { code: p.job.type === 'compose' ? 'COMPOSE_ERROR' : 'COLLECT_ERROR', message: e instanceof Error ? e.message : String(e), retryable: true },
  }));
  // 등록 해제는 finish 전송 전에 한다(재시작 요청이 finish ack를 기다리지 않도록).
  registry.release(p.job.id);
  const error = out.error ? { ...out.error, message: redactKey(out.error.message, key) } : undefined;
  await sendFinish({ jobId: p.job.id, attempt: p.job.attempt, status: out.status, result: out.result, error });
}

async function runExtractOnly(p: JobRunPayload): Promise<Outcome> {
  return runExtractJob(p, {
    signal: registry.signal(p.job.id), store: fileStore, checkPermission, parsers, rules: await loadExtractionRules(), emit: emitProgress,
  });
}

async function runCompose(p: JobRunPayload): Promise<Outcome> {
  return runComposeJob(p, {
    signal: registry.signal(p.job.id), store: fileStore, checkPermission, emit: emitProgress,
    call: (type, payload, timeoutMs) => send(type, payload, { target: 'sw', timeoutMs }),
    selectorSets: SELECTOR_SETS,
    sentCount: async (id) => (await sentStore.list(id)).filter((r) => !r.voidedAt).length,
  });
}

async function runCollect(p: JobRunPayload): Promise<Outcome> {
  return runCollectJob(p, {
    signal: registry.signal(p.job.id),
    store: fileStore,
    checkPermission,
    fetch: (...a) => fetch(...a),
    emit: emitProgress,
    extract: { parsers, rules: await loadExtractionRules() },
    readDetail: async (jobId) => (await send('g2b/read-detail', { jobId }, { target: 'sw', timeoutMs: 240_000 })).html,
  });
}

listen('g2b/test', ({ serviceKey, kind }) => g2bTest(serviceKey, kind), 'offscreen');
// 등록 전 await 금지: 검사와 등록은 한 동기 구간에서 끝낸다. 실행은 응답 후 시작한다.
const deletingNotices = new Set<string>();
listen('job/run', (p) => {
  // collect 잡은 ref만 가질 수 있으므로 정규화한 공고 키로 비교한다(같은 군으로 맞춰 비교).
  if ([...deletingNotices].some((id) => jobsConflict({ type: p.job.type, noticeId: id }, p.job))) return { accepted: false as const, code: 'JOB_ALREADY_RUNNING' as const, conflictJobId: '', active: registry.active() };
  const reg = registry.tryRegister(p.job);
  if (!reg.ok) return { accepted: false as const, code: 'JOB_ALREADY_RUNNING' as const, conflictJobId: reg.conflictJobId, active: registry.active() };
  setTimeout(() => { void runJob(p); }, 0);
  return { accepted: true as const, active: registry.active() };
}, 'offscreen');
// 확장 페이지 발신 정책 검증은 SW 릴레이(router.ts)에서 한다. SW를 거치지 않은 직접 발신은 bus.listen이 'offscreen' target에서 거부한다.
// 나라장터 연동 실패 보고: 기록은 SW가 한다. 응답을 기다리지 않고 실패는 삼킨다.
const reportG2bFailure = (f: G2bFailureInput): void => { void send('diag/g2b-failure', { failures: [f] }, { target: 'sw', timeoutMs: 5_000 }).catch(() => undefined); };
listen('eval/save', (p) => saveEval(fileStore, p, { onFailure: reportG2bFailure }), 'offscreen');
listen('eval/list', async () => (await new EvalStore(fileStore).loadIndex()).entries, 'offscreen');
listen('eval/get', ({ noticeId }) => new EvalStore(fileStore).get(noticeId), 'offscreen');
listen('eval/get-many', ({ noticeIds }) => new EvalStore(fileStore).getMany(noticeIds), 'offscreen');
listen('eval/delete', async ({ noticeId }) => ({ removed: await new EvalStore(fileStore).remove(noticeId) }), 'offscreen');
let resultRun: Promise<ResultRunSummary> | null = null;
listen('result/run', ({ mode, serviceKey, bizNo }) => {
  // 단일 실행. 실행 중이면 BUSY로 돌려보낸다(SW가 2분 뒤 재시도).
  if (resultRun) return { ran: false, checked: 0, updated: 0, won: 0, skipped: 'BUSY' as const, nextFollowCheckAt: null, events: [] };
  resultRun = runResultRefresh({
    store: fileStore, fetch: (...a) => fetch(...a), serviceKey, bizNo,
    checkPermission: async () => { const st = await fileStore.status(); return st.hasRoot && st.permission === 'granted'; },
    onFailure: reportG2bFailure,
  }, { mode }).then((r) => {
    // 응답이 타임아웃으로 SW에 못 가도 알림과 알람은 이 메시지로 전달된다.
    void send('result/done', { events: r.events, nextFollowCheckAt: r.nextFollowCheckAt, ...(r.skipped ? { skipped: r.skipped } : {}) }, { target: 'sw' }).catch(() => undefined);
    return r;
  }).finally(() => { resultRun = null; });
  return resultRun;
}, 'offscreen');
listen('follow/set', async (p) => {
  const r = await setFollow(fileStore, p);
  void send('result/done', { events: [], nextFollowCheckAt: r.nextFollowCheckAt }, { target: 'sw' }).catch(() => undefined);
  return r;
}, 'offscreen');
listen('result/probe', ({ noticeNo, serviceKey }) => probeResult(noticeNo, serviceKey ?? '', undefined, reportG2bFailure), 'offscreen');
listen('notice/list', () => listNotices(fileStore), 'offscreen');
listen('deadline/plan', async () => buildPlan(await listNotices(fileStore), Date.now()), 'offscreen');
listen('notice/get', ({ noticeId }) => getNotice(fileStore, noticeId), 'offscreen');
// 삭제 중인 공고도 바쁨으로 본다(AI 실행·편집·메일 준비가 지워지는 폴더에 쓰지 않도록). 삭제 루틴 자신은 이 함수를 쓰지 않는다.
const isNoticeBusy = (noticeId: string) => deletingNotices.has(noticeId) || registry.findConflict({ type: 'extract', noticeId }) !== undefined;
listen('extraction/edit', (p) => editExtraction(fileStore, p, { isBusy: isNoticeBusy }), 'offscreen');
listen('notice/field-edit', (p) => editNoticeField(fileStore, p, { isBusy: isNoticeBusy }), 'offscreen');
listen('extraction/text', (p) => readExtractionText(fileStore, p), 'offscreen');

// RFP 요구사항 비교. 파일 쓰기는 이 서비스만 한다(단일 작성자).
const rfp = createRfpService({ store: fileStore, parsers });
listen('rfp/docs', ({ noticeId }) => rfp.listDocs(noticeId), 'offscreen');
listen('rfp/extract', ({ ref, force }) => rfp.extract(ref, force), 'offscreen');
listen('rfp/upload', (p) => rfp.upload(p), 'offscreen');
listen('rfp/uploads', () => rfp.uploads(), 'offscreen');
listen('rfp/upload-rename', ({ uploadId, label }) => rfp.renameUpload(uploadId, label), 'offscreen');
listen('rfp/upload-delete', async ({ uploadId }) => { await rfp.deleteUpload(uploadId); }, 'offscreen');
listen('rfp/text', ({ ref }) => rfp.text(ref), 'offscreen');
listen('rfp/compare-save', ({ session }) => rfp.saveCompare(session), 'offscreen');
listen('rfp/compare-list', () => rfp.listCompares(), 'offscreen');
listen('rfp/compare-get', ({ compareId }) => rfp.getCompare(compareId), 'offscreen');
listen('rfp/compare-delete', async ({ compareId }) => { await rfp.deleteCompare(compareId); }, 'offscreen');

// AI 재검토. 실행 조율은 AiRunner가 한다(공고당 1개, 상태 push, 취소, 고아 정리). 키는 SW가 ai/exec·ai/models로 주입하며 저장하지 않는다.
const aiDeps = async () => ({ rules: await loadExtractionRules(), isBusy: isNoticeBusy });
const aiRunner = new AiRunner({
  store: fileStore, fetch: (...a) => fetch(...a), apiDeps: aiDeps,
  pushStatus: (s) => { void send('ai/status', s, { target: 'sw' }).catch(() => undefined); },
});
listen('ai/exec', async (p) => ({ runId: (await aiRunner.exec(p)).runId }), 'offscreen');
listen('ai/compare-exec', async (p) => { const r = await aiRunner.execCompare(p); return { compareId: r.compareId, runId: r.runId }; }, 'offscreen');
listen('ai/prepare', async (p) => {
  const prepared = await aiRunner.prepare({ noticeId: p.noticeId, scope: p.scope, keys: p.keys, provider: p.provider as NonNullable<typeof p.provider>, files: p.files });
  return { runId: prepared.run.id, text: prepared.built.manualText, webUrl: prepared.adapter.webUrl, stats: prepared.stats };
}, 'offscreen');
listen('ai/submit', async (p) => {
  await finishRun(fileStore, { noticeId: p.noticeId, runId: p.runId, responseText: p.text }, await aiDeps());
  return (await getReview(fileStore, p.noticeId)) as NonNullable<Awaited<ReturnType<typeof getReview>>>;
}, 'offscreen');
listen('ai/get', ({ noticeId }) => aiRunner.get(noticeId), 'offscreen');
listen('ai/prompt-get', (p) => getPrompt(fileStore, p), 'offscreen');
listen('ai/apply', async (p) => applySuggestion(fileStore, p, await aiDeps()), 'offscreen');
listen('ai/dismiss', async (p) => dismissSuggestion(fileStore, p, await aiDeps()), 'offscreen');
listen('ai/cancel', (p) => aiRunner.cancel(p), 'offscreen');
const aiBatch = new AiBatch({
  runner: aiRunner, getReview: (noticeId) => getReview(fileStore, noticeId),
  pushStatus: (s) => { void send('ai/batch-status', s, { target: 'sw' }).catch(() => undefined); },
});
listen('ai/batch-exec', (p) => ({ batchId: aiBatch.start(p).batchId }), 'offscreen');
listen('ai/batch-get', () => aiBatch.current(), 'offscreen');
listen('ai/batch-cancel', ({ batchId }) => aiBatch.cancel(batchId), 'offscreen');
listen('ai/models', ({ provider, apiKey }) => listModels(provider, apiKey, (...a) => fetch(...a)), 'offscreen');
listen('performances/list', () => listPerformances(fileStore), 'offscreen');
listen('performances/save', ({ performance }) => savePerformance(fileStore, performance), 'offscreen');
listen('performances/delete', ({ id }) => deletePerformance(fileStore, id), 'offscreen');
listen('performances/import', ({ plan }) => importPerformances(fileStore, plan), 'offscreen');
listen('recipients/list', () => listRecipients(fileStore), 'offscreen');
listen('recipients/save', ({ recipient }) => saveRecipient(fileStore, recipient), 'offscreen');
listen('recipients/import', ({ plan }) => importRecipients(fileStore, plan), 'offscreen');
listen('recipients/delete', ({ id }) => deleteRecipient(fileStore, id), 'offscreen');
listen('groups/save', ({ group }) => saveGroup(fileStore, group), 'offscreen');
listen('groups/delete', ({ id }) => deleteGroup(fileStore, id), 'offscreen');
listen('groups/set-default', ({ id }) => setDefaultGroup(fileStore, id), 'offscreen');
listen('templates/list', () => listTemplates(fileStore), 'offscreen');
listen('templates/save', ({ template }) => saveTemplate(fileStore, template), 'offscreen');
listen('templates/delete', ({ id }) => deleteTemplate(fileStore, id), 'offscreen');
listen('templates/set-default', ({ id }) => setDefaultTemplate(fileStore, id), 'offscreen');
listen('mail/prepare', (p) => prepareMail(fileStore, p, { isBusy: isNoticeBusy }), 'offscreen');
listen('mail/draft-get', ({ noticeId }) => getDraft(fileStore, noticeId), 'offscreen');
listen('mail/edits-get', ({ noticeId }) => getEdits(fileStore, noticeId), 'offscreen');
const sentStore = new SentStore(fileStore, { isBusy: isNoticeBusy });
listen('mail/sent-list', async () => (await sentStore.loadIndex()).entries, 'offscreen');
listen('mail/sent-get', ({ noticeId }) => sentStore.list(noticeId), 'offscreen');
listen('mail/sent-add', (p) => sentStore.addManual(p, new Date()), 'offscreen');
listen('mail/sent-void', (p) => sentStore.voidRecord(p, new Date()), 'offscreen');
listen('mail/sent-view', (p) => sentStore.view(p), 'offscreen');
listen('notice/delete', async ({ noticeIds }) => {
  const r = await deleteNotices(noticeIds, {
    store: fileStore,
    isBusy: (id) => registry.findConflict({ type: 'extract', noticeId: id }) !== undefined
      || registry.findConflict({ type: 'compose', noticeId: id }) !== undefined
      || aiRunner.isRunning(id) || rfp.isNoticeBusy(id),
    deleteCompares: (id) => rfp.deleteComparesForNotice(id),
    mark: { begin: (id) => deletingNotices.add(id), end: (id) => deletingNotices.delete(id) },
  });
  if (r.nextFollowCheckAt !== undefined) void send('result/done', { events: [], nextFollowCheckAt: r.nextFollowCheckAt }, { target: 'sw' }).catch(() => undefined);
  return { deleted: r.deleted, failed: r.failed };
}, 'offscreen');
listen('mail/sent-record', async ({ kind, confirmation, ...p }) => {
  if (kind === 'confirm') {
    if (!confirmation) return { recorded: false };
    await sentStore.confirmAuto({ ...p, confirmation });
    return { recorded: false };
  }
  return { recorded: (await sentStore.recordAuto({ ...p, kind }, new Date())).record !== null };
}, 'offscreen');
listen('config/repair', ({ file }) => repairConfig(fileStore, file), 'offscreen');
listen('job/abort', ({ jobId }) => ({ known: registry.abort(jobId) }), 'offscreen');
listen('job/status', ({ jobIds }) => ({ active: registry.active().filter((a) => !jobIds || jobIds.includes(a.jobId)) }), 'offscreen');

// 로드 완료 알림. SW는 이를 "레지스트리가 비었다"로 해석하지 않고 job/status로 질의한다.
void send('engine/ready', undefined, { target: 'sw' }).catch(() => undefined);
