import { attributeCompose, deriveMailStatus, legacyRecord, sentIndexEntryOf, summaryOf } from '../../core/mail/sent-derive';
import type { ComposeRecord, SendRecord, SentIndexEntry, SentIndexFile } from '../../core/types/compose';
import type { Notice } from '../../core/types/notice';
import type { MailProvider } from '../../core/types/settings';
import { readJson, writeJson } from '../file-store/json-store';
import type { IFileStore } from '../file-store/types';
import { editLockKey, NoticeStore } from '../notices/notice-store';
import { mailRecordPath } from './record';
import { readDraft } from './prepare';

export const SENT_INDEX_PATH = 'mail-sent-index.json';
export const sentPath = (folder: string): string => `${folder}/mail-sent.json`;

const INDEX_WARN_BYTES = 2 * 1024 * 1024;
const NOTE_MAX = 200;
const isPermission = (e: unknown): boolean => (e as { code?: string })?.code === 'NEEDS_FS_PERMISSION' || (e as { code?: string })?.code === 'DISK_FULL';
const err = (code: string, message: string) => Object.assign(new Error(message), { code });

type Confirmation = 'ui_gone' | 'toast' | 'unload';
interface MutateOpts { checkBusy?: boolean }
interface MutateOut<T> { records: SendRecord[] | null; result: T; touchNotice?: boolean }

export class SentStore {
  private ns: NoticeStore;
  constructor(private store: IFileStore, private opts: { isBusy?: (noticeId: string) => boolean } = {}) { this.ns = new NoticeStore(store); }

  /** 파일의 기록. 없거나 손상이면 옛 delivered 공고에 한해 legacy 1건을 합성한다. 권한 오류만 던진다. */
  async list(noticeId: string): Promise<SendRecord[]> {
    const notice = await this.ns.loadNotice(noticeId);
    if (!notice) return [];
    return (await this.readRecords(notice.folder)) ?? this.legacyOf(notice);
  }

  async loadIndex(): Promise<SentIndexFile> {
    const idx = await this.readIndex();
    if (idx) return idx;
    return this.store.withLock(SENT_INDEX_PATH, async () => {
      const again = await this.readIndex();
      if (again) return again;
      const scanned = await this.scan();
      await writeJson(this.store, SENT_INDEX_PATH, scanned);
      return scanned;
    });
  }

  async addManual(p: { noticeId: string; sentAt?: string; note?: string }, now: Date): Promise<{ record: SendRecord; notice: Notice }> {
    let sentAt = now.toISOString();
    if (p.sentAt !== undefined) {
      const t = Date.parse(p.sentAt);
      if (Number.isNaN(t)) throw err('INVALID_VALUE', '발송 시각이 올바르지 않습니다.');
      sentAt = new Date(t).toISOString();
    }
    const note = p.note?.trim().slice(0, NOTE_MAX);
    const out = await this.mutate<SendRecord>(p.noticeId, async (records, notice) => {
      const composes = await this.readComposes(notice.folder);
      const c = attributeCompose(records, composes);
      const record: SendRecord = {
        id: crypto.randomUUID(), noticeId: p.noticeId, sentAt, recordedAt: now.toISOString(), source: 'manual',
        ...(c ? { composeRecordId: c.id, jobId: c.jobId } : {}),
        summary: summaryOf(c, c ? null : await readDraft(this.store, notice.folder)),
        ...(note ? { note } : {}),
      };
      return { records: [...records, record], result: record };
    }, { checkBusy: true });
    return { record: out.result, notice: out.notice };
  }

