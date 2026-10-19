# 수집 완료 후 메일 작성 자동 시작

## 목표
수집(collect) 잡이 끝나면 설정에 따라 SW가 자동으로 네이버웍스 메일 작성(compose) 잡을 시작하거나, 검수가 필요하면 대시보드 검수 화면을 연다. 요구사항 `.claude/specs/requirements.md` 53행 4번. 결정은 `.claude/specs/decisions.md` "2026-10-18, 수집 완료 후 메일 작성 자동 시작" 절.

## 확정된 사용자 결정
- 설정 토글 하나로 켜고 끈다. 끄면 자동 작성과 검수 자동 이동이 모두 꺼진다(기본 off).
- 자동 작성의 수신자(기본 그룹 / 특정 그룹 / 개별 수신자와 TO/CC)와 템플릿은 설정에서 지정한다.
- 검수 기준 3단계, 기본값 `conflicts`.
- 검수가 필요하면 대시보드 탭(있으면 재사용)을 검수 화면으로 이동시키고 앞으로 띄운다.
- 대시보드 메일 준비 화면에 [웹메일로 작성] 카드를 추가한다(사이드패널 ComposeCard 공통화).
- 이미 웹메일 작성 이력이 있는 공고는 재수집해도 자동 작성하지 않는다. 지정한 그룹/템플릿이 삭제됐으면 실패 처리한다.

## 공통 제약
- 사이트 CS(g2b, webmail)에 `job/start` compose를 열지 않는다(`src/background/job-coordinator.ts` 176행 부근 검사 유지). 자동 시작은 SW 내부 호출만.
- `JobRequest.auto`는 SW 내부 전용. `job/start` 리스너는 외부 메시지의 `auto`를 버린다.
- serial 체인 안에서 `startJob`/`setHandoff`를 직접 await하지 않는다. 종결 리스너는 `setTimeout(0)`으로 dispatch.
- `setHandoff`는 status/attempt/result/errors를 바꾸지 않는다.
- 큐 처리 경로에서 `permissions.request` 금지(`contains`만).
- 삭제된 그룹/템플릿을 기본값으로 대체하지 않는다. 설정에 이메일 문자열을 저장하지 않는다(id 참조만).
- 자동 compose를 collect 잡의 step으로 넣지 않는다. compose 재시도를 CS에 열지 않는다.
- `job/list-for-tab`, `job/latest-for-tab`은 compose 잡을 돌려주지 않는다. CS는 collect 잡의 `handoff.jobId`로만 compose를 찾는다.
- 수동 모드 결과를 "작성 완료"로 표현하지 않는다. storage.session에는 큐 항목 외 큰 데이터를 넣지 않는다.
- 가운뎃점 문자 금지(주석, 화면 문구 포함). 새 npm 패키지 금지. 기존 코드 관례를 따른다.
- 실제 함수 이름, 줄 번호가 명세와 다르면 같은 역할의 코드에 적용하고 보고한다. 명세 밖 구조 변경이 필요하면 멈추고 보고.

## 단계
| 단계 | 내용 | 의존 |
|---|---|---|
| S1 | 타입, 설정 기본값, 순수 판정 함수 | 없음 |
| S2 | 엔진(collect 결과, prepareMail, compose-job) | S1 |
| S3 | SW(종결 리스너, setHandoff, auto-compose 큐, dashboard-tabs, ui/open) | S1 |
| S4 | CS UI(handoff-view, 패널, 트래커봇 행 버튼, compose-view) | S1 |
| S5 | 대시보드(라우트, 검수 배너, 자동 작성 설정 카드, 메일 준비 [웹메일로 작성]) | S1 |
S2/S3 병렬, S4/S5 병렬. 각 단계는 해당 테스트까지 작성하고 통과시킨다.

---

## S1. 타입과 순수 함수

### `src/core/types/settings.ts`
```ts
export type AutoComposeRecipients =
  | { mode: 'default' }
  | { mode: 'group'; groupId: string }
  | { mode: 'custom'; members: Array<{ recipientId: string; role: 'to' | 'cc' }> };
export type ReviewGate = 'errors_only' | 'conflicts' | 'any_review';
export interface AutoComposeSettings {
  enabled: boolean;                  // 기본 false
  recipients: AutoComposeRecipients; // 기본 { mode: 'default' }
  templateId?: string;               // 없으면 기본 템플릿(isDefault, 없으면 첫 템플릿)
  reviewGate: ReviewGate;            // 기본 'conflicts'
}
// Settings에 autoCompose: AutoComposeSettings (필수)
```

