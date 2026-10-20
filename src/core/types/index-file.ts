import type { CollectStatus, MailStatus, NoticeKind } from './notice';
import type { ExtractionStatus } from './extraction';
import type { ISODate } from './common';
import type { FollowTarget, ResultStatus } from './result';

export interface IndexEntry {
  kind?: NoticeKind;   // 없음 = bid
  noticeId: string; noticeNo: string; round: string; title: string; orderingOrg: string; folder: string;
  collectedAt: ISODate; bidCloseAt?: ISODate; collectStatus: CollectStatus;
  attachments: { total: number; saved: number; failed: number };
  extractionStatus: ExtractionStatus; mailStatus: MailStatus; lastComposedAt?: ISODate;
  isCorrection: boolean; supersededBy?: string;
  /** 파생 필드. index.json에는 저장하지 않고 listNotices가 results.json/follows.json에서 합친다 */
  result?: { status: ResultStatus; rank?: number; bidders?: number; awardedAt?: ISODate; amount?: number; startAt?: ISODate; nextCheckAt?: ISODate; ourAmount?: number; openingAt?: ISODate };
  following?: FollowTarget;
  /** 입찰공고 일정(notice 파생, 재생성 안전). 사전규격은 없음. 값이 없는 키는 생략 */
  schedule?: { registrationDeadline?: ISODate; proposalEvalAt?: ISODate; openingAt?: ISODate };
}
export const INDEX_VERSION = 2 as const;
export interface IndexFile { schemaVersion: 1; indexVersion?: typeof INDEX_VERSION; generatedAt: ISODate; notices: IndexEntry[]; }
