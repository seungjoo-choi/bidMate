# 대시보드에서 바로 발송 (Fable 설계, 2026-10-21 사용자 승인)

## 목표
대시보드 메일 준비 화면의 [바로 발송] → 미리보기 확인 → 네이버웍스 작성 탭을 **백그라운드**로 열어 기존처럼 채우기·첨부 → 확장이 보내기 버튼을 클릭 → 발송 확인 시 탭을 닫고 대시보드에 "발송 완료". 조건 미달·확인 실패·오류면 탭을 앞으로 가져와 사용자에게 넘긴다. 기존 "직접 보내기" 흐름은 그대로 유지한다.

## 0. 전제 사실

### 기존 불변 조건과의 관계 (중요)
- `src/adapters/naverworks/dom-actions.ts:3` "웹메일 DOM에 이벤트를 보내는 유일한 파일. 전송/submit/modifier 키 경로는 만들지 않는다." `click()`은 forbidden(보내기)이면 `ForbiddenActionError`.
- `tests/adapters/forbidden-dispatch.test.ts`가 adapters/naverworks·gmail, naverworks-compose.ts, send-watch.ts의 `.click(`/`dispatchEvent(`/`.submit(`/`execCommand(`와 dom-actions의 modifier 키를 금지한다.
- 이 기능은 위 규칙을 **완화하지 않는다.** 보내기 클릭은 새 파일 `src/background/send-trigger.ts` 한 곳에서 `executeScript` func로만 한다. 채움 엔진(dom-actions)은 계속 보내기를 못 누른다.
- 합성 `.click()`은 `isTrusted === false`라 send-watch의 기존 click 리스너(`send-watch.ts:64-68`)가 잡지 않는다. 정상이다. 자동 클릭은 `markSent('auto')`로 명시 신호를 낸다.

### S0 실측 (2026-10-21, 사용자)
1. 작성 화면 콘솔에서 `document.querySelector('button.lw_btn_point[data-hotkey="sendKey"]').click()` → **실제 발송됨**.
2. 작성 탭이 숨은 상태(다른 탭 활성)에서도 **발송됨**.
3. 보내기 전 확인 다이얼로그 **없음**. 보이는 상태: 같은 URL(`/write/popup?...`)에서 화면이 "메일을 성공적으로 보냈습니다." + [받은메일함가기 | 메일쓰기]로 바뀜. 숨은 상태: **작성 탭이 스스로 닫힘**.
→ 발송 확인 신호는 (a) 작성 UI 사라짐(`ui_gone`), (b) pagehide(`unload`), (c) 클릭 뒤 작성 탭 제거(SW `tabs.onRemoved`, `unload`로 기록) 세 경로를 모두 받는다.

### 확인된 코드 사실
- `compose-relay.ts:64-66` 셀렉터가 있으면 `tabs.create({active:false})`, 입력·첨부 끝나면 `compose/focus`(124-129)로 앞으로.
- `compose-job.ts` `finish`가 끝에서 무조건 `compose/focus`(141행 부근) → 자동 발송 성공 시 탭이 튀어나오므로 분리 필요.
- `job.result.recordId`는 잡 종료(onFinish) 뒤에만 ledger에 생긴다 → ComposeRecord를 클릭 전에 먼저 쓰고 id를 send-click에 동봉한다.
- 같은 공고 compose 동시 시작은 offscreen `JobRegistry.tryRegister` + `jobsConflict`가 이미 거부(`src/core/model/job-conflict.ts:46`).
- send-signal: `handleSendSignal`이 jobId별 `chains`로 직렬화 후 `processSignal`(`src/background/send-signal.ts:45-76`).

## 1. 결정 사항 (사용자 확인 완료)
- 버튼은 메일 준비 화면(MailPreparePage)에만. 사이드패널·공고 상세·트래커봇 행에는 없음.
- 미리보기에 본문 포함(기본 접힘).
- 이미 발송된 공고도 재발송 허용 + 경고 "이미 N회 발송됨 (마지막 MM-DD HH:mm)".
- 발송 확인(`ui_gone`/`toast`/`unload`/탭 제거 모두)되면 탭을 닫는다(이미 닫혔으면 그대로). 설정 없음.
- 자동 작성 큐(auto-compose)와 연동하지 않음(사용자가 내용을 본 적 없는 메일이 나가면 안 됨).
- 새 잡 타입 없음. compose 잡에 `params.autoSend`가 있으면 verify 뒤 `send_mail` 단계 실행.
- Ctrl+Enter 합성, `chrome.debugger` 사용 금지.

