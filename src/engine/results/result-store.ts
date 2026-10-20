import type { IndexEntry } from '../../core/types/index-file';
import type { ISODate } from '../../core/types/common';
import type { ResultFile } from '../../core/types/result';
import { readJson, writeJson } from '../file-store/json-store';
import type { IFileStore } from '../file-store/types';

export const RESULTS_PATH = 'results.json';
/** results.json과 follows.json을 함께 고치는 쓰기 구간의 락 키 */
export const RESULTS_LOCK = RESULTS_PATH;

export const isPermission = (e: unknown): boolean => (e as { code?: string })?.code === 'NEEDS_FS_PERMISSION' || (e as { code?: string })?.code === 'DISK_FULL';

export const emptyResults = (): ResultFile => ({ schemaVersion: 1, bizNo: '', updatedAt: new Date(0).toISOString(), entries: {} });

/** results.json(파생 캐시). 없거나 손상이면 빈 파일로 취급하고, 권한 오류만 던진다. */
export class ResultStore {
  constructor(private store: IFileStore) {}

  async load(): Promise<ResultFile> {
    try {
      const f = await readJson<ResultFile>(this.store, RESULTS_PATH);
      if (f && f.schemaVersion === 1 && f.entries && typeof f.entries === 'object' && !Array.isArray(f.entries)) return f;
    } catch (e) {
      if (isPermission(e)) throw e;
    }
    return emptyResults();
  }

  async save(f: ResultFile): Promise<void> {
    await writeJson(this.store, RESULTS_PATH, f);
  }
}

export interface NoticeSchedule { openingAt: ISODate | null; bidCloseAt: ISODate | null; proposalEvalAt: ISODate | null }

/** notice.json에서 일정만 읽는다. 없거나 손상이면 null, 권한 오류만 던진다. */
export async function readSchedule(store: IFileStore, entry: Pick<IndexEntry, 'folder'>): Promise<NoticeSchedule | null> {
  try {
    const n = await readJson<{ schedule?: Record<string, { value?: unknown } | undefined> }>(store, `${entry.folder}/notice.json`);
    const pick = (k: string): ISODate | null => {
      const v = n?.schedule?.[k]?.value;
      return typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null;
    };
    return { openingAt: pick('openingAt'), bidCloseAt: pick('bidCloseAt'), proposalEvalAt: pick('proposalEvalAt') };
  } catch (e) {
    if (isPermission(e)) throw e;
    return null;
  }
}
