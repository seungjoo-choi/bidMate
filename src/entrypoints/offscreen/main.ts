import { fetchNotice, redactKey } from '../../adapters/g2b/openapi';
import { fetchPrespec, mapPrespecItem } from '../../adapters/g2b/prespec-api';
import { loadRules } from '../../core/extraction/rules/load';
import { SELECTOR_SETS } from '../../adapters/naverworks/selectors';
import { runCollectJob } from '../../engine/jobs/collect-job';
import type { JobError, JobStatus } from '../../core/types/job';
import { runComposeJob } from '../../engine/jobs/compose-job';
import { runExtractJob } from '../../engine/jobs/extract-job';
import { createParserRegistry } from '../../engine/parsers/registry';
import { editExtraction, getNotice, listNotices, readExtractionText } from '../../engine/notices/notice-api';
import { repairConfig } from '../../engine/config/config-store';
import { deleteGroup, deleteRecipient, importRecipients, listRecipients, saveGroup, saveRecipient, setDefaultGroup } from '../../engine/config/recipients-api';
import { deleteTemplate, listTemplates, saveTemplate, setDefaultTemplate } from '../../engine/config/templates-api';
import { getDraft, getEdits, prepareMail, setMailStatus } from '../../engine/mail/prepare';
import { JobRegistry } from '../../engine/jobs/job-registry';
import { listen, send } from '../../messaging/bus';
import { fileStore } from '../../engine/file-store/file-store';
import { lookupInIndex } from '../../engine/notices/lookup';
import { NoticeStore } from '../../engine/notices/notice-store';
import type { NoticeKind } from '../../core/types/notice';
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
listen('job/run', (p) => {
  const reg = registry.tryRegister(p.job);
  if (!reg.ok) return { accepted: false as const, code: 'JOB_ALREADY_RUNNING' as const, conflictJobId: reg.conflictJobId, active: registry.active() };
  setTimeout(() => { void runJob(p); }, 0);
  return { accepted: true as const, active: registry.active() };
}, 'offscreen');
// 확장 페이지 발신 정책 검증은 SW 릴레이(router.ts)에서 한다. SW를 거치지 않은 직접 발신은 bus.listen이 'offscreen' target에서 거부한다.
listen('notice/list', () => listNotices(fileStore), 'offscreen');
listen('notice/get', ({ noticeId }) => getNotice(fileStore, noticeId), 'offscreen');
listen('extraction/edit', (p) => editExtraction(fileStore, p, { isBusy: (noticeId) => registry.findConflict({ type: 'extract', noticeId }) !== undefined }), 'offscreen');
listen('extraction/text', (p) => readExtractionText(fileStore, p), 'offscreen');
const isNoticeBusy = (noticeId: string) => registry.findConflict({ type: 'extract', noticeId }) !== undefined;
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
listen('mail/set-status', (p) => setMailStatus(fileStore, p, { isBusy: isNoticeBusy }), 'offscreen');
listen('config/repair', ({ file }) => repairConfig(fileStore, file), 'offscreen');
listen('job/abort', ({ jobId }) => ({ known: registry.abort(jobId) }), 'offscreen');
listen('job/status', ({ jobIds }) => ({ active: registry.active().filter((a) => !jobIds || jobIds.includes(a.jobId)) }), 'offscreen');

// 로드 완료 알림. SW는 이를 "레지스트리가 비었다"로 해석하지 않고 job/status로 질의한다.
void send('engine/ready', undefined, { target: 'sw' }).catch(() => undefined);