## 2. 타입·프로토콜 (S1)

`src/core/types/job.ts`
```ts
export type StepId = ... | 'send_mail';
// ComposeParams에 추가
autoSend?: { expectSentCount: number; fingerprint: string; confirmedAt: ISODate };
export type SendConfirmation = 'ui_gone' | 'toast' | 'unload';
export interface JobSendState { clickedAt: ISODate; composeRecordId?: string; confirmed: boolean; confirmation?: SendConfirmation; lastSignalAt?: ISODate; tabRemoved?: boolean }
// Job에 추가
send?: JobSendState;
// ComposeResult에 추가
send?: { state: 'sent' | 'unconfirmed' | 'skipped' | 'unknown'; reason?: SendSkipReason; confirmation?: SendConfirmation; tabClosed?: boolean; clickedAt?: ISODate };
export type SendSkipReason = 'NOT_SUPPORTED' | 'RETRY_ATTEMPT' | 'AUTO_JOB' | 'FIELDS_NOT_OK' | 'ATTACH_NOT_OK' | 'FINGERPRINT_MISMATCH' | 'SENT_COUNT_CHANGED' | 'BUTTON_NOT_FOUND' | 'BUTTON_DISABLED' | 'SUBJECT_MISMATCH' | 'ALREADY_FIRED' | 'CLICK_FAILED';
```
기존 코드에 `'ui_gone' | 'toast' | 'unload'` 리터럴이 흩어져 있으면 `SendConfirmation`으로 바꾼다.

`src/core/types/compose.ts`: `SendSignal.kind: 'click' | 'hotkey' | 'auto'`, `SentIndexEntry.signalKind?: SendSignal['kind']`. `src/core/mail/sent-derive.ts`의 `sentIndexEntryOf`에서 복사.

`src/adapters/naverworks/types.ts` `ComposeSelectorSet`에 `autoSend?: { button: string }`(확장이 눌러도 되는 유일한 요소. forbidden·sendWatch와 별개). `selectors/naverworks-v1.ts`에 `autoSend: { button: 'button.lw_btn_point[data-hotkey="sendKey"]' }`. gmail-v1은 없음. `selectors/index.ts`의 병합 함수가 새 필드를 다루는지 확인하고 필요하면 반영.

`src/messaging/protocol.ts`
```ts
| { type: 'compose/send-click'; payload: { jobId: string; composeRecordId?: string; subject: string }; response: { clicked: boolean; reason?: SendSkipReason } }  // offscreen→SW
| { type: 'compose/send-status'; payload: { jobId: string }; response: { tabAlive: boolean; clicked: boolean; confirmed: boolean; confirmation?: SendConfirmation } }  // offscreen→SW
| { type: 'compose/close-tab'; payload: { jobId: string }; response: { closed: boolean } }  // offscreen→SW
```
`mail/send-signal`, `mail/sent-record`의 kind에 `'auto'` 추가.

`src/core/mail/send-fingerprint.ts`(새, 순수): `sendFingerprint(d: { to: string[]; cc: string[]; subject: string; attachments: Array<{ name: string; size: number }> }): string`. to/cc는 trim·소문자·정렬, 제목 trim, 첨부는 이름+크기로 정렬 → `JSON.stringify` → djb2 해시 16진 문자열. 라이브러리 금지. 미리보기와 잡이 같은 함수를 쓴다.

`src/background/job-coordinator.ts`
- `COMPOSE_STEPS`에 `send_mail` 추가(맨 뒤). autoSend 없는 잡은 이 단계를 `skipped`로 둔다.
- `newJob`에서 `params.autoSend` 보존.
- `job/start` 리스너: 발신자가 extension 페이지가 아니면 `params.autoSend`를 제거(`auto`와 같은 취급).
- `setSendState(jobId, patch: Partial<JobSendState>)` 신설: ACTIVE 잡에만, 기존 serial 쓰기 경로 사용, `send`가 없으면 patch로 생성.

