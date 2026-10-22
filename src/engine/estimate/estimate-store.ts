import { normalizeEstimate, validateScore } from '../../core/estimate/estimate';
import type { EstimateEntry, EstimateFile, EstimateKey } from '../../core/types/estimate';
import { ESTIMATE_KEYS } from '../../core/types/estimate';
import { readJson, writeJson } from '../file-store/json-store';
import type { IFileStore } from '../file-store/types';
import { NoticeStore } from '../notices/notice-store';

const NOTE_MAX = 200;
const err = (code: string, message: string) => Object.assign(new Error(message), { code });
const isNotFound = (e: unknown) => (e as { name?: string } | null)?.name === 'NotFoundError';

export const estimatePath = (folder: string): string => `${folder}/estimate.json`;

/** 파일 없음 null, 손상(JSON 파싱 실패 포함)은 빈 파일로 보정한다(쓰지 않음). */
async function readEstimate(store: IFileStore, folder: string, noticeId: string): Promise<EstimateFile | null> {
  let raw: unknown;
  try {
    raw = await readJson<unknown>(store, estimatePath(folder));
  } catch (e) {
    if (isNotFound(e)) return null;
    return normalizeEstimate(null, noticeId);
  }
  return normalizeEstimate(raw, noticeId);
}

export async function getEstimate(store: IFileStore, noticeId: string): Promise<EstimateFile | null> {
  const entry = await new NoticeStore(store).findEntry(noticeId);
  if (!entry) return null;
  return readEstimate(store, entry.folder, noticeId);
}

export async function saveEstimate(
  store: IFileStore,
  p: { noticeId: string; key: EstimateKey; score: number | null; note?: string; max: number | null },
  opts: { isBusy: (id: string) => boolean },
): Promise<EstimateFile> {
  if (!(ESTIMATE_KEYS as string[]).includes(p.key)) throw err('INVALID_KEY', `수정할 수 없는 항목: ${String(p.key)}`);
  if (p.note !== undefined && (typeof p.note !== 'string' || p.note.length > NOTE_MAX)) throw err('INVALID_VALUE', `메모는 ${NOTE_MAX}자 이하여야 합니다.`);
  const score = p.score === null || p.score === undefined ? null : validateScore(p.score, p.max);
  const entry = await new NoticeStore(store).findEntry(p.noticeId);
  if (!entry) throw err('NOT_FOUND', '공고를 찾을 수 없습니다.');
  const path = estimatePath(entry.folder);
  return store.withLock(path, async () => {
    if (opts.isBusy(p.noticeId)) throw err('JOB_ALREADY_RUNNING', '같은 공고의 수집/추출 잡이 실행 중입니다.');
    const file = (await readEstimate(store, entry.folder, p.noticeId)) ?? normalizeEstimate(null, p.noticeId);
    const nowIso = new Date().toISOString();
    if (score === null) {
      delete file.items[p.key];
    } else {
      const next: EstimateEntry = { score, updatedAt: nowIso };
      const note = p.note === undefined ? file.items[p.key]?.note : p.note;
      if (note) next.note = note;
      file.items[p.key] = next;
    }
    file.updatedAt = nowIso;
    await writeJson(store, path, file);
    return file;
  });
}
