import type { FollowFile } from '../../core/types/result';
import { writeJson } from '../file-store/json-store';
import type { IFileStore } from '../file-store/types';
import { isPermission } from './result-store';

export const FOLLOWS_PATH = 'follows.json';

export const emptyFollows = (): FollowFile => ({ schemaVersion: 1, updatedAt: new Date(0).toISOString(), entries: {} });

/** follows.json(사용자 의사). 손상되면 follows.corrupt-<ts>.json으로 남기고 빈 파일로 시작한다. */
export class FollowStore {
  constructor(private store: IFileStore, private now: () => Date = () => new Date()) {}

  async load(): Promise<FollowFile> {
    let text: string;
    try {
      text = await this.store.readText(FOLLOWS_PATH);
    } catch (e) {
      if (isPermission(e)) throw e;
      return emptyFollows(); // 없음
    }
    try {
      const f = JSON.parse(text) as FollowFile;
      if (f && f.schemaVersion === 1 && f.entries && typeof f.entries === 'object' && !Array.isArray(f.entries)) {
        // 옛 파일(target 없음)은 final로 본다. 파일은 고쳐 쓰지 않는다.
        for (const [id, e] of Object.entries(f.entries)) {
          if (!e || typeof e !== 'object') { delete f.entries[id]; continue; } // 깨진 항목 하나로 파일 전체를 버리지 않는다
          f.entries[id] = { ...e, target: e.target === 'rank' ? 'rank' : 'final' };
        }
        return f;
      }
    } catch { /* 손상 */ }
    try {
      await this.store.writeText(`follows.corrupt-${this.now().getTime()}.json`, text);
      await this.store.remove(FOLLOWS_PATH);
    } catch (e) {
      if (isPermission(e)) throw e;
    }
    return emptyFollows();
  }

  async save(f: FollowFile): Promise<void> {
    await writeJson(this.store, FOLLOWS_PATH, f);
  }
}
