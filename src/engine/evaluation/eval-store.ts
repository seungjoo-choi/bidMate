import type { EvalIndexEntry, EvalIndexFile, EvalRecord } from '../../core/types/evaluation';
import { readJson, writeJson } from '../file-store/json-store';
import type { IFileStore } from '../file-store/types';
import { decodeHtmlEntities as txt } from '../../core/templates/escape';

const DIR = 'evaluations';
const INDEX_PATH = `${DIR}/index.json`;
const ID_RE = /^R\d{2}[A-Z]{2}\d{8}-\d{3}$/;

const isPermission = (e: unknown): boolean => (e as { code?: string })?.code === 'NEEDS_FS_PERMISSION' || (e as { code?: string })?.code === 'DISK_FULL';
const err = (code: string, message: string) => Object.assign(new Error(message), { code });

/** 엔티티 디코딩 이전에 저장된 기록(&#40;주&#41; 등)도 글자로 보이게 읽을 때 되돌린다 */
function decodeRecord(r: EvalRecord): EvalRecord {
  return {
    ...r, title: txt(r.title), orgName: txt(r.orgName),
    bidders: r.bidders.map((b) => ({ ...b, name: txt(b.name) })),
    items: r.items.map((i) => ({ ...i, names: i.names.map(txt) })),
  };
}

function decodeIndex(idx: EvalIndexFile): EvalIndexFile {
  return {
    ...idx,
    entries: idx.entries.map((e) => ({ ...e, title: txt(e.title), orgName: txt(e.orgName), bidders: e.bidders.map((b) => ({ ...b, name: txt(b.name) })) })),
  };
}

export function entryOf(r: EvalRecord): EvalIndexEntry {
  return {
    noticeId: r.noticeId, noticeNo: r.noticeNo, round: r.round, title: r.title, orgName: r.orgName, evalNo: r.evalNo,
    status: r.status, evaluatedAt: r.evaluatedAt, collectedAt: r.collectedAt,
    bidders: r.bidders.map((b) => ({ bizNo: b.bizNo, name: b.name })),
    judgeKeys: r.judges.map((j) => j.key).filter((k): k is string => !!k),
    hasOfficial: r.official !== null,
  };
}

export class EvalStore {
  constructor(private store: IFileStore) {}

  private pathOf(noticeId: string): string {
    if (!ID_RE.test(noticeId)) throw err('EVAL_BAD_ID', '평가 기록 ID 형식이 올바르지 않습니다.');
    return `${DIR}/${noticeId}.json`;
  }

  /**
   * 파일 → index.json 순서로 쓴다. 기존 파일이 있으면 firstCollectedAt을 승계한다.
   * 저장, 삭제, index 재생성은 모두 index 락 하나로 직렬화해 파일과 index가 어긋나지 않게 한다.
   */
  async save(record: EvalRecord): Promise<EvalRecord> {
    const path = this.pathOf(record.noticeId);
    return this.store.withLock(INDEX_PATH, async () => {
      let first = record.firstCollectedAt;
      try {
        const prev = await readJson<EvalRecord>(this.store, path);
        if (typeof prev?.firstCollectedAt === 'string') first = prev.firstCollectedAt;
      } catch (e) { if (isPermission(e)) throw e; /* 없거나 손상: 새로 쓴다 */ }
      const saved = { ...record, firstCollectedAt: first };
      await writeJson(this.store, path, saved);
      const idx = await this.loadIndexRaw();
      const entry = entryOf(saved);
      const i = idx.entries.findIndex((e) => e.noticeId === saved.noticeId);
      if (i >= 0) idx.entries[i] = entry; else idx.entries.push(entry);
      idx.generatedAt = new Date().toISOString();
      await writeJson(this.store, INDEX_PATH, idx);
      return saved;
    });
  }

  /** index.json을 읽는다. 없거나 손상되면 evaluations/*.json 스캔으로 재생성한다. */
  async loadIndex(): Promise<EvalIndexFile> {
    const idx = await this.readIndex();
    if (idx) return idx;
    return this.store.withLock(INDEX_PATH, async () => {
      // 락을 기다리는 사이 다른 저장이 index를 새로 썼을 수 있다.
      const again = await this.readIndex();
      if (again) return again;
      const scanned = await this.scan();
      await writeJson(this.store, INDEX_PATH, scanned);
      return scanned;
    });
  }

  async get(noticeId: string): Promise<EvalRecord | null> {
    try {
      const r = await readJson<EvalRecord>(this.store, this.pathOf(noticeId));
      return r?.noticeId === noticeId ? decodeRecord(r) : null; // 파일명과 내용이 다른 사본은 무시
    } catch (e) {
      if (isPermission(e) || (e as { code?: string }).code === 'EVAL_BAD_ID') throw e;
      return null;
    }
  }

  /** ids가 없으면 index의 전부. 읽을 수 없는 항목은 건너뛴다. */
  async getMany(ids?: string[]): Promise<EvalRecord[]> {
    const list = ids ?? (await this.loadIndex()).entries.map((e) => e.noticeId);
    const out: EvalRecord[] = [];
    for (const id of list) {
      if (!ID_RE.test(id)) continue;
      const r = await this.get(id);
      if (r) out.push(r);
    }
    return out;
  }

  async remove(noticeId: string): Promise<boolean> {
    const path = this.pathOf(noticeId);
    return this.store.withLock(INDEX_PATH, async () => {
      const had = (await this.store.fileSize(path)) !== null;
      if (had) await this.store.remove(path);
      const idx = await this.loadIndexRaw();
      const entries = idx.entries.filter((e) => e.noticeId !== noticeId);
      if (entries.length !== idx.entries.length) {
        await writeJson(this.store, INDEX_PATH, { ...idx, entries, generatedAt: new Date().toISOString() });
      }
      return had;
    });
  }

  private async readIndex(): Promise<EvalIndexFile | null> {
    try {
      const idx = await readJson<EvalIndexFile>(this.store, INDEX_PATH);
      if (idx && idx.schemaVersion === 1 && Array.isArray(idx.entries)) return decodeIndex(idx);
    } catch (e) { if (isPermission(e)) throw e; }
    return null;
  }

  // index 락 안에서만 호출한다.
  private async loadIndexRaw(): Promise<EvalIndexFile> {
    return (await this.readIndex()) ?? this.scan();
  }

  /** 폴더가 없으면 빈 index. 그 밖의 목록 실패는 던져서 빈 index가 저장되지 않게 한다. */
  private async scan(): Promise<EvalIndexFile> {
    let files: Array<{ name: string; kind: 'file' | 'directory' }>;
    try {
      files = await this.store.list(DIR);
    } catch (e) {
      if ((e as { name?: string })?.name !== 'NotFoundError') throw e;
      files = [];
    }
    const byId = new Map<string, EvalIndexEntry>();
    for (const f of files) {
      const id = f.name.endsWith('.json') ? f.name.slice(0, -5) : '';
      if (f.kind !== 'file' || !ID_RE.test(id)) continue; // index.json, 사본, *.crswap 제외
      try {
        const r = await readJson<EvalRecord>(this.store, `${DIR}/${f.name}`);
        if (r?.noticeId === id) byId.set(id, entryOf(decodeRecord(r)));
      } catch (e) { if (isPermission(e)) throw e; /* 손상된 항목은 건너뜀 */ }
    }
    return { schemaVersion: 1, generatedAt: new Date().toISOString(), entries: [...byId.values()] };
  }
}
