# 메일 작성 이동(compose) 구현 명세

설계: Fable, 2026-10-18. 결정 기록: `.claude/specs/decisions.md` "메일 작성 이동(compose) 설계".
이 문서의 독자는 맥락 없는 구현 에이전트다. 여기 적힌 것만 결정 사항이다. 설계에서 벗어나야 하면 구현 전에 멈추고 보고한다.

## 0. 목표와 전제
- 목표: 사이드패널 [메일 작성] 한 번으로 웹메일(네이버웍스) 작성 탭을 열고, 수신자/제목/본문 입력과 첨부를 수행한 뒤 사용자가 직접 보내게 한다. 전송은 절대 하지 않는다.
- 전제: 네이버웍스 DOM 실측 자료가 없다. 셀렉터는 하나도 확정되지 않았다. 따라서 셀렉터셋 `status: 'unverified'`이면 "수동 모드"(탭 열기 + 사이드패널 복사 안내, 결과 partial)로 끝나고, 실측 후(S6) `verified`가 되면 자동 입력이 켜진다. **셀렉터 값을 추정해서 채우지 않는다.**
- 이미 있는 것:
  - `Job.type`에 `compose`, `StepId`에 `render_mail, open_compose, fill_fields, attach_files, verify`, `Job.composeTabId` (`src/core/types/job.ts`)
  - `job-conflict.ts`는 compose를 별도 군으로 둔다(같은 공고의 collect와 동시 실행 가능)
  - `prepareMail`(`src/engine/mail/prepare.ts`): 그룹/템플릿 결정, 렌더, 첨부 목록, `mail-draft.json` 저장. `draftToComposeFill`로 `compose/fill` 입력과 `FileMeta[]`를 만든다
  - 메시지 bus(`src/messaging/bus.ts`)의 `send`/`listen`/`sendToTab`. Port 인프라는 없다(만들지 않는다)
  - `bus.listen(..., 'offscreen')`은 SW 발신만 받는다(2026-10-18 결정). offscreen은 SW에 `send(..., {target:'sw'})`로 보낸다
  - `src/adapters/naverworks/types.ts`(ComposeSelectorSet, ComposeAdapter 등)
  - ESLint 없음

## 1. 전체 흐름
```
[sidepanel] 권한 사전 확인 → job/start {type:'compose', noticeId, ref?, params}
[SW coordinator] ledger queued → job/run → offscreen
[offscreen compose-job] 단계 실행. 탭 관련 동작은 전부 SW에 요청
  render_mail   prepareMail(noticeId) → MailDraft
  render_mail 직후 planCompose(settings, draft, selectorSets)로 서비스별 계획(provider, url, prefilled, selector?)을 만든다
  open_compose  compose/open {url, selector?} → SW: 탭 생성 + (selector 있을 때만) CS 주입 + configure
                selector 없음(셀렉터셋 unverified, 또는 Gmail 주소 방식)이면 여기서 수동/주소 모드로 분기(아래 생략하고 마무리)
                compose/detect 1초 폴링(최대 120초) → 감지된 프레임으로 compose/bind
  fill_fields   compose/fill → SW(ledger에서 탭/프레임 조회) → CS
  attach_files  파일마다 compose/attach-begin → file/chunk ×N(응답이 ack) → file/end(주입 시작)
                → compose/attach-status 1.5초 폴링(완료 또는 타임아웃까지)
  verify        compose/verify → CS readState() → draft와 대조해 FieldResult 재판정
  마무리        ComposeRecord를 notices/<folder>/mail.json에 append, notice.mail 갱신, compose/focus
[SW] job/finish → ledger → 사이드패널이 storage.session 구독으로 표시
```
- provider 분기는 `planCompose`(`src/engine/mail/compose-plan.ts`) 한 곳에서만 한다. `Settings.mail.provider`가 작성 서비스다.
  - naverworks: url = `https://<host><composePath>`, 사용자가 [메일쓰기]를 눌러야 하므로 `needsUserOpen`. 셀렉터셋이 verified면 자동 입력, 아니면 수동 모드.
  - gmail: url에 받는 사람, 참조, 제목, 본문을 담은 작성 주소(`buildGmailComposeUrl`, `https://mail.google.com/mail/u/<accountIndex>/?fs=1&tf=cm&to=&cc=&su=&body=`)를 쓴다. 본문은 `draft.text`. 주소가 8000자를 넘으면 본문을 통째로 뺀다(절단 금지, `URL_TOO_LONG`). `gmail-v1` 셀렉터셋은 unverified라 작성 화면 감지, 필드 입력, 첨부, 확인은 모두 생략하고 첨부는 사용자가 직접 한다(`ATTACH_MANUAL`). 결과는 항상 partial.

