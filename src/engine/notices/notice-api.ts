import { computeStatus } from '../../core/extraction/decide';
import { applyUserEdit, isEditableKey, revertUserEdit, validateFieldValue, VALUE_CHECK } from '../../core/model/field-edit';
import { mergeDocumentLayer } from '../../core/model/merge';
import { latestBids } from '../../core/results/plan';
import { getField, setFields } from '../../core/model/notice-fields';
import { normalizePath } from '../../core/model/path';
import { EXTRACTION_KEYS, type ExtractedItem, type Extraction, type ExtractionKey } from '../../core/types/extraction';
import type { IndexEntry } from '../../core/types/index-file';
import type { Notice, NoticeFieldKey } from '../../core/types/notice';
import { missing, type FieldValue } from '../../core/types/common';
import { docFieldsOf } from '../extraction/extract-step';
import { PROVIDERS } from '../ai/providers';
import { NOTICE_TEXTS_MAX_CHARS } from '../../core/search/constants';
import { DETAIL_TEXT_NAME } from '../../core/model/detail-text';
import type { NoticeTextFile, NoticeTexts } from '../../core/types/search';
import type { FollowFile, FollowTarget, ResultEntry, ResultFile } from '../../core/types/result';
import { readJson } from '../file-store/json-store';
import type { IFileStore } from '../file-store/types';
import { editLockKey, NoticeStore } from './notice-store';

const TEXT_MAX_BYTES = 2 * 1024 * 1024;
const err = (code: string, message: string) => Object.assign(new Error(message), { code });

export async function listNotices(store: IFileStore): Promise<IndexEntry[]> {
  const notices = (await new NoticeStore(store).loadIndex()).notices;
  // 결과 추적 파생 필드. 파일이 없거나 손상이면 무시한다(권한 오류도 목록은 보여 준다).
  let results: Record<string, ResultEntry> = {};
  let follows: Record<string, unknown> = {};
  try { results = (await readJson<ResultFile>(store, 'results.json')).entries ?? {}; } catch { /* 없음/손상 */ }
  try { follows = (await readJson<FollowFile>(store, 'follows.json')).entries ?? {}; } catch { /* 없음/손상 */ }
  if (typeof results !== 'object' || results === null) results = {};
  if (typeof follows !== 'object' || follows === null) follows = {};
  const ids = new Set(notices.map((n) => n.noticeId));
  const latestIdByNo = new Map(latestBids(notices).map((e) => [e.noticeNo, e.noticeId]));
  return notices.map((n) => {
    const origId = n.reannounceOf ? latestIdByNo.get(n.reannounceOf) : undefined;
    const withOrig = origId ? { ...n, reannounceOfId: origId } : n;
    const r = Object.hasOwn(results, n.noticeId) ? results[n.noticeId] : undefined;
    const following: FollowTarget | undefined = Object.hasOwn(follows, n.noticeId)
      ? ((follows[n.noticeId] as { target?: unknown } | null)?.target === 'rank' ? 'rank' : 'final')
      : undefined;
    if (!r?.status && !following) return withOrig;
    return {
      ...withOrig,
      ...(r?.status ? {
        result: {
          status: r.status,
          ...(r.rank !== undefined ? { rank: r.rank } : {}),
          ...(r.bidders !== undefined ? { bidders: r.bidders } : {}),
          ...(r.awardedAt ? { awardedAt: r.awardedAt } : {}),
          ...(r.amount !== undefined ? { amount: r.amount } : {}),
          ...(r.startAt ? { startAt: r.startAt } : {}),
          ...(r.nextCheckAt ? { nextCheckAt: r.nextCheckAt } : {}),
          ...(r.ourAmount !== undefined ? { ourAmount: r.ourAmount } : {}),
          ...(r.openingAt ? { openingAt: r.openingAt } : {}),
          ...(r.reannounce ? {
            reannounce: {
              status: r.reannounce.status,
              ...(r.reannounce.found ? {
                noticeNo: r.reannounce.found.noticeNo,
                round: r.reannounce.found.round,
                title: r.reannounce.found.title,
                ...(ids.has(r.reannounce.found.noticeId) ? { noticeId: r.reannounce.found.noticeId } : {}),
              } : {}),
            },
          } : {}),
        },
      } : {}),
      ...(following ? { following } : {}),
    };
  });
}

