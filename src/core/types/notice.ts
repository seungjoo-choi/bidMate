import type { FieldValue, ISODate } from './common';
import type { JobError } from './job';
import type { DocKind } from '../extraction/classify';

export type NoticeKind = 'bid' | 'prespec' | 'orderplan';
/** 수집 가능한 종류. orderplan은 유니언 예약만. */
export const COLLECTIBLE_NOTICE_KINDS: ReadonlySet<NoticeKind> = new Set<NoticeKind>(['bid', 'prespec']);
export interface NoticeRef { kind?: NoticeKind; noticeNo: string; round?: string; detailUrl?: string; origin: 'trackerbot' | 'g2b' | 'manual'; }
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
  evalMethodDoc: FieldValue<string>; quantEvalDoc: FieldValue<string>;
  priceEvalRate: FieldValue<number>;
}
export interface NoticePrespec {
  specRegNo: FieldValue<string>; specName: FieldValue<string>; bizDivision: FieldValue<string>;
  assignedBudget: FieldValue<number>; registeredAt: FieldValue<ISODate>; opinionCloseAt: FieldValue<ISODate>;
  officerName: FieldValue<string>; officerTel: FieldValue<string>; relatedBidNo: FieldValue<string>;
}
export type NoticeFieldKey = keyof NoticeBasic | keyof NoticeSchedule | keyof NoticeEvaluation | keyof NoticePrespec;
export type AttachmentStatus = 'pending' | 'downloading' | 'saved' | 'failed' | 'skipped' | 'size_mismatch';
export interface Attachment {
  id: string; index: number; originalName: string; savedName: string | null;
  url: string; expectedSize: number | null; savedSize: number | null; sha256?: string;
  mimeHint?: string; docKind?: DocKind;
  status: AttachmentStatus; attempts: number; lastError?: string; note?: string; savedAt?: ISODate;
  origin?: AttachmentOrigin;      // 없음=bid. 연계 사전규격에서 가져온 첨부면 'prespec'
  duplicateOf?: string;           // 입찰공고 첨부와 중복이라 파일을 지운 경우 그 bid 첨부 id
  namePrefix?: string;            // savedName을 정할 때 앞에 붙인 태그. 화면 표시에서는 뗀다
}
export type AttachmentOrigin = 'bid' | 'prespec';   // 없음 = bid
export interface LinkedPrespec {
  regNo: string;
  status: 'linked' | 'not_found' | 'failed';
  fetchedAt: ISODate;
  attachmentCount: number;      // linked일 때 사전규격 첨부 수(중복 포함)
  error?: string;
}
export type CollectStatus = 'collected' | 'partial' | 'failed';
export type MailStatus = 'none' | 'drafting' | 'ready_for_review' | 'delivered';   // delivered는 mail-sent.json에서 파생(자동/수동)
export interface Notice {
  schemaVersion: 1; id: string; ref: NoticeRef; folder: string;
  basic: NoticeBasic; schedule: NoticeSchedule; evaluation: NoticeEvaluation; prespec: NoticePrespec;
  customFields: Record<string, FieldValue<string>>; sourceUrl: FieldValue<string>;
  isCorrection: boolean; previousNoticeId?: string; attachments: Attachment[]; linkedPrespec?: LinkedPrespec;
  collect: { status: CollectStatus; collectedAt: ISODate; lastJobId: string; errors: JobError[] };
  mail: { status: MailStatus; groupId?: string; templateId?: string; lastComposedAt?: ISODate; deliveredAt?: ISODate; sentCount?: number };
  updatedAt: ISODate;
}
