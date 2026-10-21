import type { DocFormat } from '../../core/doc/model';
import { renderText } from '../../core/doc/render-text';
import { classifyName, extOf } from '../../core/extraction/classify';
import { normalizePath } from '../../core/model/path';
import { RFP_UPLOAD_MAX_MB } from '../../core/rfp/constants';
import { extractRequirements } from '../../core/rfp/extract';
import type { Attachment } from '../../core/types/notice';
import {
  RFP_EXTRACTOR_VERSION, type RequirementSet, type RfpCompareEntry, type RfpCompareSession, type RfpDocCandidate, type RfpDocRef, type RfpUploadEntry,
} from '../../core/types/rfp';
import { removeTree } from '../file-store/remove-tree';
import type { IFileStore } from '../file-store/types';
import { NoticeStore } from '../notices/notice-store';
import type { ParseFailReason, ParserRegistry } from '../parsers/types';
import { openZip } from '../parsers/zip';
import {
  assertId, comparePath, err, newId, noticeJsonPath, noticeTextPath, readJson, readJsonOrNull, RFP_COMPARES_DIR, RFP_UPLOADS_DIR,
  uploadDir, uploadMetaPath, uploadSetPath, uploadSourcePath, uploadTextPath, writeJson,
} from './rfp-store';

const TEXT_MAX_BYTES = 2 * 1024 * 1024;
const PARSE_TIMEOUT_MS = 60_000;
const LABEL_MAX = 60;
const ID_RETRY = 5;
const COMPARE_MAX_JSON = 1_000_000;
const COMPARE_ARRAY_MAX = 5_000;
const DOC_EXTS = ['hwp', 'hwpx', 'pdf', 'docx'];
const SUPPORTED: DocFormat[] = ['hwp5', 'hwpx', 'pdf', 'docx'];
const FAIL_MESSAGE: Record<ParseFailReason, string> = {
  unsupported: '지원하지 않는 문서 형식입니다.',
  encrypted: '암호가 걸린 문서라 읽을 수 없습니다.',
  drm: 'DRM이 걸린 문서라 읽을 수 없습니다.',
  scanned: '스캔 이미지 문서라 글자를 읽을 수 없습니다.',
  corrupt: '문서가 손상되어 읽을 수 없습니다.',
  timeout: '문서 분석 시간이 초과되었습니다.',
  cancelled: '문서 분석이 취소되었습니다.',
};

export interface RfpServiceDeps { store: IFileStore; parsers: ParserRegistry; now?: () => Date }

/** 2MB(UTF-8)를 넘으면 잘라서 돌려준다. */
function capText(text: string): string {
  const enc = new TextEncoder();
  let t = text;
  while (enc.encode(t).length > TEXT_MAX_BYTES) t = t.slice(0, Math.floor(t.length * 0.9));
  return t;
}

type NoticeRef = Extract<RfpDocRef, { kind: 'notice' }>;
interface Resolved { name: string; bytes: Uint8Array; jsonPath: string; textPath: string; allowedDir: string }

