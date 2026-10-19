import { sanitizeSegment } from '../../core/model/sanitize';
import { uniqueName } from '../../core/model/names';
import type { Attachment } from '../../core/types/notice';
import type { IFileStore } from '../file-store/types';

export interface DownloadSettings { concurrency: number; maxRetries: number; backoffMs: number; maxFileMB: number }

export interface DownloadEvent {
  attachmentId: string;
  /** 'start': 파일 시작, 'bytes': 받는 중, 'done': 파일 처리 종료(성공/실패/skip 포함) */
  type: 'start' | 'bytes' | 'done';
  bytes?: number;
  total?: number | null;
  /** done: 최종 첨부 상태, 저장(또는 예상) 크기, 마지막 오류, 첫 시도부터의 소요(재시도 백오프 포함) */
  status?: Attachment['status'];
  size?: number | null;
  error?: string;
  ms?: number;
  done: number;
  totalFiles: number;
}

export interface DownloadOptions {
  store: IFileStore;
  /** 공고 폴더(루트 기준). 파일은 `<folder>/attachments/<savedName>`에 저장된다. */
  folder: string;
  settings: DownloadSettings;
  fetch: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  /** true면 크기 초과로 skipped 된 항목은 다시 시도하지 않는다(재시도 잡). */
  keepSkipped?: boolean;
  /** 응답 헤더 대기 한도(기본 30s) */
  headerTimeoutMs?: number;
  /** 청크 간 idle 한도(기본 60s) */
  idleTimeoutMs?: number;
  /** 잡 취소 신호 */
  signal?: AbortSignal;
  onEvent?: (e: DownloadEvent) => void;
  /** 파일 하나가 끝날 때마다 현재 첨부 배열(공유 객체)을 전달한다. */
  onUpdate?: (atts: Attachment[]) => void;
}

/** 전체 다운로드를 중단시키는 오류. 중단 시점까지의 첨부 상태를 함께 담는다. */
export class DownloadAbort extends Error {
  attachments: Attachment[] = [];
  constructor(public code: string, message: string, public retryable: boolean) {
    super(message);
  }
}
export class DiskFullError extends DownloadAbort {
  constructor(message = '저장 공간이 부족합니다.') { super('DISK_FULL', message, false); }
}
export class CancelledError extends DownloadAbort {
  constructor() { super('JOB_CANCELLED', '작업이 취소되었습니다.', false); }
}

class AttachError extends Error {
  constructor(public code: string, message: string, public retryable: boolean) {
    super(message);
  }
}
class TooLargeError extends Error {}