## 2. 메시지 프로토콜 (`src/messaging/protocol.ts`)
기존 compose 정의(`cs/ready`, `compose/open`, `compose/fill`, `compose/attach-begin`, `file/chunk`, `file/end`, `compose/attach-result`, `compose/verify`)는 처리부가 없으므로 아래로 교체한다. `cs/ready`, `compose/attach-result`는 삭제한다. `cs/ping`은 유지(compose에서는 안 씀).

```ts
export interface ComposeSelectorConfig { selectorSetId: string; selectorOverrides?: Partial<ComposeSelectorSet> }
export interface ComposeDetect { frameId: number; injected: boolean; isCompose: boolean; ready: boolean }
export type AttachStatus =
  | { done: false; phase: 'buffering' | 'injecting' | 'uploading'; elapsedMs: number }
  | { done: true; result: AttachResult };
export interface FileMeta { fileId: string; name: string; size: number; mime?: string }   // 기존 유지

// offscreen→SW (SW 핸들러 첫 줄에서 isOffscreenSender 검사 필수)
| { type: 'compose/open';    payload: { jobId: string; url: string; selector?: ComposeSelectorConfig }; response: { tabId: number } }
| { type: 'compose/detect';  payload: { jobId: string }; response: { frames: ComposeDetect[] } }
| { type: 'compose/bind';    payload: { jobId: string; frameId: number }; response: void }
| { type: 'compose/focus';   payload: { jobId: string }; response: void }
| { type: 'compose/abort';   payload: { jobId: string }; response: void }   // SW→CS로도 같은 type(target 'content')
// offscreen→SW→CS (SW가 ledger의 composeTabId/composeFrameId로 tabs.sendMessage(tabId, env, {frameId}))
| { type: 'compose/fill';          payload: { jobId: string; to: string[]; cc: string[]; subject: string; html: string }; response: FieldResult[] }
| { type: 'compose/attach-begin';  payload: { jobId: string; files: FileMeta[] }; response: { accepted: string[]; rejected: Array<{ fileId: string; reason: string }> } }
| { type: 'file/chunk';            payload: { jobId: string; fileId: string; seq: number; total: number; b64: string }; response: { received: number } }
| { type: 'file/end';              payload: { jobId: string; fileId: string }; response: { started: boolean; error?: string } }
| { type: 'compose/attach-status'; payload: { jobId: string; fileId: string }; response: AttachStatus }
| { type: 'compose/verify';        payload: { jobId: string }; response: ComposeState }
```
- `compose/open`: `url`은 planCompose가 만든 전체 주소다. SW는 https가 아니거나 파싱 실패면 `COMPOSE_BAD_URL`로 거부하고, url의 origin으로 권한을 확인한다. `selector`가 없으면 CS 주입과 configure를 생략하고 탭만 연다.
- 호출 측(offscreen) 타임아웃: open 60초(SW 로드 대기 20초 + 주입), detect 10초, fill 90초, attach-begin 15초, chunk 30초, end 15초, attach-status 10초, verify 15초. 모든 호출은 `signal`과 race. abort면 `compose/abort`를 보내고 `cancelled`로 끝낸다.
- 오류 code
  - SW: `NEEDS_SITE_PERMISSION`(permissions.contains 거짓), `COMPOSE_BAD_URL`(url 파싱 실패 또는 https 아님), `COMPOSE_TAB_CLOSED`(tabs.get 실패 또는 ledger에 탭 없음), `COMPOSE_INJECT_FAILED`(executeScript 거부), `COMPOSE_CS_UNREACHABLE`(수신자 없음, "Receiving end does not exist")
  - offscreen: `COMPOSE_NOT_DETECTED`(120초 초과), `COMPOSE_UNVERIFIED`(수동 모드 표식, 오류 아님), `COMPOSE_FILL_FAILED`, prepareMail의 `NO_GROUP`/`NO_RECIPIENTS`/`NOT_FOUND`/`JOB_ALREADY_RUNNING`/`NEEDS_FS_PERMISSION`은 그대로 전파
  - CS: `COMPOSE_JOB_MISMATCH`(jobId 불일치)

