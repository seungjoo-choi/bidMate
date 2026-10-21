import { kindOf } from '../../core/model/ids';
import type { ISODate } from '../../core/types/common';
import type { NoticeDeleteResult } from '../../messaging/protocol';
import { EvalStore } from '../evaluation/eval-store';
import { removeTree } from '../file-store/remove-tree';
import type { IFileStore } from '../file-store/types';
import { SentStore } from '../mail/sent-store';
import { removeTracking } from '../results/follow-api';
import { editLockKey, NoticeStore } from './notice-store';

const err = (code: string, message: string) => Object.assign(new Error(message), { code });
const isPermission = (e: unknown): boolean => (e as { code?: string } | null)?.code === 'NEEDS_FS_PERMISSION';

export interface DeleteNoticeDeps {
  store: IFileStore;
  isBusy: (noticeId: string) => boolean;
  deleteCompares: (noticeId: string) => Promise<unknown>;
  mark?: { begin(noticeId: string): void; end(noticeId: string): void };
  now?: () => Date;
}

/** nextFollowCheckAt이 undefined면 결과 추적 정리에 실패한 것이므로 호출 측은 알람을 건드리지 않는다. */
export async function deleteNotices(ids: string[], d: DeleteNoticeDeps): Promise<NoticeDeleteResult & { nextFollowCheckAt: ISODate | null | undefined }> {
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== 'string' || id === '')) {
    throw err('INVALID_VALUE', '삭제할 공고가 올바르지 않습니다.');
  }
  const now = d.now ?? (() => new Date());
  const ns = new NoticeStore(d.store);
  const sentStore = new SentStore(d.store);
  const deleted: string[] = [];
  const failed: NoticeDeleteResult['failed'] = [];

  for (const id of [...new Set(ids)]) {
    d.mark?.begin(id);
    try {
      await d.store.withLock(editLockKey(id), async () => {
        if (d.isBusy(id)) throw err('JOB_ALREADY_RUNNING', '이 공고의 수집·추출·메일 작성 또는 AI 실행이 진행 중입니다.');
        const entry = await ns.findEntry(id);
        if (!entry) return;
        const notice = await ns.loadNotice(id).catch((e) => { if (isPermission(e)) throw e; return null; });
        await sentStore.archiveForDelete(entry, notice, now());
        await removeTree(d.store, entry.folder);
        await ns.removeFromIndex(id);
        if (kindOf(entry) === 'bid') {
          try { await new EvalStore(d.store).remove(id); } catch (e) { if (isPermission(e)) throw e; console.warn(`[bidmate] 평가 기록 삭제 실패: ${id}`, e); }
        }
        try { await d.deleteCompares(id); } catch (e) { if (isPermission(e)) throw e; console.warn(`[bidmate] RFP 비교 삭제 실패: ${id}`, e); }
      });
      deleted.push(id);
    } catch (e) {
      if (isPermission(e)) throw e;
      const x = e as { code?: string; message?: string };
      failed.push({ noticeId: id, code: x.code ?? 'DELETE_FAILED', message: x.message ?? '삭제하지 못했습니다.' });
    } finally {
      d.mark?.end(id);
    }
  }

  let nextFollowCheckAt: ISODate | null | undefined;
  try {
    nextFollowCheckAt = (await removeTracking(d.store, deleted, { now })).nextFollowCheckAt;
  } catch (e) {
    if (isPermission(e)) throw e;
    console.warn('[bidmate] 결과 추적 정리 실패', e);
    nextFollowCheckAt = undefined;
  }
  return { deleted, failed, nextFollowCheckAt };
}
