import { parseHtmlField } from '../../adapters/g2b/html-parse';
import { redactKey } from '../../adapters/g2b/openapi';
import { sourceFor } from '../../adapters/g2b/source';
import { kindOf } from '../../core/model/ids';
import { mergeFields, type MergeLayer } from '../../core/model/merge';
import { emptyNotice, setFields, type FieldMap } from '../../core/model/notice-fields';
import type { FieldValue } from '../../core/types/common';
import type { RuleSet } from '../../core/extraction/rules/schema';
import type { Extraction } from '../../core/types/extraction';
import type { CollectResult, HtmlFields, Job, JobError, JobProgress, JobStatus, StepId } from '../../core/types/job';
import type { Attachment, Notice } from '../../core/types/notice';
import type { Settings } from '../../core/types/settings';
import { DownloadAbort, downloadAttachments } from '../downloader/downloader';
import type { IFileStore } from '../file-store/types';
import { conflictCountOf, reviewCountOf, runExtractStep } from '../extraction/extract-step';
import type { ParserRegistry } from '../parsers/types';
import { NoticeStore } from '../notices/notice-store';
import { matchAttachments } from './attachments';

export interface CollectJobInput {
  job: Job;
  html?: HtmlFields;
  secrets: { g2bServiceKey?: string };
  settings: Settings;
}

export interface CollectJobDeps {
  store: IFileStore;
  /** 쓰기 권한이 granted가 아니면 NEEDS_FS_PERMISSION을 던진다. */
  checkPermission(): Promise<void>;
  fetch: typeof fetch;
  emit(p: JobProgress): void;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** 잡 취소 신호 */
  signal?: AbortSignal;
  /** 중간 저장 디바운스(ms). 기본 500 */
  saveDebounceMs?: number;
  /** bytes 진행 emit 간격(ms). 기본 1000 */
  progressIntervalMs?: number;
  /** 평가정보 추출 의존성. 없으면 extract step은 건너뛴다. */
  extract?: { parsers: ParserRegistry; rules: RuleSet & { warnings?: string[] } };
  /** 상세화면 값 읽기(SW가 비활성 탭으로 수행). 없으면 fetch_html은 건너뛴다. 실패는 DETAIL_* code로 던진다. */
  readDetail?: (jobId: string) => Promise<HtmlFields>;
}

export interface CollectOutcome { status: JobStatus; result?: CollectResult; error?: JobError }

const fmtMB = (n: number): string => `${(n / 1048576).toFixed(1)}MB`;

const FAILED_ATT = (a: Attachment) => a.status === 'failed' || a.status === 'size_mismatch';

function resultOf(n: Notice): CollectResult {
  return {
    noticeId: n.id,
    folder: n.folder,
    title: typeof n.basic.title.value === 'string' ? n.basic.title.value : undefined,
    attachments: n.attachments.map((a) => ({ name: a.originalName, savedName: a.savedName, status: a.status, size: a.savedSize, error: a.lastError })),
    mailStatus: n.mail.status,
  };
}

function htmlLayer(html: HtmlFields): FieldMap {
  const out: FieldMap = {};
  for (const [key, f] of Object.entries(html.fields)) {
    if (!f || f.raw.trim() === '') continue;
    out[key as keyof FieldMap] = parseHtmlField(key as keyof FieldMap, f.raw, f.ref, html.capturedAt);
  }
  return out;
}

const toError = (e: unknown, step: StepId, key?: string): JobError => {
  const code = (e as { code?: unknown })?.code;
  const c = typeof code === 'string' ? code : 'COLLECT_ERROR';
  return { code: c, message: redactKey(e instanceof Error ? e.message : String(e), key), step, retryable: c !== 'DISK_FULL' && c !== 'KIND_UNSUPPORTED' };
};