## 3. 상태 모델
- compose 진행 상태는 `jobs.<id>` ledger에 넣는다. 별도 키 없음.
- `Job`에 `composeFrameId?: number` 추가.
- `JobRequest`: compose는 `noticeId` 필수, `ref` 선택(제목 표시용), `params?: { groupId?: string; templateId?: string } & Record<string, unknown>`.
- `COMPOSE_STEPS = ['render_mail','open_compose','fill_fields','attach_files','verify']`. 필수 step = open_compose, fill_fields.
- 결과:
```ts
export interface ComposeResult {
  noticeId: string; folder: string; title?: string;
  mode: 'auto' | 'manual' | 'url';         // manual = 셀렉터 미검증 또는 전 필드 unsupported, url = 주소 파라미터로 전달(Gmail)
  provider?: MailProvider;                 // 'naverworks' | 'gmail'
  tabId?: number;
  fields: FieldResult[];                   // to, cc, subject, body
  attachments: Array<AttachResult & { error?: string }>;
  outcome: 'ready_for_review' | 'partial' | 'failed';
  recordId?: string;                       // mail.json에 기록된 ComposeRecord.id
  attachDir: string;                       // `${folder}/attachments`
}
```
- `FieldResult.status`에 `'prefilled'`가 추가됐다(주소 파라미터로 전달, 화면 확인 안 함). `prefilled`는 `ok`로 취급하지 않는다. 생략된 본문은 `unsupported` + `error: 'URL_TOO_LONG'`.
- Gmail 결과는 항상 partial이다(mode 'url', 필드 prefilled, 첨부 skipped). 화면 확인 없이 completed로 올리지 않는다.
- 상태 전이: completed = 모든 필드 ok 그리고 모든 첨부 uploaded(첨부 0개 포함). partial = open/fill은 됐으나 mismatch/unsupported/첨부 실패/타임아웃, 또는 수동 모드. failed = render 실패, 탭 열기 실패, 감지 타임아웃, fill 전부 failed. cancelled/interrupted는 기존 규칙. **수동 모드를 completed로 올리지 않는다.**
- `notice.mail`: outcome이 failed가 아니면 `status='ready_for_review'`(이미 delivered면 유지), `lastComposedAt=now`.
- ComposeRecord는 `notices/<folder>/mail.json`(`ComposeRecord[]`)에 경로 락 안에서 append.
- Job.result(storage.session)에 html/base64를 넣지 않는다.

## 3.1 이후 변경 (Gmail 지원, 2026-10-18)
S1~S6 기록은 당시 기준이다. `compose/open`은 `{ jobId, url, selector? }`로 바뀌었고(host/composePath 제거), `site.host`로 주소를 만드는 일은 planCompose가 맡는다. 상세는 `.claude/specs/gmail-provider.md`.

## 4. 공통 금지
- 셀렉터 추정 금지. `naverworks-v1`은 빈 값 + unverified.
- SW 핸들러에서 수 분짜리 응답을 pending으로 잡지 않는다(감지/업로드 대기는 offscreen 폴링).
- offscreen→SW compose 핸들러에서 `isOffscreenSender` 검사를 빼지 않는다.
- CS는 `chrome.storage.session`을 읽지 않는다. 요청에만 답한다.
- `prepareMail`과 `markComposed`는 각각 `editLockKey` 락을 잡는다. 둘을 한 락 안에 넣지 말고, 락 안에서 `saveNoticeLatest`를 부르지 않는다(데드락).
- `tabs.sendMessage`는 항상 frameId를 지정한다.
- 재시도에서 이전 `composeTabId`를 재사용하지 않는다. 항상 새로 열고 이전 탭은 닫지 않는다.
- 첨부 파일을 `chrome.downloads`로 내보내지 않는다.
- `form.submit`, `requestSubmit`, modifier 키 조합, 전송 버튼 클릭 경로를 만들지 않는다.
- 가운뎃점(·) 문자를 코드 주석, 문자열, 문서에 쓰지 않는다.

