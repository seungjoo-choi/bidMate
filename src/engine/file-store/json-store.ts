import type { IFileStore } from './types';

export async function readJson<T>(store: IFileStore, path: string): Promise<T> {
  return JSON.parse(await store.readText(path)) as T;
}

export async function writeJson(store: IFileStore, path: string, data: unknown): Promise<void> {
  await store.writeText(path, JSON.stringify(data, null, 2) + '\n');
}
