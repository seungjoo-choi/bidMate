import { computeStatus } from '../../core/extraction/decide';
import { mergeDocumentLayer } from '../../core/model/merge';
import { setFields } from '../../core/model/notice-fields';
import { normalizePath } from '../../core/model/path';
import { EXTRACTION_KEYS, type Extraction, type ExtractionKey } from '../../core/types/extraction';
import type { IndexEntry } from '../../core/types/index-file';
import type { Notice } from '../../core/types/notice';
import { missing } from '../../core/types/common';
import { docFieldsOf } from '../extraction/extract-step';
import type { IFileStore } from '../file-store/types';
import { editLockKey, NoticeStore } from './notice-store';

const TEXT_MAX_BYTES = 2 * 1024 * 1024;
const err = (code: string, message: string) => Object.assign(new Error(message), { code });

export async function listNotices(store: IFileStore): Promise<IndexEntry[]> {
  return (await new NoticeStore(store).loadIndex()).notices;
}

export async function getNotice(store: IFileStore, noticeId: string): Promise<{ notice: Notice; extraction: Extraction | null } | null> {
  const ns = new NoticeStore(store);
  const notice = await ns.loadNotice(noticeId);
  if (!notice) return null;
  return { notice, extraction: await ns.loadExtraction(noticeId) };
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const VALUE_CHECK: Record<ExtractionKey, (v: unknown) => boolean> = {
  credibilityScore: (v) => finite(v) && v >= 0 && v <= 1000,
  managementScore: (v) => finite(v) && v >= 0 && v <= 1000,
  performanceScore: (v) => finite(v) && v >= 0 && v <= 1000,
  performancePeriod: (v) => typeof v === 'string' && /^\d{1,2}년$/.test(v),
  performanceMinAmount: (v) => finite(v) && Number.isInteger(v) && v >= 0,
  performanceCondition: (v) => typeof v === 'string' && v.length <= 2000,
  differentialScoring: (v) => typeof v === 'boolean',
};

/**
 * value가 있으면 사용자 수정을 넣고, null이면 해제해 자동 결과로 되돌린다. 끝나면 전체 status를 다시 계산한다.
 * 같은 공고의 쓰기 잡이 실행 중이면 거부하고(isBusy), 공고 락 안에서 다시 읽은 최신 파일에 수정한다.
 */
export async function editExtraction(
  store: IFileStore, p: { noticeId: string; key: ExtractionKey; value: unknown | null; note?: string },
  opts: { now?: () => Date; isBusy?: (noticeId: string) => boolean } = {},
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
    if (!Object.hasOwn(extraction.items, p.key)) throw err('INVALID_KEY', `알 수 없는 항목: ${key}`);
    const item = extraction.items[p.key];
    const nowIso = now().toISOString();
    if (value !== null) {
      item.userEdited = { value, editedAt: nowIso, ...(p.note ? { note: p.note } : {}) };
      notice.evaluation[p.key] = { value, status: 'user_edited', source: { kind: 'user', ref: 'dashboard', fetchedAt: nowIso } } as never;
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