## S1. 타입, 프로토콜, 파일스토어 (implementer 1명, 가장 먼저)
대상과 변경:
- `src/messaging/protocol.ts`: §2 교체. `Target`은 그대로.
- `src/core/types/job.ts`: `Job.composeFrameId?`, `ComposeResult`, `JobRequest.params` 타입(§3).
- `src/core/types/compose.ts`: `AttachResult.status`에 `'skipped'` 추가, `method`에 `'none'` 추가.
- `src/adapters/naverworks/types.ts`: `ComposeSelectorSet.status: 'unverified' | 'verified'`, `ComposeAdapter.detect()` 반환에 `reason?: string`, `attachFile(file: File, opts: { signal: AbortSignal; onPhase(p: 'injecting' | 'uploading'): void }): Promise<AttachResult>`.
- `src/engine/file-store/types.ts`, `file-store.ts`, `tests/helpers/memory-store.ts`: `readBlob(path): Promise<Blob>` 추가(FSA는 `getFile()` 결과, 메모리는 `new Blob([bytes])`). 슬라이스는 호출 측.
- 셀렉터셋(S3, S4가 함께 쓴다)
  - `src/adapters/naverworks/selectors/naverworks-v1.ts`: `id:'naverworks-v1', version:'0.0.0-unverified', status:'unverified', hostPattern:'mail.worksmobile.com'`. 나머지 셀렉터 필드는 빈 문자열/빈 배열. `forbidden.textPatterns: ['보내기','전송','Send','발송']`.
  - `src/adapters/naverworks/selectors/index.ts`: `SELECTOR_SETS: Record<string, ComposeSelectorSet>`, `mergeSelectorSet(base, overrides)`(deep merge, 배열은 교체).
  - `mergeSelectorSet` 단위 테스트 추가
- 기존 compose 정의를 참조하던 곳이 있으면 타입만 맞춘다(동작 추가 금지).
완료 조건: `npx tsc --noEmit` 통과, `mergeSelectorSet`과 memory-store `readBlob` 테스트 추가 및 통과, 기존 테스트 통과.

## S2. SW (implementer 1명, S1 뒤)
- `src/background/job-coordinator.ts`
  - `COMPOSE_STEPS` 추가, `newJob`에서 type별 steps.
  - `startJob` 검증: `ref`가 없어도 되는 조건에 `type==='compose' && noticeId` 추가. compose의 `retryOf`는 steps 전부 pending으로 초기화.
  - `assertRetryAllowed` 및 시작 검사: `req.type==='compose'`는 extension 발신만(extract와 같은 분기).
  - export `setComposeTab(jobId, patch: { composeTabId?: number; composeFrameId?: number })`: serial 안에서 putJob, 잡이 ACTIVE일 때만.
