import type { RuleSet } from '../../core/extraction/rules/schema';
import type { ExtractResult, Job, JobError, JobProgress, JobStatus } from '../../core/types/job';
import type { Settings } from '../../core/types/settings';
import { runExtractStep } from '../extraction/extract-step';
import type { IFileStore } from '../file-store/types';
import { NoticeStore } from '../notices/notice-store';
import type { ParserRegistry } from '../parsers/types';

export interface ExtractJobInput { job: Job; settings: Settings }
export interface ExtractJobDeps {
  store: IFileStore;
  checkPermission(): Promise<void>;
  parsers: ParserRegistry;
  rules: RuleSet & { warnings?: string[] };
  emit(p: JobProgress): void;
  signal?: AbortSignal;
  now?: () => Date;
}
export interface ExtractOutcome { status: JobStatus; result?: ExtractResult; error?: JobError }

const fail = (code: string, message: string, retryable = false): ExtractOutcome => ({ status: 'failed', error: { code, message, step: 'extract', retryable } });

/** 단독 추출 잡: notice.json과 이전 extraction을 읽고 → 추출 → 저장. */
export async function runExtractJob(input: ExtractJobInput, deps: ExtractJobDeps): Promise<ExtractOutcome> {
  const { job, settings } = input;
  const ns = new NoticeStore(deps.store);
  try {
    if (deps.signal?.aborted) return { status: 'cancelled' };
    await deps.checkPermission();
    if (!job.noticeId) return fail('EXTRACT_NO_NOTICE', '공고 ID가 없습니다.');
    const notice = await ns.loadNotice(job.noticeId);
    if (!notice) return fail('EXTRACT_NO_NOTICE', '수집된 공고를 찾을 수 없습니다.');
    const prior = await ns.loadExtraction(notice.id);
    const out = await runExtractStep(job, notice, prior, {
      store: deps.store, parsers: deps.parsers, rules: deps.rules, emit: deps.emit, signal: deps.signal, now: deps.now,
      settings: settings.extraction, readFile: (p) => deps.store.readBytes(p),
    });
    if (out.status === 'cancelled') {
      await ns.saveNoticeLatest(notice); // docKind 등 이미 반영된 변경 보존
      return { status: 'cancelled' };
    }
    if (out.status === 'failed') return { status: 'failed', error: out.error };
    const saved = await ns.saveExtractionLatest(notice, out.extraction!);
    return { status: 'completed', result: { noticeId: notice.id, folder: notice.folder, extraction: saved } };
  } catch (e) {
    const code = (e as { code?: unknown })?.code;
    const err: JobError = { code: typeof code === 'string' ? code : 'EXTRACT_FAILED', message: e instanceof Error ? e.message : String(e), step: 'extract', retryable: code !== 'DISK_FULL' };
    deps.emit({ jobId: job.id, attempt: job.attempt, step: 'extract', status: 'failed', label: err.message });
    return { status: 'failed', error: err };
  }
}
