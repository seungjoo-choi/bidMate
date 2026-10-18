import { uniqueName } from '../../core/model/names';
import type { Attachment } from '../../core/types/notice';

export interface NewAttachment { originalName: string; url: string; expectedSize: number | null }

/**
 * 재수집 시 이전 Attachment를 새 목록에 이어붙인다.
 * url이 같은 이전 항목을 우선 매칭하고, 없으면 url이 비어 있는 이전 항목을 index로 매칭한다.
 * 한 번 쓴 이전 항목은 소비된다. id는 `${noticeId}:a${index}` 고정, savedName 충돌 시 뒤쪽을 재결정한다.
 */
export function matchAttachments(prev: Attachment[], next: NewAttachment[], noticeId: string): Attachment[] {
  const used = new Set<Attachment>();
  const taken = new Set<string>();
  return next.map((n, index): Attachment => {
    let old = prev.find((p) => !used.has(p) && p.url === n.url);
    if (!old) old = prev.find((p) => !used.has(p) && !p.url && p.index === index);
    if (old) used.add(old);
    const base: Attachment = {
      id: `${noticeId}:a${index}`, index, originalName: n.originalName, savedName: null, url: n.url,
      expectedSize: n.expectedSize, savedSize: null, status: 'pending', attempts: 0,
    };
    if (!old) return base;
    const merged: Attachment = { ...old, ...base, savedName: old.savedName, savedSize: old.savedSize, status: old.status, attempts: old.attempts,
      expectedSize: old.expectedSize ?? n.expectedSize, lastError: old.lastError, savedAt: old.savedAt, sha256: old.sha256, note: old.note };
    if (merged.savedName) {
      if (taken.has(merged.savedName.toLowerCase())) {
        // 충돌: 파일명을 새로 정하게 하고 다시 받도록 되돌린다.
        merged.savedName = uniqueName(merged.savedName, taken);
        merged.status = 'pending';
        merged.savedSize = null;
        merged.savedAt = undefined;
      }
      taken.add(merged.savedName.toLowerCase());
    }
    return merged;
  });
}