### `src/core/model/default-settings.ts`
- `defaultSettings().autoCompose = { enabled: false, recipients: { mode: 'default' }, reviewGate: 'conflicts' }`.
- `withDefaults`: `autoCompose: { ...d.autoCompose, ...stored.autoCompose }`(extraction과 같은 방식).

### `src/core/types/job.ts`
```ts
export type HandoffReason = 'collect_failed' | 'attachments_failed' | 'extract_failed' | 'needs_review';
export type HandoffSkip = 'disabled' | 'already_composed' | 'compose_running' | 'needs_site_permission' | 'no_notice' | 'start_failed' | 'dequeued';
export type Handoff =
  | { action: 'compose'; state: 'queued' | 'started'; jobId?: string; at: ISODate }
  | { action: 'review'; reasons: HandoffReason[]; opened: boolean; at: ISODate }
  | { action: 'none'; reason: HandoffSkip; at: ISODate };
export type ComposeParams = { groupId?: string; templateId?: string; recipients?: Array<{ recipientId: string; role: 'to' | 'cc' }> };
```
- Job에 `handoff?: Handoff`(collect만), `auto?: { collectJobId: string }`(compose만). 기존 compose params 타입을 `ComposeParams`로 교체.
- CollectResult에 `mailStatus?: MailStatus`, `extraction?: { status; reviewCount: number; conflictCount: number }`(기존 extraction 필드가 있으면 conflictCount만 추가).

### `src/core/types/mail.ts`
- `MailDraft.groupId`를 선택으로, `recipientSource?: 'group' | 'custom'` 추가. schemaVersion 1 유지.

### `src/messaging/protocol.ts`
- `JobRequest.params?: ComposeParams`, `JobRequest.auto?: { collectJobId: string }`(주석: SW 내부 전용).
- `ui/open`의 page에 `'mail'` 추가.
- `| { type: 'auto-compose/dequeue'; payload: { collectJobId: string }; response: { removed: boolean } }`.
- `mail/prepare` payload에 `recipients?`.

### `src/core/model/handoff.ts` (신규, 순수)
```ts
export type Verdict = { kind: 'compose' } | { kind: 'review'; reasons: HandoffReason[] } | { kind: 'skip'; reason: HandoffSkip };
export function decideHandoff(job: Job, s: AutoComposeSettings): Verdict | null;
export function handoffReasonLabel(r: HandoffReason): string;
export function parseHandoffReasons(q: string | undefined): HandoffReason[]; // 쉼표 구분, 모르는 값 무시
```
판정 표(위에서부터 첫 매치):
| 조건 | 결과 |
|---|---|
| type이 collect가 아님, 또는 status가 queued/running/cancelling/cancelled/interrupted | null |
| `s.enabled === false` | skip disabled |
| failed, `result.noticeId` 없음 | skip no_notice |
| failed, noticeId 있음 | review [collect_failed] |
| partial | review: 첨부 failed/size_mismatch 있으면 attachments_failed, errors에 EXTRACT_FAILED 있으면 extract_failed(둘 다 가능), 둘 다 없으면 collect_failed |
| completed, mailStatus가 ready_for_review 또는 delivered | skip already_composed |
| completed, 추출 게이트에 걸림 | review [needs_review] |
| 그 외 completed | compose |

추출 게이트:
- extraction 없음, 또는 status가 not_run/unsupported면 통과.
- `errors_only`: 항상 통과. `conflicts`: `conflictCount > 0`이면 걸림. `any_review`: `reviewCount > 0`이면 걸림.

라벨: attachments_failed '첨부 실패', extract_failed '평가정보 추출 실패', needs_review '평가정보 확인 필요', collect_failed '수집 오류'.
decideHandoff는 compose_running, needs_site_permission, start_failed, dequeued를 내지 않는다.

### `src/engine/extraction/extract-step.ts`
- `export function conflictCountOf(x: Extraction): number`: status가 needs_review이고 reason이 conflict 또는 low_confidence이며 userEdited가 없는 항목 수. (reason 실제 값 이름은 `src/core/extraction/decide.ts`를 보고 맞춘다.)

### 테스트
- `tests/core/handoff.test.ts`: 판정 표 전 행, 게이트 3종, extraction 없음/not_run/unsupported 통과, mailStatus 2종 skip, compose 타입이면 null, parseHandoffReasons.
- `tests/core/default-settings.test.ts`(있으면 추가): autoCompose 기본값, withDefaults 병합.
- conflictCountOf 케이스(기존 extract-step 테스트 파일 또는 신규).

