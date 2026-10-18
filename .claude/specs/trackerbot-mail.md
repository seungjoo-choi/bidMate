# 트래커봇 메일 [공고 수집] 버튼 (STEP 1-A)

## 목표
네이버웍스 웹메일(크롬) 읽기 화면에서 트래커봇 목록 메일의 입찰정보 행 "바로가기" 링크 옆에 [공고 수집] 버튼을 넣는다. 클릭하면 기존 collect 잡을 시작하고, 버튼이 진행/완료/실패/기수집 상태를 보여 준다.

배경: `.claude/specs/requirements.md` 19행, 결정은 `.claude/specs/decisions.md` "2026-10-18, 트래커봇 메일" 절.

## 확정 사실
- 트래커봇 메일은 표 3개(발주계획, 사전규격, 입찰정보), 각 행 끝 `<a href>바로가기</a>`. href는 나라장터 직접 URL이고 네이버웍스는 링크를 바꾸지 않으며 본문은 iframe 없이 같은 DOM에 있다.
  - 입찰정보: `https://www.g2b.go.kr/link/PNPE027_01/single/?bidPbancNo=R26BK01722175&bidPbancOrd=000`
  - 사전규격: `https://www.g2b.go.kr/link/PRVA004_02/single/?bfSpecRegNo=R26BD00273952`
  - 발주계획: `https://www.g2b.go.kr/link/PRPA015_01/single/?oderPlanNo=R26DD20869346`
- 버튼 대상은 입찰정보(`bid`)만. 사전규격/발주계획은 파서가 인식만 하고 버튼을 만들지 않는다.
- 같은 공고가 여러 행(취소공고/일반공고)일 수 있다. 사업명 셀에 줄바꿈이 섞일 수 있다.
- 웹메일 호스트는 설정값 `sites.naverworks.host`(기본 `mail.worksmobile.com`). 메일 읽기 화면 URL 경로는 모른다(SPA 가정).

## 공통 제약
- 웹메일 원본 DOM은 추가만 한다. 기존 노드의 속성/텍스트/스타일 변경, 제거, 이동 금지. 기존 요소에 `.click()`/`dispatchEvent` 금지(`tests/adapters/forbidden-dispatch.test.ts`가 잡는다).
- contenteditable 안(작성/전달/답장 편집기)에는 절대 버튼을 넣지 않는다.
- ref.detailUrl에는 메일 원문 href가 아니라 파서가 재조립한 정규화 URL만 넣는다.
- `job/start`에 html을 동봉하지 않는다.
- 상태를 DOM 데이터 속성이나 sessionStorage에 두지 않는다. 복원은 `job/list-for-tab`.
- 스크립트 등록 matches는 설정 호스트 하나만(`https://*/*` 금지).
- `webmail` 발신자에게 extract/compose 시작이나 EXTENSION_ONLY_TYPES를 열지 않는다.
- MutationObserver는 childList+subtree만(attributes 금지). 스캔은 멱등.
- JOB_ALREADY_RUNNING은 실패로 그리지 않는다. 탭이 숨겨져 있으면 폴링하지 않는다.
- `sites.trackerbot.urlPatterns`는 쓰지 않는다. NoticeRef 스키마는 바꾸지 않는다.
- 가운뎃점 문자 금지(주석, 화면 문구 포함). 기존 코드 관례(이름, 주석 밀도)를 따른다.
- 새 npm 패키지 금지.

## 단계와 담당
| 단계 | 작업 | 의존 |
|---|---|---|
| 1 | A, B (링크 파서) | 없음 |
| 2 | C, D, E (스캔, 뷰, 버튼) | 1 |
| 3 | H, I, J, K, L, M (백그라운드, 메시지, offscreen) | 없음(1, 2와 병렬 가능) |
| 4 | F, G, N, O (컨트롤러, 진입점, 카드 문구, 금지 테스트 glob) | 1, 2, 3 |

각 단계는 해당 테스트까지 작성하고 통과시킨다(DOM 테스트는 파일 상단 `// @vitest-environment jsdom`).

