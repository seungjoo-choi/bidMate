import type { ComposeSelectorSet, ComposeState } from '../../adapters/naverworks/types';
import type { AttachResult, ComposeRecord, FieldResult } from '../../core/types/compose';
import type { ComposeResult, Job, JobError, JobProgress, JobStatus, StepId } from '../../core/types/job';
import type { MailDraft } from '../../core/types/mail';
import type { Settings } from '../../core/types/settings';
import type { ComposeDetect, MsgType, PayloadOf, ResponseOf } from '../../messaging/protocol';
import type { IFileStore } from '../file-store/types';
import { chunkBlob } from '../mail/chunker';
import { draftToComposeFill, prepareMail } from '../mail/prepare';
import { selectAttachTargets } from '../mail/attach-limits';
import { planCompose } from '../mail/compose-plan';
import { appendComposeRecord, markComposed } from '../mail/record';

export interface ComposeJobDeps {
  store: IFileStore; checkPermission(): Promise<void>; emit(p: JobProgress): void; signal: AbortSignal;
  call: <T extends MsgType>(type: T, payload: PayloadOf<T>, timeoutMs: number) => Promise<ResponseOf<T>>;
  selectorSets: Record<string, ComposeSelectorSet>; now?: () => Date; sleep?: (ms: number) => Promise<void>;
  detectTimeoutMs?: number; attachPollMs?: number;
}
export interface ComposeJobOutcome { status: JobStatus; result?: ComposeResult; error?: JobError }

const MB = 1024 * 1024;
const T = { open: 60_000, detect: 10_000, fill: 90_000, attachBegin: 15_000, chunk: 30_000, end: 15_000, status: 10_000, verify: 15_000, short: 5_000 };
const ATTACH_MIN_TIMEOUT_MS = 60_000;
const ATTACH_BYTES_PER_SEC = 100 * 1024;

class Aborted extends Error { constructor() { super('aborted'); } }
const errCode = (e: unknown): string | undefined => { const c = (e as { code?: unknown } | null)?.code; return typeof c === 'string' ? c : undefined; };
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const FIELDS: FieldResult['field'][] = ['to', 'cc', 'subject', 'body'];

function requestedOf(field: FieldResult['field'], fill: { to: string[]; cc: string[]; subject: string; html: string }): string[] | string {
  return field === 'to' ? fill.to : field === 'cc' ? fill.cc : field === 'subject' ? fill.subject : fill.html;
}
function fieldsWith(fill: { to: string[]; cc: string[]; subject: string; html: string }, status: FieldResult['status'], error: string): FieldResult[] {
  return FIELDS.map((field) => ({ field, requested: requestedOf(field, fill), rendered: null, status, method: 'none', error }));
}
/** Job.result에는 html/본문 전문을 넣지 않는다. */
const slim = (f: FieldResult): FieldResult => (f.field !== 'body' ? f : { ...f, requested: '', rendered: null });
const norm = (xs: string[]) => new Set(xs.map((s) => s.trim().toLowerCase()).filter(Boolean));
const squash = (s: string) => s.replace(/\s+/g, ' ');
const sameSet =(a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));

/** 본문 텍스트의 첫 섹션 제목 줄("1. ...")에서 번호를 뗀 라벨. 없으면 undefined. */
function firstSectionLabel(draft: MailDraft): string | undefined {
  const line = draft.text.split('\n').map((l) => l.trim()).find((l) => /^1\.\s/.test(l));
  return line?.replace(/^1\.\s+/, '');
}