---

## S2. 엔진

### `src/engine/jobs/collect-job.ts`
- `resultOf`에 `mailStatus: n.mail.status`.
- 추출 결과 기록부에 `conflictCount: conflictCountOf(extraction)` 추가.

### `src/engine/mail/prepare.ts` `prepareMail`
- 인자에 `recipients?: Array<{ recipientId; role }>` 추가.
- 그룹 결정 우선순위: recipients(합성 그룹 `{ id: 'auto-custom', name: '자동 작성 수신자', memberIds, 역할 덮어쓰기, isDefault: false }`) → groupId → notice.mail.groupId → 기본 그룹. 합성 그룹의 역할 표현은 기존 그룹 타입 구조에 맞춘다.
- recipients가 빈 배열이면 NO_RECIPIENTS.
- 오류 코드: 지정 그룹 없음 `GROUP_NOT_FOUND`, 지정 템플릿 없음 `TEMPLATE_NOT_FOUND`(공고 없음은 기존 NOT_FOUND 유지).
- 해석에서 삭제/사용 안 함으로 빠진 수신자가 1명 이상이면 `draft.warnings`에 "삭제되거나 사용 안 함인 수신자 n명 제외". 전원 제외면 NO_RECIPIENTS.
- 합성 그룹이면 `draft.groupId` 생략, `recipientSource: 'custom'`, `notice.mail.groupId`는 기존 값 유지(templateId는 갱신).

### `src/engine/jobs/compose-job.ts`
- prepareMail 호출에 `recipients: params.recipients` 전달.

### `src/entrypoints/offscreen/main.ts`
- 타입 통과에 필요한 변경만.

### 테스트
- `tests/engine/mail-prepare.test.ts`: 합성 그룹 역할/중복 제거, draft.groupId 없음, notice.mail.groupId 불변, 일부 삭제 경고, 전원 삭제 NO_RECIPIENTS, GROUP_NOT_FOUND, TEMPLATE_NOT_FOUND.
- `tests/engine/collect-job.test.ts`: mailStatus, conflictCount.
- `tests/engine/compose-job.test.ts`: recipients 전달.

---

## S3. SW

### `src/background/job-coordinator.ts`
- `onFinish`가 확정한 Job을 반환(무시하면 undefined).
- `addFinalListener(fn: (job: Job) => void)`, `clearFinalListeners()`(테스트용). `emitFinal(job)`은 `setTimeout(0)` 안에서 리스너 호출, 예외 삼킴. 호출 지점: onFinish 저장 뒤, syncActive가 interrupted로 바꾼 잡마다, cancelJob 강제 종료 경로의 잡마다.
- `export function setHandoff(jobId: string, handoff: Handoff): Promise<void>`: serial 안에서 getJob, 없으면 무시, `putJob({ ...cur, handoff })`, `notifyUpdate(next)`.
- `newJob`: compose면 params(groupId, templateId, recipients)와 auto 복사.
- `job/start` 리스너: `const { auto: _ignored, ...safe } = req;` 후 startJob(safe).
- `latestJobForSender` 필터에 compose 제외. `listJobsForTab`은 이미 collect만이면 그대로.
- `assertRetryAllowed`, `assertCancelAllowed`, `getJobForSender`는 변경 없음.

### `src/background/dashboard-tabs.ts` (신규)
```ts
export function setDashboardTabDeps(d: Partial<{ tabs; windows; getURL }>): void;
export function openDashboard(hash: string, opts?: { nearTabId?: number }): Promise<number | undefined>;
```
- `tabs.query({ url: getURL('dashboard.html') + '*' })`에서 `#/grant` 탭 제외. nearTabId와 같은 창의 탭 우선.
- 있으면 `tabs.update(id, { url: base + hash, active: true })` + `windows.update(windowId, { focused: true })`. 없으면 nearTabId의 창(없으면 마지막 포커스 창)에 `tabs.create({ url, active: true })`.
- chrome 오류는 삼키고 undefined.

### `src/background/router.ts` `ui/open`
- grant는 그대로. review, mail, settings는 openDashboard 사용(nearTabId = sender.tab?.id). mail은 `#/mail/<encodeURIComponent(noticeId)>`. 기존 페이지 해시 형식을 따른다.