export async function getNotice(store: IFileStore, noticeId: string): Promise<{ notice: Notice; extraction: Extraction | null } | null> {
  const ns = new NoticeStore(store);
  const notice = await ns.loadNotice(noticeId);
  if (!notice) return null;
  return { notice, extraction: await ns.loadExtraction(noticeId) };
}


/**
 * value가 있으면 사용자 수정을 넣고, null이면 해제해 자동 결과로 되돌린다. 끝나면 전체 status를 다시 계산한다.
 * 같은 공고의 쓰기 잡이 실행 중이면 거부하고(isBusy), 공고 락 안에서 다시 읽은 최신 파일에 수정한다.
 */
export async function editExtraction(
  store: IFileStore, p: { noticeId: string; key: ExtractionKey; value: unknown | null; note?: string },
  opts: {
    now?: () => Date; isBusy?: (noticeId: string) => boolean;
    /** AI 제안 적용 출처. 있으면 userEdited.origin에 남기고 note가 비면 기본 메모를 넣는다. */
    origin?: NonNullable<ExtractedItem<unknown>['userEdited']>['origin'];
    /** notice 필드 source(kind는 항상 'user'). 기본 ref는 'dashboard' */
    source?: { ref: string; evidence?: string; page?: number };
    /** 지정하면 락 안에서 읽은 extraction.jobId가 같을 때만 저장한다(다르면 AI_STALE). */
    expectJobId?: string;
  } = {},
): Promise<{ notice: Notice; extraction: Extraction }> {
  const key = p.key as string;
  if (typeof key !== 'string' || !(EXTRACTION_KEYS as string[]).includes(key)) throw err('INVALID_KEY', `알 수 없는 항목: ${String(key)}`);
  const value = p.value === undefined ? null : p.value;
  if (value !== null && !VALUE_CHECK[p.key](value)) throw err('INVALID_VALUE', `${key} 값 형식이 올바르지 않습니다.`);
  if (p.note !== undefined && (typeof p.note !== 'string' || p.note.length > 500)) throw err('INVALID_VALUE', 'note는 500자 이하 문자열이어야 합니다.');
  const now = opts.now ?? (() => new Date());
  const ns = new NoticeStore(store);
  return store.withLock(editLockKey(p.noticeId), async () => {
    if (opts.isBusy?.(p.noticeId)) throw err('JOB_ALREADY_RUNNING', '같은 공고의 수집/추출 잡이 실행 중입니다.');
    const notice = await ns.loadNotice(p.noticeId);
    const extraction = await ns.loadExtraction(p.noticeId);
    if (!notice || !extraction) throw err('NOT_FOUND', '추출 결과를 찾을 수 없습니다.');
    if (opts.expectJobId !== undefined && extraction.jobId !== opts.expectJobId) throw err('AI_STALE', '추출 결과가 다시 만들어져 적용할 수 없습니다.');
    if (!Object.hasOwn(extraction.items, p.key)) throw err('INVALID_KEY', `알 수 없는 항목: ${key}`);
    const item = extraction.items[p.key];
    const nowIso = now().toISOString();
    if (value !== null) {
      const note = p.note || (opts.origin ? `AI 제안 적용(${PROVIDERS[opts.origin.provider]?.label ?? opts.origin.provider}${opts.origin.model ? ` ${opts.origin.model}` : ''})` : undefined);
      item.userEdited = { value, editedAt: nowIso, ...(note ? { note } : {}), ...(opts.origin ? { origin: opts.origin } : {}) };
      notice.evaluation[p.key] = {
        value, status: 'user_edited',
        source: {
          kind: 'user', ref: opts.source?.ref ?? 'dashboard',
          ...(opts.source?.evidence ? { evidence: opts.source.evidence } : {}), ...(opts.source?.page !== undefined ? { page: opts.source.page } : {}),
          fetchedAt: nowIso,
        },
        userEdit: { editedAt: nowIso, ...(note ? { note } : {}) },
      } as never;
    } else {
      delete item.userEdited;
      notice.evaluation[p.key] = missing() as never;
      const merged = mergeDocumentLayer(notice, docFieldsOf(extraction.items, nowIso));
      if (merged[p.key]) setFields(notice, { [p.key]: merged[p.key] });
    }
    extraction.status = computeStatus(extraction.items, extraction.files.map((f) => f.status));
    notice.updatedAt = nowIso;
    await ns.saveExtraction(notice, extraction);
    return { notice, extraction };
  });
}

