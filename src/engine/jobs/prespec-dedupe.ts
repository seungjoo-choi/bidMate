import { attachmentNameKey } from '../../core/model/attachment-dedupe';
import type { Notice } from '../../core/types/notice';
import type { IFileStore } from '../file-store/types';

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 다운로드 후 중복 판정: 사전규격 첨부가 입찰공고 첨부와 이름 키가 같거나, 크기와 내용(sha256)이 같으면
 * 파일을 지우고 행은 skipped로 남긴다(이름이 같으면 내용이 달라도 입찰공고판이 최종본). 변경 여부를 반환한다.
 */
export async function dedupePrespec(notice: Notice, store: IFileStore): Promise<boolean> {
  const dir = `${notice.folder}/attachments`;
  const bids = notice.attachments.filter((a) => a.origin !== 'prespec' && a.status === 'saved' && a.savedName);
  const hashOf = async (a: Notice['attachments'][number]): Promise<string> => {
    if (a.sha256) return a.sha256;
    const h = await sha256Hex(await store.readBytes(`${dir}/${a.savedName}`));
    a.sha256 = h;
    return h;
  };
  let changed = false;
  for (const p of notice.attachments) {
    if (p.origin !== 'prespec' || p.status !== 'saved' || !p.savedName) continue;
    try {
      let dup = bids.find((b) => attachmentNameKey(p.originalName) === attachmentNameKey(b.originalName));
      if (!dup) {
        for (const b of bids) {
          if (p.savedSize === null || p.savedSize !== b.savedSize) continue;
          // 읽기/해시 실패는 그 bid 하나만 건너뛰고 나머지와 계속 비교한다.
          try {
            if ((await hashOf(p)) === (await hashOf(b))) { dup = b; break; }
          } catch (e) {
            console.warn('사전규격 해시 비교 실패(해당 쌍은 중복 아님)', p.originalName, b.originalName, e);
          }
        }
      }
      if (!dup) continue;
      await store.remove(`${dir}/${p.savedName}`);
      p.status = 'skipped';
      p.duplicateOf = dup.id;
      p.savedSize = null;
      p.savedAt = undefined;
      p.note = '입찰공고 첨부와 중복(사전규격)';
      changed = true;
    } catch (e) {
      console.warn('사전규격 중복 판정 실패(중복 아님으로 처리)', p.originalName, e);
    }
  }
  return changed;
}