- `src/messaging/bus.ts`: `sendToTab(tabId, type, payload, opts?: { frameId?: number; timeoutMs?: number })`로 확장. 기존 호출과 호환.
- `src/background/compose-relay.ts` (신규) `registerComposeRelay()`: §2의 offscreen→SW 11개 type을 `listen(type, handler, 'sw')`로 등록. 모든 핸들러 첫 줄 `if (!isOffscreenSender(sender)) throw SENDER_FORBIDDEN`.
  - `compose/open`: `permissions.contains({origins:['https://<host>/*']})` 거짓 → NEEDS_SITE_PERMISSION → `windows.getLastFocused()` → `tabs.create({windowId, url:'https://<host><composePath ?? "/">', active:true})` → `setComposeTab(jobId,{composeTabId})` → `tabs.onUpdated` status complete 대기(최대 20초, 넘어도 진행) → `inject(tabId, selector)`(실패해도 throw하지 않음, detect 폴링이 재주입) → `{tabId}`. selector는 jobId별 Map에 보관(재주입용).
  - `inject(tabId, selector)`: `scripting.executeScript({target:{tabId, allFrames:true}, files:['naverworks-compose.js']})` 후 `executeScript({func:(cfg)=>window.__bidMateCompose?.configure(cfg), args:[selector], target:{tabId, allFrames:true}})`. 실패 → COMPOSE_INJECT_FAILED.
  - `compose/detect`: `tabs.get` 실패 → COMPOSE_TAB_CLOSED. `executeScript({func:()=>window.__bidMateCompose?.detect() ?? null, allFrames:true})` → null 프레임이 있으면 inject 1회 후 재실행 → `ComposeDetect[]`(frameId 포함).
  - `compose/bind`: `setComposeTab(jobId,{composeFrameId})`.
  - 릴레이 6종(fill, attach-begin, file/chunk, file/end, attach-status, verify): `getJob(jobId)` → composeTabId/FrameId 없으면 COMPOSE_TAB_CLOSED → `sendToTab(tabId, type, payload, {frameId})` → "Receiving end does not exist"면 COMPOSE_CS_UNREACHABLE.
  - `compose/focus`: `tabs.update(tabId,{active:true})` + `windows.update(windowId,{focused:true})`, 실패 무시.
  - `compose/abort`: CS로 전달(실패 무시) + Map 정리.
- `src/entrypoints/background.ts`: `registerComposeRelay()` 호출.
- `wxt.config.ts`: 변경 없음.
테스트:
- `tests/background/job-coordinator.test.ts`: compose newJob steps, compose retry 전부 pending, ref 없는 compose 허용, g2b 발신 compose 거부.
- compose-relay(chrome API fake): open 권한 없음 → NEEDS_SITE_PERMISSION, 릴레이에서 탭 없음 → COMPOSE_TAB_CLOSED, offscreen 아닌 발신자 → SENDER_FORBIDDEN, sendToTab에 frameId 전달.
- `tests/background/router.test.ts`(또는 등록 테스트): compose-relay 등록 확인.
완료 조건: typecheck, 관련 테스트, 기존 테스트 통과.

## S3. offscreen (implementer 1명, S1 뒤, S2와 병렬 가능)
- `src/engine/mail/chunker.ts` (신규, 순수): `async function* chunkBlob(blob: Blob, chunkBytes = 2*1024*1024): AsyncGenerator<{ seq: number; total: number; b64: string }>`. `FileReader.readAsDataURL(slice)` 결과의 `,` 뒤. FileReader가 없으면 `arrayBuffer` + 수동 base64 폴백(Node 테스트용). 0바이트 파일은 total 0 또는 빈 청크 1개 중 하나로 정하고 CS 쪽 FileBuffer와 맞춘다(보고에 명시).
- `src/engine/mail/record.ts` (신규)
  - `appendComposeRecord(store, folder, record)`: `withLock(`${folder}/mail.json`)` 안에서 read(없거나 손상이면 `[]`) → push → write.
  - `markComposed(store, noticeId, outcome, now)`: `editLockKey` 락 안에서 loadNotice → mail.status/lastComposedAt 갱신 → `saveNotice`. `saveNoticeLatest` 사용 금지.
