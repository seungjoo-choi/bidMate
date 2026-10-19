import { kindOf } from '../../core/model/ids';
import type { NoticeKind } from '../../core/types/notice';
import type { IndexFile } from '../../core/types/index-file';
import type { NoticeLookup } from '../../messaging/protocol';

/** index에서 공고를 찾는다. 차수가 없으면 모든 차수 중 최신 collectedAt. */
export function lookupInIndex(idx: IndexFile, ref: { kind?: NoticeKind; noticeNo: string; round?: string }): NoticeLookup {
  const hits = idx.notices.filter((e) => kindOf(e) === kindOf(ref) && e.noticeNo === ref.noticeNo && (!ref.round || e.round === ref.round));
  const found = [...hits].sort((a, b) => b.collectedAt.localeCompare(a.collectedAt))[0];
  return found ? { found: true, collectedAt: found.collectedAt, collectStatus: found.collectStatus, noticeId: found.noticeId, bidCloseAt: found.bidCloseAt, title: found.title } : { found: false };
}
