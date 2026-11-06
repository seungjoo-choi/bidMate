import { sanitizeSegment } from '../../core/model/sanitize';
import { normalizeExtraction } from '../../core/model/extraction-compat';
import { kindOf } from '../../core/model/ids';
import { fillMissingFields } from '../../core/model/notice-fields';
import { computeStatus } from '../../core/extraction/decide';
import { EXTRACTION_KEYS, type Extraction, type ExtractionStatus } from '../../core/types/extraction';
import { INDEX_VERSION, type IndexEntry, type IndexFile } from '../../core/types/index-file';
import type { Notice } from '../../core/types/notice';
import { readJson, writeJson } from '../file-store/json-store';
import type { IFileStore } from '../file-store/types';

const INDEX_PATH = 'index.json';
const NOTICES_DIR = 'notices';

/** 입찰공고 일정 파생값. 사전규격이거나 값이 하나도 없으면 undefined. */
function scheduleOf(n: Notice): IndexEntry['schedule'] {
  if (kindOf(n.ref) === 'prespec') return undefined;
  const schedule: NonNullable<IndexEntry['schedule']> = {};
  for (const k of ['registrationDeadline', 'proposalEvalAt', 'openingAt'] as const) {
    const v = n.schedule[k].value;
    if (typeof v === 'string') schedule[k] = v;
  }
  return Object.keys(schedule).length > 0 ? schedule : undefined;
}

