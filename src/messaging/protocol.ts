import type { DeadlinePlan, DeadlineRefreshSummary } from '../core/types/deadline';
import type { AttachResult, FieldResult, SendRecord, SentIndexEntry, SentMailView } from '../core/types/compose';
import type { ComposeParams, HtmlFields, Job, JobError, JobProgress, JobStatus, SendConfirmation, SendSkipReason } from '../core/types/job';
import type { AiKey } from '../core/ai/keys';
import type { Extraction, ExtractionKey } from '../core/types/extraction';
import type { IndexEntry } from '../core/types/index-file';
import type { FollowTarget } from '../core/types/result';
import type { NoticeKind } from '../core/types/notice';
import type { PerformanceImportPlan, PerformanceImportResult, PerformanceInput, PerformancesSnapshot } from '../core/types/performance';
import type { GroupInput, RecipientImportPlan, RecipientImportResult, RecipientInput, RecipientsSnapshot, TemplateInput, TemplatesSnapshot } from '../core/types/config-file';
import type { NwRawUser } from '../adapters/naverworks/contacts-types';
import type { MailDraft, MailEdits } from '../core/types/mail';
import type { AfterCollect, MailProvider, Settings } from '../core/types/settings';
import type { Notice, NoticeFieldKey, NoticeRef } from '../core/types/notice';
import type { CollectStatus } from '../core/types/notice';
import type { DetectedDetail } from '../adapters/g2b/detail-page';
import type { ComposeSelectorSet, ComposeState, SendWatchConfig } from '../adapters/naverworks/types';
import type { EvalRaw } from '../adapters/g2b/eval-api';
import type { OrgProbeParams, OrgProbeResult } from '../adapters/g2b/org-api';
import type { EvalIndexEntry, EvalRecord } from '../core/types/evaluation';
import type { ISODate } from '../core/types/common';
import type { EstimateFile, EstimateKey } from '../core/types/estimate';
import type { G2bFailureInput } from '../core/diagnostics/g2b-failure';
import type { NotifyEvent, ResultProbeResult, ResultRunSummary } from '../core/types/result';
import type { AiBatchState, AiProvider, AiReviewFile, AiRunState, AiScope } from '../core/types/ai';
import type { AskFile, AskRecord, NoticeTexts } from '../core/types/search';
import type { RequirementSet, RfpCompareEntry, RfpCompareSession, RfpDocCandidate, RfpDocRef, RfpUploadEntry } from '../core/types/rfp';

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
export const SETTINGS_SECTIONS = ['storage', 'mail-service', 'auto-compose', 'g2b', 'company', 'performances', 'ai', 'notify', 'file-name', 'appearance'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];
export const isSettingsSection = (s: unknown): s is SettingsSection => (SETTINGS_SECTIONS as readonly unknown[]).includes(s);
/** 오류를 고칠 수 있는 화면. ui/open 페이로드로 그대로 보낸다 */
export type FixTarget = { page: 'recipients' } | { page: 'settings'; section: SettingsSection };
export interface NoticeLookup { found: boolean; collectedAt?: string; collectStatus?: CollectStatus; noticeId?: string; bidCloseAt?: string; title?: string }
/** 사이드 패널에 보여 줄 공고를 SW가 chrome.storage.session에 남기는 키 */
/** 사이드 패널이 SW와 맺는 포트 이름. SW는 이 연결로 패널이 열려 있는지 알고 닫기를 요청한다 */
export const SIDEPANEL_PORT = 'sidepanel';
export const SIDEPANEL_FOCUS_KEY = 'sidepanel.focus';
export interface EvalRef { noticeNo: string; round?: string }
export interface EvalCollectResult { noticeId: string; entry: EvalIndexEntry; warnings: string[] }
export interface EvalProbeResult {
  ok: boolean;
  counts?: { targets: number; members: number; items: number; scores: number; sheets: number };
  code?: string; message?: string; step?: number; ms: number;
}
export interface G2bDetected { noticeNo: string; round?: string; title?: string }
export interface ProbeReport { [key: string]: unknown; }
export type FsPermission = 'granted' | 'prompt' | 'denied';
export interface FsStatus { hasRoot: boolean; rootName?: string; permission: FsPermission; }
export interface SmokeTestResult { ok: boolean; steps: { write: boolean; read: boolean; delete: boolean }; error?: string; }