/**
 * 임의의 공고 필드(custom.* 포함)를 사용자 수정으로 바꾸거나(value) 자동값으로 되돌린다(null).
 * ExtractionKey는 extraction이 있으면 editExtraction에 맡기고, 없을 때만 notice에 직접 쓴다.
 */
export async function editNoticeField(
  store: IFileStore,
  p: { noticeId: string; key: string; value: unknown | null; raw?: string; note?: string },
  opts: { now?: () => Date; isBusy?: (noticeId: string) => boolean; source?: { ref: string; evidence?: string; page?: number } } = {},
): Promise<{ notice: Notice; extraction: Extraction | null }> {
  const key = p.key;
  if (!isEditableKey(key)) throw err('INVALID_KEY', `수정할 수 없는 항목: ${String(key)}`);
  if (p.note !== undefined && (typeof p.note !== 'string' || p.note.length > 500)) throw err('INVALID_VALUE', 'note는 500자 이하 문자열이어야 합니다.');
  const ns = new NoticeStore(store);
  if ((EXTRACTION_KEYS as string[]).includes(key)) {
    if (await ns.loadExtraction(p.noticeId)) return editExtraction(store, { ...p, key: key as ExtractionKey }, { ...opts, source: opts.source });
  }
  const value = p.value === undefined ? null : p.value;
  if (value !== null) {
    const v = validateFieldValue(key, value, p.raw);
    if (!v.ok) throw err('INVALID_VALUE', v.message);
  }
  const now = opts.now ?? (() => new Date());
  return store.withLock(editLockKey(p.noticeId), async () => {
    if (opts.isBusy?.(p.noticeId)) throw err('JOB_ALREADY_RUNNING', '같은 공고의 수집/추출 잡이 실행 중입니다.');
    const notice = await ns.loadNotice(p.noticeId);
    if (!notice) throw err('NOT_FOUND', '공고를 찾을 수 없습니다.');
    const extraction = await ns.loadExtraction(p.noticeId);
    if (extraction && (EXTRACTION_KEYS as string[]).includes(key)) throw err('JOB_ALREADY_RUNNING', '추출 결과가 방금 생성되었습니다. 다시 시도하세요.');
    const isCustom = key.startsWith('custom.');
    const ckey = isCustom ? key.slice('custom.'.length) : key;
    notice.customFields ??= {};
    const prev = isCustom
      ? (Object.hasOwn(notice.customFields, ckey) ? notice.customFields[ckey] : undefined)
      : getField(notice, key as NoticeFieldKey);
    const nowIso = now().toISOString();
    let next: FieldValue<unknown> | undefined;
    if (value !== null) {
      next = applyUserEdit(prev, value, nowIso, { raw: p.raw, note: p.note, ...(opts.source ? { source: opts.source } : {}) });
    } else {
      if (prev?.status !== 'user_edited') return { notice, extraction };
      next = revertUserEdit(prev);
    }
    if (isCustom) {
      if (next) notice.customFields[ckey] = next as FieldValue<string>;
      else delete notice.customFields[ckey];
    } else {
      setFields(notice, { [key as NoticeFieldKey]: next ?? missing() });
    }
    notice.updatedAt = nowIso;
    await ns.saveNotice(notice);
    return { notice, extraction };
  });
}

