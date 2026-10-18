# BidMate 아키텍처/데이터 모델 (Fable 설계, 2026-10-17)

요구사항 원문: `.claude/specs/requirements.md`. "확인 필요"로 표시한 항목은 미검증 추정이다.

## 0. 핵심 결정
- 파일 I/O 단일 작성자 = **offscreen 문서**. dashboard/sidepanel은 `showDirectoryPicker`(폴더 선택)와 `requestPermission`(재승인)만 한다(둘 다 사용자 제스처 필요). SW는 FSA에 의존하지 않는다.
- offscreen은 `chrome.tabs`를 쓸 수 없으므로 **SW가 Port 2개를 이어 주는 릴레이**를 맡는다. 파일은 청크 base64로 보내고, ack 기반 백프레셔를 건다.
- 첨부 주입 순서: `input.files` → `drop` → `paste`. 완료 검증은 DOM이 1차, `webRequest` 업로드 응답이 2차(선택)다.
- 어댑터 = 범용 엔진 + SelectorSet(JSON) + 전략 플래그. React/Vue 제어 입력에는 네이티브 setter를 쓴다. 합성 이벤트가 거부되면(isTrusted) 2차 수단으로 `chrome.debugger` Input 도메인(optional permission)을 쓴다.
- 전송 방지 가드: 전송 버튼 셀렉터 + 텍스트 휴리스틱(보내기/전송/Send)으로 2중 차단한다. modifier 키 디스패치(Ctrl/Cmd+Enter = 전송 단축키), `form.submit`, `requestSubmit`은 전면 금지한다. 모든 DOM 디스패치는 `dom-actions.ts` 단일 모듈에서만 하고, ESLint `no-restricted-syntax`로 강제한다.
- dashboard는 탭이라 닫힐 수 있으므로 장기 작업 호스트가 될 수 없다.

## 1. 실행 컨텍스트별 책임
```
[사이트 탭 CS]  trackerbot.content / g2b.content / naverworks.content / probe(주입형)
      │ runtime.sendMessage / Port
      ▼
[SW: background]  라우터/잡 코디네이터/탭 관리/권한/사이트 등록. 상태는 storage.session/local. 파일/무거운 연산 없음.
      │ runtime Port                       │ tabs.sendMessage / tabs.connect
      ▼                                    ▼
[offscreen: engine]  FileStore(FSA 단일 작성자)/JobRunner/Downloader/DocumentParser(Worker)/Extractor
[popup]      현재 사이트 감지, 수집 트리거, 최근 상태, 링크
[sidepanel]  진행 상태/오류/첨부 상태/메일 작성 이동/probe 실행 UI
[dashboard]  Full page. 폴더 선택/재승인, 공고/수신자/템플릿/설정 CRUD(요청은 SW→offscreen 경유), Phase1 테스트 페이지
```
- **offscreen = 엔진.** SW는 30초 유휴 시 종료되고 `new Worker`를 쓸 수 없다. offscreen은 명시적으로 `closeDocument`할 때까지 살아 있다. FSA 핸들은 확장 origin의 IDB에 있으므로 offscreen에서 읽을 수 있고, `createWritable`/`getFile`은 제스처가 필요 없다.
- **UI는 상태를 구독한다.** SW가 `chrome.storage.session`의 `jobs.<id>`를 갱신하고, popup/sidepanel/dashboard는 `storage.onChanged`를 구독한다. CS는 storage.session에 접근할 수 없으므로 플로팅 패널만 `tabs.sendMessage`로 push를 받는다.
- **사이트 CS는 전부 동적 등록.** `optional_host_permissions: ["https://*/*"]`를 두고, 설정을 저장할 때 `permissions.request({origins})`(제스처 안에서) → `scripting.registerContentScripts`를 호출한다. 플로팅 패널은 Shadow DOM 안에 React로 마운트한다.
- **비밀값 분리.** 나라장터 서비스키는 `chrome.storage.local.secrets`에만 저장하고, `config/settings.json`에는 쓰지 않는다.