- `src/engine/jobs/compose-job.ts` (신규)
```ts
export interface ComposeJobDeps {
  store: IFileStore; checkPermission(): Promise<void>; emit(p: JobProgress): void; signal: AbortSignal;
  call: <T extends MsgType>(type: T, payload: PayloadOf<T>, timeoutMs: number) => Promise<ResponseOf<T>>;  // = send(..., {target:'sw', timeoutMs})
  selectorSets: Record<string, ComposeSelectorSet>; now?: () => Date; sleep?: (ms: number) => Promise<void>;
  detectTimeoutMs?: number /*120000*/; attachPollMs?: number /*1500*/;
}
export async function runComposeJob(input: { job: Job; settings: Settings }, deps: ComposeJobDeps): Promise<{ status: JobStatus; result?: ComposeResult; error?: JobError }>
```
  순서:
  1. checkPermission → `prepareMail(store, { noticeId, ...job.params })`(오류 code 그대로, step render_mail) → `draftToComposeFill`.
  2. 셀렉터셋 = `settings.sites.naverworks.selectorSetId`로 조회. 없으면 수동 모드 취급.
  3. `compose/open`.
  4. 수동 모드(셀렉터셋 없음 또는 status unverified): fill_fields/attach_files/verify step `skipped`, fields 4개 `unsupported`(method 'none', error 'SELECTOR_UNVERIFIED'), attachments 전부 `skipped`, outcome partial, mode manual → 기록, focus, 종료(status partial).
  5. verified: detect 폴링(1초, detectTimeoutMs) 중 job.label을 "웹메일에서 [메일쓰기]를 눌러 주세요 (남은 N초)"로 1초마다 emit → isCompose && ready 프레임을 bind → fill → 첨부 → verify.
  6. 첨부: `size > settings.download.maxFileMB * MB`면 skipped(릴레이 안 함). 파일별 타임아웃 `max(60초, size / (100KB/s))`. attach-begin → chunkBlob(readBlob) 순서대로 file/chunk → file/end → attach-status 폴링. progress(done/total)와 bytes를 emit.
  7. verify: to/cc는 소문자 정규화 집합 비교, subject는 trim 동일, body는 bodyText에 제목과 첫 섹션 라벨 포함 그리고 bodyHtml 길이가 요청의 50% 이상.
  8. 마무리: `appendComposeRecord`, `markComposed`(failed 아니면), `compose/focus`.
  9. 각 await 전후 `signal.aborted` 확인. abort면 `compose/abort` 전송 후 `{status:'cancelled'}`. 모든 emit에 attempt 포함.
- `src/entrypoints/offscreen/main.ts`: `runJob`에서 `job.type==='compose'`면 `runComposeJob`. catch 기본 code를 type별로(compose는 `COMPOSE_ERROR`). `selectorSets`는 S1이 만든 `src/adapters/naverworks/selectors/index.ts`의 `SELECTOR_SETS`.
테스트: chunker 왕복(0바이트, 경계, 2MB+1), record append와 손상 파일, compose-job을 fake `call`로: 수동 모드 결과, 정상 경로 호출 순서, 첨부 skipped(maxFileMB), 업로드 타임아웃 → partial, 감지 타임아웃 → failed(COMPOSE_NOT_DETECTED), attach 중 abort → cancelled + compose/abort 호출, prepareMail NO_GROUP → failed(step render_mail).
완료 조건: typecheck, 관련 테스트, 기존 테스트 통과.

## S4. 웹메일 CS와 어댑터 (implementer 1명, S1 뒤, S2/S3와 병렬)
- `src/adapters/naverworks/dom-actions.ts` (신규, 유일한 이벤트 디스패치 지점)
  - `setNativeValue(el, v)`: HTMLInputElement/HTMLTextAreaElement prototype value setter 호출 + `input` 이벤트
  - `typeText(el, text)`: `beforeinput`/`input` InputEvent(insertText)
  - `pressKey(el, key)`: key는 Enter, Tab, `;`, `,`만 허용. modifier 인자 없음
  - `click(el, selectorSet)`: `isForbidden`이면 `ForbiddenActionError` throw
  - `insertHtml(editable, html, strategies)`: execCommand insertHTML → paste ClipboardEvent → innerHTML, 순서는 `selectorSet.body.insert`
  - `dropFiles(zone, files)`(dragenter → dragover → drop), `pasteFiles(target, files)`, `setInputFiles(input, files)`(DataTransfer → `input.files` + change)
  - `waitFor(fn, timeoutMs, intervalMs = 200)`, `settle(ms = 400)`
  - `isForbidden(el, set)`: forbidden 셀렉터 매치, 또는 자기 텍스트/aria-label/title이 textPatterns 매치, 또는 `type=submit`
  - `form.submit`/`requestSubmit`/modifier 키 함수는 만들지 않는다