UI 라벨 맵에 `send_mail: '발송'` 추가: `src/ui/compose-view.ts COMPOSE_STEP_LABEL`, `src/ui/notice-detail/view.ts`(268행 부근 step 라벨), `src/ui/mascot/step-icons.ts`.

## 3. CS send-watch (S2, `src/entrypoints/send-watch.ts`)
- `window.__bidMateSendWatch`에 추가:
  - `markSent(kind: 'auto'): { armed: boolean }` — 이미 fired면 `{armed:false}`. 아니면 fired=true, `report('auto')`, `startConfirm()`, `{armed:true}`.
  - `state(): { fired: boolean; confirmed: boolean; confirmation?: SendConfirmation }`.
- 이벤트 리스너는 변경 없음(isTrusted 유지). 이 파일에 dispatch/click 추가 금지(스캔 테스트 통과 유지).
- 테스트 `tests/adapters/send-watch.test.ts`(없으면 신설, 기존 send-watch 테스트 위치를 따름): markSent 1회 제한 / markSent 뒤 gone이면 confirm 신호 / 사용자 클릭 뒤 markSent는 armed false.

## 4. SW (S3)

### `src/background/send-trigger.ts`(새) — `registerSendTrigger()`
모든 리스너는 offscreen 발신자만 허용(기존 `isOffscreenSender` 관례).

**`compose/send-click`**
1. ledger 잡 확인: 존재, `type==='compose'`, ACTIVE, `params.autoSend` 있음, `auto` 없음, `composeTabId`·`composeFrameId` 있음, `send` 없음. `send` 이미 있으면 `{clicked:false, reason:'ALREADY_FIRED'}`, 나머지 불충족은 `CLICK_FAILED`.
2. **클릭 전에** `setSendState(jobId, { clickedAt: now, composeRecordId, confirmed:false })`를 await. (멱등성 핵심. 순서 바꾸기 금지.)
3. `chrome.scripting.executeScript({ target:{tabId, frameIds:[frameId]}, func: clickSend, args:[{ button, scope, subjectInput, subject }] })`. 셀렉터는 SW가 가진 현재 셀렉터셋(compose-relay의 `selectors` Map — 필요하면 getter export 추가)에서 꺼낸다.
4. `clickSend`(이 파일 안의 독립 함수, import·클로저 금지): `window.__bidMateSendWatch?.state().fired`면 `ALREADY_FIRED` / scope가 있으면 scope 안에서 버튼 탐색, 없으면 `BUTTON_NOT_FOUND` / `disabled` 또는 `getClientRects().length===0`이면 `BUTTON_DISABLED` / 제목 입력값 trim이 payload subject와 다르면 `SUBJECT_MISMATCH` / 통과하면 `markSent('auto')`가 armed false면 `ALREADY_FIRED`, 아니면 `btn.click()` 후 `{clicked:true}`. send-watch가 없으면(`__bidMateSendWatch` 없음) `CLICK_FAILED`.
5. executeScript 예외는 `{clicked:false, reason:'CLICK_FAILED'}`로 돌려주지 않고 **throw**(offscreen이 unknown으로 처리; 클릭됐을 수 있음).

**`compose/send-status`**: ledger `job.send`와 `tabs.get(composeTabId)` 성공 여부로 응답. `confirmed`가 아니고 탭이 살아 있으면 SW가 직접 `executeScript`로 sendWatch의 `gone` 셀렉터 부재 / `toast` 매치를 평가하고, 맞으면 `recordSignal(job, 'confirm', conf)` 후 갱신된 값으로 응답(숨은 탭 타이머 스로틀 대비). 평가 실패는 무시.

**`compose/close-tab`**: ledger `composeTabId`를 `tabs.get` → URL host가 compose 호스트와 같고 그 창의 탭 수 ≥ 2일 때만 `tabs.remove`. 아니면 `{closed:false}`. 탭이 이미 없으면 `{closed:true}`.

