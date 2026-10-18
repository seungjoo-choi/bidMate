import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { listen } from '../messaging/bus';
import type { AttachStatus, ComposeDetect, ComposeSelectorConfig, FileMeta } from '../messaging/protocol';
import type { AttachResult, FieldResult } from '../core/types/compose';
import { GenericComposeAdapter } from '../adapters/naverworks/engine';
import { FileBuffer } from '../adapters/naverworks/file-buffer';
import { mergeSelectorSet, SELECTOR_SETS } from '../adapters/naverworks/selectors';
import type { ComposeAdapter, ComposeAnchor } from '../adapters/naverworks/types';

// 웹메일 작성 화면 content script. 요청에만 답하고 storage.session은 읽지 않는다.

export interface ComposeCsConfig extends ComposeSelectorConfig { jobId?: string; maxFileMB?: number; anchor?: ComposeAnchor }
interface ComposeCsApi { configure(cfg: ComposeCsConfig): void; detect(): ComposeDetect | null }
type Phase = 'buffering' | 'injecting' | 'uploading';
interface AttachState { startedAt: number; phase: Phase; result?: AttachResult }

declare global {
  interface Window { __bidMateCompose?: ComposeCsApi }
}

const err = (code: string, message: string): Error => Object.assign(new Error(message), { code });

export default defineUnlistedScript(() => {
  if (window.__bidMateCompose) return; // 중복 주입 가드

  let adapter: ComposeAdapter | null = null;
  let buffer = new FileBuffer(100);
  let boundJob: string | undefined;
  let abort = new AbortController();
  const statuses = new Map<string, AttachState>();
  let queue: Promise<unknown> = Promise.resolve();

  const checkJob = (jobId: string): void => {
    boundJob ??= jobId;
    if (boundJob !== jobId) throw err('COMPOSE_JOB_MISMATCH', 'jobId가 일치하지 않습니다.');
  };
  const need = (): ComposeAdapter => {
    if (!adapter) throw err('COMPOSE_NOT_CONFIGURED', '셀렉터셋이 설정되지 않았습니다.');
    return adapter;
  };

  const api: ComposeCsApi = {
    configure(cfg) {
      const base = SELECTOR_SETS[cfg.selectorSetId];
      if (!base) throw err('SELECTOR_SET_NOT_FOUND', `알 수 없는 셀렉터셋: ${cfg.selectorSetId}`);
      adapter = new GenericComposeAdapter(mergeSelectorSet(base, cfg.selectorOverrides), document, {}, cfg.anchor);
      buffer = new FileBuffer(cfg.maxFileMB ?? 100);
      boundJob = cfg.jobId;
    },
    // configure가 안 된 프레임은 null을 돌려 SW가 재주입(configure 포함)하게 한다.
    detect() {
      if (!adapter) return null;
      const d = adapter.detect();
      return { frameId: 0, injected: true, isCompose: d.isCompose, ready: d.ready, ...(d.reason ? { reason: d.reason } : {}) };
    },
  };
  window.__bidMateCompose = api;

  listen('compose/fill', async (p) => {
    checkJob(p.jobId);
    const a = need();
    const out: FieldResult[] = [];
    for (const f of p.fields ?? ['to', 'cc', 'subject', 'body']) {
      out.push(f === 'to' ? await a.setRecipients('to', p.to) : f === 'cc' ? await a.setRecipients('cc', p.cc) : f === 'subject' ? await a.setSubject(p.subject) : await a.setBody(p.html));
    }
    return out;
  }, 'content');

  listen('compose/attach-begin', (p) => {
    checkJob(p.jobId);
    const accepted: string[] = [];
    const rejected: Array<{ fileId: string; reason: string }> = [];
    for (const meta of p.files as FileMeta[]) {
      try { buffer.begin(meta); accepted.push(meta.fileId); } catch (e) { rejected.push({ fileId: meta.fileId, reason: e instanceof Error ? e.message : String(e) }); }
    }
    return { accepted, rejected };
  }, 'content');

  listen('file/chunk', async (p) => {
    checkJob(p.jobId);
    try {
      return { received: await buffer.push(p.fileId, p.seq, p.b64, p.total) };
    } catch (e) {
      buffer.release(p.fileId);
      throw e;
    }
  }, 'content');

  listen('file/end', (p) => {
    checkJob(p.jobId);
    const a = need();
    let file: File;
    try {
      file = buffer.end(p.fileId);
    } catch (e) {
      buffer.release(p.fileId);
      return { started: false, error: e instanceof Error ? e.message : String(e) };
    }
    const st: AttachState = { startedAt: Date.now(), phase: 'buffering' };
    statuses.set(p.fileId, st);
    const signal = abort.signal;
    // 첨부는 순차로 실행하고 결과를 기다리지 않고 started를 반환한다.
    queue = queue.then(async () => {
      try {
        const r = await a.attachFile(file, { signal, onPhase: (ph) => { st.phase = ph; } });
        st.result = { ...r, fileId: p.fileId };
      } catch (e) {
        st.result = { fileId: p.fileId, name: file.name, size: file.size, status: 'failed', method: 'none', elapsedMs: Date.now() - st.startedAt, error: e instanceof Error ? e.message : String(e) };
      } finally {
        buffer.release(p.fileId);
      }
    });
    return { started: true };
  }, 'content');

  listen('compose/attach-status', (p): AttachStatus => {
    checkJob(p.jobId);
    const st = statuses.get(p.fileId);
    if (!st) throw err('ATTACH_UNKNOWN', `알 수 없는 파일: ${p.fileId}`);
    if (st.result) return { done: true, result: st.result };
    return { done: false, phase: st.phase, elapsedMs: Date.now() - st.startedAt };
  }, 'content');

  listen('compose/verify', (p) => {
    checkJob(p.jobId);
    return need().readState();
  }, 'content');

  listen('compose/abort', (p) => {
    checkJob(p.jobId);
    abort.abort();
    abort = new AbortController();
    buffer.clear();
    statuses.clear();
    queue = Promise.resolve();
  }, 'content');
});
