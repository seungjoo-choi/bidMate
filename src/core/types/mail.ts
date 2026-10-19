import type { ISODate } from './common';
import type { AttachmentStatus } from './notice';
import type { Template } from './template';

export interface ResolvedValue { text: string; status: 'ok' | 'needs_review' | 'missing'; raw: unknown; }
export interface UnresolvedVar { name: string; label: string; status: 'needs_review' | 'missing'; where: 'subject' | 'greeting' | 'closing' | string /* sectionId */ }
export interface RenderedMail { subject: string; html: string; text: string; unresolved: UnresolvedVar[]; unknownVars: string[]; }
/** path = `${folder}/attachments/${savedName}` */
export interface DraftAttachment { attachmentId: string; name: string; path: string; size: number; }
export interface MailDraft {
  schemaVersion: 1; noticeId: string; preparedAt: ISODate; templateId: string; groupId?: string; recipientSource?: 'group' | 'custom' | 'edited';
  to: string[]; cc: string[]; subject: string; html: string; text: string;
  attachments: DraftAttachment[];
  skippedAttachments: Array<{ attachmentId: string; name: string; status: AttachmentStatus }>;
  /** 공고별 편집으로 초안에서 뺀 첨부 */
  excludedAttachments?: Array<{ attachmentId: string; name: string }>;
  /** 공고별 편집(mail-edits.json)이 반영된 초안이면 편집 시각 */
  edited?: { at: ISODate };
  unresolved: UnresolvedVar[]; unknownVars: string[]; warnings: string[];
}

/** 공고별 메일 편집. notices/<folder>/mail-edits.json */
export interface MailEdits {
  schemaVersion: 1;
  noticeId: string;
  updatedAt: ISODate;
  /** 복사 원본. 변경 감지/안내용 */
  base: { templateId: string; templateName: string; updatedAt: ISODate };
  /** 이 공고 전용 양식. id는 base.templateId와 같다(템플릿 목록에 저장/노출하지 않음) */
  template: Template;
  /** 있으면 그룹 해석 대신 이 목록을 그대로 쓴다 */
  recipients?: { to: string[]; cc: string[] };
  /** 초안에서 빼는 첨부 id(`${noticeId}:a${index}`). 모르는 id는 무시 */
  excludedAttachmentIds: string[];
}