- `src/adapters/naverworks/engine.ts` (신규) `GenericComposeAdapter(selectorSet, root: Document)`: `ComposeAdapter` 구현.
  - `resolveRoot()`: `body.kind==='iframe'`이면 `iframe.contentDocument`, null이면 해당 필드 `unsupported`('CROSS_ORIGIN_FRAME')
  - 셀렉터가 빈 문자열인 필드는 즉시 `unsupported`('SELECTOR_MISSING')
  - 수신자: 이메일마다 typeText → commit 전략 순차 시도 → settle → 칩 재읽기. 요청 집합과 칩 집합이 같아야 ok
  - 첨부 완료 판정: 같은 이름 item 존재, itemProgress/uploadingClass 없음, itemError 없음이 1초 지속
  - `readState()`: to/cc 칩, subject, bodyText, bodyHtml
- `src/adapters/naverworks/file-buffer.ts` (신규) `FileBuffer`: `begin(meta)`, `push(fileId, seq, b64)`(`fetch('data:application/octet-stream;base64,'+b64)`로 디코딩, seq 순서/중복 검사), `end(fileId): File`(크기가 meta.size와 다르면 throw), 총 보유량 상한 `maxFileMB * 2`(configure로 받음). 0바이트 처리는 S3 chunker와 같은 규칙.
- `src/entrypoints/naverworks-compose.ts` (신규, `defineUnlistedScript`, 빌드 산출물 `naverworks-compose.js`): `window.__bidMateCompose` 중복 주입 가드. `configure(cfg)`(셀렉터셋 병합, 어댑터 생성), `detect()` → `{ injected: true, isCompose, ready }`. `listen(..., 'content')`로 `compose/fill`, `compose/attach-begin`, `file/chunk`, `file/end`, `compose/attach-status`, `compose/verify`, `compose/abort`. `file/end`는 File 조립 후 `attachFile`을 await하지 않고 시작하고 `{started:true}` 반환, 결과는 `Map<fileId, AttachStatus>`. jobId 불일치는 `COMPOSE_JOB_MISMATCH`.
테스트(jsdom):
- forbidden 요소 click 거부, pressKey가 허용 키 외 거부, setNativeValue가 prototype setter를 호출, FileBuffer 순서/중복/크기 검증
- GenericComposeAdapter가 빈 셀렉터에 unsupported
- 가짜 compose 픽스처 HTML(테스트 전용 셀렉터셋)에서 fill, attach(input 경로), readState 동작
- 소스 스캔 `tests/adapters/forbidden-dispatch.test.ts`: `src/adapters/naverworks/**`와 `src/entrypoints/naverworks-compose.ts`에서 `dom-actions.ts`를 제외하고 `.click(`, `dispatchEvent(`, `.submit(`, `requestSubmit(`, `execCommand(`가 없어야 한다. `dom-actions.ts` 안에 `ctrlKey|metaKey|altKey`가 없어야 한다.
완료 조건: typecheck, 관련 테스트, 빌드에서 `naverworks-compose.js` 산출 확인.

## S5. UI (메인 직접, S2 뒤)
- `src/ui/compose-view.ts`(순수 함수 `composeView`) + `tests/ui/compose-view.test.ts`
- `src/ui/clipboard.ts`: `copyRich(html, text)`(ClipboardItem text/html + text/plain), `copyText(text)`
- 사이드패널 [메일 작성]: 웹메일 호스트 권한 사전 확인(없으면 첫 await로 permissions.request) → `job/start {type:'compose', noticeId, ref, params:{}}` → useJobs로 구독. 수동 모드 카드는 `mail/draft-get`으로 받은 초안으로 복사 버튼 4종 + [작성 탭으로 이동].
- 표시 상태 표는 설계 원문(Fable 보고) 기준. 선택: MailPreparePage에 같은 진입.

## S6. 실측 반영 (사용자 probe 리포트 뒤)
- `naverworks-v1.ts`를 실측값으로 채우고 `status:'verified'`, version 1.0.0. probe에 `location.href` 변화 기록, Trusted Types/innerHTML 시도 결과 추가가 선행.
- 검증 결과는 `docs/phase1-verification.md`.

## 보고 형식 (모든 implementer)
결론, 변경 파일 경로, 추가 테스트 이름, 실패 항목만 한국어로. 명세와 다르게 한 부분과 그 이유를 따로 적는다. 범위 밖 구조 변경이 필요하면 구현하지 말고 멈춰서 보고한다.