---

## 단계 1

### A. 새 파일 `src/adapters/g2b/link.ts`
```ts
export type G2bLinkKind = 'bid' | 'prespec' | 'orderplan';
export interface G2bLink { kind: G2bLinkKind; id: string; round?: string; url: string } // url = 정규화 URL
export const G2B_ORIGIN = 'https://www.g2b.go.kr';
export const COLLECTIBLE_KINDS: ReadonlySet<G2bLinkKind>; // 현재 {'bid'}
export function parseG2bLink(href: string): G2bLink | null;
export function linkToNoticeRef(link: G2bLink, origin: NoticeRef['origin']): NoticeRef | null; // bid만, 그 외 null
```
- `new URL(href)` 실패 또는 `origin !== G2B_ORIGIN`이면 null(http도 null).
- 파라미터 표를 순서대로 검사해 첫 매치: `{kind:'bid', id:'bidPbancNo', round:'bidPbancOrd'}`, `{kind:'prespec', id:'bfSpecRegNo'}`, `{kind:'orderplan', id:'oderPlanNo'}`.
- id가 `^R\d{2}[A-Z]{2}\d{8}$` 아니면 null. round는 숫자면 3자리 0 패딩(`0` -> `000`), 그 외/없음은 undefined.
- pathname이 `^/[A-Za-z0-9_./-]*$` 아니면 null.
- 정규화 URL = origin + pathname + id/round 파라미터만(다른 쿼리, 해시 제거).
- `linkToNoticeRef`: bid면 `{ noticeNo: id, round, detailUrl: url, origin }`(round 없으면 키 생략), 그 외 null.
- `NoticeRef['origin']`에 `'trackerbot'`이 없으면 단계 1에서 멈추고 보고(스키마 변경 금지).

### B. 수정 `src/adapters/g2b/openapi.ts` resolveRef(241~254행 부근)
- URL 분기를 `parseG2bLink`에 위임: `kind === 'bid'`이면 `{ noticeNo: l.id, ...(l.round ? { round: l.round } : {}), detailUrl: t, origin: 'g2b' }`. 번호 문자열 분기는 그대로.
- 행동 변화: g2b 외 호스트 URL은 null(의도된 강화).

### 테스트
- `tests/g2b/link.test.ts`: 세 형식 각각 kind/id/round/정규화 URL, 다른 호스트의 bidPbancNo -> null, http -> null, id 형식 오류 -> null, 차수 `0` -> `000`, 차수 없음 -> undefined, 추가 쿼리/해시 제거, `linkToNoticeRef`는 bid만 반환.
- `tests/g2b/openapi.test.ts`: 기존 케이스 유지 + 다른 호스트 URL은 null.

---

## 단계 2

### C. 새 파일 `src/adapters/trackerbot/mail-scan.ts` (읽기 전용)
```ts
export interface ScannedLink { anchor: HTMLAnchorElement; link: G2bLink; title?: string }
export const OWN_SELECTOR = '[data-bidmate]';
export const CELL_SELECTOR = 'td,th'; // 실측 결과에 따라 완화 가능하도록 상수
export const TITLE_HEADERS = ['사업명', '공고명', '건명'];
export function scanG2bLinks(root: ParentNode): ScannedLink[];
export function readRowTitle(anchor: HTMLAnchorElement): string | undefined;
export function normalizeCellText(s: string): string; // \s+ -> ' ', trim, 200자 제한
```
- `scanG2bLinks`: `root.querySelectorAll('a[href*="g2b.go.kr/link/"]')` 후 `parseG2bLink(a.href)`(프로퍼티 사용). 제외: 파싱 실패, kind가 COLLECTIBLE_KINDS에 없음, `a.isContentEditable`, `!a.closest(CELL_SELECTOR)`, `a.closest(OWN_SELECTOR)`, `!a.isConnected`. title은 `readRowTitle`.
- jsdom은 `isContentEditable`을 구현하지 않을 수 있다. 그 경우 `a.closest('[contenteditable]:not([contenteditable="false"])')`도 함께 검사한다.
- `readRowTitle`: `tr = anchor.closest('tr')`, `table = tr.closest('table')`. 헤더 행 = `table.tHead?.rows[0] ?? table.rows[0]`. 현재 행이 헤더 행이면 undefined. 헤더 셀 텍스트를 normalize해 TITLE_HEADERS 중 하나를 포함하는 첫 열 인덱스의 현재 행 셀 텍스트. 헤더 행과 현재 행 셀 수가 다르면 undefined.