/** 디바운스 저장. flush는 대기 중 저장과 진행 중 저장을 모두 끝낸다. */
export function createDebouncedSaver(save: () => Promise<void>, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inflight: Promise<void> = Promise.resolve();
  const run = () => {
    timer = undefined;
    inflight = inflight.catch(() => undefined).then(save);
    inflight.catch(() => undefined);
  };
  return {
    schedule() {
      if (timer === undefined) timer = setTimeout(run, ms);
    },
    async flush() {
      if (timer !== undefined) {
        clearTimeout(timer);
        run();
      }
      await inflight;
    },
  };
}

export async function runCollectJob(input: CollectJobInput, deps: CollectJobDeps): Promise<CollectOutcome> {
  const { job, settings } = input;
  let html = input.html;
  let detailError: JobError | undefined;
  const key = input.secrets.g2bServiceKey;
  const now = deps.now ?? (() => new Date());
  const ns = new NoticeStore(deps.store);
  const isDone = (id: StepId) => job.steps.find((s) => s.id === id)?.status === 'done';
  const step = (id: StepId, status: JobProgress['status'], label: string, progress?: JobProgress['progress']) =>
    deps.emit({ jobId: job.id, attempt: job.attempt, step: id, status, label, progress });
  const cancelled = (n?: Notice | null): CollectOutcome => ({ status: 'cancelled', result: n ? resultOf(n) : undefined });

  let notice: Notice | null = null;
  let current: StepId = 'fetch_basic';
  try {
    if (deps.signal?.aborted) return cancelled();
    await deps.checkPermission();
    await ns.ensureConfigDir();
    const ref = job.ref;
    if (!ref) return { status: 'failed', error: { code: 'COLLECT_NO_REF', message: '공고 참조가 없습니다.', retryable: false } };

    const src = sourceFor(kindOf(ref));

    // 상세화면 값 확보. 취소되면 true를 반환한다. 실패는 detailError로 남기고 계속한다(partial).
    const acquireHtml = async (): Promise<boolean> => {
      if (html) { step('fetch_html', 'done', '화면값 전달됨'); return false; }
      if (!src.acceptsHtml || !deps.readDetail) {
        step('fetch_html', 'skipped', !src.acceptsHtml ? '상세화면 대상 아님' : '상세화면 읽기 건너뜀');
        return false;
      }
      step('fetch_html', 'running', '상세화면 읽는 중');
      try {
        html = await deps.readDetail(job.id);
        step('fetch_html', 'done', '상세화면 읽기 완료');
      } catch (e) {
        const c = (e as { code?: unknown })?.code;
        const code = typeof c === 'string' && c.startsWith('DETAIL_') ? c : 'DETAIL_READ_FAILED';
        if (code === 'DETAIL_CANCELLED' || deps.signal?.aborted) return true;
        const message = redactKey(e instanceof Error ? e.message : String(e), key);
        detailError = { code, message, step: 'fetch_html', retryable: true };
        step('fetch_html', 'failed', message);
      }
      return false;
    };

    // ---- fetch_basic ----
    if (isDone('fetch_basic') && job.noticeId) {
      notice = await ns.loadNotice(job.noticeId);
      if (notice && !isDone('fetch_html') && (await acquireHtml())) return cancelled(notice);
      // 재시도 요청에 html이 있으면 불러온 notice에 병합한다.
      if (notice && html && src.acceptsHtml) {
        setFields(notice, mergeFields(notice, [{ kinds: ['html'], fields: htmlLayer(html) }]));
        await ns.saveNotice(notice);
      }
    }
    if (!notice) {
      step('fetch_basic', 'running', '공고정보 조회 중');
      const r = await src.fetch(ref, { serviceKey: key, fetch: deps.fetch, signal: deps.signal });
      if (!r.ok && r.error.code === 'JOB_CANCELLED') return cancelled();
      if (!r.ok) {
        step('fetch_basic', 'failed', '공고정보 조회 실패');
        return { status: 'failed', error: r.error };
      }
      if (await acquireHtml()) return cancelled();
      const { item, operation, fetchedAt } = r;
      const id = src.idOf(ref, item);
      const existing = await ns.loadNotice(id);
      const fields = src.mapFields(item, fetchedAt);
      // API와 화면값을 한 번에 병합한다(두 단계로 나누면 화면 전용 필드가 매번 needs_review로 떨어진다).
      const layers: MergeLayer[] = [{ kinds: ['api', 'derived'], fields }];
      if (html && src.acceptsHtml) layers.push({ kinds: ['html'], fields: htmlLayer(html) });
      const merged = mergeFields(existing, layers);
      const title = typeof merged.title?.value === 'string' ? merged.title.value : '';
      const postedAt = typeof merged.postedAt?.value === 'string' ? merged.postedAt.value : null;
      const folder = existing?.folder ?? (await ns.resolveFolder(id, title, postedAt, now().toISOString()));
      notice = existing ?? emptyNotice(id, src.refOf(ref, item), folder, now().toISOString());
      setFields(notice, merged);
      notice.sourceUrl = src.sourceUrl(item, ref, fetchedAt);
      notice.isCorrection = src.isCorrection(item);
      notice.attachments = matchAttachments(notice.attachments, src.attachments(item), id);
      notice.collect = { status: 'partial', collectedAt: now().toISOString(), lastJobId: job.id, errors: [] };
      notice.updatedAt = now().toISOString();
      await ns.saveNotice(notice, { operation, item });
    }
    step('fetch_basic', 'done', '공고정보 조회 완료');
    if (deps.signal?.aborted) return cancelled(notice);

    // ---- download_attachments ----
    current = 'download_attachments';
    let failedAtts: Attachment[] = [];
    if (!isDone('download_attachments')) {
      const total = notice.attachments.length;
      step('download_attachments', 'running', `첨부파일 다운로드 중 (0/${total})`, { done: 0, total });
      // bytes 진행: 잡당 trailing throttle. 파일 완료(done)는 즉시 보내고 대기 중 bytes는 버린다.
      const interval = deps.progressIntervalMs ?? 1000;
      let pendingBytes: JobProgress | null = null;
      let bytesTimer: ReturnType<typeof setTimeout> | undefined;
      let lastDone = 0;
      const dropBytes = () => { clearTimeout(bytesTimer); bytesTimer = undefined; pendingBytes = null; };
      const saver = createDebouncedSaver(() => ns.saveNotice(notice!), deps.saveDebounceMs ?? 500);
      try {
        notice.attachments = await downloadAttachments(notice.attachments, {
          store: deps.store,
          folder: notice.folder,
          settings: settings.download,
          fetch: deps.fetch,
          sleep: deps.sleep,
          now,
          signal: deps.signal,
          keepSkipped: job.attempt > 1,
          onEvent: (e) => {
            if (e.type === 'done') {
              dropBytes();
              lastDone = e.done;
              step('download_attachments', 'running', `첨부파일 다운로드 중 (${e.done}/${e.totalFiles})`, { done: e.done, total: e.totalFiles });
              return;
            }
            const name = notice!.attachments.find((x) => x.id === e.attachmentId)?.originalName;
            const received = e.bytes ?? 0;
            const sizes = `${fmtMB(received)}${e.total ? `/${fmtMB(e.total)}` : ''}`;
            pendingBytes = {
              jobId: job.id, attempt: job.attempt, step: 'download_attachments', status: 'running',
              progress: { done: lastDone, total: e.totalFiles },
              bytes: { received, total: e.total ?? null, name },
              label: `첨부파일 다운로드 중 (${lastDone}/${e.totalFiles})${name ? `, ${name} ${sizes}` : ''}`,
            };
            bytesTimer ??= setTimeout(() => {
              bytesTimer = undefined;
              if (pendingBytes) deps.emit(pendingBytes);
              pendingBytes = null;
            }, interval);
          },
          // 첨부가 하나 끝날 때마다 notice.json을 디바운스 저장한다.
          onUpdate: (atts) => {
            notice!.attachments = atts.map((x) => ({ ...x }));
            saver.schedule();
          },
        });
        dropBytes();
        await saver.flush();
      } catch (e) {
        dropBytes();
        if (e instanceof DownloadAbort) {
          notice.attachments = e.attachments;
          await saver.flush().catch(() => undefined);
          const err = toError(e, 'download_attachments', key);
          if (e.code === 'JOB_CANCELLED') {
            notice.collect.errors = [];
            await ns.saveNotice(notice);
            step('download_attachments', 'failed', '취소됨');
            return { status: 'cancelled', result: resultOf(notice), error: err };
          }
          notice.collect.errors = [err];
          await ns.saveNotice(notice);
          step('download_attachments', 'failed', err.message);
          return { status: 'failed', result: resultOf(notice), error: err };
        }
        await saver.flush().catch(() => undefined);
        throw e;
      }
      failedAtts = notice.attachments.filter(FAILED_ATT);
      step('download_attachments', failedAtts.length ? 'failed' : 'done', failedAtts.length ? `첨부 ${failedAtts.length}건 실패` : '첨부파일 다운로드 완료', { done: total - failedAtts.length, total });
    } else {
      failedAtts = notice.attachments.filter(FAILED_ATT);
    }

    // ---- extract(선택) ----
    current = 'extract';
    if (deps.signal?.aborted) return cancelled(notice);
    let extraction: Extraction | null = null;
    let extractError: JobError | undefined;
    if (!deps.extract || !src.extract) {
      step('extract', 'skipped', !src.extract ? '평가정보 추출 대상 아님' : '평가정보 추출 건너뜀');
    } else if (isDone('extract') && isDone('download_attachments')) {
      extraction = await ns.loadExtraction(notice.id);
    } else {
      try {
        const prior = await ns.loadExtraction(notice.id);
        const out = await runExtractStep(job, notice, prior, {
          store: deps.store, parsers: deps.extract.parsers, rules: deps.extract.rules, emit: deps.emit, signal: deps.signal, now,
          settings: settings.extraction, readFile: (p) => deps.store.readBytes(p),
        });
        if (out.status === 'cancelled') {
          notice.collect.errors = [];
          await ns.saveNotice(notice);
          step('extract', 'failed', '취소됨');
          return { status: 'cancelled', result: resultOf(notice) };
        }
        if (out.status === 'failed') extractError = out.error;
        else {
          extraction = out.extraction!;
          extraction = await ns.saveExtractionLatest(notice, extraction);
        }
      } catch (e) {
        const err = toError(e, 'extract', key);
        extractError = { ...err, code: 'EXTRACT_FAILED', retryable: true };
        step('extract', 'failed', err.message);
      }
    }

    // ---- 저장 ----
    if (deps.signal?.aborted) return cancelled(notice);
    notice.collect = {
      status: failedAtts.length || extractError || detailError ? 'partial' : 'collected',
      collectedAt: now().toISOString(),
      lastJobId: job.id,
      errors: failedAtts.map((a): JobError => ({
        code: a.status === 'size_mismatch' ? 'ATTACH_SIZE_MISMATCH' : 'ATTACH_FAILED',
        message: `${a.originalName}: ${a.lastError ?? '실패'}`, step: 'download_attachments', retryable: true,
      })).concat(extractError ? [extractError] : [], detailError ? [detailError] : []),
    };
    notice.updatedAt = now().toISOString();
    await ns.saveNotice(notice);
    const result = resultOf(notice);
    if (extraction) result.extraction = { status: extraction.status, reviewCount: reviewCountOf(extraction), conflictCount: conflictCountOf(extraction) };
    return { status: failedAtts.length || extractError || detailError ? 'partial' : 'completed', result, error: extractError ?? detailError };
  } catch (e) {
    const err = toError(e, current, key);
    step(current, 'failed', err.message);
    return { status: 'failed', result: notice ? resultOf(notice) : undefined, error: err };
  }
}