### 1.1 메시지 프로토콜 (`src/messaging/protocol.ts`, discriminated union)
```ts
type Envelope<T extends Msg = Msg> = { id: string; type: T['type']; payload: T['payload']; replyTo?: string; ts: number; };
```
채널: 짧은 명령은 요청/응답(`runtime.sendMessage`/`tabs.sendMessage`)으로 보낸다. 잡 스트림/파일 청크는 Port를 쓴다. Port 이름은 `engine`(offscreen↔SW), `compose:<tabId>`, `probe:<tabId>`.

| type | 방향 | payload | 응답 | Phase |
|---|---|---|---|---|
| `cs/ready` | CS→SW | `{site, url, frameId, adapterId?}` | – | 1 |
| `cs/ping` | SW→CS | – | `{ready, composeDetected}` | 1 |
| `engine/ready` | offscreen→SW | – | – | 1 |
| `job/start` | UI→SW | `JobRequest` | `{jobId}` | 1 |
| `job/cancel` | UI→SW | `{jobId}` | – | 1 |
| `job/run` | SW→offscreen(Port) | `Job` | – | 1 |
| `job/progress` | offscreen→SW(Port), SW→CS | `JobProgress` | – | 1 |
| `job/finish` | offscreen→SW | `{jobId, status, result?, error?}` | – | 1 |
| `compose/open` | offscreen→SW | `{jobId, host, composePath?}` | `{tabId, frameId}` | 1 |
| `compose/fill` | SW→CS | `{jobId, to, cc, subject, html}` | `FieldResult[]` | 1 |
| `compose/attach-begin` | SW→CS | `{jobId, files: FileMeta[]}` | `{accepted: string[]}` | 1 |
| `file/chunk` | offscreen→SW→CS(Port) | `{fileId, seq, total, b64}` | `file/ack {fileId, seq}` | 1 |
| `file/end` | 동상 | `{fileId, sha256?}` | – | 1 |
| `compose/attach-result` | CS→SW→offscreen | `AttachResult[]` | – | 1 |
| `compose/verify` | SW→CS | `{jobId}` | `ComposeState` | 1 |
| `probe/snapshot` `probe/record-start` `probe/record-stop` | sidepanel→SW→CS | – | `ProbeReport` | 1 |
| `fs/status` | UI→SW→offscreen | – | `{hasRoot, rootName?, permission:'granted'|'prompt'|'denied'}` | 1 |
| `fs/root-updated` | dashboard→SW→offscreen | – | – | 1 |
| `fs/smoke-test` | UI→SW→offscreen | – | `{ok, steps:{write,read,delete}, error?}` | 1(P1-0 검증용) |
| `fs/read-json` `fs/write-json` `fs/list` | UI→SW→offscreen | 경로 기반 | – | 이후 |
| `notice/*` `settings/*` `recipients/*` `groups/*` `templates/*` | UI→SW→offscreen | – | – | 이후 |

규칙: SW 핸들러는 항상 `true`를 반환하고 비동기로 응답한다. 타임아웃은 호출 측이 건다(기본 15s, 첨부는 파일당 `max(60s, size/100KBps)`). 청크는 2MB이고, ack를 받기 전에는 다음 청크를 보내지 않는다. CS는 `fetch("data:application/octet-stream;base64,"+b64).arrayBuffer()`로 디코딩한다.

## 2. 로컬 파일 저장
- **원자성**: FSA `createWritable()`은 swap 파일에 쓴 뒤 `close()` 시점에 교체한다. 별도 temp 로직은 두지 않는다. 디렉터리를 나열할 때 `*.crswap`은 무시한다.
- **단일 작성자 + 경로 뮤텍스**: `withLock(path, fn)`. `index.json`은 락 안에서 read-modify-write한다.
- **index.json은 파생 데이터**: `rebuildIndex()`로 재생성할 수 있다. 쓰기 순서는 `notice.json` → `index.json`.
- **다운로드**: `fetch(url,{credentials:'include'})` → `body.pipeTo(writable)`. 완료 후 `getFile().size`로 검증하고, 실패하면 `abort()`한다.
- **폴더명**: `notices/<YYYY>/<noticeNo>_<sanitize(title,40)>`. 생성 시 1회 결정해 `notice.json.folder`와 index에 고정한다. sanitize는 `<>:"/\|?*`/제어문자 제거, 끝 공백/점 제거, Windows 예약어 회피, 경로 200자 이내.
- **파일명 충돌**: `name (2).ext` 형식. `savedName`에 기록하고, 재시도할 때 재사용한다.
- **멱등성**: `noticeId = ${noticeNo}-${round ?? '00'}`. 재수집 시 `user_edited` 상태는 보존하고, 첨부는 `savedName`과 크기가 일치하면 skip한다. 같은 noticeId의 잡이 실행 중이면 `JOB_ALREADY_RUNNING`으로 거부한다.
- **권한 수명**: offscreen이 핸들을 로드하고 `queryPermission({mode:'readwrite'})`를 확인한다. 결과가 `'prompt'`면 쓰기 잡은 `NEEDS_FS_PERMISSION`으로 실패하고, UI에 [폴더 접근 재승인] 버튼을 띄운다.
- **IDB**: db `bidmate` v1, store `handles` {key:'root', handle, name, pickedAt}.