export interface NoticeDeleteResult { deleted: string[]; failed: Array<{ noticeId: string; code: string; message: string }> }
export const NOTICE_DELETE_MAX = 200;

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
  | { type: 'compose/open'; payload: { jobId: string; url: string; selector?: ComposeSelectorConfig; anchor?: { subject: string }; sendWatch?: SendWatchConfig }; response: { tabId: number } }
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
  | { type: 'ui/open'; payload: { page: 'settings' | 'grant' | 'review' | 'mail' | 'notice' | 'recipients' | 'sidepanel' | 'evaluation'; noticeId?: string; section?: SettingsSection }; response: void }  // CS→SW: 확장 페이지 열기
  | { type: 'notice/list'; payload: void; response: IndexEntry[] }  // 확장 페이지→SW→offscreen
  | { type: 'notice/get'; payload: { noticeId: string }; response: { notice: Notice; extraction: Extraction | null } | null }
  | { type: 'notice/delete'; payload: { noticeIds: string[] }; response: NoticeDeleteResult }  // 대시보드→SW→offscreen. 건별 결과
  | { type: 'extraction/edit'; payload: { noticeId: string; key: ExtractionKey; value: unknown | null; note?: string }; response: { notice: Notice; extraction: Extraction } }
  | { type: 'notice/field-edit'; payload: { noticeId: string; key: NoticeFieldKey | `custom.${string}`; value: unknown | null; raw?: string; note?: string }; response: { notice: Notice; extraction: Extraction | null } }
  | { type: 'estimate/get'; payload: { noticeId: string }; response: EstimateFile | null }
  | { type: 'estimate/save'; payload: { noticeId: string; key: EstimateKey; score: number | null; note?: string; max: number | null }; response: EstimateFile }
  | { type: 'extraction/text'; payload: { noticeId: string; textPath: string }; response: { text: string } }
  | { type: 'notice/texts'; payload: { noticeId: string }; response: NoticeTexts }  // 통합검색 코퍼스. 상세 전문+첨부 txt 일괄
  | { type: 'rfp/docs'; payload: { noticeId: string }; response: RfpDocCandidate[] }  // 대시보드→SW→offscreen: 비교할 수 있는 첨부 후보
  | { type: 'rfp/extract'; payload: { ref: RfpDocRef; force?: boolean }; response: RequirementSet }
  | { type: 'rfp/upload'; payload: { name: string; size: number; b64: string }; response: { uploadId: string; set: RequirementSet } }
  | { type: 'rfp/uploads'; payload: void; response: RfpUploadEntry[] }
  | { type: 'rfp/upload-rename'; payload: { uploadId: string; label: string }; response: RfpUploadEntry }
  | { type: 'rfp/upload-delete'; payload: { uploadId: string }; response: void }
  | { type: 'rfp/text'; payload: { ref: RfpDocRef }; response: { text: string } }
  | { type: 'rfp/compare-save'; payload: { session: RfpCompareSession }; response: RfpCompareSession }  // id가 ''이면 새로 만든다
  | { type: 'rfp/compare-list'; payload: void; response: RfpCompareEntry[] }
  | { type: 'rfp/compare-get'; payload: { compareId: string }; response: RfpCompareSession | null }
  | { type: 'rfp/compare-delete'; payload: { compareId: string }; response: void }
  | { type: 'recipients/list'; payload: void; response: RecipientsSnapshot }
  | { type: 'performances/list'; payload: void; response: PerformancesSnapshot }
  | { type: 'performances/save'; payload: { performance: PerformanceInput }; response: PerformancesSnapshot }
  | { type: 'performances/delete'; payload: { id: string }; response: PerformancesSnapshot }
  | { type: 'performances/import'; payload: { plan: PerformanceImportPlan }; response: PerformanceImportResult }
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
  | { type: 'mail/sent-list'; payload: void; response: SentIndexEntry[] }
  | { type: 'mail/sent-get'; payload: { noticeId: string }; response: SendRecord[] }
  | { type: 'mail/sent-add'; payload: { noticeId: string; sentAt?: string; note?: string }; response: { record: SendRecord; notice: Notice } }
  | { type: 'mail/sent-void'; payload: { noticeId: string; recordId: string }; response: { notice: Notice } }
  | { type: 'mail/sent-view'; payload: { noticeId: string; recordId: string }; response: SentMailView | null }
  | { type: 'compose/send-click'; payload: { jobId: string; composeRecordId?: string; subject: string; /** 화면 주소 목록과 칸별 대조 */ to: string[]; cc: string[] }; response: { clicked: boolean; reason?: SendSkipReason } }  // offscreen→SW
  | { type: 'compose/send-status'; payload: { jobId: string }; response: { tabAlive: boolean; clicked: boolean; confirmed: boolean; confirmation?: SendConfirmation } }  // offscreen→SW
  | { type: 'compose/close-tab'; payload: { jobId: string }; response: { closed: boolean } }  // offscreen→SW
  | { type: 'mail/send-signal'; payload: { jobId: string; kind: 'click' | 'hotkey' | 'auto' | 'confirm'; confirmation?: SendConfirmation }; response: void }  // CS→SW
  | { type: 'mail/sent-record'; payload: { noticeId: string; jobId: string; composeRecordId?: string; provider?: MailProvider; kind: 'click' | 'hotkey' | 'auto' | 'confirm'; confirmation?: SendConfirmation }; response: { recorded: boolean } }  // SW→offscreen
  | { type: 'config/repair'; payload: { file: 'recipients' | 'groups' | 'templates' | 'performances' }; response: { backupPath: string } }
  | { type: 'g2b/detect'; payload: void; response: G2bDetected | null }  // popup→CS
  | { type: 'g2b/read-html'; payload: { noticeNo: string; round?: string; withText?: boolean };
      response: { detected: DetectedDetail | null; match: boolean; html: HtmlFields | null; readyState: DocumentReadyState;
                  diag: null | { visibility: DocumentVisibilityState; readyState: DocumentReadyState; mainFrame: boolean; inputs: number;
                          noticeInputAny: boolean; noticeInputVisible: boolean; rafFiredSinceLast: boolean; timerSkewMs: number | null; url: string } } }  // SW→g2b 탭 CS(target content)
  | { type: 'g2b/read-detail'; payload: { jobId: string };
      response: { html: HtmlFields; elapsedMs: { detect: number; stable: number } } }  // offscreen→SW. 실패는 DETAIL_* code
  | { type: 'g2b/eval-fetch'; payload: EvalRef & { withoutIdHeaders?: boolean }; response: { raw: EvalRaw; warnings: string[] } }  // SW→g2b 탭 CS(target content). 실패는 EVAL_* code
  | { type: 'eval/collect'; payload: { ref: EvalRef }; response: EvalCollectResult }  // 대시보드 또는 g2b CS→SW
  | { type: 'eval/save'; payload: { ref: EvalRef; raw: EvalRaw; serviceKey?: string; fetchWarnings?: string[] }; response: EvalCollectResult }  // SW→offscreen
  | { type: 'eval/list'; payload: void; response: EvalIndexEntry[] }
  | { type: 'eval/get'; payload: { noticeId: string }; response: EvalRecord | null }
  | { type: 'eval/get-many'; payload: { noticeIds?: string[] }; response: EvalRecord[] }
  | { type: 'eval/delete'; payload: { noticeId: string }; response: { removed: boolean } }
  | { type: 'eval/probe'; payload: { ref: EvalRef; withoutIdHeaders?: boolean }; response: EvalProbeResult }  // 확장 페이지→SW. 저장 없이 개수만 반환
  | { type: 'result/refresh'; payload: { reason: 'list' | 'manual' }; response: ResultRunSummary }  // 대시보드→SW. throw하지 않는다
  | { type: 'result/run'; payload: { mode: 'list' | 'follow'; serviceKey: string; bizNo: string }; response: ResultRunSummary }  // SW→offscreen 전용
  | { type: 'result/done'; payload: { events: NotifyEvent[]; nextFollowCheckAt: ISODate | null; skipped?: ResultRunSummary['skipped'] }; response: void }  // offscreen→SW 전용. 실행/팔로우 설정이 끝날 때마다 알림과 알람 재예약을 맡긴다
  | { type: 'follow/set'; payload: { noticeId: string; follow: boolean; target?: FollowTarget }; response: { following: boolean; target: FollowTarget | null; nextFollowCheckAt: ISODate | null; startAt: ISODate | null } }  // 대시보드→SW→offscreen
  | { type: 'deadline/plan'; payload: void; response: DeadlinePlan }  // SW→offscreen 전용. index에서 계획 계산
  | { type: 'deadline/refresh'; payload: { reason: 'list' | 'manual' }; response: DeadlineRefreshSummary }  // 확장 페이지→SW. throw하지 않는다
  | { type: 'result/probe'; payload: { noticeNo: string; serviceKey?: string }; response: ResultProbeResult }  // 대시보드→SW→offscreen(키는 SW가 주입)
  | { type: 'org/probe'; payload: OrgProbeParams; response: OrgProbeResult }  // 대시보드→SW. 키는 SW가 주입한다
  | { type: 'org/probe-run'; payload: OrgProbeParams & { serviceKey: string }; response: OrgProbeResult }  // SW→offscreen 전용
  | { type: 'ai/get'; payload: { noticeId: string }; response: AiReviewFile | null }
  | { type: 'ai/run'; payload: { noticeId: string; scope: AiScope; keys?: AiKey[]; provider?: AiProvider; files?: string[] }; response: { runId: string } }  // 대시보드→SW. 키는 SW가 주입한다
  | { type: 'ai/compare-run'; payload: { noticeId: string; scope: AiScope; keys?: AiKey[]; providers: AiProvider[]; files?: string[] }; response: { compareId: string; runId: string } }  // 대시보드→SW. 키는 SW가 주입
  | { type: 'ai/compare-exec'; payload: { noticeId: string; scope: AiScope; keys?: AiKey[]; files?: string[]; compareId: string; targets: Array<{ provider: AiProvider; api: { key: string; model: string; sendFullText?: boolean } }> }; response: { compareId: string; runId: string } }  // SW→offscreen 전용
  | { type: 'ai/exec'; payload: { noticeId: string; scope: AiScope; keys?: AiKey[]; provider: AiProvider; files?: string[]; api: { key: string; model: string; sendFullText?: boolean } }; response: { runId: string } }  // SW→offscreen 전용
  | { type: 'ai/status'; payload: AiRunState; response: void }  // offscreen→SW 전용
  | { type: 'ai/cancel'; payload: { noticeId: string; runId: string }; response: { cancelled: boolean } }
  | { type: 'ai/prepare'; payload: { noticeId: string; scope: AiScope; keys?: AiKey[]; provider?: AiProvider; files?: string[] }; response: { runId: string; text: string; webUrl: string; stats: { chars: number; files: number; truncated: boolean; excludedFiles: string[] } } }
  | { type: 'ai/prompt-get'; payload: { noticeId: string; runId: string }; response: { text: string } }
  | { type: 'ai/submit'; payload: { noticeId: string; runId: string; text: string }; response: AiReviewFile }  // text 상한 200KB(SW 검사)
  | { type: 'ai/apply'; payload: { noticeId: string; runId: string; key: AiKey; note?: string; variantIndex?: number }; response: { notice: Notice; extraction: Extraction; aiReview: AiReviewFile } }
  | { type: 'ai/dismiss'; payload: { noticeId: string; runId: string; key: AiKey }; response: AiReviewFile }
  | { type: 'ai/test'; payload: { provider: AiProvider }; response: { ok: boolean; models?: Array<{ id: string; displayName?: string }>; error?: { code: string; message: string } } }  // 대시보드→SW
  | { type: 'ai/models'; payload: { provider: AiProvider; apiKey: string }; response: { models: Array<{ id: string; displayName?: string }> } }  // SW→offscreen 전용
  | { type: 'ai/batch-run'; payload: { noticeIds: string[]; provider?: AiProvider }; response: { batchId: string } }  // 대시보드→SW. 키는 SW가 주입한다
  | { type: 'ai/batch-exec'; payload: { batchId: string; noticeIds: string[]; provider: AiProvider; api: { key: string; model: string; sendFullText?: boolean } }; response: { batchId: string } }  // SW→offscreen 전용
  | { type: 'ai/batch-status'; payload: AiBatchState; response: void }  // offscreen→SW 전용
  | { type: 'ai/batch-get'; payload: Record<string, never>; response: AiBatchState | null }  // 대시보드→SW(고아 판정 포함), SW→offscreen(현재 배치)
  | { type: 'ai/batch-cancel'; payload: { batchId: string }; response: { cancelled: boolean } }
  | { type: 'ai/batch-clear'; payload: { batchId: string }; response: void }  // SW 단독. 실행 중이면 AI_BATCH_BUSY
  | { type: 'search/ask'; payload: { noticeId: string; askId: string; question: string; fieldDocText: string; provider?: AiProvider; contextMode?: 'context' | 'full' }; response: AskRecord }  // 대시보드→SW. 키는 SW가 주입한다. question 500자·fieldDocText 20,000자 상한(SW 검사)
  | { type: 'search/ask-exec'; payload: { noticeId: string; askId: string; question: string; fieldDocText: string; provider: AiProvider; contextMode?: 'context' | 'full'; api: { key: string; model: string } }; response: AskRecord }  // SW→offscreen 전용
  | { type: 'search/ask-cancel'; payload: { noticeId: string; askId: string }; response: { cancelled: boolean } }
  | { type: 'search/asks-get'; payload: { noticeId: string }; response: AskFile | null }
  | { type: 'diag/g2b-failure'; payload: { failures: G2bFailureInput[] }; response: void }  // offscreen→SW 전용, 1회 50건 상한
  | { type: 'diag/g2b-failures-clear'; payload: void; response: void }  // 대시보드→SW
  | { type: 'g2b/collect'; payload: void; response: { started: boolean; jobId?: string; code?: string } }  // popup→CS
  | { type: 'g2b/retry'; payload: { jobId: string }; response: { started: boolean; jobId?: string; code?: string } };  // sidepanel→CS: 이 탭 공고의 잡 재시도(SW가 공고/탭 일치 검사)

export type MsgType = Msg['type'];
export type PayloadOf<T extends MsgType> = Extract<Msg, { type: T }>['payload'];
export type ResponseOf<T extends MsgType> = Extract<Msg, { type: T }>['response'];

export type Envelope<T extends Msg = Msg> = {
  id: string; type: T['type']; payload: T['payload']; replyTo?: string; ts: number;
  target: Target;
};

export type Reply<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; path?: string; detail?: Record<string, unknown> } };
