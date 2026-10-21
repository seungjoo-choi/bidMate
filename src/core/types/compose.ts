import type { ISODate } from './common';
import type { NoticeKind } from './notice';
import type { IndexEntry } from './index-file';
import type { MailProvider } from './settings';
import type { SendConfirmation } from './job';

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
  kind: 'click' | 'hotkey' | 'auto';
  confirmed: boolean;
  confirmation?: SendConfirmation;
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
/** 발송 기록의 메일 내용. compose=웹메일에 채워 넣은 작성 기록, draft=작성 기록이 없어 현재 초안으로 대신함 */
export interface SentMailView {
  source: 'compose' | 'draft';
  composedAt?: ISODate;
  to: string[]; cc: string[]; subject: string; html: string;
  attachments: Array<{ name: string; size?: number }>;
}
export interface SentIndexEntry {
  id: string; noticeId: string; kind?: NoticeKind; noticeNo: string; round: string; title: string; orderingOrg: string; folder: string;
  sentAt: ISODate; source: SendSource; provider?: MailProvider; confirmed?: boolean;
  subject: string; toCount: number; ccCount: number; attachmentCount: number;
  composeRecordId?: string; voidedAt?: ISODate;
  signalKind?: SendSignal['kind'];
  /** 공고가 삭제되어 보관본에서 온 항목(folder는 ''). */
  noticeDeleted?: true;
}
export interface SentIndexFile { schemaVersion: 1; generatedAt: ISODate; entries: SentIndexEntry[] }

/** 공고 삭제 시 발송 이력을 공고 폴더 밖에 보관하는 파일(mail-sent-archive/<noticeId>.json). */
export interface SentArchiveFile {
  schemaVersion: 1; noticeId: string; deletedAt: ISODate;
  entry: Pick<IndexEntry, 'kind' | 'noticeNo' | 'round' | 'title' | 'orderingOrg'>;
  records: SendRecord[];
}
