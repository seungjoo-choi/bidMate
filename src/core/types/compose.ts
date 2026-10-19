import type { ISODate } from './common';
import type { NoticeKind } from './notice';
import type { MailProvider } from './settings';

export interface FieldResult { field: 'to' | 'cc' | 'subject' | 'body'; requested: string[] | string; rendered: string[] | string | null; status: 'ok' | 'mismatch' | 'failed' | 'unsupported' | 'prefilled' /* 주소 파라미터로 전달, 화면 확인 안 함 */; method: string; error?: string; }
export interface AttachResult { fileId: string; name: string; size: number; status: 'uploaded' | 'uploading_timeout' | 'failed' | 'not_in_dom' | 'size_mismatch' | 'skipped'; renderedName?: string; renderedSize?: string; method: 'input' | 'drop' | 'paste' | 'none'; elapsedMs: number; error?: string; }
export interface ComposeRecord {
  id: string; jobId: string; noticeId: string; composedAt: ISODate; templateId: string; groupId?: string;
  snapshot: { to: string[]; cc: string[]; subject: string; html: string };
  fields: FieldResult[]; attachments: AttachResult[];
  outcome: 'ready_for_review' | 'partial' | 'failed';   // 'sent' 없음
  adapterId: string; selectorSetVersion: string; webmailUrl: string;
}

export type SendSource = 'auto' | 'manual';
export interface SendSignal {
  kind: 'click' | 'hotkey';
  confirmed: boolean;
  confirmation?: 'ui_gone' | 'toast' | 'unload';
}
export interface SendRecord {
  id: string;                 // crypto.randomUUID(), legacy는 `legacy-<noticeId>`
  noticeId: string;
  sentAt: ISODate;            // auto: 신호 수신 시 offscreen 시계, manual: 사용자 지정 또는 now
  recordedAt: ISODate;
  source: SendSource;
  provider?: MailProvider;
  composeRecordId?: string;
  jobId?: string;
  signal?: SendSignal;        // auto만
  summary: { subject: string; toCount: number; ccCount: number; attachmentCount: number };
  note?: string;              // manual 메모(선택, 200자)
  voidedAt?: ISODate;         // 취소. 삭제하지 않는다
}
export interface SentIndexEntry {
  id: string; noticeId: string; kind?: NoticeKind; noticeNo: string; round: string; title: string; orderingOrg: string; folder: string;
  sentAt: ISODate; source: SendSource; provider?: MailProvider; confirmed?: boolean;
  subject: string; toCount: number; ccCount: number; attachmentCount: number;
  composeRecordId?: string; voidedAt?: ISODate;
}
export interface SentIndexFile { schemaVersion: 1; generatedAt: ISODate; entries: SentIndexEntry[] }