/** readState 결과로 필드 판정을 다시 한다. 이미 unsupported/failed인 필드는 유지한다. */
function reverify(fields: FieldResult[], state: ComposeState, draft: MailDraft, fill: { html: string }, title: string | null): FieldResult[] {
  const label = firstSectionLabel(draft);
  return fields.map((f) => {
    if (f.status === 'unsupported' || f.status === 'failed') return f;
    if (f.error === 'KEEP_LOST') return f;   // 서명 유실은 화면 대조로 덮지 않는다
    if (state.supported[f.field] === false) return f;   // 대조할 셀렉터가 없으면 현 상태 유지
    if (f.field === 'to' || f.field === 'cc') {
      const want = norm(f.requested as string[]);
      const got = state[f.field];
      return { ...f, rendered: got, status: sameSet(want, norm(got)) ? 'ok' : 'mismatch' };
    }
    if (f.field === 'subject') {
      return { ...f, rendered: state.subject, status: state.subject.trim() === (f.requested as string).trim() ? 'ok' : 'mismatch' };
    }
    // innerText는 연속 공백을 하나로 줄이므로 양쪽 공백을 정규화해 비교한다.
    const body = squash(state.bodyText);
    const okText = (!title || body.includes(squash(title))) && (label === undefined || body.includes(squash(label)));
    // 주소로 넣은 본문은 서식이 없어 html 길이 대신 평문 길이로 비교한다.
    // textContent는 줄바꿈을 잃으므로 공백을 모두 뺀 길이끼리 비교한다.
    const okLen = f.method === 'url'
      ? state.bodyText.replace(/\s+/g, '').length >= draft.text.replace(/\s+/g, '').length * 0.8
      : state.bodyHtml.length >= fill.html.length * 0.5;
    return { ...f, rendered: state.bodyText, status: okText && okLen ? 'ok' : 'mismatch' };
  });
}