export function createRfpService(deps: RfpServiceDeps) {
  const { store, parsers } = deps;
  const now = deps.now ?? (() => new Date());
  const inflight = new Map<string, Promise<RequirementSet>>();
  const notices = new NoticeStore(store);

  const findAttachment = (atts: Attachment[], id: string): Attachment | undefined => atts.find((a) => a.id === id);

  async function loadNoticeOrThrow(noticeId: string) {
    const notice = await notices.loadNotice(noticeId);
    if (!notice) throw err('NOT_FOUND', '공고를 찾을 수 없습니다.');
    return notice;
  }

  async function uploadSourceFile(uploadId: string): Promise<{ path: string; ext: string }> {
    const dir = uploadDir(uploadId);
    let items: Array<{ name: string; kind: string }>;
    try { items = await store.list(dir); } catch { throw err('NOT_FOUND', '업로드한 문서를 찾을 수 없습니다.'); }
    const f = items.find((i) => i.kind === 'file' && i.name.startsWith('source.'));
    if (!f) throw err('NOT_FOUND', '업로드한 문서를 찾을 수 없습니다.');
    return { path: `${dir}/${f.name}`, ext: extOf(f.name) };
  }

  async function resolve(ref: RfpDocRef, nameHint?: string): Promise<Resolved> {
    if (ref.kind === 'upload') {
      const src = await uploadSourceFile(ref.uploadId);
      const cached = await readJsonOrNull<RequirementSet>(store, uploadSetPath(ref.uploadId));
      return {
        name: nameHint ?? cached?.source?.name ?? `source.${src.ext}`, bytes: await store.readBytes(src.path),
        jsonPath: uploadSetPath(ref.uploadId), textPath: uploadTextPath(ref.uploadId), allowedDir: uploadDir(ref.uploadId),
      };
    }
    const notice = await loadNoticeOrThrow(ref.noticeId);
    const att = findAttachment(notice.attachments, ref.attachmentId);
    if (!att || !att.savedName) throw err('NOT_FOUND', '첨부 파일을 찾을 수 없습니다.');
    let bytes: Uint8Array;
    try { bytes = await store.readBytes(`${notice.folder}/attachments/${att.savedName}`); } catch { throw err('NOT_FOUND', '첨부 파일을 읽을 수 없습니다.'); }
    let name = att.originalName;
    if (ref.innerPath !== undefined) {
      try { bytes = openZip(bytes).read(ref.innerPath); } catch { throw err('NOT_FOUND', 'zip 안의 문서를 찾을 수 없습니다.'); }
      name = ref.innerPath.split('/').pop() ?? ref.innerPath;
    }
    return { name, bytes, jsonPath: noticeJsonPath(notice.folder, ref), textPath: noticeTextPath(notice.folder, ref), allowedDir: `${normalizePath(notice.folder)}/rfp` };
  }

  const sameRef = (a: RfpDocRef, b: RfpDocRef): boolean =>
    a.kind === 'upload' ? b.kind === 'upload' && a.uploadId === b.uploadId
      : b.kind === 'notice' && a.noticeId === b.noticeId && a.attachmentId === b.attachmentId && a.innerPath === b.innerPath;

  async function doExtract(ref: RfpDocRef, force: boolean, nameHint?: string): Promise<RequirementSet> {
    const r = await resolve(ref, nameHint);
    if (!force) {
      const cached = await readJsonOrNull<RequirementSet>(store, r.jsonPath);
      if (cached && cached.extractorVersion === RFP_EXTRACTOR_VERSION && cached.source?.size === r.bytes.length && sameRef(cached.ref, ref)) return cached;
    }
    const started = Date.now();
    const fmt = parsers.detect(r.name, r.bytes.subarray(0, 32), r.bytes);
    if (!SUPPORTED.includes(fmt as DocFormat)) throw err('UNSUPPORTED', '지원하지 않는 문서 형식입니다(hwp, hwpx, pdf, docx만 가능).');
    let res;
    try {
      res = await parsers.get(fmt as DocFormat).parse({ name: r.name, bytes: r.bytes, deadlineAt: Date.now() + PARSE_TIMEOUT_MS });
    } catch (e) {
      throw err('PARSE_FAILED', e instanceof Error ? e.message : String(e));
    }
    if (!res.ok) throw err(res.reason.toUpperCase(), FAIL_MESSAGE[res.reason] ?? res.message);
    const doc = res.doc;
    // extractRequirements가 doc을 바꿀 수 있으므로 텍스트 렌더를 먼저 한다.
    const text = capText(renderText(doc));
    const body = extractRequirements(doc);
    await store.withLock(r.jsonPath, async () => {
      await store.writeText(r.textPath, text);
    });
    const set: RequirementSet = {
      schemaVersion: 1, extractorVersion: RFP_EXTRACTOR_VERSION, ref, extractedAt: now().toISOString(),
      ...body,
      source: { name: r.name, format: fmt as DocFormat, size: r.bytes.length, ...(doc.pages !== undefined ? { pages: doc.pages } : {}), textPath: r.textPath },
      ms: Date.now() - started,
    };
    await store.withLock(r.jsonPath, () => writeJson(store, r.jsonPath, set));
    return set;
  }

  /** 진행 중 요청 공유 키. 속성 순서와 무관하게 같은 문서면 같은 키. */
  const refKey = (ref: RfpDocRef): string =>
    ref.kind === 'upload' ? `u:${ref.uploadId}` : `n:${ref.noticeId}:${ref.attachmentId}:${ref.innerPath ?? ''}`;
  const deleting = new Set<string>();

  function extract(ref: RfpDocRef, force?: boolean, nameHint?: string): Promise<RequirementSet> {
    if (!ref || (ref.kind !== 'notice' && ref.kind !== 'upload')) return Promise.reject(err('BAD_REQUEST', '잘못된 문서 지정입니다.'));
    if (ref.kind === 'upload') {
      try { assertId(ref.uploadId, 'u'); } catch (e) { return Promise.reject(e); }
    }
    if (ref.kind === 'upload' && deleting.has(ref.uploadId)) return Promise.reject(err('NOT_FOUND', '삭제 중인 문서입니다.'));
    const key = refKey(ref);
    const running = inflight.get(key);
    if (running && !force) return running;
    // force는 진행 중인 요청을 공유하지 않고, 그것이 끝난 뒤 다시 파싱한다.
    const p: Promise<RequirementSet> = (running ? running.catch(() => undefined).then(() => doExtract(ref, true, nameHint)) : doExtract(ref, !!force, nameHint))
      .finally(() => { if (inflight.get(key) === p) inflight.delete(key); });
    inflight.set(key, p);
    return p;
  }

  /** 새 id를 만들 때 대상이 이미 있으면 다시 만든다(최대 5회). */
  async function freshId(prefix: 'u' | 'c', exists: (id: string) => Promise<boolean>): Promise<string> {
    for (let i = 0; i < ID_RETRY; i++) {
      const id = newId(prefix, now());
      if (!(await exists(id))) return id;
    }
    throw err('ID_COLLISION', '식별자를 만들지 못했습니다. 다시 시도하세요.');
  }
  const uploadExists = async (id: string): Promise<boolean> => {
    try { return (await store.list(uploadDir(id))).length > 0; } catch { return false; }
  };

  async function listDocs(noticeId: string): Promise<RfpDocCandidate[]> {
    const notice = await loadNoticeOrThrow(noticeId);
    const out: RfpDocCandidate[] = [];
    const title = typeof notice.basic.title?.value === 'string' ? notice.basic.title.value : null;
    const readCache = async (ref: NoticeRef, size: number | null): Promise<RequirementSet | null> => {
      const c = await readJsonOrNull<RequirementSet>(store, noticeJsonPath(notice.folder, ref));
      if (!c || c.extractorVersion !== RFP_EXTRACTOR_VERSION || !sameRef(c.ref, ref)) return null;
      if (size !== null && c.source?.size !== size) return null;
      return c;
    };
    const push = async (ref: NoticeRef, name: string, docKind: RfpDocCandidate['docKind'], size: number | null) => {
      const c = await readCache(ref, size);
      out.push({ ref, name, docKind, status: c ? 'ready' : 'parse_needed', ...(c ? { itemCount: c.items.length, quality: c.quality } : {}) });
    };
    for (const att of notice.attachments) {
      if (!att.savedName || att.status !== 'saved') continue;
      const ext = extOf(att.originalName) || extOf(att.savedName);
      const kind = att.docKind ?? classifyName(att.originalName, title).kind;
      if (DOC_EXTS.includes(ext)) {
        await push({ kind: 'notice', noticeId, attachmentId: att.id }, att.originalName, kind, att.savedSize);
      } else if (ext === 'zip') {
        let entries;
        try { entries = openZip(await store.readBytes(`${notice.folder}/attachments/${att.savedName}`)).entries; } catch { continue; }
        for (const e of entries) {
          if (e.isDir) continue;
          const base = e.path.split('/').pop() ?? e.path;
          if (!DOC_EXTS.includes(extOf(base))) continue;
          await push({ kind: 'notice', noticeId, attachmentId: att.id, innerPath: e.path }, base, classifyName(base, title).kind, e.size);
        }
      }
    }
    // 안정 정렬: rfp 먼저, 나머지는 원래 순서
    return [...out.filter((d) => d.docKind === 'rfp'), ...out.filter((d) => d.docKind !== 'rfp')];
  }

  async function upload(p: { name: string; size: number; b64: string }): Promise<{ uploadId: string; set: RequirementSet }> {
    const name = typeof p?.name === 'string' ? p.name : '';
    const ext = extOf(name);
    if (!DOC_EXTS.includes(ext)) throw err('UNSUPPORTED', '지원하지 않는 파일 형식입니다(hwp, hwpx, pdf, docx만 가능).');
    const maxBytes = RFP_UPLOAD_MAX_MB * 1024 * 1024;
    if (typeof p.b64 !== 'string' || p.b64.length > maxBytes * 1.37) throw err('PAYLOAD_TOO_LARGE', `파일이 너무 큽니다(${RFP_UPLOAD_MAX_MB}MB 이하).`);
    let bytes: Uint8Array;
    try { bytes = Uint8Array.from(atob(p.b64), (c) => c.charCodeAt(0)); } catch { throw err('BAD_REQUEST', '파일 데이터를 읽을 수 없습니다.'); }
    if (bytes.length > maxBytes) throw err('PAYLOAD_TOO_LARGE', `파일이 너무 큽니다(${RFP_UPLOAD_MAX_MB}MB 이하).`);
    if (bytes.length === 0) throw err('BAD_REQUEST', '빈 파일입니다.');
    const uploadId = await freshId('u', uploadExists);
    try {
      // Blob.stream()은 jsdom에 없어 스트림을 직접 만든다(브라우저·테스트 공통)
      await store.writeStream(uploadSourcePath(uploadId, ext), new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } }));
      const set = await extract({ kind: 'upload', uploadId }, false, name);
      return { uploadId, set };
    } catch (e) {
      await removeDir(uploadDir(uploadId)).catch(() => undefined);
      throw e;
    }
  }

  /** IFileStore.remove가 디렉터리를 재귀 삭제하지 않을 수 있어(fake) 안의 파일을 먼저 지운다. */
  const removeDir = (dir: string): Promise<void> => removeTree(store, dir);

  async function entryOf(uploadId: string): Promise<RfpUploadEntry | null> {
    const set = await readJsonOrNull<RequirementSet>(store, uploadSetPath(uploadId));
    if (!set) return null;
    try { await uploadSourceFile(uploadId); } catch { return null; } // 원본이 없으면 삭제 중 남은 유령 폴더
    const meta = await readJsonOrNull<{ label?: string }>(store, uploadMetaPath(uploadId));
    return {
      uploadId, name: set.source.name, ...(meta?.label ? { label: meta.label } : {}), size: set.source.size, format: set.source.format,
      uploadedAt: set.extractedAt, itemCount: set.items.length, quality: set.quality,
    };
  }

  async function uploads(): Promise<RfpUploadEntry[]> {
    let items: Array<{ name: string; kind: string }>;
    try { items = await store.list(RFP_UPLOADS_DIR); } catch { return []; }
    const out: RfpUploadEntry[] = [];
    for (const it of items) {
      if (it.kind !== 'directory' || !/^u_\d{14}_[a-z0-9]{4}$/.test(it.name)) continue;
      const e = await entryOf(it.name);
      if (e) out.push(e);
    }
    return out.sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : a.uploadedAt > b.uploadedAt ? -1 : 0));
  }

  async function renameUpload(uploadId: string, label: string): Promise<RfpUploadEntry> {
    assertId(uploadId, 'u');
    const clean = typeof label === 'string' ? label.trim().slice(0, LABEL_MAX) : '';
    if (!(await entryOf(uploadId))) throw err('NOT_FOUND', '업로드한 문서를 찾을 수 없습니다.');
    const path = uploadMetaPath(uploadId);
    await store.withLock(path, async () => {
      const meta = (await readJsonOrNull<{ label?: string }>(store, path)) ?? {};
      if (clean) meta.label = clean; else delete meta.label;
      await writeJson(store, path, meta);
    });
    return (await entryOf(uploadId))!;
  }

  async function deleteUpload(uploadId: string): Promise<void> {
    const dir = uploadDir(uploadId);
    // 삭제하는 동안 새 추출을 막아 requirements.json만 남은 폴더가 생기지 않게 한다
    deleting.add(uploadId);
    try {
      const running = inflight.get(refKey({ kind: 'upload', uploadId }));
      if (running) await running.catch(() => undefined);
      await removeDir(dir);
    } finally { deleting.delete(uploadId); }
  }

  async function text(ref: RfpDocRef): Promise<{ text: string }> {
    const set = await extract(ref);
    const r = await resolve(ref);
    let path: string;
    try { path = normalizePath(set.source.textPath); } catch { throw err('PATH_FORBIDDEN', '허용되지 않은 경로입니다.'); }
    if (!path.startsWith(`${r.allowedDir}/`)) throw err('PATH_FORBIDDEN', '허용되지 않은 경로입니다.');
    const bytes = await store.readBytes(path);
    return { text: new TextDecoder().decode(bytes.length > TEXT_MAX_BYTES ? bytes.subarray(0, TEXT_MAX_BYTES) : bytes) };
  }

  async function saveCompare(session: RfpCompareSession): Promise<RfpCompareSession> {
    if (!session || typeof session !== 'object' || typeof session.id !== 'string') throw err('BAD_REQUEST', '잘못된 비교 세션입니다.');
    if (JSON.stringify(session).length > COMPARE_MAX_JSON
      || (session.overrides?.length ?? 0) > COMPARE_ARRAY_MAX || (session.reviewed?.length ?? 0) > COMPARE_ARRAY_MAX) {
      throw err('PAYLOAD_TOO_LARGE', '비교 세션이 너무 큽니다.');
    }
    const nowIso = now().toISOString();
    if (session.id === '') {
      const id = await freshId('c', async (c) => (await store.fileSize(comparePath(c))) !== null);
      const next = { ...session, id, createdAt: nowIso, updatedAt: nowIso };
      await store.withLock(comparePath(id), () => writeJson(store, comparePath(id), next));
      return next;
    }
    const path = comparePath(session.id);
    return store.withLock(path, async () => {
      const prior = await readJsonOrNull<RfpCompareSession>(store, path);
      const next = { ...session, createdAt: prior?.createdAt ?? session.createdAt ?? nowIso, updatedAt: nowIso };
      await writeJson(store, path, next);
      return next;
    });
  }

  async function listCompares(): Promise<RfpCompareEntry[]> {
    let items: Array<{ name: string; kind: string }>;
    try { items = await store.list(RFP_COMPARES_DIR); } catch { return []; }
    const out: RfpCompareEntry[] = [];
    for (const it of items) {
      const m = /^(c_\d{14}_[a-z0-9]{4})\.json$/.exec(it.name);
      if (it.kind !== 'file' || !m) continue;
      const s = await readJsonOrNull<RfpCompareSession>(store, comparePath(m[1]!));
      if (!s) continue;
      out.push({
        id: s.id, createdAt: s.createdAt, updatedAt: s.updatedAt, prevTitle: s.prev?.title ?? '', nextTitle: s.next?.title ?? '',
        reviewedCount: s.reviewed?.length ?? 0, ...(s.summary ? { summary: s.summary } : {}),
      });
    }
    return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  }

  async function getCompare(id: string): Promise<RfpCompareSession | null> {
    return readJsonOrNull<RfpCompareSession>(store, comparePath(id));
  }

  async function deleteCompare(id: string): Promise<void> {
    const path = comparePath(id);
    await store.withLock(path, async () => { try { await store.remove(path); } catch { /* 이미 없음 */ } });
  }

  /** 공고 삭제용. 이 공고의 문서를 prev/next로 가진 비교 세션을 지우고 지운 id를 돌려준다. */
  async function deleteComparesForNotice(noticeId: string): Promise<string[]> {
    let items: Array<{ name: string; kind: string }>;
    try { items = await store.list(RFP_COMPARES_DIR); } catch { return []; }
    const isMine = (ref: RfpDocRef | undefined): boolean => ref?.kind === 'notice' && ref.noticeId === noticeId;
    const deleted: string[] = [];
    for (const it of items) {
      const m = /^(c_\d{14}_[a-z0-9]{4})\.json$/.exec(it.name);
      if (it.kind !== 'file' || !m) continue;
      const s = await readJsonOrNull<RfpCompareSession>(store, comparePath(m[1]!));
      if (!s || !(isMine(s.prev?.ref) || isMine(s.next?.ref))) continue;
      await deleteCompare(m[1]!);
      deleted.push(m[1]!);
    }
    return deleted;
  }

  /** 이 공고의 첨부 문서를 추출하는 요청이 진행 중인지. */
  function isNoticeBusy(noticeId: string): boolean {
    const prefix = `n:${noticeId}:`;
    for (const k of inflight.keys()) if (k.startsWith(prefix)) return true;
    return false;
  }

  return { deleteComparesForNotice, isNoticeBusy, listDocs, extract: (ref: RfpDocRef, force?: boolean) => extract(ref, force), upload, uploads, renameUpload, deleteUpload, text, saveCompare, listCompares, getCompare, deleteCompare };
}

export type RfpService = ReturnType<typeof createRfpService>;
