import type { ISODate } from './common';
import type { AttachmentStatus } from './notice';

export interface ResolvedValue { text: string; status: 'ok' | 'needs_review' | 'missing'; raw: unknown; }
export interface UnresolvedVar { name: string; label: string; status: 'needs_review' | 'missing'; where: 'subject' | 'greeting' | 'closing' | string /* sectionId */ }
export interface RenderedMail { subject: string; html: string; text: string; unresolved: UnresolvedVar[]; unknownVars: string[]; }
/** path = `${folder}/attachments/${savedName}` */
export interface DraftAttachment { attachmentId: string; name: string; path: string; size: number; }
export interface MailDraft {
  schemaVersion: 1; noticeId: string; preparedAt: ISODate; templateId: string; groupId?: string; recipientSource?: 'group' | 'custom';
  to: string[]; cc: string[]; subject: string; html: string; text: string;
  attachments: DraftAttachment[];
  skippedAttachments: Array<{ attachmentId: string; name: string; status: AttachmentStatus }>;
  unresolved: UnresolvedVar[]; unknownVars: string[]; warnings: string[];
}