### D. 새 파일 `src/ui/trackerbot/row-view.ts` (순수 함수)
```ts
export interface RowEntry { key: string; ref: NoticeRef; title?: string; lookup: NoticeLookup; job: Job | null; starting: boolean; error: string | null; otherTab: boolean }
export type RowView =
  | { kind: 'idle'; label: string; chip?: string; tone: 'primary' | 'secondary'; detail?: string }
  | { kind: 'busy'; label: string; canCancel: boolean; cancelling: boolean }
  | { kind: 'done'; label: string; tone: 'ok' | 'warn'; detail?: string; canRetry: boolean }
  | { kind: 'error'; label: string; detail?: string; action: 'retry' | 'grant' | 'settings' | 'none'; actionLabel?: string }
  | { kind: 'disabled'; label: string; reason: string };
export function rowView(entry: RowEntry, opts: { orphaned: boolean }): RowView;
```
- 내부에서 `src/ui/g2b-panel/panel-view.ts`의 `panelView(entry.job, entry.lookup, { title: entry.title })`를 호출해 매핑한다. 실제 panelView 시그니처가 다르면 그에 맞추고 보고.
- 매핑: orphaned -> disabled "새로고침 필요". starting -> busy "시작 중". 진행 중 -> busy, 라벨은 attach 진행이 있으면 `첨부 n/m`, 없으면 panelView label 첫 20자. completed -> done ok "수집 완료 첨부 n/m". partial -> done warn, canRetry true. error -> error, action은 panelView action 그대로. 잡 없음 + lookup found -> idle secondary "다시 수집" + 칩. 잡 없음 + 미수집 -> idle primary "공고 수집". otherTab -> idle에 detail "다른 탭에서 수집 중".
- panel-view.ts 내부 함수 `collectedChip`을 `export`로 바꾼다(그 한 줄만).

### E. 새 파일 `src/ui/trackerbot/row-button.ts` (바닐라 DOM)
```ts
export interface RowButtonHandle { host: HTMLElement; render(view: RowView): void; dispose(): void }
export function createRowButton(anchor: HTMLAnchorElement, on: { collect(): void; cancel(): void; action(a: 'retry' | 'grant' | 'settings'): void }): RowButtonHandle;
```
- `<span data-bidmate="collect">`를 `anchor.insertAdjacentElement('afterend', host)`. `attachShadow({ mode: 'open' })` 안에 `<style>`(이 파일 상수 문자열, px 단위, 글꼴 고정)과 `<button type="button">`, busy이고 canCancel이면 "취소" 버튼 추가.
- 이벤트는 addEventListener만. 우리 요소의 click/pointerdown/mousedown에서 `stopPropagation`(preventDefault 금지).
- detail/reason은 `title` 속성. 색: primary `#2563eb`, ok `#16a34a`, warn `#f59e0b`, danger `#dc2626`, secondary는 회색 테두리.
- dispose는 host 제거.

### 테스트
- `tests/adapters/trackerbot-scan.test.ts`: 3개 표 픽스처(발주계획/사전규격/입찰정보, 위 확정 사실의 URL 형식)에서 입찰정보 앵커만 반환, 같은 공고 2행은 2건(키 동일), 줄바꿈 섞인 사업명 정규화, contenteditable 안 복사본 제외, 표 밖 링크 제외, `[data-bidmate]` 내부 제외, 헤더/행 셀 수 불일치 시 title undefined.
- `tests/ui/trackerbot-row-view.test.ts`: 미수집 idle, lookup found -> "다시 수집"+칩, starting, 진행(첨부 n/m), completed, partial(canRetry), error 3종 action, orphaned -> disabled, otherTab.
- `tests/ui/trackerbot-row-button.test.ts`: afterend 삽입, 앵커 속성/텍스트 불변, render 전환, 클릭 콜백 호출과 전파 차단, dispose.