  async recordAuto(
    p: { noticeId: string; jobId: string; composeRecordId?: string; provider?: MailProvider; kind: 'click' | 'hotkey' },
    now: Date,
  ): Promise<{ record: SendRecord | null }> {
    const out = await this.mutate<SendRecord | null>(p.noticeId, async (records, notice) => {
      // 같은 composeRecordId의 기록(출처 무관, 취소된 것 포함)이 있으면 버린다. composeRecordId가 없으면 같은 jobId의 auto 기록.
      const dup = p.composeRecordId
        ? records.some((r) => r.composeRecordId === p.composeRecordId)
        : records.some((r) => r.source === 'auto' && !r.composeRecordId && r.jobId === p.jobId);
      if (dup) return { records: null, result: null };
      const c = p.composeRecordId ? (await this.readComposes(notice.folder)).find((x) => x.id === p.composeRecordId) ?? null : null;
      const iso = now.toISOString();
      const record: SendRecord = {
        id: crypto.randomUUID(), noticeId: p.noticeId, sentAt: iso, recordedAt: iso, source: 'auto',
        ...(p.provider ? { provider: p.provider } : {}),
        ...(p.composeRecordId ? { composeRecordId: p.composeRecordId } : {}),
        jobId: p.jobId, signal: { kind: p.kind, confirmed: false },
        summary: summaryOf(c, c ? null : await readDraft(this.store, notice.folder)),
      };
      return { records: [...records, record], result: record };
    });
    return { record: out.result };
  }

  /** composeRecordId(없으면 jobId)로 취소 안 된 auto 기록을 찾아 확인 정보를 갱신한다. 없으면 무시. */
  async confirmAuto(p: { noticeId: string; jobId: string; composeRecordId?: string; confirmation: Confirmation }): Promise<void> {
    try {
      await this.mutate<null>(p.noticeId, async (records) => {
        const hit = records.find((r) => r.source === 'auto' && !r.voidedAt && r.signal
          && (p.composeRecordId ? r.composeRecordId === p.composeRecordId : !r.composeRecordId && r.jobId === p.jobId));
        if (!hit) return { records: null, result: null };
        const next = records.map((r) => (r === hit ? { ...r, signal: { ...r.signal!, confirmed: true, confirmation: p.confirmation } } : r));
        return { records: next, result: null, touchNotice: false };
      });
    } catch (e) {
      if ((e as { code?: string }).code !== 'NOT_FOUND') throw e;
    }
  }

  async voidRecord(p: { noticeId: string; recordId: string }, now: Date): Promise<{ notice: Notice }> {
    const out = await this.mutate<null>(p.noticeId, async (records) => {
      const hit = records.find((r) => r.id === p.recordId);
      if (!hit) throw err('NOT_FOUND', '발송 기록을 찾을 수 없습니다.');
      if (hit.voidedAt) return { records: null, result: null };
      return { records: records.map((r) => (r === hit ? { ...r, voidedAt: now.toISOString() } : r)), result: null };
    }, { checkBusy: true });
    return { notice: out.notice };
  }

  /**
   * editLockKey 안에서 notice와 기록을 읽고(legacy는 합성해 함께 쓴다), fn이 새 기록 목록을 주면
   * mail-sent-index.json 락 안에서 파일과 index를 쓴 뒤, 락 밖에서 notice.mail을 재계산해 저장한다.
   * 락 순서: editLockKey -> SENT_INDEX_PATH. index 락 안에서 notice를 저장하지 않는다(saveNoticeLatest 금지).
   */
  private async mutate<T>(
    noticeId: string, fn: (records: SendRecord[], notice: Notice) => Promise<MutateOut<T>>, mo: MutateOpts = {},
  ): Promise<{ result: T; notice: Notice }> {
    return this.store.withLock(editLockKey(noticeId), async () => {
      if (mo.checkBusy && this.opts.isBusy?.(noticeId)) throw err('JOB_ALREADY_RUNNING', '같은 공고의 수집/추출 잡이 실행 중입니다.');
      const notice = await this.ns.loadNotice(noticeId);
      if (!notice) throw err('NOT_FOUND', '공고를 찾을 수 없습니다.');
      // 쓰기 경로: 파일이 있는데 읽을 수 없으면 덮어쓰지 않는다.
      const current = (await this.readRecords(notice.folder, true)) ?? this.legacyOf(notice);
      const out = await fn(current, notice);
      if (!out.records) return { result: out.result, notice };
      const records = out.records;
      const entry = (await this.ns.loadIndex()).notices.find((e) => e.noticeId === noticeId);
      let indexError: unknown = null;
      await this.store.withLock(SENT_INDEX_PATH, async () => {
        await writeJson(this.store, sentPath(notice.folder), records);
        try {
          const idx = await this.loadIndexRaw();
          const rest = idx.entries.filter((e) => e.noticeId !== noticeId);
          const mine = entry ? records.map((r) => sentIndexEntryOf(r, entry)) : [];
          await writeJson(this.store, SENT_INDEX_PATH, { ...idx, entries: [...rest, ...mine], generatedAt: new Date().toISOString() });
        } catch (e) {
          if ((e as { code?: string } | null)?.code === 'NEEDS_FS_PERMISSION') throw e;
          // 레코드 파일은 저장됐다. index는 지워 다음 loadIndex에서 재생성되게 하고, 지우기까지 실패하면 notice 저장 뒤 오류를 던진다.
          try {
            await this.store.remove(SENT_INDEX_PATH);
            console.warn(`[bidmate] ${SENT_INDEX_PATH} 쓰기에 실패해 삭제했습니다(다음 조회 때 재생성)`);
          } catch { indexError = e; }
        }
      });
      if (out.touchNotice === false) {
        if (indexError) throw indexError;
        return { result: out.result, notice };
      }
      notice.mail = deriveMailStatus(records, (await readDraft(this.store, notice.folder)) !== null, notice.mail);
      notice.updatedAt = new Date().toISOString();
      await this.ns.saveNotice(notice);
      if (indexError) throw indexError;
      return { result: out.result, notice };
    });
  }