## 3. 핵심 데이터 모델 (`src/core/types/*.ts`)
```ts
// ---------- 공통 ----------
export type ISODate = string;
export type FieldStatus = 'verified' | 'needs_review' | 'missing' | 'user_edited';
export type SourceKind = 'api' | 'html' | 'document' | 'user' | 'derived';
export interface FieldSource { kind: SourceKind; ref: string; evidence?: string; page?: number; fetchedAt: ISODate; }
export interface FieldValue<T> {
  value: T | null; raw?: string; status: FieldStatus; source?: FieldSource;
  candidates?: Array<{ value: T; source: FieldSource }>; note?: string;
}
export const missing = <T>(): FieldValue<T> => ({ value: null, status: 'missing' });

// ---------- Notice ----------
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
  credibilityScore: FieldValue<number>; performanceScore: FieldValue<number>;
  performancePeriod: FieldValue<string>; performanceMinAmount: FieldValue<number>; performanceCondition: FieldValue<string>;
}
export type NoticeFieldKey = keyof NoticeBasic | keyof NoticeSchedule | keyof NoticeEvaluation;
export type AttachmentStatus = 'pending' | 'downloading' | 'saved' | 'failed' | 'skipped' | 'size_mismatch';
export interface Attachment {
  id: string; index: number; originalName: string; savedName: string | null;
  url: string; expectedSize: number | null; savedSize: number | null; sha256?: string;
  mimeHint?: string; docKind?: 'eval_criteria' | 'notice' | 'rfp' | 'other';
  status: AttachmentStatus; attempts: number; lastError?: string; savedAt?: ISODate;
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

// ---------- Extraction ----------
export type ExtractionStatus = 'verified' | 'needs_review' | 'unsupported' | 'failed' | 'not_run';
export interface EvidenceRef { sourceFile: string; page?: number; sheet?: string; evidence: string; }
export interface ExtractedItem<T> { value: T | null; status: ExtractionStatus; evidence?: EvidenceRef; candidates?: Array<{ value: T; evidence: EvidenceRef }>; userEdited?: boolean; }
export interface Extraction {
  schemaVersion: 1; noticeId: string; extractedAt: ISODate;
  credibilityEvaluation: { score: ExtractedItem<number> };
  performanceEvaluation: { score: ExtractedItem<number>; period: ExtractedItem<string>; minimumAmount: ExtractedItem<number>; condition: ExtractedItem<string> };
  differentialScoring: ExtractedItem<boolean>;
  files: Array<{ attachmentId: string; parser: string; status: 'parsed' | 'unsupported' | 'failed' | 'scanned'; pages?: number; error?: string }>;
}

// ---------- Recipient / Group ----------
export interface Recipient { id: string; name: string; email: string; dept?: string; memo?: string; enabled: boolean; defaultRole: 'to' | 'cc'; updatedAt: ISODate; }
export interface Group { id: string; name: string; memberIds: string[]; roleOverrides?: Record<string, 'to' | 'cc'>; isDefault: boolean; updatedAt: ISODate; }
// 해석: enabled=false 제외 → 이메일 소문자 정규화 중복 제거 → TO가 CC보다 우선

// ---------- Template ----------
export interface TemplateFieldItem { fieldKey: NoticeFieldKey | `custom.${string}` | `extraction.${string}` | 'attachmentList' | 'sourceUrl'; label: string; visible: boolean; }
export interface TemplateSection { id: string; title: string; items: TemplateFieldItem[]; }
export interface Template { id: string; name: string; isDefault: boolean; subject: string; greeting: string; closing: string; sections: TemplateSection[]; updatedAt: ISODate; }
// 변수 레지스트리 core/templates/variables.ts (코드 상수). 렌더 core/templates/render.ts:
// (template, notice, extraction) => { subject, html, text, unresolved: string[] }; missing/needs_review → "확인 필요"

// ---------- Settings (비밀값 제외) ----------
export interface FieldMapping { key: string; label: string; variable: string; apiPath?: string; htmlSelector?: string; }
export interface Settings {
  schemaVersion: 1;
  g2b: { apiBaseUrl: string; detailUrlPatterns: string[] };
  sites: {
    trackerbot: { urlPatterns: string[] };
    naverworks: { host: string /* 기본 'mail.worksmobile.com' */; composePath?: string; selectorSetId: string; selectorOverrides?: Partial<ComposeSelectorSet> };
  };
  download: { concurrency: number; maxRetries: number; backoffMs: number; maxFileMB: number };
  mail: { defaultGroupId?: string; defaultTemplateId?: string };
  customFields: FieldMapping[];
  updatedAt: ISODate;
}
// chrome.storage.local: { secrets: { g2bServiceKey?: string }, settingsCache: Settings, registeredSites }

// ---------- index.json ----------
export interface IndexEntry {
  noticeId: string; noticeNo: string; round: string; title: string; orderingOrg: string; folder: string;
  collectedAt: ISODate; bidCloseAt?: ISODate; collectStatus: CollectStatus;
  attachments: { total: number; saved: number; failed: number };
  extractionStatus: ExtractionStatus; mailStatus: MailStatus; lastComposedAt?: ISODate;
  isCorrection: boolean; supersededBy?: string;
}
export interface IndexFile { schemaVersion: 1; generatedAt: ISODate; notices: IndexEntry[]; }

// ---------- Job ----------
export type JobType = 'collect' | 'compose' | 'extract' | 'download_retry';
export type JobStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled' | 'interrupted';
export type StepId = 'fetch_basic' | 'fetch_html' | 'download_attachments' | 'extract' | 'render_mail' | 'open_compose' | 'fill_fields' | 'attach_files' | 'verify';
export interface StepState { id: StepId; status: 'pending' | 'running' | 'done' | 'failed' | 'skipped'; progress?: { done: number; total: number }; startedAt?: ISODate; endedAt?: ISODate; error?: JobError; }
export interface JobError { code: string; message: string; step?: StepId; retryable: boolean; detail?: unknown; }
export interface Job {
  id: string; type: JobType; noticeId?: string; ref?: NoticeRef; status: JobStatus;
  steps: StepState[]; currentStep?: StepId; attempt: number;
  originTabId?: number; composeTabId?: number;
  createdAt: ISODate; updatedAt: ISODate; result?: unknown; errors: JobError[];
}
export interface JobProgress { jobId: string; step: StepId; status: StepState['status']; progress?: StepState['progress']; label: string; }

// ---------- 메일 작성 이력 (notices/<folder>/mail.json = ComposeRecord[]) ----------
export interface FieldResult { field: 'to' | 'cc' | 'subject' | 'body'; requested: string[] | string; rendered: string[] | string | null; status: 'ok' | 'mismatch' | 'failed' | 'unsupported'; method: string; error?: string; }
export interface AttachResult { fileId: string; name: string; size: number; status: 'uploaded' | 'uploading_timeout' | 'failed' | 'not_in_dom' | 'size_mismatch'; renderedName?: string; renderedSize?: string; method: 'input' | 'drop' | 'paste'; elapsedMs: number; error?: string; }
export interface ComposeRecord {
  id: string; jobId: string; noticeId: string; composedAt: ISODate; templateId: string; groupId?: string;
  snapshot: { to: string[]; cc: string[]; subject: string; html: string };
  fields: FieldResult[]; attachments: AttachResult[];
  outcome: 'ready_for_review' | 'partial' | 'failed';   // 'sent' 없음
  adapterId: string; selectorSetVersion: string; webmailUrl: string;
}
```
Job 상태 전이:
- `queued→running`
- `running→completed`(필수 step 모두 done)
- `running→partial`(선택 step 실패)
- `running→failed`
- `queued|running→cancelled`
- `running→interrupted`(SW가 재시작될 때 offscreen이 없으면)