---

## 단계 3

### J. 수정 `src/messaging/protocol.ts`
```ts
| { type: 'job/list-for-tab'; payload: void; response: Job[] }  // CS→SW: 이 탭이 시작한 collect 잡
| { type: 'notice/lookup-batch'; payload: { refs: Array<{ noticeNo: string; round?: string }> }; response: NoticeLookup[] }  // CS→SW→offscreen, 입력 순서 보존
```
기존 union 표기 관례에 맞춘다.

### I. 수정 `src/background/job-coordinator.ts`
- `export type SenderKind = 'extension' | 'g2b' | 'webmail' | 'unknown'`, `export const isSiteKind = (k: SenderKind) => k === 'g2b' || k === 'webmail'`.
- `senderKind(sender, runtimeId?, webmailHost?)`: 기존 판정 뒤, `sender.tab`이 있고 URL이 https이며 hostname === webmailHost이면 'webmail'. 기존 호출부(`assertExtensionSender`, `isOffscreenSender` 등)는 host 없이 호출해 동작 불변.
- `async function resolveKind(sender)`: `(await getSettings()).sites.naverworks.host`(비면 기본값)를 넣어 senderKind 호출. 기존 kindOrThrow 계열을 대체.
- `assertRetryAllowed`, `getJobForSender`, `latestJobForSender`, `assertCancelAllowed` 등의 `=== 'g2b'`/`!== 'g2b'` 판정을 `isSiteKind`로 교체. `originTabIdFor(kind, sender)`로 시그니처 변경.
- `webmail`은 g2b와 같은 규칙: collect만 시작, 자기 탭 잡만 조회/취소/재시도. extract/compose 시작은 extension만(기존 그대로).
- 새 핸들러 `job/list-for-tab`: site 종류가 아니면 `[]`. `listJobs()`에서 `originTabId === sender.tab.id && type === 'collect'`만 updatedAt 내림차순.
- 실제 함수 이름이 위와 다르면 같은 역할의 함수에 적용하고 보고.

### K. 수정 `src/background/router.ts`
- `notice/lookup-batch` 중계: 기존 notice/lookup 중계와 같은 패턴. refs 200개 초과 시 앞 200개만. 실패 시 `refs.map(() => ({ found: false }))`.
- `fs/permission-granted` 팬아웃: 기존 g2b 탭에 더해 `https://${웹메일 호스트}/*` 탭에도 보낸다.

### L. 새 파일 `src/engine/notices/lookup.ts` + 수정 `src/entrypoints/offscreen/main.ts`
```ts
export function lookupInIndex(idx: IndexFile, ref: { noticeNo: string; round?: string }): NoticeLookup;
```
- offscreen main.ts 52~58행 부근 기존 notice/lookup 로직을 이 순수 함수로 옮기고, `notice/lookup`과 `notice/lookup-batch`(index 1회 로드 후 map, 순서 보존) 둘 다 사용.