  private legacyOf(notice: Notice): SendRecord[] {
    const l = legacyRecord(notice);
    return l ? [l] : [];
  }

  /** 없거나 손상이면 null. 권한 오류만 던진다. strict면 파일이 있는데 읽을 수 없을 때 CONFIG_CORRUPT를 던진다. */
  private async readRecords(folder: string, strict = false): Promise<SendRecord[] | null> {
    const corrupt = () => err('CONFIG_CORRUPT', '발송 기록 파일이 손상되어 기록하지 않았습니다.');
    try {
      const v = await readJson<unknown>(this.store, sentPath(folder));
      if (Array.isArray(v)) return v as SendRecord[];
      if (strict) throw corrupt();
      return null;
    } catch (e) {
      const x = e as { code?: string; name?: string };
      if (isPermission(e) || x.code === 'CONFIG_CORRUPT') throw e;
      if (strict && x.name !== 'NotFoundError' && x.code !== 'NOT_FOUND') throw corrupt();
      return null;
    }
  }

  private async readComposes(folder: string): Promise<ComposeRecord[]> {
    try {
      const v = await readJson<unknown>(this.store, mailRecordPath(folder));
      return Array.isArray(v) ? (v as ComposeRecord[]) : [];
    } catch (e) {
      if (isPermission(e)) throw e;
      return [];
    }
  }

  private async readIndex(): Promise<SentIndexFile | null> {
    try {
      const idx = await readJson<SentIndexFile>(this.store, SENT_INDEX_PATH);
      if (idx && idx.schemaVersion === 1 && Array.isArray(idx.entries)) {
        const size = await this.store.fileSize(SENT_INDEX_PATH);
        if (size !== null && size > INDEX_WARN_BYTES) console.warn(`[bidmate] ${SENT_INDEX_PATH}가 2MB를 넘었습니다(${size}바이트)`);
        return idx;
      }
    } catch (e) { if (isPermission(e)) throw e; }
    return null;
  }

  // index 락 안에서만 호출한다.
  private async loadIndexRaw(): Promise<SentIndexFile> {
    return (await this.readIndex()) ?? this.scan();
  }

  /** index.json의 공고를 돌며 mail-sent.json(없으면 legacy)에서 재생성한다. */
  private async scan(): Promise<SentIndexFile> {
    const entries: SentIndexEntry[] = [];
    for (const e of (await this.ns.loadIndex()).notices) {
      try {
        let records = await this.readRecords(e.folder);
        if (!records && e.mailStatus === 'delivered') {
          const n = await this.ns.loadNotice(e.noticeId);
          records = n ? this.legacyOf(n) : [];
        }
        for (const r of records ?? []) entries.push(sentIndexEntryOf(r, e));
      } catch (err2) { if (isPermission(err2)) throw err2; /* 손상된 항목은 건너뜀 */ }
    }
    return { schemaVersion: 1, generatedAt: new Date().toISOString(), entries };
  }
}
