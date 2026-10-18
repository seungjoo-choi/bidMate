import { sanitizeSegment } from '../../core/model/sanitize';
import { normalizeExtraction } from '../../core/model/extraction-compat';
import { fillMissingFields } from '../../core/model/notice-fields';
import { computeStatus } from '../../core/extraction/decide';
import { EXTRACTION_KEYS, type Extraction, type ExtractionStatus } from '../../core/types/extraction';
import type { IndexEntry, IndexFile } from '../../core/types/index-file';
import type { Notice } from '../../core/types/notice';
import { readJson, writeJson } from '../file-store/json-store';
import type { IFileStore } from '../file-store/types';

const INDEX_PATH = 'index.json';
const NOTICES_DIR = 'notices';

export function entryOf(n: Notice, prev?: IndexEntry, extractionStatus?: ExtractionStatus): IndexEntry {
  const att = n.attachments;
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  return {
    noticeId: n.id,
    noticeNo: str(n.basic.noticeNo.value) || n.ref.noticeNo,
    round: str(n.basic.round.value) || n.ref.round || '',
    title: str(n.basic.title.value),
    orderingOrg: str(n.basic.orderingOrg.value),
    folder: n.folder,
    collectedAt: n.collect.collectedAt,
    bidCloseAt: n.schedule.bidCloseAt.value ?? undefined,
    collectStatus: n.collect.status,
    attachments: {
      total: att.length,
      saved: att.filter((a) => a.status === 'saved').length,
      failed: att.filter((a) => a.status === 'failed' || a.status === 'size_mismatch').length,
    },
    extractionStatus: extractionStatus ?? prev?.extractionStatus ?? 'not_run',
    mailStatus: n.mail.status,
    lastComposedAt: n.mail.lastComposedAt,
    isCorrection: n.isCorrection,
    supersededBy: prev?.supersededBy,
  };
}

/** 사용자 수정과 잡 저장이 서로 덮어쓰지 않도록 공고 단위로 직렬화하는 락 키. */
export const editLockKey = (noticeId: string): string => `notices-edit:${noticeId}`;

export class NoticeStore {
  constructor(private store: IFileStore) {}

  /** `config/` 폴더를 만들어 둔다. 내용은 이후 단계에서 채운다. */
  ensureConfigDir(): Promise<void> {
    return this.store.ensureDir('config');
  }

  /** index.json을 읽는다. 없거나 손상되면 notice.json을 스캔해 재생성한다. */
  async loadIndex(): Promise<IndexFile> {
    try {
      const idx = await readJson<IndexFile>(this.store, INDEX_PATH);
      if (idx && idx.schemaVersion === 1 && Array.isArray(idx.notices)) return idx;
    } catch (e) {
      if ((e as { code?: string }).code === 'NEEDS_FS_PERMISSION' || (e as { code?: string }).code === 'DISK_FULL') throw e;
    }
    return this.rebuildIndex();
  }

  async rebuildIndex(): Promise<IndexFile> {
    const idx = await this.scan();
    await this.store.withLock(INDEX_PATH, () => writeJson(this.store, INDEX_PATH, idx));
    return idx;
  }

  /** 기존 항목이 있으면 그 folder를 그대로 쓴다(재계산 금지). */
  async resolveFolder(noticeId: string, title: string, postedAt: string | null, nowIso: string): Promise<string> {
    const idx = await this.loadIndex();
    const found = idx.notices.find((e) => e.noticeId === noticeId);
    if (found) return found.folder;
    const year = /^\d{4}/.test(postedAt ?? '') ? (postedAt as string).slice(0, 4) : nowIso.slice(0, 4);
    return `${NOTICES_DIR}/${year}/${noticeId}_${sanitizeSegment(title, 40)}`;
  }

  async loadNotice(noticeId: string): Promise<Notice | null> {
    const idx = await this.loadIndex();
    const found = idx.notices.find((e) => e.noticeId === noticeId);
    if (!found) return null;
    try {
      return fillMissingFields(await readJson<Notice>(this.store, `${found.folder}/notice.json`));
    } catch (e) {
      if ((e as { code?: string }).code === 'NEEDS_FS_PERMISSION') throw e;
      return null;
    }
  }

  /** notice.json → index.json 순서로 쓴다. raw가 있으면 source/api-<operation>.json도 쓴다. */
  async saveNotice(n: Notice, raw?: { operation: string; item: unknown }, opts?: { extractionStatus?: ExtractionStatus }): Promise<void> {
    if (raw) await writeJson(this.store, `${n.folder}/source/api-${raw.operation}.json`, raw.item);
    await this.store.withLock(`${n.folder}/notice.json`, () => writeJson(this.store, `${n.folder}/notice.json`, n));
    await this.store.withLock(INDEX_PATH, async () => {
      const idx = await this.loadIndexRaw();
      const i = idx.notices.findIndex((e) => e.noticeId === n.id);
      const entry = entryOf(n, idx.notices[i], opts?.extractionStatus);
      if (i >= 0) idx.notices[i] = entry;
      else idx.notices.push(entry);
      idx.generatedAt = new Date().toISOString();
      await writeJson(this.store, INDEX_PATH, idx);
    });
  }