### H. 수정 `src/background/site-registry.ts`
```ts
export const TRACKERBOT_SCRIPT_ID = 'bidmate-trackerbot-mail';
export const TRACKERBOT_SCRIPT_FILE = 'trackerbot-mail.js';
export async function syncTrackerbotScript(): Promise<'registered' | 'unregistered' | 'unchanged'>;
export function registerSiteRegistry(): void;
export function setSiteRegistryDeps(deps: Partial<{ scripting; permissions; tabs; getHost }>): void; // 테스트용, job-coordinator deps 패턴
```
- origin 패턴 `https://${host}/*`. `permissions.contains({ origins: [pattern] })`가 거짓이면 등록돼 있을 때 unregister -> 'unregistered'.
- 참이면 `getRegisteredContentScripts({ ids: [ID] })`: 없음 -> register `{ id, js: [FILE], matches: [pattern], runAt: 'document_idle', allFrames: false, persistAcrossSessions: true }`, matches 다름 -> update, 같음 -> 'unchanged'.
- 동시 호출은 promise chain으로 직렬화. chrome API 오류는 삼키고 'unchanged'.
- 새로 등록/갱신했으면 `tabs.query({ url: pattern })`의 각 탭에 `scripting.executeScript({ target: { tabId }, files: [FILE] })` 1회 시도(실패 무시).
- `registerSiteRegistry`: `runtime.onInstalled`, `storage.onChanged`(local, settingsCache 키), `permissions.onAdded`, `permissions.onRemoved` 모두 sync 호출.
- 기존 파일 내용을 유지하며 추가한다.

### M. 수정 `src/entrypoints/background.ts`
- main에 `registerSiteRegistry()` 호출 추가.

### 테스트
- `tests/background/job-coordinator.test.ts`: 설정 호스트와 같은 탭 발신은 collect 시작 허용 + originTabId 채움, 다른 호스트는 SENDER_FORBIDDEN, webmail은 extract/compose 금지, `job/list-for-tab`은 자기 탭 collect 잡만 정렬, 기존 g2b 케이스 불변.
- `tests/background/site-registry.test.ts`: 권한 없음 -> unregister, 권한 있고 미등록 -> register(matches 정확), 호스트 변경 -> update, 동일 -> unchanged, API 오류 삼킴, 동시 호출 직렬화, 등록 시 열린 탭 executeScript.
- `tests/engine/notice-lookup.test.ts`: `lookupInIndex` 차수 있음/없음(최신 collectedAt), 배치 순서 보존.
- 라우터 lookup-batch 테스트가 기존 라우터 테스트 패턴으로 가능하면 추가.

---

## 단계 4

### F. 새 파일 `src/ui/trackerbot/controller.ts`
```ts
export class TrackerbotController {
  constructor(doc: Document, deps?: { send?: typeof send; now?: () => number; isOrphaned?: () => boolean });
  start(): void; stop(): void;
  scan(): void;                                   // 멱등
  collect(key: string, retryOf?: string): Promise<void>;
  cancel(key: string): Promise<void>;
  onProgress(jobId: string): void; onJobUpdate(job: Job): void; onPermissionGranted(): void;
  getEntry(key: string): RowEntry | undefined;     // 테스트용
}
```
- 상수: DEBOUNCE 300, MAX_WAIT 1000, POLL 3000, MAX_POLL_FAILS 3, RESTORE_WINDOW 10분, LOOKUP_BATCH 200.
- 상태: `entries: Map<key, RowEntry>`, `buttons: Map<key, Set<RowButtonHandle>>`, `seen: WeakSet<HTMLAnchorElement>`, `jobToKey: Map<jobId, key>`. key = `src/core/model/ids.ts`의 `noticeId(noticeNo, round)`.
- start: `document.body` MutationObserver(childList, subtree), 디바운스 300ms/최대 1000ms로 scan. `visibilitychange`가 visible이면 scan + ACTIVE 잡 재조회. 첫 scan 즉시.
- scan: `scanG2bLinks(doc)` -> 엔트리 없으면 생성(lookup `{ found: false }`) -> seen에 없는 앵커(그리고 `nextElementSibling`이 `[data-bidmate="collect"]`가 아닌 경우)만 버튼 생성 -> `host.isConnected === false` 핸들 정리 -> 새 키를 모아 `notice/lookup-batch`(200개씩) -> 첫 scan에서만 `job/list-for-tab` 1회로 복원(ACTIVE는 항상, FINAL은 updatedAt이 10분 이내만) -> 바뀐 키만 렌더.
- collect: starting이거나 ACTIVE 잡이면 무시. `job/start { type: 'collect', ref: linkToNoticeRef(link, 'trackerbot'), retryOf? }`. 응답 처리는 `src/ui/g2b-panel/controller.ts`의 job/start 처리(219~235행 부근)와 동일 규칙: JOB_ALREADY_RUNNING이면 `job/get`으로 충돌 잡 조회, 이 탭 잡이면 붙이고, null이면 otherTab. 성공 시 jobToKey 등록 후 잡 조회.
- 진행 반영: `applyJob` 순서 가드는 g2b controller(184~198행 부근)와 동일(attempt 낮으면 버림, 같은 attempt면 updatedAt 비교, FINAL을 ACTIVE로 되돌리지 않음). FINAL 전이 시 그 키만 `notice/lookup` 재조회.
- 폴링: ACTIVE 잡이 하나라도 있고 탭이 보일 때만 타이머 1개로 ACTIVE 잡 전체를 `job/get`. 실패 3회 또는 고아(`!chrome.runtime?.id`)면 정지하고 모든 버튼 disabled.
- 버튼 action: retry -> `collect(key, job.id)`, grant -> `ui/open` grant, settings -> `ui/open` settings(기존 g2b 패널과 같은 메시지 사용). `onPermissionGranted`는 NEEDS_FS_PERMISSION 오류 잡을 자동 재시도(g2b와 동일).
- cancel: `job/cancel`. cancelling 이후 강제 중단은 제공하지 않는다.