/** `<folder>/source/text/` 아래 파일만 읽는다. normalizePath 이후에 검증하고 2MB로 자른다. */
export async function readExtractionText(store: IFileStore, p: { noticeId: string; textPath: string }): Promise<{ text: string }> {
  const notice = await new NoticeStore(store).loadNotice(p.noticeId);
  if (!notice) throw err('NOT_FOUND', '공고를 찾을 수 없습니다.');
  let path: string;
  try { path = normalizePath(p.textPath); } catch { throw err('PATH_FORBIDDEN', '허용되지 않은 경로입니다.'); }
  if (!path.startsWith(`${normalizePath(notice.folder)}/source/text/`)) throw err('PATH_FORBIDDEN', '허용되지 않은 경로입니다.');
  const bytes = await store.readBytes(path);
  return { text: new TextDecoder().decode(bytes.length > TEXT_MAX_BYTES ? bytes.subarray(0, TEXT_MAX_BYTES) : bytes) };
}

/** 검색용 코퍼스. 상세화면 전문(priority 0)과 parsed 첨부 txt를 한 번에 읽는다. 파일당 2MB, 총 NOTICE_TEXTS_MAX_CHARS 초과분은 skipped budget. NEEDS_FS_PERMISSION은 그대로 던진다. */
export async function readNoticeTexts(store: IFileStore, p: { noticeId: string }): Promise<NoticeTexts> {
  const ns = new NoticeStore(store);
  const notice = await ns.loadNotice(p.noticeId);
  if (!notice) throw err('NOT_FOUND', '공고를 찾을 수 없습니다.');
  const extraction = await ns.loadExtraction(p.noticeId);
  const prefix = `${normalizePath(notice.folder)}/source/text/`;
  const out: NoticeTexts = { noticeId: p.noticeId, extractionJobId: extraction?.jobId ?? null, files: [], skipped: [], totalChars: 0 };

  const load = async (base: Omit<NoticeTextFile, 'text' | 'truncated'>) => {
    if (out.totalChars >= NOTICE_TEXTS_MAX_CHARS) {
      out.files.push({ ...base, text: '', truncated: false });
      out.skipped.push({ name: base.name, reason: 'budget' });
      return;
    }
    let bytes: Uint8Array;
    try {
      const path = normalizePath(base.textPath);
      if (!path.startsWith(prefix)) throw new Error('forbidden');
      bytes = await store.readBytes(path);
    } catch (e) {
      if ((e as { code?: string }).code === 'NEEDS_FS_PERMISSION') throw e;
      out.skipped.push({ name: base.name, reason: 'failed' });
      return;
    }
    const cut = bytes.length > TEXT_MAX_BYTES;
    const text = new TextDecoder().decode(cut ? bytes.subarray(0, TEXT_MAX_BYTES) : bytes);
    if (out.totalChars + text.length > NOTICE_TEXTS_MAX_CHARS) {
      out.files.push({ ...base, text: '', truncated: false });
      out.skipped.push({ name: base.name, reason: 'budget' });
      return;
    }
    out.files.push({ ...base, text, truncated: cut });
    out.totalChars += text.length;
  };

  if (notice.detailText?.textPath) {
    await load({ id: 'detail', kind: 'detail', textPath: notice.detailText.textPath, name: DETAIL_TEXT_NAME, priority: 0 });
  }
  const parsed = (extraction?.files ?? []).map((f, i) => ({ f, i })).filter(({ f }) => f.status === 'parsed' && f.textPath)
    .sort((a, b) => a.f.priority - b.f.priority || a.i - b.i);
  for (const { f, i } of parsed) {
    await load({
      id: `att:${i}`, kind: 'attachment', textPath: f.textPath!, name: f.innerPath ? `${f.name} › ${f.innerPath}` : f.name,
      docKind: f.docKind, ...(f.origin ? { origin: f.origin } : {}), attachmentId: f.attachmentId,
      ...(f.innerPath ? { innerPath: f.innerPath } : {}), priority: f.priority,
    });
  }
  return out;
}