**`chrome.tabs.onRemoved`**: 제거된 tabId가 어떤 compose 잡의 `composeTabId`이고 그 잡에 `send.clickedAt`이 있고 `confirmed`가 아니면 `recordSignal(job, 'confirm', 'unload')` + `setSendState(jobId, { tabRemoved: true })`. (S0: 숨은 탭은 보낸 뒤 스스로 닫힌다.) 같은 jobId `chains` 직렬화를 거친다.

### `src/background/send-signal.ts`
- `processSignal` 본문을 `export async function recordSignal(job: Job, kind: 'click'|'hotkey'|'auto'|'confirm', confirmation?: SendConfirmation): Promise<void>`로 추출. CS 경로·send-trigger 경로가 공유. send-trigger에서 부를 때도 같은 jobId `chains`에 태우도록 `enqueue(jobId, fn)` 헬퍼를 export한다.
- composeRecordId는 `job.send?.composeRecordId ?? job.result?.recordId` 순(CS 페이로드 값 사용 금지는 기존대로).
- 기록 뒤 잡에 `send`가 있으면 `setSendState(jobId, { confirmed: kind==='confirm' || prev, confirmation, lastSignalAt })`.
- kind `'auto'` 수용.

### `src/background/compose-relay.ts open()`
`tabs.create` 직후 `chrome.tabs.update(tabId, { autoDiscardable: false })`(실패 무시). 모든 compose 탭에 적용.

### `src/entrypoints/background.ts`: `registerSendTrigger()` 등록.

### 테스트
- `tests/background/send-trigger.test.ts`: autoSend 없음 / auto 있음 / send 이미 있음 → 거부 / setSendState가 executeScript보다 먼저 호출 / executeScript 예외는 throw / close-tab 호스트·탭 수 가드 / onRemoved: clickedAt 있고 미확인이면 confirm unload 기록, clickedAt 없으면 무시.
- send-signal 테스트에 kind 'auto', ledger 갱신, composeRecordId 우선순위 추가.
- `tests/adapters/forbidden-dispatch.test.ts` 확장: `src/background/**/*.ts` 스캔, `.click(`은 send-trigger.ts에 정확히 1회만, 그 파일에도 `dispatchEvent(`/`KeyboardEvent`/`ctrlKey|metaKey`/`execCommand(`/`.submit(` 없음.

## 5. offscreen 잡 (S4)

### `src/engine/jobs/compose-job.ts`
- `finish`를 둘로 분리(기존 경로 동작 불변):
  - `writeRecord(...)`: appendComposeRecord + markComposed, `{ recordId?, outcome, composedAt }` 반환.
  - `complete(..., send?, focus: boolean)`: focus가 true일 때만 `compose/focus`. ComposeResult 조립·status 결정. 기존 경로는 항상 focus true.
- autoSend 없으면 `send_mail` step을 skipped로 emit하고 기존과 동일하게 끝.
- autoSend 있으면 verify 뒤 가드(하나라도 실패 → `send={state:'skipped', reason}`, 클릭 안 함, focus):
  1. `plan.selector`(verified)에 `autoSend.button` 있음 → 아니면 `NOT_SUPPORTED`
  2. `job.attempt === 1` → 아니면 `RETRY_ATTEMPT`
  3. `job.auto` 없음 → 아니면 `AUTO_JOB`
  4. verify 후 fields 전부 `status==='ok'` → 아니면 `FIELDS_NOT_OK`
  5. 첨부 결과 수 == 대상 파일 수, 전부 `uploaded`, verify의 attachments에 `uploading===true` 없음, 길이 ≥ 파일 수 → 아니면 `ATTACH_NOT_OK`(첨부 0개면 통과)
  6. `sendFingerprint({to, cc, subject, attachments: 파일 name/size})` == `autoSend.fingerprint` → 아니면 `FINGERPRINT_MISMATCH`
  7. `deps.sentCount(noticeId)` == `expectSentCount` → 아니면 `SENT_COUNT_CHANGED`
  8. abort 아님
