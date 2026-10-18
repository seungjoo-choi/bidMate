import type { CollectStatus, MailStatus } from './notice';
import type { ExtractionStatus } from './extraction';
import type { ISODate } from './common';

export interface IndexEntry {
  noticeId: string; noticeNo: string; round: string; title: string; orderingOrg: string; folder: string;
  collectedAt: ISODate; bidCloseAt?: ISODate; collectStatus: CollectStatus;
  attachments: { total: number; saved: number; failed: number };
  extractionStatus: ExtractionStatus; mailStatus: MailStatus; lastComposedAt?: ISODate;
  isCorrection: boolean; supersededBy?: string;
}
export interface IndexFile { schemaVersion: 1; generatedAt: ISODate; notices: IndexEntry[]; }