`interrupted|partial|failed`는 실패한 step부터 재개한다(attempt+1, 이미 성공한 step은 skipped). 필수 step: collect=`fetch_basic`, compose=`open_compose, fill_fields`.

## 4. 어댑터 인터페이스 (`src/adapters/*`)
### 4.1 NaverWorksComposeAdapter (CS)
```ts
export interface ComposeSelectorSet {
  id: string; version: string; hostPattern: string;
  compose: { url?: string; openButton?: string; readySelector: string; inFrame?: string };
  to: RecipientSel; cc: RecipientSel & { revealButton?: string };
  subject: { input: string };
  body: { kind: 'contenteditable' | 'iframe' | 'textarea'; editable: string; iframe?: string; insert: Array<'execCommand' | 'paste' | 'innerHTML'> };
  attach: { fileInput?: string; dropZone?: string; item: string; itemName: string; itemSize?: string; itemProgress?: string; itemError?: string; uploadingClass?: string; methods: Array<'input' | 'drop' | 'paste'> };
  draft?: { button: string; savedIndicator?: string };
  forbidden: { send: string[]; textPatterns: string[] /* 기본 ["보내기","전송","Send"] */ };
}
export interface RecipientSel { input: string; chip: string; chipEmail: string; commit: Array<'enter' | 'semicolon' | 'comma' | 'blur' | 'tab'>; }
export interface ComposeAdapter {
  readonly id: string; readonly selectorSet: ComposeSelectorSet;
  detect(): { isCompose: boolean; ready: boolean };
  waitReady(timeoutMs: number): Promise<void>;
  setRecipients(role: 'to' | 'cc', emails: string[]): Promise<FieldResult>;
  setSubject(text: string): Promise<FieldResult>;
  setBody(html: string): Promise<FieldResult>;
  attachFile(file: File, onProgress: (p: Partial<AttachResult>) => void): Promise<AttachResult>;
  readState(): ComposeState;   // { to; cc; subject; bodyText; bodyHtml; attachments: {name,size?,uploading}[] }
  saveDraft?(): Promise<FieldResult>;
}
```
- `GenericComposeAdapter(selectorSet)` 하나가 엔진이다. `selectorOverrides`는 deep-merge한다.
- DOM 조작은 `src/adapters/naverworks/dom-actions.ts`에서만 한다: `setNativeValue`, `typeText`, `pressKey`(modifier 거부), `click`(forbidden 검사 → `ForbiddenActionError`), `insertHtml`, `waitFor`, `settle`. ESLint로 그 밖의 `.click(`, `dispatchEvent(`, `.submit(`, `requestSubmit(` 사용을 금지한다.
- **수신자**: 네이티브 setter → `InputEvent insertText` → commit 전략 → 400ms settle → 칩을 다시 읽는다. 요청한 이메일이 모두 칩으로 있고, 요청하지 않은 칩이 없어야 `ok`다.
- **본문 검증**: `bodyText`에 핵심 문자열이 들어 있고, `bodyHtml` 길이가 요청 길이의 50%를 넘어야 한다.
- **첨부**: `DataTransfer` → `input.files` + `change` → 안 되면 `drop`(`dragenter`/`dragover` 선행) → 안 되면 `paste`. 완료 판정은 해당 이름의 item이 있고, 진행 표시가 사라지고, 오류가 없는 상태가 1초 이상 유지될 때다. 타임아웃은 `max(60s, size/100KB/s)`.
- **2차 수단**(optional `debugger`): 1차 수단이 실패한 필드가 있을 때만 구현한다.