export async function runComposeJob(input: { job: Job; settings: Settings }, deps: ComposeJobDeps): Promise<ComposeJobOutcome> {
  const { job, settings } = input;
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const attachPollMs = deps.attachPollMs ?? 1500;
  const { signal } = deps;

  let cur: StepId = 'render_mail';
  let opened = false;
  const emit = (step: StepId, status: JobProgress['status'], label: string, extra: Pick<JobProgress, 'progress' | 'bytes'> = {}) => {
    cur = step;
    deps.emit({ jobId: job.id, attempt: job.attempt, step, status, label, ...extra });
  };
  const check = () => { if (signal.aborted) throw new Aborted(); };
  const abortP = new Promise<never>((_, rej) => { signal.addEventListener('abort', () => rej(new Aborted()), { once: true }); });
  abortP.catch(() => undefined);
  const rpc = async <K extends MsgType>(type: K, payload: PayloadOf<K>, ms: number): Promise<ResponseOf<K>> => {
    check();
    const r = await Promise.race([deps.call(type, payload, ms), abortP]);
    check();
    return r as ResponseOf<K>;
  };
  const wait = async (ms: number) => { check(); await Promise.race([sleep(ms), abortP]); check(); };

  try {
    check();
    // 1. render_mail
    emit('render_mail', 'running', '메일 초안을 만드는 중');
    await deps.checkPermission();
    check();
    const params = job.params ?? {};
    const prepared = await prepareMail(deps.store, { noticeId: job.noticeId ?? '', groupId: params.groupId, templateId: params.templateId, recipients: params.recipients });
    check();
    const { draft, notice } = prepared;
    const { fill, files } = draftToComposeFill(draft);
    emit('render_mail', 'done', '메일 초안 완료');

    // 2. 작성 계획(서비스별 주소, 셀렉터)
    const plan = planCompose(settings, draft, deps.selectorSets);
    const detectTimeoutMs = plan.detectTimeoutMs ?? deps.detectTimeoutMs ?? 120_000;
    const manual = !plan.selector;
    const isGmail = plan.provider === 'gmail';
    const attachDir = `${notice.folder}/attachments`;

    const finish = async (
      mode: ComposeResult['mode'], fields: FieldResult[], attachments: ComposeResult['attachments'], tabId: number | undefined,
    ): Promise<ComposeJobOutcome> => {
      const allOk = fields.every((f) => f.status === 'ok') && attachments.every((a) => a.status === 'uploaded');
      const allFailed = fields.every((f) => f.status === 'failed');
      const outcome: ComposeResult['outcome'] = allFailed ? 'failed' : allOk ? 'ready_for_review' : 'partial';
      const composedAt = now();
      const record: ComposeRecord = {
        id: `${job.id}-${job.attempt}`, jobId: job.id, noticeId: notice.id, composedAt: composedAt.toISOString(),
        templateId: draft.templateId, groupId: draft.groupId,
        snapshot: { to: fill.to, cc: fill.cc, subject: fill.subject, html: fill.html },
        fields, attachments, outcome, adapterId: plan.provider, selectorSetVersion: plan.selector?.set.version ?? 'none', webmailUrl: plan.url,
      };
      let recordId: string | undefined;
      try {
        await appendComposeRecord(deps.store, notice.folder, record);
        recordId = record.id;
        await markComposed(deps.store, notice.id, outcome, composedAt);
      } catch { /* 기록 실패는 결과를 바꾸지 않는다(탭은 이미 열려 있음) */ }
      check();
      try { await deps.call('compose/focus', { jobId: job.id }, T.short); } catch { /* 무시 */ }
      const result: ComposeResult = { noticeId: notice.id, folder: notice.folder, title: notice.basic.title.value ?? undefined, mode, provider: plan.provider, tabId, fields: fields.map(slim), attachments, outcome, recordId, attachDir };
      if (outcome === 'failed') {
        return { status: 'failed', result, error: { code: 'COMPOSE_FILL_FAILED', message: '입력에 모두 실패했습니다.', step: 'fill_fields', retryable: true } };
      }
      return { status: outcome === 'ready_for_review' ? 'completed' : 'partial', result };
    };

    // 3. open_compose
    emit('open_compose', 'running', '웹메일 작성 탭을 여는 중');
    const { tabId } = await rpc('compose/open', {
      jobId: job.id, url: plan.url, selector: plan.selector?.config,
      ...(plan.prefilled.includes('subject') ? { anchor: { subject: fill.subject } } : {}),
    }, T.open);
    opened = true;

    // 4. 셀렉터 없음(수동 또는 주소 방식)
    if (manual) {
      emit('open_compose', 'done', '작성 탭을 열었습니다');
      if (isGmail) {
        emit('fill_fields', 'skipped', '주소로 전달(받는 사람, 참조, 제목, 본문)');
        emit('attach_files', 'skipped', '첨부는 직접');
        emit('verify', 'skipped', '주소 방식은 확인 생략');
      } else if (plan.prefilled.length > 0) {
        emit('fill_fields', 'skipped', '주소로 전달(받는 사람, 참조, 제목), 본문은 붙여 넣기');
        emit('attach_files', 'skipped', '첨부는 직접');
        emit('verify', 'skipped', '주소 방식은 확인 생략');
      } else {
        for (const s of ['fill_fields', 'attach_files', 'verify'] as const) emit(s, 'skipped', '수동 모드: 셀렉터 미검증');
      }
      const fields = fieldsWith(fill, 'unsupported', 'SELECTOR_UNVERIFIED').map((f): FieldResult => {
        if (plan.prefilled.includes(f.field)) return { ...f, status: 'prefilled', method: 'url', error: undefined };
        if (plan.omitted.some((o) => o.field === f.field)) return { ...f, error: 'URL_TOO_LONG' };
        return f;
      });
      const attachError = isGmail || plan.prefilled.length > 0 ? 'ATTACH_MANUAL' : 'SELECTOR_UNVERIFIED';
      const attachments = files.map((f): ComposeResult['attachments'][number] => ({ fileId: f.fileId, name: f.name, size: f.size, status: 'skipped', method: 'none', elapsedMs: 0, error: attachError }));
      return await finish(plan.prefilled.length > 0 ? 'url' : 'manual', fields, attachments, tabId);
    }

    // 5. 감지
    let frameId: number | undefined;
    const failAfterOpen = async (error: JobError): Promise<ComposeJobOutcome> => {
      try {
        const out = await finish('auto', fieldsWith(fill, 'failed', error.code), [], tabId);
        return { status: 'failed', result: out.result, error };
      } catch (e) {
        if (e instanceof Aborted) throw e;
        return { status: 'failed', error };
      }
    };
    const detectStart = now().getTime();
    let lastReason: string | undefined;
    for (;;) {
      const waited = now().getTime() - detectStart;
      const left = Math.max(0, Math.ceil((detectTimeoutMs - waited) / 1000));
      emit('open_compose', 'running', `${plan.needsUserOpen ? '웹메일에서 [메일쓰기]를 눌러 주세요' : '작성 화면을 확인하는 중'} (남은 ${left}초)`);
      let frames: ComposeDetect[] = [];
      try {
        frames = (await rpc('compose/detect', { jobId: job.id }, T.detect)).frames;
      } catch (e) {
        if (e instanceof Aborted || errCode(e) === 'COMPOSE_TAB_CLOSED' || errCode(e) === 'SENDER_FORBIDDEN') throw e;
      }
      lastReason = frames.find((f) => f.reason === 'SCOPE_AMBIGUOUS')?.reason ?? frames.find((f) => f.reason)?.reason;
      const hit = frames.find((f) => f.isCompose && f.ready);
      if (hit) { frameId = hit.frameId; break; }
      if (now().getTime() - detectStart >= detectTimeoutMs) {
        const message = lastReason === 'SCOPE_AMBIGUOUS'
          ? '같은 제목의 작성 창이 여러 개라 하나로 특정하지 못했습니다. 다른 작성 창을 닫고 다시 시도하세요'
          : '작성 화면을 찾지 못했습니다.';
        const error: JobError = { code: 'COMPOSE_NOT_DETECTED', message, step: 'open_compose', retryable: true };
        emit('open_compose', 'failed', error.message);
        return await failAfterOpen(error);
      }
      await wait(1000);
    }
    await rpc('compose/bind', { jobId: job.id, frameId }, T.short);
    emit('open_compose', 'done', '작성 화면을 찾았습니다');

    // fill_fields: 주소로 전달된 필드는 prefilled, 생략된 필드는 unsupported로 시작한다.
    const initial = new Map<FieldResult['field'], FieldResult>();
    for (const field of FIELDS) {
      const base = { field, requested: requestedOf(field, fill), rendered: null } as const;
      if (plan.prefilled.includes(field)) initial.set(field, { ...base, status: 'prefilled', method: 'url' });
      else if (plan.omitted.some((o) => o.field === field)) initial.set(field, { ...base, status: 'unsupported', method: 'none', error: 'URL_TOO_LONG' });
    }
    if (plan.fillFields.length === 0) {
      emit('fill_fields', 'skipped', '주소로 전달됨, 확인 단계에서 대조');
    } else {
      emit('fill_fields', 'running', '수신자/제목/본문을 입력하는 중');
      try {
        const filled = await rpc('compose/fill', {
          jobId: job.id, ...fill, ...(plan.fillFields.length < FIELDS.length ? { fields: plan.fillFields } : {}),
        }, T.fill);
        for (const r of filled) initial.set(r.field, r);
      } catch (e) {
        if (e instanceof Aborted) throw e;
        const error: JobError = { code: errCode(e) ?? 'COMPOSE_FILL_FAILED', message: errMsg(e), step: 'fill_fields', retryable: true };
        emit('fill_fields', 'failed', error.message);
        return await failAfterOpen(error);
      }
      emit('fill_fields', 'done', '입력 완료');
    }
    let fields: FieldResult[] = FIELDS.flatMap((f) => initial.get(f) ?? []);

    // 6. attach_files
    const attachments: ComposeResult['attachments'] = [];
    const maxBytes = settings.download.maxFileMB * MB;
    // 셀렉터셋이 자동 첨부를 지원하지 않으면(첨부 목록 미실측) 파일을 보내지 않고 직접 첨부로 안내한다.
    const attachSupported = (plan.selector?.set.attach.methods.length ?? 0) > 0;
    const { targets, skipped } = attachSupported
      ? selectAttachTargets(files, maxBytes, plan.attachLimits)
      : { targets: [], skipped: files.map((file) => ({ file, error: 'ATTACH_MANUAL' })) };
    for (const { file: f, error } of skipped) {
      attachments.push({ fileId: f.fileId, name: f.name, size: f.size, status: 'skipped', method: 'none', elapsedMs: 0, error });
    }
    if (files.length > 0 && !attachSupported) emit('attach_files', 'skipped', '첨부는 직접');
    else emit('attach_files', files.length === 0 ? 'skipped' : 'running', files.length === 0 ? '첨부 없음' : '첨부 파일을 올리는 중', { progress: { done: 0, total: files.length } });
    if (targets.length > 0) {
      const pathOf = new Map(draft.attachments.map((a) => [a.attachmentId, a.path]));
      const failedResult = (f: (typeof targets)[number], error: string, started = now().getTime()): ComposeResult['attachments'][number] => ({
        fileId: f.fileId, name: f.name, size: f.size, status: 'failed', method: 'none', elapsedMs: now().getTime() - started, error,
      });
      let begin: ResponseOf<'compose/attach-begin'> | undefined;
      try {
        begin = await rpc('compose/attach-begin', { jobId: job.id, files: targets }, T.attachBegin);
      } catch (e) {
        if (e instanceof Aborted) throw e;
        for (const f of targets) attachments.push(failedResult(f, errCode(e) ?? errMsg(e)));
      }
      if (begin) {
        for (const r of begin.rejected) {
          const f = targets.find((x) => x.fileId === r.fileId);
          if (f) attachments.push(failedResult(f, r.reason));
        }
        let received = 0;
        for (const f of targets.filter((x) => begin!.accepted.includes(x.fileId))) {
          const started = now().getTime();
          const progress = () => emit('attach_files', 'running', `첨부 올리는 중: ${f.name}`, {
            progress: { done: attachments.length, total: files.length }, bytes: { received, total: f.size, name: f.name },
          });
          try {
            let blob: Blob;
            try {
              blob = await deps.store.readBlob(pathOf.get(f.fileId) ?? `${notice.folder}/attachments/${f.name}`);
            } catch (e) {
              attachments.push(failedResult(f, `READ_FAILED: ${errCode(e) ?? errMsg(e)}`, started));
              continue;
            }
            check();
            received = 0;
            progress();
            for await (const c of chunkBlob(blob)) {
              await rpc('file/chunk', { jobId: job.id, fileId: f.fileId, seq: c.seq, total: c.total, b64: c.b64 }, T.chunk);
              received = Math.min(f.size, (c.seq + 1) * 2 * MB);
              progress();
            }
            const end = await rpc('file/end', { jobId: job.id, fileId: f.fileId }, T.end);
            if (!end.started) { attachments.push(failedResult(f, end.error ?? 'ATTACH_NOT_STARTED', started)); continue; }
            const limit = Math.max(ATTACH_MIN_TIMEOUT_MS, (f.size / ATTACH_BYTES_PER_SEC) * 1000);
            const pollStart = now().getTime();
            for (;;) {
              const st = await rpc('compose/attach-status', { jobId: job.id, fileId: f.fileId }, T.status);
              if (st.done) { attachments.push(st.result); break; }
              if (now().getTime() - pollStart >= limit) {
                attachments.push({ fileId: f.fileId, name: f.name, size: f.size, status: 'uploading_timeout', method: 'none', elapsedMs: now().getTime() - started, error: 'UPLOAD_TIMEOUT' });
                break;
              }
              await wait(attachPollMs);
            }
          } catch (e) {
            if (e instanceof Aborted) throw e;
            attachments.push(failedResult(f, errCode(e) ?? errMsg(e), started));
          }
          emit('attach_files', 'running', `첨부 처리: ${f.name}`, { progress: { done: attachments.length, total: files.length } });
        }
      }
    }
    if (files.length > 0 && attachSupported) emit('attach_files', 'done', '첨부 처리 완료', { progress: { done: attachments.length, total: files.length } });

    // 7. verify
    emit('verify', 'running', '입력 결과를 확인하는 중');
    try {
      const state = await rpc('compose/verify', { jobId: job.id }, T.verify);
      fields = reverify(fields, state, draft, fill, notice.basic.title.value);
      emit('verify', 'done', '확인 완료');
    } catch (e) {
      if (e instanceof Aborted) throw e;
      emit('verify', 'failed', `확인 실패: ${errMsg(e)}`);
    }

    // 8. 마무리
    return await finish(plan.prefilled.length > 0 ? 'url' : 'auto', fields, attachments, tabId);
  } catch (e) {
    if (e instanceof Aborted || signal.aborted) {
      if (opened) { try { await deps.call('compose/abort', { jobId: job.id }, T.short); } catch { /* 무시 */ } }
      return { status: 'cancelled' };
    }
    const error: JobError = { code: errCode(e) ?? 'COMPOSE_ERROR', message: errMsg(e), step: cur, retryable: errCode(e) !== 'NEEDS_FS_PERMISSION' };
    emit(cur, 'failed', error.message);
    return { status: 'failed', error };
  }
}