### `src/background/auto-compose.ts` (신규)
```ts
export const QUEUE_KEY = 'autoComposeQueue';
export interface QueueEntry { collectJobId: string; noticeId: string; ref?: NoticeRef; originTabId?: number; enqueuedAt: ISODate }
export function setAutoComposeDeps(d: Partial<AutoComposeDeps>): void; // storage(session/local), startJob, listJobs, getJob, setHandoff, permissions.contains, openDashboard, getComposeHost, getSettings, now
export function registerAutoCompose(): void;
export function onFinal(job: Job): Promise<void>;
export function pump(): Promise<void>;
export function dequeue(collectJobId: string): Promise<boolean>;
```
- 큐 읽기/쓰기와 pump는 모듈 내부 promise chain으로 직렬화.
- `registerAutoCompose`: addFinalListener(onFinal), `listen('auto-compose/dequeue')`, storage.onChanged(local settingsCache) 시 pump, 시작 시 pump 1회(SW 재시작 복구).
- `onFinal(job)`:
  - compose면 pump.
  - collect면: `job.handoff`가 있으면 무시(멱등). `decideHandoff(job, settings.autoCompose)`. null이면 종료.
  - skip이면 setHandoff(none, reason).
  - review면 `openDashboard('#/review/' + enc(noticeId) + '?handoff=' + reasons.join(','), { nearTabId: job.originTabId })` 후 setHandoff(review, reasons, opened: 결과가 undefined가 아니면 true).
  - compose면: `permissions.contains({ origins: ['https://' + host + '/*'] })` 거짓이면 none(needs_site_permission). 큐 또는 ledger의 ACTIVE compose에 같은 noticeId가 있으면 none(compose_running). 아니면 enqueue, setHandoff(compose queued), pump.
- `pump()`: 설정 재독. disabled면 큐를 비우고 각 항목 collect 잡에 none(disabled). 큐가 비면 종료. ledger에 ACTIVE compose가 있으면(수동 시작 포함) 종료. 선두를 꺼내 저장 후 `startJob({ type: 'compose', noticeId, ref, originTabId, params: paramsOf(settings.autoCompose), auto: { collectJobId } })`. JOB_ALREADY_RUNNING이면 none(compose_running), 그 외 throw면 none(start_failed), 성공이면 setHandoff(compose started, jobId). 결과와 무관하게 다음 항목은 다음 pump에서.
- `paramsOf`: group → `{ groupId }`, custom → `{ recipients: members }`, default → `{}`. templateId가 있으면 포함.
- `auto-compose/dequeue`: 확장 발신자는 허용. 사이트 발신자는 `getJobForSender(collectJobId, sender)`가 null이면 `{ removed: false }`. 제거하면 setHandoff(none dequeued).
- startJob이 originTabId를 받는 방식은 실제 시그니처에 맞춘다(SW 내부 호출 경로).

### `src/entrypoints/background.ts`
- registerCoordinator 뒤 `registerAutoCompose()`.

### 테스트
- `tests/background/job-coordinator.test.ts`: onFinish 반환, final 리스너가 serial 밖에서 호출되고 리스너 안 startJob이 멈추지 않음, setHandoff가 status/result 보존과 notifyUpdate, job/start가 외부 auto 제거, latest-for-tab이 compose 제외, newJob이 params/auto 복사.
- `tests/background/auto-compose.test.ts`: disabled, 게이트 통과 시 startJob 인자(params, auto, originTabId), partial이면 openDashboard 해시와 review handoff, needs_site_permission, already_composed, 큐 2건 직렬화, compose 종결로 다음 시작, 수동 compose ACTIVE면 대기, 세션 큐 재시작 복구, 설정 off로 큐 비움, dequeue 권한, 같은 noticeId 중복 거부, handoff 있는 잡 무시.
- `tests/background/dashboard-tabs.test.ts`: 재사용(같은 창 우선, grant 제외), 없으면 생성, 오류 삼킴.
- `tests/background/router.test.ts`: ui/open mail.

---

## S4. CS UI