### 4.2 NoticeSourceAdapter (offscreen)
```ts
export interface SourceContext { settings: Settings; secrets: { g2bServiceKey?: string }; fetch: typeof fetch; }
export interface NoticeSourceAdapter {
  readonly id: 'g2b-openapi' | 'g2b-html'; readonly kind: SourceKind;
  canHandle(ref: NoticeRef): boolean;
  fetchFields(ref: NoticeRef, ctx: SourceContext): Promise<Partial<Record<NoticeFieldKey, FieldValue<unknown>>>>;
  listAttachments(ref: NoticeRef, ctx: SourceContext): Promise<Array<Pick<Attachment, 'originalName' | 'url' | 'expectedSize' | 'mimeHint'>>>;
  resolveRef?(urlOrText: string): NoticeRef | null;
}
// core/model/merge.ts: api > html > document, user_edited 보존, verified 충돌 시 needs_review + candidates
```
### 4.3 TrackerBotAdapter (CS)
```ts
export interface NoticeLinkCandidate { row: Element; href: string; ref: NoticeRef | null; title?: string; }
export interface TrackerBotAdapter {
  readonly id: string; detect(doc: Document): boolean; findCandidates(doc: Document): NoticeLinkCandidate[];
  mountButton(c: NoticeLinkCandidate, onClick: () => void): () => void;
  observe(onChange: () => void): () => void;
}
```
트래커봇/나라장터 DOM도 Phase 2/3 시작 시 같은 probe로 확정한다.

