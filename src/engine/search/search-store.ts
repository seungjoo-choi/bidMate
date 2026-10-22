import { ASK_MAX_RECORDS } from '../../core/search/constants';
import type { AskFile } from '../../core/types/search';
import { readJson, writeJson } from '../file-store/json-store';
import type { IFileStore } from '../file-store/types';

export const askFilePath = (folder: string): string => `${folder}/search/asks.json`;
export const askPromptPath = (folder: string, id: string): string => `${folder}/search/${id}-prompt.txt`;
export const askResponsePath = (folder: string, id: string): string => `${folder}/search/${id}-response.txt`;

type NoticeRefLike = { id: string; folder: string };
const isFatal = (e: unknown) => ['NEEDS_FS_PERMISSION', 'DISK_FULL'].includes((e as { code?: string }).code ?? '');

/** `<folder>/search/asks.json`과 `<folder>/search/*.txt`. 락 키는 파일 경로. AiReviewStore와 같은 패턴이다. */
export class AskStore {
  constructor(private store: IFileStore) {}

  /** 없거나 손상되면 null. 권한 오류만 던진다. */
  async load(n: NoticeRefLike): Promise<AskFile | null> {
    try {
      const f = await readJson<AskFile>(this.store, askFilePath(n.folder));
      return f && f.schemaVersion === 1 && Array.isArray(f.asks) ? f : null;
    } catch (e) {
      if (isFatal(e)) throw e;
      return null;
    }
  }

  /** 락 안에서 읽고 → fn → 쓴다. 최신 먼저, ASK_MAX_RECORDS 초과분은 기록과 txt를 지운다. */
  async mutate(n: NoticeRefLike, fn: (file: AskFile) => AskFile | void | Promise<AskFile | void>): Promise<AskFile> {
    const path = askFilePath(n.folder);
    return this.store.withLock(path, async () => {
      const cur = (await this.load(n)) ?? { schemaVersion: 1 as const, noticeId: n.id, asks: [] };
      const next = (await fn(cur)) ?? cur;
      const dropped = next.asks.slice(ASK_MAX_RECORDS);
      next.asks = next.asks.slice(0, ASK_MAX_RECORDS);
      await writeJson(this.store, path, next);
      for (const r of dropped) {
        for (const p of [askPromptPath(n.folder, r.id), askResponsePath(n.folder, r.id)]) await this.store.remove(p).catch(() => undefined);
      }
      return next;
    });
  }

  writePrompt(n: NoticeRefLike, id: string, text: string): Promise<void> { return this.store.writeText(askPromptPath(n.folder, id), text); }
  writeResponse(n: NoticeRefLike, id: string, text: string): Promise<void> { return this.store.writeText(askResponsePath(n.folder, id), text); }
}