### `src/ui/handoff-view.ts` (신규, 순수)
```ts
export type HandoffAction = 'open-mail' | 'open-review' | 'settings' | 'dequeue' | 'cancel-compose' | 'none';
export interface HandoffView { kind: 'queued' | 'composing' | 'composed' | 'manual' | 'compose_partial' | 'compose_failed' | 'review' | 'skipped'; text: string; tone: 'ok' | 'warn' | 'error' | 'info'; action: HandoffAction; actionLabel?: string; composeJobId?: string; noticeId?: string }
export function handoffView(collect: Job, compose: Job | null): HandoffView | null;
```
| 상태 | text | action |
|---|---|---|
| compose queued | 메일 작성 대기 중 | dequeue '대기 취소' |
| compose 진행 | composeView 라벨 | cancel-compose '취소' |
| compose completed | 메일 작성 완료, 웹메일 탭에서 확인 후 보내세요 | open-mail '열기' |
| compose 수동 모드/partial | 웹메일 탭을 열었습니다. 내용은 직접 붙여 넣어야 합니다 | open-mail '열기' |
| compose failed | composeView 오류 문구 | GROUP/TEMPLATE_NOT_FOUND, 권한 오류는 settings '설정 열기', 그 외 open-mail |
| review | 검수 필요: 사유 라벨들(첨부 실패 n건, 평가정보 확인 필요 n건 등) | open-review '검수' |
| none already_composed | 이미 메일을 작성한 공고입니다 | open-mail '열기' |
| none needs_site_permission | 웹메일 접근 권한이 필요합니다 | settings '설정 열기' |
| none compose_running | 다른 메일 작성이 끝나면 시작합니다 | none |
| none start_failed | 메일 작성을 시작하지 못했습니다 | open-mail '열기' |
| none dequeued | 자동 메일 작성을 취소했습니다 | none |
| none disabled, no_notice, handoff 없음 | null | |
compose 상태 판정은 `src/ui/compose-view.ts`의 composeView를 재사용한다.

### `src/ui/compose-view.ts`
- errorOf에 GROUP_NOT_FOUND/TEMPLATE_NOT_FOUND → "자동 작성 설정의 그룹이 삭제되었습니다" / "자동 작성 설정의 템플릿이 삭제되었습니다", action 'settings'(ComposeAction에 추가).
- 사이드패널 `ComposeCard.tsx`의 action 분기에 settings → 대시보드 설정 열기.

### `src/ui/g2b-panel/panel-view.ts`
- `PanelViewOpts.compose?: Job | null`. completed/partial/error 변형에 `handoff?: HandoffView`(foreign이면 생략).

### `src/ui/g2b-panel/controller.ts`
- 상태에 `compose: Job | null`. collect 잡 적용 뒤 `handoff.jobId`가 있으면 job/get으로 compose 조회. onProgress/onJobUpdate가 compose id도 처리(같은 순서 가드). 폴링에 compose ACTIVE 포함. 초기화에 compose 포함(ACTIVE면 유지).
- `handoffAction(a)`: open-mail → `ui/open` mail, open-review → `ui/open` review, settings → `ui/open` settings, dequeue → `auto-compose/dequeue` 후 collect 잡 재조회, cancel-compose → `job/cancel { jobId: composeJobId }`.

### `src/ui/g2b-panel/Panel.tsx`
- panelView에 compose 전달, 완료 카드 아래 handoff 한 줄 + 버튼. 자동 접힘은 handoff가 queued/composing이면 보류, compose 종결 뒤 적용.

### `src/ui/trackerbot/row-view.ts`, `row-button.ts`, `controller.ts`
- `RowEntry.compose: Job | null`. done/error 변형에 `action?: 'open-mail' | 'open-review' | 'settings'; actionLabel?`. busy 변형에 `cancelTarget: 'collect' | 'compose'`.
- 매핑: queued → done ok '수집 완료', 툴팁 대기 문구. composing → busy '메일 작성 중'(취소 가능, compose). composed → done ok '메일 작성됨' + [열기]. manual/partial → done warn '메일 확인' + [열기]. compose_failed → error '메일 작성 실패' + action. review → done warn '검수 필요' + [검수]. 그 외 skipped → 기존 표시 + 툴팁.
- row-button: done/error에 action이 있으면 보조 버튼 1개.
- controller: applyJob에서 compose 잡은 entry.compose에 적용(같은 순서 가드). collect 적용 뒤 handoff.jobId를 jobToKey에 등록하고 job/get. restore에서도 같은 보충 조회. cancel(key)는 compose ACTIVE면 compose 취소. onAction에 open-mail/open-review/settings. 폴링에 compose 포함.
- 셀이 좁으므로 라벨은 짧게, 상세는 title 툴팁.

### 테스트
- `tests/ui/handoff-view.test.ts`: 표 전 행.
- `tests/ui/panel-view.test.ts`, `tests/ui/trackerbot-row-view.test.ts`: handoff 케이스.
- `tests/ui/trackerbot-controller.test.ts`: handoff.jobId → job/get과 compose 반영, compose job/update, busy 중 취소가 compose id, action → ui/open mail.
- `tests/ui/compose-view.test.ts`: 두 코드.
- g2b controller 테스트가 있으면 compose 추적 케이스.
- `tests/adapters/forbidden-dispatch.test.ts` 통과 유지.