## 5. Phase 1
### P1-0 스캐폴드
- 빌드는 **WXT**(Vite 기반)로 한다. `imports: false`, `srcDir: 'src'`. WXT가 Node 22와 맞지 않아 빌드에 실패하면 수동 Vite 설정으로 전환한다.
- 디렉터리:
```
src/entrypoints/{background.ts, offscreen/, popup/, sidepanel/, dashboard/, naverworks.content.ts, probe.ts(unlisted-script)}
src/core/{types, model(merge, ids, sanitize), templates(variables, render)}
src/messaging/{protocol.ts, bus.ts}
src/adapters/{naverworks/(engine.ts, dom-actions.ts, verify.ts, selectors/v1.ts), g2b/, trackerbot/}
src/engine/{file-store/(idb-handles.ts, file-store.ts, json-store.ts), jobs/(runner.ts, compose-job.ts), downloader/, extractor/}
src/background/{router.ts, job-coordinator.ts, tab-manager.ts, site-registry.ts, offscreen-manager.ts}
src/ui/{components, hooks(useJobs, useSettings), theme}
docs/{probe/, phase1-verification.md}
```
- manifest: `permissions: ["storage","scripting","offscreen","sidePanel","tabs","downloads","unlimitedStorage"]`, `optional_permissions: ["debugger","webRequest"]`, `optional_host_permissions: ["https://*/*"]`, `background.type: "module"`.
- offscreen `reasons: ['BLOBS','DOM_PARSER','WORKERS']`, 단일 인스턴스. offscreen에서 FSA 스모크 테스트를 한다.

### P1-1 probe
- `chrome.scripting.executeScript({target:{tabId, allFrames:true}, files:['probe.js']})`로 주입한다.
- sidepanel 진단 탭에 [스냅샷] [녹화 시작] [녹화 정지/저장]을 둔다.
- `ProbeReport` 구조:
  - 기본: `{url, title, ts, ua, frames:[{frameId,url,sameOrigin}], elements:{inputs, editables, buttons, fileInputs, iframes, shadowHosts}`
  - 각 요소: tag, type, id, name, class, placeholder, aria-*, role, visible, rect, cssPath, outerHTML 앞 300자
  - `editorHints`: ProseMirror, ql-editor, fr-element, se2, smarteditor, tox, cke 등
  - `sendCandidates`
  - `mutations[]`: 녹화 중 MutationObserver 결과
  - `resources[]`: PerformanceObserver resource
  - 이메일 패턴은 마스킹한다.
- 사용자 녹화 시나리오: 메일쓰기 → 수신자 1명 입력/칩 확정 → CC 열기 → 제목 → 본문 한 줄 → 작은 파일 첨부/완료 대기 → (선택) 임시저장. **보내기 클릭 금지.**
- 저장은 `chrome.downloads.download`로 한다. 사용자가 `docs/probe/`에 복사한다.

### P1-2 컴포즈 엔진
GenericComposeAdapter + dom-actions + 가드 + `naverworks.content.ts`로 구성한다. 흐름:
1. job-coordinator가 compose 잡을 받아 offscreen compose-job으로 넘긴다.
2. compose/open: 기존 탭을 탐색하고, 없으면 `tabs.create`. 작성 화면이 팝업으로 열리면 `tabs.onCreated` + URL 매칭으로 찾는다.
3. `cs/ping`을 최대 20s 기다린다.
4. fill → attach(릴레이) → verify.
5. ComposeRecord를 저장한다(Phase 1에서는 테스트 폴더 `bidmate-test/compose-<ts>.json`).
6. 작성 탭에 포커스를 준다.

