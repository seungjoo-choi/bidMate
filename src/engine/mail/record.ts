import type { ComposeRecord } from '../../core/types/compose';
import { readJson, writeJson } from '../file-store/json-store';
import type { IFileStore } from '../file-store/types';
import { editLockKey, NoticeStore } from '../notices/notice-store';

export const mailRecordPath = (folder: string): string => `${folder}/mail.json`;

/** `<folder>/mail.json`에 기록을 추가한다. 파일이 없거나 손상되면 빈 배열에서 시작한다. */
export async function appendComposeRecord(store: IFileStore, folder: string, record: ComposeRecord): Promise<void> {
  const path = mailRecordPath(folder);
  await store.withLock(path, async () => {
    let list: ComposeRecord[] = [];
    try {
      const v = await readJson<unknown>(store, path);
      if (Array.isArray(v)) list = v as ComposeRecord[];
    } catch (e) {
      if ((e as { code?: string } | null)?.code === 'NEEDS_FS_PERMISSION') throw e;
    }
    list.push(record);
    await writeJson(store, path, list);
  });
}

/**
 * notice.mail을 갱신한다(failed이면 건드리지 않음). 이미 delivered면 status는 유지한다.
 * editLockKey 락 안이므로 saveNotice를 직접 쓴다(saveNoticeLatest 금지: 같은 락을 다시 잡아 교착).
 */
export async function markComposed(
  store: IFileStore, noticeId: string, outcome: ComposeRecord['outcome'], now: Date,
): Promise<void> {
  if (outcome === 'failed') return;
  const ns = new NoticeStore(store);
  await store.withLock(editLockKey(noticeId), async () => {
    const notice = await ns.loadNotice(noticeId);
    if (!notice) return;
    const iso = now.toISOString();
    notice.mail = { ...notice.mail, status: notice.mail.status === 'delivered' ? 'delivered' : 'ready_for_review', lastComposedAt: iso };
    notice.updatedAt = iso;
    await ns.saveNotice(notice);
  });
}