  /** 없거나 손상되면 null. 권한 오류만 던진다. */
  async loadExtraction(noticeId: string): Promise<Extraction | null> {
    const idx = await this.loadIndex();
    const found = idx.notices.find((e) => e.noticeId === noticeId);
    if (!found) return null;
    try {
      return normalizeExtraction(await readJson<Extraction>(this.store, `${found.folder}/extraction.json`));
    } catch (e) {
      if ((e as { code?: string }).code === 'NEEDS_FS_PERMISSION') throw e;
      return null;
    }
  }

  /** extraction.json(락) → notice.json → index.json 순서로 쓴다. */
  async saveExtraction(n: Notice, x: Extraction): Promise<void> {
    const path = `${n.folder}/extraction.json`;
    await this.store.withLock(path, () => writeJson(this.store, path, x));
    await this.saveNotice(n, undefined, { extractionStatus: x.status });
  }

  private setUserEdited(n: Notice, k: string, value: unknown, fetchedAt: string): void {
    (n.evaluation as unknown as Record<string, unknown>)[k] = { value, status: 'user_edited', source: { kind: 'user', ref: 'dashboard', fetchedAt } };
  }

  /** 취소 등 extraction 없이 notice만 저장할 때: 공고 락 안에서 디스크의 사용자 수정을 다시 반영한다. */
  async saveNoticeLatest(n: Notice): Promise<void> {
    await this.store.withLock(editLockKey(n.id), async () => {
      const diskX = await this.loadExtraction(n.id);
      for (const k of EXTRACTION_KEYS) {
        const theirs = diskX?.items?.[k]?.userEdited;
        if (theirs) this.setUserEdited(n, k, theirs.value, theirs.editedAt);
      }
      await this.saveNotice(n);
    });
  }

  /**
   * 잡 저장용. 공고 락 안에서 디스크의 notice.json/extraction.json을 다시 읽어, 잡이 도는 동안 들어온 사용자 수정
   * (userEdited, user_edited 필드)을 최신 값으로 합친 뒤 저장한다.
   */
  async saveExtractionLatest(n: Notice, x: Extraction): Promise<Extraction> {
    return this.store.withLock(editLockKey(n.id), async () => {
      const diskNotice = await this.loadNotice(n.id);
      const diskX = await this.loadExtraction(n.id);
      for (const k of EXTRACTION_KEYS) {
        const mine = x.items[k].userEdited;
        const theirs = diskX?.items?.[k]?.userEdited;
        const dField = diskNotice?.evaluation?.[k];
        const differs = JSON.stringify(mine) !== JSON.stringify(theirs);
        if (theirs) {
          x.items[k].userEdited = theirs;
          this.setUserEdited(n, k, theirs.value, theirs.editedAt);
        } else if (differs || n.evaluation[k].status === 'user_edited' || dField?.status === 'user_edited') {
          // 디스크에서 수정이 해제됐다: 디스크의 필드(자동 결과)를 따른다.
          delete x.items[k].userEdited;
          if (dField) (n.evaluation as unknown as Record<string, unknown>)[k] = dField;
        }
      }
      x.status = computeStatus(x.items, x.files.map((f) => f.status));
      await this.saveExtraction(n, x);
      return x;
    });
  }

  // 락 안에서 호출: rebuildIndex는 락을 다시 잡으므로 쓰지 않고 스캔 결과만 쓴다.
  private async loadIndexRaw(): Promise<IndexFile> {
    try {
      const idx = await readJson<IndexFile>(this.store, INDEX_PATH);
      if (idx && idx.schemaVersion === 1 && Array.isArray(idx.notices)) return idx;
    } catch (e) {
      if ((e as { code?: string }).code === 'NEEDS_FS_PERMISSION') throw e;
    }
    return this.scan();
  }

  private async scan(): Promise<IndexFile> {
    const notices: IndexEntry[] = [];
    const years = await this.store.list(NOTICES_DIR).catch(() => []);
    for (const y of years) {
      if (y.kind !== 'directory') continue;
      for (const f of await this.store.list(`${NOTICES_DIR}/${y.name}`).catch(() => [])) {
        if (f.kind !== 'directory') continue;
        try {
          notices.push(entryOf(await readJson<Notice>(this.store, `${NOTICES_DIR}/${y.name}/${f.name}/notice.json`)));
        } catch { /* 손상된 항목은 건너뜀 */ }
      }
    }
    return { schemaVersion: 1, generatedAt: new Date().toISOString(), notices };
  }
}