### P1-3 검증 UI
- dashboard `/test/compose` 페이지:
  - 입력: TO/CC, 제목, 본문(기본 템플릿 렌더), 테스트 폴더, [작성 실행]
  - 결과: 필드별 requested/rendered/status, 첨부별 상태, 오류 원문, 리포트 JSON
- `docs/phase1-verification.md`를 작성한다.

Phase 1 제외: 나라장터/트래커봇, 다운로더, 파서, 수신자/그룹/템플릿 CRUD 화면(render 함수와 기본 템플릿 상수는 만든다), 통계.

## 6. 불가능/불확실 지점
1. **offscreen FSA**: 미검증. 실패하면 엔진을 고정 탭으로 옮긴다(FileStore 인터페이스는 그대로).
2. **SW FSA**: 의존하지 않는다.
3. **확장 origin FSA 영속 권한**: 미확인. 적용되지 않으면 세션마다 재승인 1회가 필요하다.
4. **isTrusted 검사**: debugger로 우회하고, 그래도 안 되면 `unsupported` + 클립보드 복사/붙여넣기 안내로 대체한다.
5. **업로드 완료 판정이 모호한 경우**: webRequest를 2차 신호로 쓰고, 그래도 불확실하면 `uploading_timeout` + 사용자 확인을 요청한다.
6. **input/drop/paste가 모두 실패한 경우**: `unsupported`로 보고하고 수동 첨부를 안내한다.
7. **로컬 폴더 열기**: FSA는 절대 경로를 노출하지 않는다. 대신 사용자가 입력한 절대 경로로 `file:///` 링크를 만들거나 경로 복사 버튼을 둔다.
8. **편집기 iframe이 다른 origin인 경우**: `allFrames` + 해당 origin 권한 + `frameId`로 처리한다.
9. **`sidePanel.open` 제스처 전파**: 미확인. 전파되지 않으면 플로팅 패널을 1차 UI로 쓴다.
10. **Phase 2 첨부 인증 세션**: host_permissions가 필요하다. 특수 다운로드는 probe `resources[]`로 분석한다.
11. **대용량 첨부**: `maxFileMB`(기본 100)를 넘는 파일은 자동 첨부에서 제외하고 보고한다.

## 7. 금지
- SW에서 파일 I/O/파싱/장기 루프를 돌리지 않는다.
- dashboard/sidepanel에서 `createWritable`을 호출하지 않는다.
- 폴더 경로를 제목에서 다시 계산하지 않는다.
- `FieldValue.value`에 추정값을 넣지 않는다.
- 이벤트 디스패치만으로 성공 처리하지 않는다.
- modifier 키, `form.submit`, `requestSubmit`, 전송 버튼 이벤트를 쓰지 않는다. 'sent' 상태는 없다.
- 첨부를 `chrome.downloads`로 저장하지 않는다(downloads는 probe 리포트 내보내기 전용).
- 메시지에 ArrayBuffer/File을 넣지 않는다(청크 base64로 보낸다).
- 호스트를 `host_permissions`에 하드코딩하지 않는다.
- `storage.session`에 큰 데이터를 넣지 않는다.

## 8. 검증
- **P1-0**: 로드 → offscreen 쓰기/읽기/삭제 → 브라우저 재시작 후 `fs/status` 기록.
- **P1-1**: inputs/editables/fileInputs/sendCandidates가 비어 있지 않아야 한다. mutations에 첨부 항목이 추가되는지 확인한다.
- **P1-2/3**:
  - 입력: TO 2명, CC 1명, 제목, HTML 본문, 파일 3개(1KB/5MB/30MB)
  - 통과 조건: 모든 필드 `ok`, 모든 첨부 `uploaded`, 사용자 육안 확인, 미전송 확인
  - 가드 단위 테스트(vitest + jsdom)
- **단위 테스트**: sanitize, ids, merge, render, Job 상태 전이.