---

## S5. 대시보드

### `src/entrypoints/dashboard/App.tsx`
- parseRoute: review/mail 해시에서 `?` 뒤를 분리해 `query`로. ReviewPage에 `handoff={parseHandoffReasons(query.handoff)}`.

### `src/entrypoints/dashboard/ReviewPage.tsx`
- prop `handoff?: HandoffReason[]`. 비어 있지 않으면 상단 배너: "자동 메일 작성을 건너뛰었습니다. 사유: <라벨들>. 내용을 확인한 뒤 메일 작성 준비로 진행하세요" + [메일 작성 준비](`#/mail/<id>`).
- 실행 중 잡 판정 필터에서 compose 제외.

### `src/entrypoints/dashboard/AutoComposeCard.tsx` (신규) + `SettingsPage.tsx`
- NaverWorksCard 다음에 배치. 기존 카드 디자인 관례를 따른다.
- 토글: 켤 때 첫 await로 `chrome.permissions.request({ origins: ['https://<웹메일 호스트>/*'] })`, 거부되면 켜지 않음.
- 검수 기준 라디오 3종: "충돌/저신뢰 항목이 있을 때(권장)", "확인 필요 항목이 하나라도 있을 때", "오류일 때만".
- 수신자 라디오: 기본 수신 그룹 / 그룹 선택(select) / 개별 지정(체크 + TO/CC select, 사용 안 함 수신자는 흐리게). "TO n명, CC m명" 미리보기.
- 템플릿 select(비우면 기본 템플릿).
- 끊어진 id는 "삭제됨" 배지. 저장 시 끊어진 수신자 id는 제거, 그룹/템플릿 id가 끊어져 있으면 저장 차단과 안내.
- 저장은 `useSettings().save`. 수신자/그룹/템플릿 목록은 기존 대시보드 페이지가 쓰는 메시지로 읽는다.

### `src/entrypoints/dashboard/MailPreparePage.tsx` + ComposeCard 공통화
- `src/entrypoints/sidepanel/ComposeCard.tsx`를 `src/ui/compose/ComposeCard.tsx`로 옮기고 props를 `{ noticeId; ref?: NoticeRef; params?: { groupId?; templateId? }; jobs }` 형태로 일반화. 사이드패널은 새 위치를 import(`ref: collectJob.ref, params: {}`).
- 메일 준비 화면에 [웹메일로 작성] 카드 배치. 현재 화면에서 선택한 groupId/templateId를 params로 전달.
- CODE_MESSAGE에 GROUP_NOT_FOUND/TEMPLATE_NOT_FOUND 문구 추가.

### 테스트
- parseRoute 쿼리 분리(테스트 파일이 있으면).
- AutoComposeCard: 저장 시 끊어진 id 처리, 권한 거부 시 미활성(React 테스트 환경이 이미 있으면, 없으면 순수 로직을 함수로 빼서 테스트).

---

## 완료 조건
- 단계별 테스트 통과, 마지막에 전체 테스트, 타입체크, 빌드 1회 통과.
- 수동 확인(사용자): 토글 on과 권한, 그룹/템플릿 지정 → 수집 완료 시 웹메일 작성 탭이 열림 / 같은 공고 재수집 시 생략 / 행 3개 연타 시 하나씩 / 첨부 실패 공고는 검수 화면 이동과 배너 / 지정 그룹 삭제 후 수집 시 실패와 설정 열기 / 토글 off면 자동 동작 없음.

## 미확인 사항
- 네이버웍스 작성 화면 셀렉터셋은 unverified라 실측 전까지 수동 모드(탭 열기와 복사 안내)로 동작한다.
- `tabs.update` 해시 변경 시 리로드 여부(어느 쪽이든 parseRoute가 해시를 읽으므로 동작 동일).

## 보고 형식
결론, 변경 파일 경로, 테스트 결과, 명세와 다르게 한 점과 이유, 실패 항목. 한국어로 작성.

> 2026-10-19 갱신: 판정 마지막 행은 `(job.afterCollect ?? settings.afterCollect) === "dashboard"`면 `edit`(대시보드 `#/mail/<id>?from=collect` 열기, already_composed 무시), 아니면 `compose`. 상세는 `.claude/specs/mail-edit.md`.
