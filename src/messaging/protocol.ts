import type { AttachResult, FieldResult } from '../core/types/compose';
import type { ComposeParams, HtmlFields, Job, JobError, JobProgress, JobStatus } from '../core/types/job';
import type { Extraction, ExtractionKey } from '../core/types/extraction';
import type { IndexEntry } from '../core/types/index-file';
import type { NoticeKind } from '../core/types/notice';
import type { GroupInput, RecipientImportPlan, RecipientImportResult, RecipientInput, RecipientsSnapshot, TemplateInput, TemplatesSnapshot } from '../core/types/config-file';
import type { NwRawUser } from '../adapters/naverworks/contacts-types';
import type { MailDraft, MailEdits } from '../core/types/mail';
import type { AfterCollect, Settings } from '../core/types/settings';
import type { Notice, NoticeRef } from '../core/types/notice';
import type { CollectStatus } from '../core/types/notice';
import type { DetectedDetail } from '../adapters/g2b/detail-page';
import type { ComposeSelectorSet, ComposeState } from '../adapters/naverworks/types';

/** 'content'는 SW/팝업이 content script로 보내는 메시지의 대상. */
export type Target = 'sw' | 'offscreen' | 'content';

/** §1.1 Phase 1: 계약 정의. 일부 payload/응답 구조는 후속 단계에서 구체화한다. */
export interface JobRequest {
  type: Job['type']; ref?: NoticeRef; noticeId?: string; params?: ComposeParams;
  /** content script가 화면에서 읽은 값(Stage B) */
  html?: HtmlFields;
  originTabId?: number;
  /** SW 내부 전용. job/start 리스너가 외부 메시지의 값을 버린다. */
  auto?: { collectJobId: string };
  /** 지정하면 해당 잡을 실패한 step부터 재개한다(attempt+1). */
  retryOf?: string;
}
/** SW가 offscreen에 넘기는 잡 실행 입력. offscreen은 chrome.storage를 쓸 수 없어 키/설정을 함께 보낸다. */
export interface JobRunPayload { job: Job; html?: HtmlFields; secrets: { g2bServiceKey?: string }; settings: Settings }
export interface ActiveJob { jobId: string; attempt: number }
export interface G2bTestResult { ok: boolean; title?: string; error?: { code: string; message: string } }
export interface ComposeSelectorConfig { selectorSetId: string; selectorOverrides?: Partial<ComposeSelectorSet> }
export interface ComposeDetect { frameId: number; injected: boolean; isCompose: boolean; ready: boolean; reason?: string }
export type AttachStatus =
  | { done: false; phase: 'buffering' | 'injecting' | 'uploading'; elapsedMs: number }
  | { done: true; result: AttachResult };
export interface FileMeta { fileId: string; name: string; size: number; mime?: string; }
/** 설정 화면에서 바로 보여 줄 카드 */
export type SettingsSection = 'storage' | 'mail-service' | 'auto-compose' | 'g2b';
/** 오류를 고칠 수 있는 화면. ui/open 페이로드로 그대로 보낸다 */
export type FixTarget = { page: 'recipients' } | { page: 'settings'; section: SettingsSection };
export interface NoticeLookup { found: boolean; collectedAt?: string; collectStatus?: CollectStatus }
export interface G2bDetected { noticeNo: string; round?: string; title?: string }
export interface ProbeReport { [key: string]: unknown; }
export type FsPermission = 'granted' | 'prompt' | 'denied';
export interface FsStatus { hasRoot: boolean; rootName?: string; permission: FsPermission; }
export interface SmokeTestResult { ok: boolean; steps: { write: boolean; read: boolean; delete: boolean }; error?: string; }