### G. 새 파일 `src/entrypoints/trackerbot-mail.ts`
- `defineUnlistedScript`. `window.__bidMateTrackerbot` 중복 가드(naverworks-compose.ts와 같은 관례). 컨트롤러 생성, `listen('job/progress', ..., 'sw')`, `listen('job/update', ..., 'content')`, `listen('fs/permission-granted', ..., 'content')`(g2b.content.ts와 같은 방식), `start()`.
- 빌드 후 `dist` 산출물 이름이 `trackerbot-mail.js`인지 확인하고 다르면 `TRACKERBOT_SCRIPT_FILE`을 맞춘다.

### N. 수정 `src/entrypoints/dashboard/NaverWorksCard.tsx`
- 권한 설명 문구를 "메일 작성 자동 입력과 트래커봇 메일의 [공고 수집] 버튼에 웹메일 호스트 접근 권한이 필요합니다."로 바꾼다. 그 외 변경 없음.

### O. 수정 `tests/adapters/forbidden-dispatch.test.ts`
- 검사 glob에 `src/adapters/trackerbot/**/*.ts`, `src/ui/trackerbot/**/*.ts`, `src/entrypoints/trackerbot-mail.ts` 추가(기존 경로 표기 관례대로).

### 테스트
- `tests/ui/trackerbot-controller.test.ts`(send 모킹, jsdom): 재스캔 멱등(앵커당 host 1개), 같은 키 두 버튼 상태 공유, 클릭 시 job/start payload(type collect, origin trackerbot, 정규화 detailUrl, html 없음), JOB_ALREADY_RUNNING 2경로, applyJob 순서 가드, FINAL 후 lookup 재조회, list-for-tab 복원(10분 창), 표 재렌더 후 새 앵커에 기존 상태 렌더, 고아 시 disabled.
- forbidden-dispatch 통과.

---

## 완료 조건
- 단계별 테스트 통과, 마지막에 전체 테스트/타입체크/빌드 1회 통과.
- 수동 확인(사용자): 설정에서 호스트 저장/권한 허용 후 트래커봇 메일에서 입찰정보 행에만 버튼, 같은 사업 2행 상태 공유, 클릭 후 진행/완료, 새로고침 후 "다시 수집"+칩, 전달 편집기 안 표에는 버튼 없음.

## 미확인 사항
- 네이버웍스가 메일 본문 표를 `td`로 유지하는지. 아니면 `CELL_SELECTOR` 완화.
- 본문이 shadow root 안에 그려지지 않는지.
- 사전규격/발주계획 수집 시 ref 표현은 이후 별도 설계.

## 보고 형식
결론, 변경 파일 경로, 테스트 결과, 명세와 다르게 한 점과 이유, 실패 항목. 한국어로 작성.
