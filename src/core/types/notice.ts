import type { FieldValue, ISODate } from './common';
import type { JobError } from './job';
import type { DocKind } from '../extraction/classify';

export interface NoticeRef { noticeNo: string; round?: string; detailUrl?: string; origin: 'trackerbot' | 'g2b' | 'manual'; }
export interface NoticeBasic {
  noticeNo: FieldValue<string>; round: FieldValue<string>; title: FieldValue<string>;
  postedAt: FieldValue<ISODate>; noticeType: FieldValue<string>;
  orderingOrg: FieldValue<string>; demandOrg: FieldValue<string>;
  budgetAmount: FieldValue<number>; estimatedPrice: FieldValue<number>;
  projectPeriod: FieldValue<string>; contractMethod: FieldValue<string>;
  awardMethod: FieldValue<string>; priceMethod: FieldValue<string>;
  jointVentureAllowed: FieldValue<boolean>; eligibility: FieldValue<string>;
}
export interface NoticeSchedule {
  registrationDeadline: FieldValue<ISODate>; bidStartAt: FieldValue<ISODate>; bidCloseAt: FieldValue<ISODate>;
  proposalPeriod: FieldValue<string>; proposalEvalAt: FieldValue<ISODate>; openingAt: FieldValue<ISODate>;
}
export interface NoticeEvaluation {
  evalMethod: FieldValue<string>; differentialScoring: FieldValue<boolean>;
  credibilityScore: FieldValue<number>; managementScore: FieldValue<number>; performanceScore: FieldValue<number>;
  performancePeriod: FieldValue<string>; performanceMinAmount: FieldValue<number>; performanceCondition: FieldValue<string>;
}
export type NoticeFieldKey = keyof NoticeBasic | keyof NoticeSchedule | keyof NoticeEvaluation;
export type AttachmentStatus = 'pending' | 'downloading' | 'saved' | 'failed' | 'skipped' | 'size_mismatch';
export interface Attachment {
  id: string; index: number; originalName: string; savedName: string | null;
  url: string; expectedSize: number | null; savedSize: number | null; sha256?: string;
  mimeHint?: string; docKind?: DocKind;
  status: AttachmentStatus; attempts: number; lastError?: string; note?: string; savedAt?: ISODate;
}
export type CollectStatus = 'collected' | 'partial' | 'failed';
export type MailStatus = 'none' | 'drafting' | 'ready_for_review' | 'delivered';   // delivered는 사용자 수동만
export interface Notice {
  schemaVersion: 1; id: string; ref: NoticeRef; folder: string;
  basic: NoticeBasic; schedule: NoticeSchedule; evaluation: NoticeEvaluation;
  customFields: Record<string, FieldValue<string>>; sourceUrl: FieldValue<string>;
  isCorrection: boolean; previousNoticeId?: string; attachments: Attachment[];
  collect: { status: CollectStatus; collectedAt: ISODate; lastJobId: string; errors: JobError[] };
  mail: { status: MailStatus; groupId?: string; templateId?: string; lastComposedAt?: ISODate; deliveredAt?: ISODate };
  updatedAt: ISODate;
}