- 가드 통과 → `writeRecord` 먼저 → emit `send_mail running "보내기를 누르는 중"` → `compose/send-click`(T.sendClick=10_000, 재시도 금지)
  - `{clicked:false, reason}` → skipped(reason), focus
  - rpc 오류/타임아웃 → `unknown`, focus
  - `{clicked:true}` → emit "발송 완료를 확인하는 중" → `SEND_POLL_MS=500`마다 `compose/send-status`(T.sendStatus=5_000), 최대 `CONFIRM_WAIT_MS=15_000`
    - confirmed → 탭 살아 있으면 `compose/close-tab` → `send={state:'sent', confirmation, tabClosed}` → focus 안 함
    - !tabAlive && !confirmed → 한 번 더 send-status(onRemoved 처리 지연 대비) 후에도 미확인이면 `unknown`
    - 시간 초과 → `unconfirmed`, focus
- status: 기존 outcome 매핑 유지, 단 autoSend 요청인데 `send.state !== 'sent'`면 `partial`.
- 확인 대기 중 `compose/focus` 호출 금지.
- deps에 `sentCount: (noticeId: string) => Promise<number>` 추가(필수).

### `src/entrypoints/offscreen/main.ts`(170행 부근 compose deps): `sentCount: async (id) => (await sentStore.list(id)).filter((r) => !r.voidedAt).length`. `mail/sent-record` 리스너가 kind 'auto' 수용, `src/engine/mail/sent-store.ts` `recordAuto`(87행 부근) kind 확장.

### 테스트 `tests/engine/compose-job.test.ts`
가드 사유별 skipped(send-click 미호출 단언) / 클릭 성공→confirmed→close-tab 호출·focus 미호출 / 탭이 사라지고 confirmed(onRemoved 경로) → sent·close-tab 미호출 / 시간 초과→unconfirmed→focus / rpc 오류→unknown·재호출 없음 / autoSend 없는 잡은 기존 결과와 동일(회귀) / writeRecord가 send-click보다 먼저.

## 6. 대시보드 UI (S5, 메인 직접)
- `src/ui/compose/SendPreviewDialog.tsx`(새), `ComposeCard.tsx`(controller `startSend(token)`, 상태 분기), `src/ui/compose-view.ts`(send 상태 4종 문구), `MailPreparePage.tsx` 헤더 [바로 발송], `SentHistoryPage.tsx` 출처 문구(`signalKind==='auto'` → '자동 발송'), HistoryTab 배지.
- 비활성: provider≠naverworks / 셀렉터셋 unverified 또는 autoSend 없음 / 웹메일 권한 없음. 저장 안 된 편집은 기존 `beforeStart`로 먼저 저장.
- 상태 문구: sent "발송 완료 HH:mm" / unconfirmed "보내기를 눌렀지만 완료를 확인하지 못했습니다. 웹메일 탭을 확인하세요" + [작성 탭으로 이동] / skipped "자동 발송 조건 미충족: {사유}. 내용 확인 후 직접 보내세요" + 이동 / unknown "발송 여부를 알 수 없습니다. 웹메일 탭을 확인하세요" + 이동. unconfirmed·unknown에는 "실제로 안 갔으면 발송 이력에서 취소" 안내.

## 7. 문서 (S6)
`.claude/specs/decisions.md`: 전송 경로 예외 1개(send-trigger), 자동 작성 큐 연동 기각, autoDiscardable, 탭 제거=발송 확인. `.claude/specs/mail-sent.md` "관찰 전용"에 markSent 예외 주석.

## 금지
- dom-actions `isForbidden` 완화·bypass 인자 금지. adapters/naverworks-compose.ts에 `.click(` 금지.
- send-click에서 ledger 기록을 클릭 뒤로 옮기기 금지. 클릭 rpc 재시도 금지.
- 확인 대기 중 focus 금지. ledger 검증 없는 `tabs.remove` 금지.
- 셀렉터 추정 금지(위에 적힌 실측값만).

## 진행 순서
S1 → (S2+S3 한 implementer, S4 다른 implementer 병렬) → S5(메인) → S6 → code-reviewer → test-runner.