export type Msg =
  | { type: 'cs/ping'; payload: void; response: { ready: boolean; composeDetected: boolean } }
  | { type: 'engine/ready'; payload: void; response: void }
  | { type: 'job/start'; payload: JobRequest; response: { jobId: string; code?: 'JOB_ALREADY_RUNNING' } }
  | { type: 'job/cancel'; payload: { jobId: string; force?: boolean }; response: { status: JobStatus } }  // UI→SW
  | { type: 'job/abort'; payload: { jobId: string }; response: { known: boolean } }  // SW→offscreen
  | { type: 'job/status'; payload: { jobIds?: string[] }; response: { active: ActiveJob[] } }  // SW→offscreen
  | { type: 'job/run'; payload: JobRunPayload;
      response: { accepted: true; active: ActiveJob[] }
              | { accepted: false; code: 'JOB_ALREADY_RUNNING'; conflictJobId: string; active: ActiveJob[] } }
  | { type: 'job/progress'; payload: JobProgress; response: void }
  | { type: 'job/finish'; payload: { jobId: string; attempt: number; status: JobStatus; result?: unknown; error?: JobError }; response: void }
  | { type: 'compose/open'; payload: { jobId: string; url: string; selector?: ComposeSelectorConfig; anchor?: { subject: string } }; response: { tabId: number } }
  | { type: 'compose/detect'; payload: { jobId: string }; response: { frames: ComposeDetect[] } }
  | { type: 'compose/bind'; payload: { jobId: string; frameId: number }; response: void }
  | { type: 'compose/focus'; payload: { jobId: string }; response: void }
  | { type: 'compose/abort'; payload: { jobId: string }; response: void }   // SW->CS로도 같은 type(target 'content')
  | { type: 'compose/fill'; payload: { jobId: string; to: string[]; cc: string[]; subject: string; html: string; fields?: Array<'to' | 'cc' | 'subject' | 'body'> }; response: FieldResult[] }
  | { type: 'compose/attach-begin'; payload: { jobId: string; files: FileMeta[] }; response: { accepted: string[]; rejected: Array<{ fileId: string; reason: string }> } }
  | { type: 'file/chunk'; payload: { jobId: string; fileId: string; seq: number; total: number; b64: string }; response: { received: number } }
  | { type: 'file/end'; payload: { jobId: string; fileId: string }; response: { started: boolean; error?: string } }
  | { type: 'compose/attach-status'; payload: { jobId: string; fileId: string }; response: AttachStatus }
  | { type: 'compose/verify'; payload: { jobId: string }; response: ComposeState }
  | { type: 'probe/snapshot'; payload: void; response: ProbeReport }
  | { type: 'probe/record-start'; payload: void; response: ProbeReport }
  | { type: 'probe/record-stop'; payload: void; response: ProbeReport }
  | { type: 'fs/status'; payload: void; response: FsStatus }
  | { type: 'fs/root-updated'; payload: void; response: void }
  | { type: 'fs/smoke-test'; payload: void; response: SmokeTestResult }
  | { type: 'g2b/test'; payload: { serviceKey?: string; kind?: NoticeKind }; response: G2bTestResult }
  | { type: 'job/get'; payload: { jobId: string }; response: Job | null }  // CS→SW. ledger 조회(서비스키 미포함)
  | { type: 'job/latest-for-tab'; payload: { kind?: NoticeKind; noticeNo: string; round?: string }; response: Job | null }  // CS→SW
  | { type: 'job/list-for-tab'; payload: void; response: Job[] }  // CS→SW: 이 탭이 시작한 collect 잡
  | { type: 'job/update'; payload: { job: Job }; response: void }  // SW→CS(target content): 종료 스냅샷
  | { type: 'notice/lookup'; payload: { kind?: NoticeKind; noticeNo: string; round?: string }; response: NoticeLookup }  // CS→SW→offscreen
  | { type: 'notice/lookup-batch'; payload: { refs: Array<{ kind?: NoticeKind; noticeNo: string; round?: string }> }; response: NoticeLookup[] }  // CS→SW→offscreen, 입력 순서 보존
  | { type: 'fs/permission-granted'; payload: void; response: void }  // grant 창→SW, SW→CS(target content)
  | { type: 'auto-compose/choose'; payload: { collectJobId: string; afterCollect: AfterCollect }; response: { applied: boolean } }  // ACTIVE collect면 스냅샷 변경, handoff ask 대기 중이면 즉시 해소
  | { type: 'auto-compose/dequeue'; payload: { collectJobId: string }; response: { removed: boolean } }
  | { type: 'ui/open'; payload: { page: 'settings' | 'grant' | 'review' | 'mail' | 'recipients'; noticeId?: string; section?: SettingsSection }; response: void }  // CS→SW: 확장 페이지 열기
  | { type: 'notice/list'; payload: void; response: IndexEntry[] }  // 확장 페이지→SW→offscreen
  | { type: 'notice/get'; payload: { noticeId: string }; response: { notice: Notice; extraction: Extraction | null } | null }
  | { type: 'extraction/edit'; payload: { noticeId: string; key: ExtractionKey; value: unknown | null; note?: string }; response: { notice: Notice; extraction: Extraction } }
  | { type: 'extraction/text'; payload: { noticeId: string; textPath: string }; response: { text: string } }
  | { type: 'recipients/list'; payload: void; response: RecipientsSnapshot }
  | { type: 'recipients/save'; payload: { recipient: RecipientInput }; response: RecipientsSnapshot }
  | { type: 'recipients/import'; payload: { plan: RecipientImportPlan }; response: RecipientImportResult }  // 대시보드→SW→offscreen
  | { type: 'contacts/naverworks-fetch'; payload: { domainId?: string }; response: { domainId: string; users: NwRawUser[]; totalCount: number; tabReused: boolean } }  // 대시보드→SW
  | { type: 'recipients/delete'; payload: { id: string }; response: RecipientsSnapshot }
  | { type: 'groups/save'; payload: { group: GroupInput }; response: RecipientsSnapshot }
  | { type: 'groups/delete'; payload: { id: string }; response: RecipientsSnapshot }
  | { type: 'groups/set-default'; payload: { id: string }; response: RecipientsSnapshot }
  | { type: 'templates/list'; payload: void; response: TemplatesSnapshot }
  | { type: 'templates/save'; payload: { template: TemplateInput }; response: TemplatesSnapshot }
  | { type: 'templates/delete'; payload: { id: string }; response: TemplatesSnapshot }
  | { type: 'templates/set-default'; payload: { id: string }; response: TemplatesSnapshot }
  | { type: 'mail/prepare'; payload: { noticeId: string; groupId?: string; templateId?: string; recipients?: Array<{ recipientId: string; role: 'to' | 'cc' }>; edits?: MailEdits | null }; response: { draft: MailDraft; notice: Notice } }
  | { type: 'mail/edits-get'; payload: { noticeId: string }; response: MailEdits | null }
  | { type: 'mail/draft-get'; payload: { noticeId: string }; response: MailDraft | null }
  | { type: 'mail/set-status'; payload: { noticeId: string; status: 'delivered' | 'none' }; response: { notice: Notice } }
  | { type: 'config/repair'; payload: { file: 'recipients' | 'groups' | 'templates' }; response: { backupPath: string } }
  | { type: 'g2b/detect'; payload: void; response: G2bDetected | null }  // popup→CS
  | { type: 'g2b/read-html'; payload: { noticeNo: string; round?: string };
      response: { detected: DetectedDetail | null; match: boolean; html: HtmlFields | null; readyState: DocumentReadyState } }  // SW→g2b 탭 CS(target content)
  | { type: 'g2b/read-detail'; payload: { jobId: string };
      response: { html: HtmlFields; elapsedMs: { detect: number; stable: number } } }  // offscreen→SW. 실패는 DETAIL_* code
  | { type: 'g2b/collect'; payload: void; response: { started: boolean; jobId?: string; code?: string } }  // popup→CS
  | { type: 'g2b/retry'; payload: { jobId: string }; response: { started: boolean; jobId?: string; code?: string } };  // sidepanel→CS: 이 탭 공고의 잡 재시도(SW가 공고/탭 일치 검사)

export type MsgType = Msg['type'];
export type PayloadOf<T extends MsgType> = Extract<Msg, { type: T }>['payload'];
export type ResponseOf<T extends MsgType> = Extract<Msg, { type: T }>['response'];

export type Envelope<T extends Msg = Msg> = {
  id: string; type: T['type']; payload: T['payload']; replyTo?: string; ts: number;
  target: Target;
};

export type Reply<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; path?: string } };
