import type { ConfigList } from '../../core/types/config-file';
import { writeJson } from '../file-store/json-store';
import type { IFileStore } from '../file-store/types';

export type ConfigFile = 'recipients' | 'groups' | 'templates' | 'performances';

/** 세 config 파일의 모든 변경이 공유하는 락 키. */
export const CONFIG_LOCK = 'config';
export const CONFIG_PATHS: Record<ConfigFile, string> = {
  recipients: 'config/recipients.json',
  groups: 'config/groups.json',
  templates: 'config/templates.json',
  performances: 'config/performances.json',
};

const err = (code: string, message: string, path?: string) => Object.assign(new Error(message), path ? { code, path } : { code });
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNotFound = (e: unknown) => (e as { name?: string } | null)?.name === 'NotFoundError';

export interface LoadedList<T> {
  items: T[];
  warnings: string[];
  /** 파일이 실제로 있었는지. 없으면 빈 목록(파일은 만들지 않는다). */
  exists: boolean;
}

/** 항목 보정 함수. item이 null이면 그 항목을 제외한다. */
export type ItemNormalizer<T> = (raw: unknown, fileUpdatedAt: string) => { item: T | null; warnings: string[] };

/**
 * 읽기 전용 로더. 파일을 쓰지 않는다.
 * 파일 없음 → 빈 목록, 손상 → CONFIG_CORRUPT, schemaVersion > 1 → CONFIG_NEWER, 그 외 항목별 보정(메모리만).
 */
export async function loadList<T>(store: IFileStore, file: ConfigFile, normalize: ItemNormalizer<T>, now: Date = new Date()): Promise<LoadedList<T>> {
  const path = CONFIG_PATHS[file];
  let text: string;
  try {
    text = await store.readText(path);
  } catch (e) {
    if (isNotFound(e)) return { items: [], warnings: [], exists: false };
    throw e;
  }
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw err('CONFIG_CORRUPT', `설정 파일이 손상되었습니다: ${path}`, path); }
  if (!isObj(data)) throw err('CONFIG_CORRUPT', `설정 파일이 손상되었습니다: ${path}`, path);
  // 버전을 먼저 본다. 새 버전 형식은 items 모양이 달라도 손상이 아니다(초기화를 권하면 안 된다).
  const v = data.schemaVersion;
  if (v !== undefined && v !== 1) {
    if (Number(v) > 1) throw err('CONFIG_NEWER', `더 새로운 버전에서 만든 설정 파일입니다: ${path}`, path);
    throw err('CONFIG_CORRUPT', `설정 파일이 손상되었습니다: ${path}`, path);
  }
  if (!Array.isArray(data.items)) throw err('CONFIG_CORRUPT', `설정 파일이 손상되었습니다: ${path}`, path);
  const fileUpdatedAt = typeof data.updatedAt === 'string' && data.updatedAt ? data.updatedAt : now.toISOString();
  const items: T[] = [];
  const warnings: string[] = [];
  for (const raw of data.items) {
    const r = normalize(raw, fileUpdatedAt);
    warnings.push(...r.warnings);
    if (r.item !== null) items.push(r.item);
  }
  return { items, warnings, exists: true };
}

/** 목록 전체를 ConfigList 형식으로 쓴다. 호출 측이 withConfigLock 안에서 부른다. */
export async function saveList<T>(store: IFileStore, file: ConfigFile, items: T[], now: Date = new Date()): Promise<void> {
  const data: ConfigList<T> = { schemaVersion: 1, updatedAt: now.toISOString(), items };
  await writeJson(store, CONFIG_PATHS[file], data);
}

export function withConfigLock<T>(store: IFileStore, fn: () => Promise<T>): Promise<T> {
  return store.withLock(CONFIG_LOCK, fn);
}

/**
 * 손상된 config 파일을 백업하고 빈 ConfigList로 다시 쓴다. 사용자 버튼으로만 실행한다.
 * 원문 읽기도 실패하면 백업 없이 초기화하고 backupPath는 ''.
 */
export function repairConfig(store: IFileStore, file: ConfigFile, now: Date = new Date()): Promise<{ backupPath: string }> {
  return withConfigLock(store, async () => {
    const path = CONFIG_PATHS[file];
    let backupPath = '';
    let text: string | null = null;
    try {
      text = await store.readText(path);
    } catch (e) {
      if ((e as { code?: string } | null)?.code === 'NEEDS_FS_PERMISSION') throw e;
    }
    // 원문을 읽었으면 백업이 성공해야만 초기화한다. 백업 쓰기 실패는 그대로 던져 원본을 남긴다.
    if (text !== null) {
      backupPath = `config/${file}.corrupt-${now.toISOString().replace(/:/g, '-')}.json`;
      await store.writeText(backupPath, text);
    }
    await saveList(store, file, [], now);
    return { backupPath };
  });
}