/** 파일명 정리: 확장자는 유지하고 이름 부분만 sanitize. */
export function safeFileName(original: string): string {
  const dot = original.lastIndexOf('.');
  if (dot > 0) {
    const ext = sanitizeSegment(original.slice(dot + 1), 10);
    return `${sanitizeSegment(original.slice(0, dot), 120)}.${ext === '_' ? '' : ext}`.replace(/\.$/, '');
  }
  return sanitizeSegment(original, 130);
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function downloadAttachments(input: Attachment[], opts: DownloadOptions): Promise<Attachment[]> {
  const atts = input.map((a) => ({ ...a }));
  const rawSleep = opts.sleep ?? defaultSleep;
  // backoff 대기 중에도 취소되면 즉시 CancelledError
  const sleep = (ms: number): Promise<void> => {
    const sig = opts.signal;
    if (!sig) return rawSleep(ms);
    if (sig.aborted) return Promise.reject(new CancelledError());
    return new Promise<void>((resolve, reject) => {
      const onAbort = () => reject(new CancelledError());
      sig.addEventListener('abort', onAbort, { once: true });
      rawSleep(ms).then(
        () => { sig.removeEventListener('abort', onAbort); resolve(); },
        (e) => { sig.removeEventListener('abort', onAbort); reject(e); },
      );
    });
  };
  const now = opts.now ?? (() => new Date());
  const headerMs = opts.headerTimeoutMs ?? 30_000;
  const idleMs = opts.idleTimeoutMs ?? 60_000;
  const maxBytes = opts.settings.maxFileMB * 1024 * 1024;

  // savedName은 최초 1회만 결정한다.
  const taken = new Set(atts.map((a) => a.savedName).filter((n): n is string => !!n));
  for (const a of atts) {
    if (a.savedName) continue;
    a.savedName = uniqueName(safeFileName(a.originalName), taken);
    taken.add(a.savedName);
  }

  let doneCount = 0;
  let fatal: DownloadAbort | null = null;
  const emit = (a: Attachment, type: DownloadEvent['type'], bytes?: number, total?: number | null, extra?: Partial<DownloadEvent>) =>
    opts.onEvent?.({ attachmentId: a.id, type, bytes, total, done: doneCount, totalFiles: atts.length, ...extra });

  const attempt = async (a: Attachment): Promise<void> => {
    const path = `${opts.folder}/attachments/${a.savedName}`;
    const ac = new AbortController();
    let kill!: (e: Error) => void;
    const dead = new Promise<never>((_, rej) => { kill = (e) => { ac.abort(); rej(e); }; });
    dead.catch(() => undefined);
    const onAbort = () => kill(new CancelledError());
    if (opts.signal?.aborted) throw new CancelledError();
    opts.signal?.addEventListener('abort', onAbort);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = (ms: number, what: string) => {
      clearTimeout(timer);
      timer = setTimeout(() => kill(new AttachError('ATTACH_TIMEOUT', `${what} 시간 초과`, true)), ms);
    };
    try {
      arm(headerMs, '응답 헤더 대기');
      const res = await Promise.race([opts.fetch(a.url, { credentials: 'omit', signal: ac.signal }), dead]);
      clearTimeout(timer);
      if (res.status !== 200) {
        await res.body?.cancel().catch(() => undefined);
        throw new AttachError(`HTTP_${res.status}`, `HTTP ${res.status}`, res.status >= 500 || res.status === 429);
      }
      const type = (res.headers.get('content-type') ?? '').toLowerCase();
      if (type.includes('text/html')) {
        await res.body?.cancel().catch(() => undefined);
        throw new AttachError('ATTACH_NOT_FILE', '파일이 아닌 HTML 응답입니다(오류 페이지로 판단).', false);
      }
      const lenHeader = res.headers.get('content-length');
      const total = lenHeader !== null && /^\d+$/.test(lenHeader) ? Number(lenHeader) : null;
      const tooLarge = () => {
        a.status = 'skipped';
        a.lastError = `최대 파일 크기(${opts.settings.maxFileMB}MB) 초과로 받지 않았습니다.`;
      };
      if (total !== null && total > maxBytes) {
        await res.body?.cancel().catch(() => undefined);
        tooLarge();
        a.expectedSize = total;
        return;
      }
      if (!res.body) throw new AttachError('ATTACH_EMPTY', '응답 본문이 없습니다.', true);

      const reader = res.body.getReader();
      let bytes = 0;
      const source = new ReadableStream<Uint8Array>({
        async pull(ctl) {
          arm(idleMs, '데이터 수신');
          const r = await Promise.race([reader.read(), dead]);
          clearTimeout(timer); // 쓰기 쪽 백프레셔로 지연되는 시간은 idle로 보지 않는다.
          if (r.done) { clearTimeout(timer); ctl.close(); return; }
          bytes += r.value.byteLength;
          if (bytes > maxBytes) throw new TooLargeError();
          emit(a, 'bytes', bytes, total);
          ctl.enqueue(r.value);
        },
        cancel(reason) { return reader.cancel(reason).catch(() => undefined); },
      });

      const existed = (await opts.store.fileSize(path)) !== null;
      let size: number;
      try {
        size = await opts.store.withLock(path, () => opts.store.writeStream(path, source));
      } catch (e) {
        // 새 파일이면 부분 파일(0바이트 포함)을 남기지 않는다. 기존 파일은 swap abort로 유지된다.
        if (!existed) await opts.store.remove(path).catch(() => undefined);
        if (e instanceof TooLargeError) {
          tooLarge();
          return;
        }
        if ((e as { code?: string }).code === 'DISK_FULL') throw new DiskFullError();
        throw e;
      }
      a.expectedSize = total ?? a.expectedSize;
      a.savedSize = size;
      a.savedAt = now().toISOString();
      if (total === null) {
        a.status = 'saved';
        a.lastError = undefined;
        a.note = '서버가 크기를 알려주지 않음';
      } else if (size !== total) {
        a.status = 'size_mismatch';
        a.lastError = `크기 불일치: 서버 ${total}B, 저장 ${size}B`;
      } else {
        a.status = 'saved';
        a.lastError = undefined;
        a.note = undefined;
      }
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }
  };

  const process = async (a: Attachment): Promise<void> => {
    if (a.status === 'skipped' && opts.keepSkipped) return;
    const path = `${opts.folder}/attachments/${a.savedName}`;
    if (a.status === 'saved' && a.savedSize !== null) {
      if ((await opts.store.fileSize(path)) === a.savedSize) return; // 멱등 skip
    }
    a.status = 'downloading';
    emit(a, 'start');
    for (let n = 0; ; n++) {
      a.attempts++;
      try {
        await attempt(a);
        return;
      } catch (e) {
        if (e instanceof DownloadAbort) throw e;
        const retryable = e instanceof AttachError ? e.retryable : true;
        a.lastError = e instanceof Error ? e.message : String(e);
        if (!retryable || n >= opts.settings.maxRetries) {
          a.status = 'failed';
          return;
        }
        await sleep(opts.settings.backoffMs * 2 ** n);
      }
    }
  };

  const queue = [...atts];
  const worker = async () => {
    let startedAt = 0;
    for (let a = queue.shift(); a && !fatal; a = queue.shift()) {
      try {
        if (opts.signal?.aborted) throw new CancelledError();
        startedAt = Date.now();
        await process(a);
      } catch (e) {
        if (e instanceof DownloadAbort) {
          fatal = fatal ?? e;
          a.status = 'failed';
          a.lastError = e.message;
          return;
        }
        throw e;
      }
      doneCount++;
      emit(a, 'done', undefined, undefined, {
        status: a.status, size: a.savedSize ?? a.expectedSize, ...(a.lastError ? { error: a.lastError } : {}), ms: Date.now() - startedAt,
      });
      opts.onUpdate?.(atts);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.settings.concurrency) }, worker));
  if (fatal) {
    (fatal as DownloadAbort).attachments = atts;
    throw fatal;
  }
  return atts;
}
