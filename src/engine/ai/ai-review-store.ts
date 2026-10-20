import { AI_MAX_RUNS, type AiReviewFile, type AiRun } from '../../core/types/ai';
import { readJson, writeJson } from '../file-store/json-store';
import type { IFileStore } from '../file-store/types';

export const aiReviewPath = (folder: string): string => `${folder}/ai-review.json`;
export const aiPromptPath = (folder: string, runId: string): string => `${folder}/ai/${runId}-prompt.txt`;
export const aiResponsePath = (folder: string, runId: string): string => `${folder}/ai/${runId}-response.txt`;

type NoticeRefLike = { id: string; folder: string };
const isFatal = (e: unknown) => ['NEEDS_FS_PERMISSION', 'DISK_FULL'].includes((e as { code?: string }).code ?? '');

/** `<folder>/ai-review.json`과 `<folder>/ai/*.txt`. 락 키는 파일 경로. */
export class AiReviewStore {
  constructor(private store: IFileStore) {}

  /** 없거나 손상되면 null. 권한 오류만 던진다. */
  async load(n: NoticeRefLike): Promise<AiReviewFile | null> {
    try {
      const f = await readJson<AiReviewFile>(this.store, aiReviewPath(n.folder));
      return f && f.schemaVersion === 1 && Array.isArray(f.runs) ? f : null;
    } catch (e) {
      if (isFatal(e)) throw e;
      return null;
    }
  }

  async save(n: NoticeRefLike, file: AiReviewFile): Promise<void> {
    await this.store.withLock(aiReviewPath(n.folder), () => writeJson(this.store, aiReviewPath(n.folder), file));
  }

  /** 락 안에서 읽고 → fn(비동기 가능) → 쓴다. 최신 먼저, AI_MAX_RUNS 초과분은 run과 txt를 지운다. */
  async mutate(n: NoticeRefLike, fn: (file: AiReviewFile) => AiReviewFile | void | Promise<AiReviewFile | void>): Promise<AiReviewFile> {
    const path = aiReviewPath(n.folder);
    return this.store.withLock(path, async () => {
      const cur = (await this.load(n)) ?? { schemaVersion: 1 as const, noticeId: n.id, runs: [] };
      const next = (await fn(cur)) ?? cur;
      // 10개 초과분은 닫힌 run 중 오래된 것부터 지운다(awaiting·requesting은 지우지 않는다).
      const dropped: AiRun[] = [];
      for (let i = next.runs.length - 1; i >= 0 && next.runs.length - dropped.length > AI_MAX_RUNS; i--) {
        const r = next.runs[i]!;
        if (r.status !== 'awaiting' && r.status !== 'requesting') dropped.push(r);
      }
      next.runs = next.runs.filter((r) => !dropped.includes(r));
      await writeJson(this.store, path, next);
      for (const r of dropped) {
        for (const p of [aiPromptPath(n.folder, r.id), aiResponsePath(n.folder, r.id)]) await this.store.remove(p).catch(() => undefined);
      }
      return next;
    });
  }

  /** 같은 id가 있으면 교체, 없으면 맨 앞에 넣는다. */
  upsertRun(n: NoticeRefLike, run: AiRun): Promise<AiReviewFile> {
    return this.mutate(n, (f) => {
      const i = f.runs.findIndex((r) => r.id === run.id);
      if (i >= 0) f.runs[i] = run; else f.runs.unshift(run);
    });
  }

  writePrompt(n: NoticeRefLike, runId: string, text: string): Promise<void> { return this.store.writeText(aiPromptPath(n.folder, runId), text); }
  readPrompt(n: NoticeRefLike, runId: string): Promise<string> { return this.store.readText(aiPromptPath(n.folder, runId)); }
  writeResponse(n: NoticeRefLike, runId: string, text: string): Promise<void> { return this.store.writeText(aiResponsePath(n.folder, runId), text); }
}
