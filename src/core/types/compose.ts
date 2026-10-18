import type { ISODate } from './common';

export interface FieldResult { field: 'to' | 'cc' | 'subject' | 'body'; requested: string[] | string; rendered: string[] | string | null; status: 'ok' | 'mismatch' | 'failed' | 'unsupported'; method: string; error?: string; }
export interface AttachResult { fileId: string; name: string; size: number; status: 'uploaded' | 'uploading_timeout' | 'failed' | 'not_in_dom' | 'size_mismatch' | 'skipped'; renderedName?: string; renderedSize?: string; method: 'input' | 'drop' | 'paste' | 'none'; elapsedMs: number; error?: string; }
export interface ComposeRecord {
  id: string; jobId: string; noticeId: string; composedAt: ISODate; templateId: string; groupId?: string;
  snapshot: { to: string[]; cc: string[]; subject: string; html: string };
  fields: FieldResult[]; attachments: AttachResult[];
  outcome: 'ready_for_review' | 'partial' | 'failed';   // 'sent' 없음
  adapterId: string; selectorSetVersion: string; webmailUrl: string;
}