export function entryOf(n: Notice, prev?: IndexEntry, extractionStatus?: ExtractionStatus): IndexEntry {
  const att = n.attachments;
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const isPrespec = kindOf(n.ref) === 'prespec';
  const schedule = scheduleOf(n);
  const demandOrg = str(n.basic.demandOrg.value);
  return {
    ...(kindOf(n.ref) !== 'bid' ? { kind: kindOf(n.ref) } : {}),
    noticeId: n.id,
    noticeNo: str(n.basic.noticeNo.value) || n.ref.noticeNo,
    round: str(n.basic.round.value) || n.ref.round || '',
    title: str(n.basic.title.value),
    orderingOrg: str(n.basic.orderingOrg.value),
    ...(demandOrg ? { demandOrg } : {}),
    folder: n.folder,
    collectedAt: n.collect.collectedAt,
    // 사전규격은 의견등록마감일시를 bidCloseAt 자리에 의도적으로 재사용한다(목록의 '마감' 열).
    bidCloseAt: (isPrespec ? n.prespec.opinionCloseAt.value : n.schedule.bidCloseAt.value) ?? undefined,
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
    ...(schedule ? { schedule } : {}),
    ...(n.reannounceOf ? { reannounceOf: n.reannounceOf } : {}),
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

  /** index.json을 읽는다. 없거나 손상되면 notice.json을 스캔해 재생성하고, 옛 버전이면 항목을 유지한 채 보충한다. */
  async loadIndex(): Promise<IndexFile> {
    try {
      const idx = await readJson<IndexFile>(this.store, INDEX_PATH);
      if (idx && idx.schemaVersion === 1 && Array.isArray(idx.notices)) {
        return idx.indexVersion === INDEX_VERSION ? idx : this.migrateIndex();
      }
    } catch (e) {
      if ((e as { code?: string }).code === 'NEEDS_FS_PERMISSION' || (e as { code?: string }).code === 'DISK_FULL') throw e;
    }
    return this.rebuildIndex();
  }

  /** 옛 index에 schedule(입찰공고)·demandOrg를 보충한다. 보충이 필요한 항목만 notice.json을 한 번 읽는다. 항목은 지우지 않고, 못 읽은 항목은 그대로 둔다. */
  private migrateIndex(): Promise<IndexFile> {
    return this.store.withLock(INDEX_PATH, async () => {
      const idx = await this.loadIndexRaw();
      if (idx.indexVersion === INDEX_VERSION) return idx;
      for (let i = 0; i < idx.notices.length; i++) {
        const e = idx.notices[i]!;
        const needSchedule = e.kind !== 'prespec' && !e.schedule;
        const needDemandOrg = !('demandOrg' in e);
        if (!needSchedule && !needDemandOrg) continue;
        try {
          const n = fillMissingFields(await readJson<Notice>(this.store, `${e.folder}/notice.json`));
          const next: IndexEntry = { ...e };
          if (needSchedule) {
            const schedule = scheduleOf(n);
            if (schedule) next.schedule = schedule;
          }
          if (needDemandOrg) {
            const v = n.basic.demandOrg.value;
            if (typeof v === 'string' && v) next.demandOrg = v;
          }
          idx.notices[i] = next;
        } catch (err) {
          if ((err as { code?: string }).code === 'NEEDS_FS_PERMISSION') throw err;
        }
      }
      idx.indexVersion = INDEX_VERSION;
      await writeJson(this.store, INDEX_PATH, idx);
      return idx;
    });
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

  async findEntry(noticeId: string): Promise<IndexEntry | undefined> {
    return (await this.loadIndex()).notices.find((e) => e.noticeId === noticeId);
  }

  /** index에서 항목을 빼고, 다른 항목의 supersededBy가 이 공고면 그 필드도 지운다. 변화가 없으면 쓰지 않고 false. */
  removeFromIndex(noticeId: string): Promise<boolean> {
    return this.store.withLock(INDEX_PATH, async () => {
      const idx = await this.loadIndexRaw();
      let changed = false;
      const notices: IndexEntry[] = [];
      for (const e of idx.notices) {
        if (e.noticeId === noticeId) { changed = true; continue; }
        if (e.supersededBy === noticeId) {
          const { supersededBy: _drop, ...rest } = e;
          notices.push(rest);
          changed = true;
        } else notices.push(e);
      }
      if (!changed) return false;
      await writeJson(this.store, INDEX_PATH, { ...idx, notices, generatedAt: new Date().toISOString() });
      return true;
    });
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

  /** notice.json → index.json 순서로 쓴다. raw(배열 가능)가 있으면 각각 source/api-<operation>.json도 쓴다. */
  async saveNotice(n: Notice, raw?: { operation: string; item: unknown } | Array<{ operation: string; item: unknown }>, opts?: { extractionStatus?: ExtractionStatus }): Promise<void> {
    for (const r of raw === undefined ? [] : Array.isArray(raw) ? raw : [raw]) await writeJson(this.store, `${n.folder}/source/api-${r.operation}.json`, r.item);
    await this.store.withLock(`${n.folder}/notice.json`, () => writeJson(this.store, `${n.folder}/notice.json`, n));
    await this.store.withLock(INDEX_PATH, async () => {
      const idx = await this.loadIndexRaw();
      const i = idx.notices.findIndex((e) => e.noticeId === n.id);
      const entry = entryOf(n, idx.notices[i], opts?.extractionStatus);
      if (i >= 0) idx.notices[i] = entry;
      else idx.notices.push(entry);
      idx.generatedAt = new Date().toISOString();
      // 옛 버전 index는 버전을 올리지 않는다. 다음 loadIndex의 migrateIndex가 나머지 항목을 보충한다.
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

  private setUserEdited(n: Notice, k: string, value: unknown, fetchedAt: string, note?: string): void {
    (n.evaluation as unknown as Record<string, unknown>)[k] = {
      value, status: 'user_edited', source: { kind: 'user', ref: 'dashboard', fetchedAt },
      userEdit: { editedAt: fetchedAt, ...(note ? { note } : {}) },
    };
  }

  /** 취소 등 extraction 없이 notice만 저장할 때: 공고 락 안에서 디스크의 사용자 수정을 다시 반영한다. */
  async saveNoticeLatest(n: Notice): Promise<void> {
    await this.store.withLock(editLockKey(n.id), async () => {
      const diskX = await this.loadExtraction(n.id);
      for (const k of EXTRACTION_KEYS) {
        const theirs = diskX?.items?.[k]?.userEdited;
        if (theirs) this.setUserEdited(n, k, theirs.value, theirs.editedAt, theirs.note);
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
          this.setUserEdited(n, k, theirs.value, theirs.editedAt, theirs.note);
        } else if (!diskX && dField?.status === 'user_edited') {
          // 추출 전에 notice/field-edit로 notice에만 고친 값: 첫 추출 결과로 옮겨 심는다.
          const editedAt = dField.userEdit?.editedAt ?? dField.source?.fetchedAt ?? new Date().toISOString();
          const note = dField.userEdit?.note;
          x.items[k].userEdited = { value: dField.value, editedAt, ...(note ? { note } : {}) };
          (n.evaluation as unknown as Record<string, unknown>)[k] = dField;
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
    return { schemaVersion: 1, indexVersion: INDEX_VERSION, generatedAt: new Date().toISOString(), notices };
  }
}
