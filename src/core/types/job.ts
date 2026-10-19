import type { AttachResult, FieldResult } from './compose';
import type { ISODate } from './common';
import type { BasicFacts, EvalFacts } from '../model/notice-summary';
import type { Extraction, ExtractionStatus } from './extraction';
import type { AttachmentStatus, MailStatus, NoticeFieldKey, NoticeRef } from './notice';
import type { AfterCollect, MailProvider } from './settings';

export type JobType = 'collect' | 'compose' | 'extract' | 'download_retry';
export type JobStatus = 'queued' | 'running' | 'cancelling' | 'completed' | 'partial' | 'failed' | 'cancelled' | 'interrupted';
export type StepId = 'fetch_basic' | 'fetch_html' | 'download_attachments' | 'extract' | 'render_mail' | 'open_compose' | 'fill_fields' | 'attach_files' | 'verify';
export interface StepState { id: StepId; status: 'pending' | 'running' | 'done' | 'failed' | 'skipped'; progress?: { done: number; total: number }; bytes?: { received: number; total: number | null; name?: string }; startedAt?: ISODate; endedAt?: ISODate; error?: JobError; }
export interface JobError { code: string; message: string; step?: StepId; retryable: boolean; detail?: unknown; }
export type HandoffReason = 'collect_failed' | 'attachments_failed' | 'extract_failed' | 'needs_review' | 'detail_failed';
export type HandoffSkip = 'disabled' | 'already_composed' | 'compose_running' | 'needs_site_permission' | 'no_notice' | 'start_failed' | 'dequeued';
export type Handoff =
  | { action: 'compose'; state: 'queued' | 'started'; jobId?: string; at: ISODate }
  | { action: 'review'; reasons: HandoffReason[]; opened: boolean; at: ISODate }
  | { action: 'edit'; opened: boolean; at: ISODate }
  // 수집 완료, 사용자가 팝업에서 편집/작성을 고르기 전
  | { action: 'ask'; at: ISODate }
  | { action: 'none'; reason: HandoffSkip; at: ISODate };
export type ComposeParams = { groupId?: string; templateId?: string; recipients?: Array<{ recipientId: string; role: 'to' | 'cc' }> };
export interface Job {
  id: string; type: JobType; noticeId?: string; ref?: NoticeRef; status: JobStatus;
  steps: StepState[]; currentStep?: StepId; attempt: number; label?: string;
  originTabId?: number; composeTabId?: number;
  /** compose: 사용자가 고른 그룹/템플릿(JobRequest.params에서 복사) */
  params?: ComposeParams; composeFrameId?: number;
  /** collect만: 수집 완료 후 자동 작성/검수 처리 결과 */
  handoff?: Handoff;
  /** collect만: 수집 완료 후 동작 스냅샷(자동 작성이 켜져 있을 때만). 없으면 선택 UI 없음 */
  afterCollect?: AfterCollect;
  /** compose만: 자동 시작된 잡이면 원인 collect 잡 */
  auto?: { collectJobId: string };
  createdAt: ISODate; updatedAt: ISODate; result?: unknown; errors: JobError[];
}
export interface JobProgress {
  jobId: string; attempt: number; step: StepId; status: StepState['status'];
  progress?: StepState['progress']; bytes?: { received: number; total: number | null; name?: string }; label: string;
  /** 사이드 패널 기록용 이벤트(전이와 무관하게 기록) */
  event?: ProgressEvent;
  /** 엔진이 잰 단계 소요(ms). 있으면 SW 시계 대신 쓴다 */
  ms?: number;
}

export type LogStep = StepId | 'handoff';
export type JobEventBase = { seq: number; at: ISODate; attempt: number };
export type JobEvent = JobEventBase & (
  | { kind: 'attempt'; label: string }
  | { kind: 'step'; step: StepId; status: 'running' | 'done' | 'failed' | 'skipped'; label: string; ms?: number; error?: JobError }
  | { kind: 'file'; step: 'download_attachments' | 'extract'; phase: 'start' | 'end';
      file: { id: string; name: string; size: number | null }; status?: string; ms?: number; error?: string }
  | { kind: 'note'; step: LogStep; label: string }
  | { kind: 'facts'; step: 'fetch_basic' | 'extract'; facts: BasicFacts | EvalFacts }
  | { kind: 'handoff'; handoff: Handoff }
  | { kind: 'finish'; status: JobStatus; error?: JobError }
);
export interface JobLog { jobId: string; seq: number; events: JobEvent[] }
export type ProgressEvent =
  | { kind: 'file'; step: 'download_attachments' | 'extract'; phase: 'start' | 'end'; file: { id: string; name: string; size: number | null }; status?: string; ms?: number; error?: string }
  | { kind: 'note'; step: LogStep; label: string }
  | { kind: 'facts'; step: 'fetch_basic' | 'extract'; facts: BasicFacts | EvalFacts };

/** content script(Stage B)가 화면에서 읽어 job/start에 동봉하는 값. 매핑은 Stage B에서 한다. */
export interface HtmlFields {
  fields: Partial<Record<NoticeFieldKey, { raw: string; ref: string }>>;
  capturedAt: ISODate;
  pageTitle?: string;
}

/** collect 잡의 Job.result 형태. */
export interface CollectResult {
  noticeId: string;
  folder: string;
  title?: string;
  attachments: Array<{ name: string; savedName: string | null; status: AttachmentStatus; size: number | null; error?: string }>;
  mailStatus?: MailStatus;
  extraction?: { status: ExtractionStatus; reviewCount: number; conflictCount: number };
}

/** extract 잡의 Job.result 형태. */
export interface ExtractResult { noticeId: string; folder: string; extraction: Extraction }

/** compose 잡의 Job.result 형태. html/base64는 넣지 않는다. */
export interface ComposeResult {
  noticeId: string; folder: string; title?: string;
  mode: 'auto' | 'manual' | 'url';         // manual = 셀렉터 미검증 또는 전 필드 unsupported, url = 주소 파라미터로 전달
  provider?: MailProvider;
  tabId?: number;
  fields: FieldResult[];                   // to, cc, subject, body
  attachments: Array<AttachResult & { error?: string }>;
  outcome: 'ready_for_review' | 'partial' | 'failed';
  recordId?: string;                       // mail.json에 기록된 ComposeRecord.id
  attachDir: string;                       // `${folder}/attachments`
}
