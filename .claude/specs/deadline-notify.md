# 마감 일정판과 알림 (deadline-notify) 구현 명세

작성 2026-10-20. Fable 설계. 범위와 선택값은 `.claude/specs/prebid-features.md` 4절, 결정 근거는 `.claude/specs/decisions.md` "2026-10-20 입찰 전 기능 5종 방향". 이 문서만 보고 구현한다(대화 참조 없음).

## 목표
- 대시보드 홈에 일정판: 수집한 입찰공고의 참가등록 마감, 입찰 마감, 제안서 평가, 개찰을 D-day와 함께 한 표로 보여 준다.
- 메일 전달을 마친 입찰공고의 입찰 마감과 참가등록 마감에 대해 D-3, D-1, 당일 09:00(KST)에 OS 알림을 보낸다.
- 공고 상세 개요 탭에 알림 예정 시각을 보여 주고, 설정에서 마감 알림을 켜고 끈다.

## 확정 선택값 (바꾸지 않는다)
- 알림 대상 일정: 입찰 마감(`bidCloseAt`), 참가등록 마감(`registrationDeadline`). 제안서 평가, 개찰, 사전규격 의견마감은 일정판에만 표시하고 알림은 없다.
- 알림 대상 공고: `kind` bid이고 `mailStatus === 'delivered'`인 공고만. 같은 noticeNo는 round가 가장 큰 것만.
- 알림 시각: 마감일 KST 달력 기준 D-3, D-1, 당일 모두 09:00 KST. 주말도 보낸다.
- 놓친 알림: 알람이 늦게 울렸을 때 "같은 KST 날짜"의 것만 보내고 전날 이전 것은 버린다. 마감 시각이 이미 지난 알림도 버린다.
- 일정판 기간: 오늘부터 14일 안의 일정.

## 현재 코드 상태 (확인된 사실, 설계 근거)
- 알림 인프라: `src/background/result-scheduler.ts`에 `ResultSchedulerDeps`(alarms, notifications, storage, toOffscreen, openDashboard, getURL, now), `armFollowAlarm`, `notificationOf`, 비공개 `notify(events, settings, d)`(`d.notifications.create(id, { type:'basic', iconUrl: d.getURL('icon/128.png'), title, message })`, 실패 무시), `onNotificationClicked`(정규식으로 id 해석 → `openDashboard('#/notices/<encodeURIComponent(id)>/overview')` → `notifications.clear`). `registerResultScheduler`가 `chrome.alarms.onAlarm`, `chrome.notifications.onClicked`, `onStartup`, `onInstalled`, `storage.onChanged`를 최상위에서 동기 등록. 테스트 `tests/background/result-scheduler.test.ts`가 create 인자 객체 형태와 클릭 동작을 고정하고 있다.
- 권한: `wxt.config.ts:15` permissions에 `alarms`, `notifications` 있음.
- 설정: `src/core/types/settings.ts:45` `notify: { rank: boolean; final: boolean }`, `src/core/model/default-settings.ts:26,49` 기본값과 병합. `src/messaging/protocol.ts:45` `SettingsSection`에 `'notify'` 있음. 설정 화면 카드는 없음(`src/entrypoints/dashboard/SettingsPage.tsx:19-48` GROUPS에 notify 항목 없음). `useSettingsStatus`(`src/entrypoints/dashboard/useSettingsStatus.ts:63-84`)에 notify 없음. 설정 저장은 `useSettings().save(settings)`(`src/entrypoints/dashboard/CompanyCard.tsx:9,30` 패턴).
- KST 계산: `src/core/results/schedule.ts` `kstParts(ms)`(dow, hour, minute, dayStartMs), `KST_OFFSET_MS`. `nextKstSlot`은 평일만 고르므로 마감 알림에는 쓰지 않는다.
- 최대 round 선택: `src/core/results/plan.ts:25` `latestBids(index)`(bid만, noticeNo별 최대 round).
- index: `src/core/types/index-file.ts` IndexEntry에 `bidCloseAt?`만 있음(사전규격은 opinionCloseAt을 여기에 넣음, `src/engine/notices/notice-store.ts:28`). `entryOf`(15-42행)가 notice에서 파생, `loadIndex`(56-64행)는 없거나 손상이면 `rebuildIndex`(66-70행, `scan`)로 재생성. `saveNotice`(94-106행)가 entryOf로 갱신. 메일 전달 완료는 `src/engine/mail/sent-store.ts:176`이 `saveNotice`를 호출해 index의 mailStatus가 delivered로 갱신된다.
- offscreen: `src/entrypoints/offscreen/main.ts:201-221` result/run, follow/set, notice/list 리스너. `listNotices`(`src/engine/notices/notice-api.ts:20`)가 IndexEntry[] 반환.
- 홈: `src/entrypoints/dashboard/HomePage.tsx:80-90` "마감 예정" 카드(bidCloseAt만), `src/core/dashboard/stats.ts:36-38,61` dueSoon. 테스트 `tests/core/home-stats.test.ts`.
- 개요 탭: `src/entrypoints/dashboard/notice/OverviewTab.tsx:20-31` "일정" 카드(Timeline + 제안서 제출기간 줄). 뷰 함수 `src/ui/notice-detail/view.ts:311-343,348`. D-day 포맷 `src/ui/review/format.ts:31-45`.
- 알림 클릭 열기: `src/background/dashboard-tabs.ts:22` `openDashboard(hash)`.
- 잡 종결 리스너: `src/background/job-coordinator.ts:53` `addFinalListener(fn)`, 사용 예 `src/background/auto-compose.ts:201`.
- 발신자 검사: `assertExtensionSender`(`job-coordinator.ts:244`), offscreen 발신 검사 `isOffscreenAllowedSender`(`src/messaging/bus.ts:70`), result-scheduler.ts:159 `assertOffscreenSender`.

## 불변 원칙
- SW는 파일을 읽지 않는다. 알림 계획은 offscreen이 index에서 계산해 SW가 `chrome.storage.local`에 캐시한다. 알람이 울리면 캐시만으로 발송한다(폴더 권한이 prompt여도 발송된다).
- 알림 발송과 클릭 처리는 SW. 알림 id 접두어로 기능을 구분한다(`result:` / `deadline:`).
- 계획 계산, 발송 대상 판정, 문구는 core 순수 함수. 시간은 항상 ms 인자로 받는다.
- `src/core/results/*`, `src/engine/results/*`, `result/*` 프로토콜은 수정하지 않는다. result-scheduler.ts는 공통 모듈을 쓰도록 바꾸되 동작과 테스트는 그대로.
- 새 메시지, 새 설정, 새 index 필드는 모두 추가만. 스키마 버전 변경 없음(IndexFile은 indexVersion 추가).
- 발송 실패, offscreen 실패, 권한 없음은 조용히 넘기고 throw하지 않는다.
- 가운뎃점(·) 금지(코드 주석, 화면 문구, 테스트 이름 모두).

## 데이터 모델

### IndexEntry 추가 (`src/core/types/index-file.ts`)
```ts
export interface IndexEntry {
  // ...기존 유지...
  /** 입찰공고 일정(notice 파생, 재생성 안전). 사전규격은 없음. 값이 없는 키는 생략 */
  schedule?: { registrationDeadline?: ISODate; proposalEvalAt?: ISODate; openingAt?: ISODate };
}
export const INDEX_VERSION = 2 as const;
export interface IndexFile { schemaVersion: 1; indexVersion?: typeof INDEX_VERSION; generatedAt: ISODate; notices: IndexEntry[] }
```
- `entryOf`: bid 공고(`kindOf(n.ref) === 'bid'`)에서 `n.schedule.registrationDeadline.value`, `proposalEvalAt.value`, `openingAt.value` 중 문자열인 것만 `schedule`에 넣는다. 셋 다 없으면 `schedule` 키 자체를 넣지 않는다. 사전규격은 넣지 않는다. `bidCloseAt`은 그대로.
- `loadIndex`: 읽은 index가 유효해도 `idx.indexVersion !== INDEX_VERSION`이면 `rebuildIndex()`로 1회 재생성한다(옛 항목 schedule 채움). `scan()`과 `rebuildIndex()`가 만드는 IndexFile에 `indexVersion: INDEX_VERSION`을 넣는다. `saveNotice`의 index 쓰기에서도 `idx.indexVersion = INDEX_VERSION`을 넣는다. `loadIndexRaw`(락 안)는 재생성하지 않는다(현행 유지, 다음 loadIndex가 처리).
- 구현 시 확인: `scan()`이 `entryOf`를 쓰는지(쓰지 않으면 같은 파생 규칙으로 맞춘다).

### 설정 (`src/core/types/settings.ts`, `default-settings.ts`)
```ts
notify: { rank: boolean; final: boolean; deadline: boolean };   // deadline 기본 true
```
withDefaults의 `notify: { ...d.notify, ...stored.notify }`로 옛 저장본은 자동 보정된다(추가 코드 없음).

### 알림 계획 (`src/core/types/deadline.ts` 신설)
```ts
export type DeadlineKind = 'bidClose' | 'registration';
export const DEADLINE_OFFSETS = [3, 1, 0] as const;          // D-3, D-1, 당일
export type DeadlineOffset = (typeof DEADLINE_OFFSETS)[number];
export const DEADLINE_HOUR_KST = 9;

/** 한 공고의 알림 대상 일정 하나 */
export interface DeadlineItem { noticeId: string; title: string; kind: DeadlineKind; at: ISODate }
/** 알림 1건 */
export interface DeadlineNotice extends DeadlineItem { offset: DeadlineOffset; fireAt: number /* UTC ms */; key: string /* deadline:<noticeId>:<kind>:<offset> */ }
export interface DeadlinePlan { builtAt: ISODate; items: DeadlineNotice[] }   // fireAt 오름차순
/** storage.local 키 */
export const DEADLINE_PLAN_KEY = 'deadlinePlan';
export const DEADLINE_SENT_KEY = 'deadlineSent';       // Record<key, ISODate 발송 시각>
export interface DeadlineRefreshSummary { ran: boolean; planned: number; nextAlarmAt: ISODate | null; skipped?: 'NO_FS' | 'BUSY'; error?: string }
```

### 프로토콜 (`src/messaging/protocol.ts`)
```ts
| { type: 'deadline/plan'; payload: void; response: DeadlinePlan }                        // SW→offscreen 전용. index에서 계획 계산
| { type: 'deadline/refresh'; payload: { reason: 'list' | 'manual' }; response: DeadlineRefreshSummary }   // 확장 페이지→SW. throw하지 않는다
```
`router.ts`의 EXTENSION_ONLY_TYPES에는 넣지 않는다(deadline 스케줄러가 직접 listen하고 `assertExtensionSender`로 검사).

## 공통 모듈 `src/background/notify.ts` (신설, result-scheduler와 공유)
```ts
export interface NotifyDeps {
  notifications: Pick<typeof chrome.notifications, 'create' | 'clear'>;
  openDashboard: (hash: string) => Promise<unknown>;
  getURL: (path: string) => string;
}
export interface NotificationSpec { id: string; title: string; message: string }
export const NOTIFY_TITLE_MAX = 60;
/** 60자 넘으면 60자 + "…" */
export function clipTitle(s: string): string;
/** type basic, iconUrl = getURL('icon/128.png'). 실패는 삼킨다 */
export async function showNotification(spec: NotificationSpec, d: NotifyDeps): Promise<void>;
/** 공고 상세 overview를 열고 알림을 지운다. 둘 다 실패를 삼킨다 */
export async function openNoticeFromNotification(noticeId: string, notificationId: string, d: NotifyDeps): Promise<void>;
```
- `showNotification`은 정확히 `d.notifications.create(spec.id, { type: 'basic', iconUrl: d.getURL('icon/128.png'), title: spec.title, message: spec.message })`를 호출한다(result-scheduler 테스트 114행이 이 형태를 검사).
- `openNoticeFromNotification`은 `d.openDashboard('#/notices/' + encodeURIComponent(noticeId) + '/overview')` 뒤 `d.notifications.clear(notificationId)`.
- result-scheduler.ts 변경: `clip`과 `TITLE_MAX`를 `clipTitle`/`NOTIFY_TITLE_MAX`로 교체, `notify()` 안의 create 호출을 `showNotification(n, d)`로, `onNotificationClicked`의 본문을 `openNoticeFromNotification(m[1], id, d)`로 교체. `ResultSchedulerDeps`는 그대로(구조적으로 NotifyDeps를 만족). 리스너 등록 위치와 정규식은 그대로. `tests/background/result-scheduler.test.ts` 무변경 통과.
- 각 스케줄러는 자기 `chrome.notifications.onClicked` 리스너를 따로 등록하고 자기 접두어만 처리한다(리스너 두 개 허용). 공통 라우터 등록은 만들지 않는다(테스트가 chrome 스텁을 테스트마다 바꿔 끼우므로 모듈 전역 "한 번만 등록" 플래그가 깨진다).

## 코어 순수 함수 `src/core/deadline/plan.ts` (신설)
```ts
import type { IndexEntry } from '../types/index-file';
import type { DeadlineItem, DeadlineNotice, DeadlinePlan, DeadlineOffset } from '../types/deadline';

/** 알림 대상 일정. bid만, noticeNo별 최대 round(latestBids), supersededBy 없음, mailStatus === 'delivered'.
 *  bidCloseAt → kind 'bidClose', schedule.registrationDeadline → 'registration'. 해석 불가 날짜는 제외 */
export function deadlineItemsOf(entries: IndexEntry[]): DeadlineItem[];

/** 마감일 KST 달력 날짜의 (offset)일 전 09:00 KST(UTC ms). kstParts(dayStartMs) 기준 */
export function fireTimeOf(atIso: string, offset: DeadlineOffset, hour?: number): number;

/** 계획. 규칙: 각 item × offset에 대해 fireAt을 구하고, (a) 마감 at > now 이고 (b) fireAt > now 이거나 fireAt이 now와 같은 KST 날짜인 것만 남긴다. fireAt 오름차순, 같으면 at 오름차순, noticeId 순 */
export function buildPlan(entries: IndexEntry[], nowMs: number): DeadlinePlan;

/** 지금 보낼 것과 다음 알람 시각. due = fireAt <= now 이고 fireAt이 now와 같은 KST 날짜이고 at > now 이고 sent에 key 없음.
 *  nextAlarmAt = min(plan 중 fireAt > now 의 최솟값, nextKstHour(now, 9)). plan이 비어도 nextKstHour는 반환 */
export function duePlan(plan: DeadlinePlan, sent: Record<string, string>, nowMs: number): { due: DeadlineNotice[]; nextAlarmAt: number };

/** now보다 큰 다음 KST hour:00(주말 포함). */
export function nextKstHour(nowMs: number, hour: number): number;

/** 마감이 지난 key 제거. 남길 기준: plan.items에 key가 있거나 보낸 지 7일 이내 */
export function pruneSent(sent: Record<string, string>, plan: DeadlinePlan, nowMs: number): Record<string, string>;

/** 알림 문구. 제목: offset 3 → "입찰 마감 D-3" / 1 → "입찰 마감 D-1" / 0 → "오늘 입찰 마감". registration은 "참가등록 마감 D-3" 등, 당일 "오늘 참가등록 마감".
 *  본문: `${clipTitle(title)} ${MM/DD HH:mm KST} 마감` (예 "〈공고명〉 10/22 14:00 마감"). 날짜는 kstParts로 계산(로컬 시간대 사용 금지) */
export function deadlineNotificationOf(n: DeadlineNotice): { id: string; title: string; message: string };   // id = n.key
```
- `kstParts`, `KST_OFFSET_MS`는 `src/core/results/schedule.ts`에서 import한다(복사 금지).
- 날짜 문자열 해석은 `Date.parse`, NaN이면 제외.
- `deadlineItemsOf`는 `latestBids`(`src/core/results/plan.ts:25`)를 import해 쓴다.

### 일정판 뷰 모델 `src/core/dashboard/schedule-board.ts` (신설)
```ts
export type BoardColumn = 'registrationDeadline' | 'bidCloseAt' | 'proposalEvalAt' | 'openingAt';
export const BOARD_COLUMNS: Array<{ key: BoardColumn; label: string }> = [
  { key: 'registrationDeadline', label: '참가등록 마감' }, { key: 'bidCloseAt', label: '입찰 마감' },
  { key: 'proposalEvalAt', label: '제안서 평가' }, { key: 'openingAt', label: '개찰' },
];
export interface BoardRow { entry: IndexEntry; cells: Record<BoardColumn, ISODate | null>; nextAt: ISODate; nextColumn: BoardColumn; notifyTarget: boolean }
export const BOARD_DAYS = 14;
/** bid만, latestBids, supersededBy 제외. 네 열 중 now 이후이면서 now+14일 이내인 값이 하나라도 있는 공고. nextAt = 그중 가장 이른 값. nextAt 오름차순.
 *  notifyTarget = mailStatus === 'delivered' */
export function scheduleBoard(entries: IndexEntry[], now: Date): BoardRow[];
```
`computeHomeStats`와 `dueSoon`은 건드리지 않는다(StatCard "입찰마감 예정 7일" 유지).

### 개요 탭 뷰 `src/ui/notice-detail/view.ts` 추가
```ts
export interface DeadlineNoticeLine { label: string /* "입찰 마감" | "참가등록 마감" */; times: string[] /* ["D-3 10/19 09:00", "D-1 10/21 09:00", "당일 10/22 09:00"], 지난 것은 제외 */ }
export type DeadlineNoticeView =
  | { state: 'off' }                                   // settings.notify.deadline false
  | { state: 'not_target'; reason: string }            // 사전규격 / 메일 전달 전 / 정정공고로 대체됨 / 일정 없음
  | { state: 'target'; lines: DeadlineNoticeLine[] };
export function deadlineNoticeView(n: Notice, index: IndexEntry[], settings: Pick<Settings, 'notify'>, now?: Date): DeadlineNoticeView;
```
판정: prespec → not_target "사전규격은 마감 알림 대상이 아닙니다". `n.mail.status !== 'delivered'` → not_target "메일 전달을 마친 공고만 알림을 보냅니다". index에 같은 noticeNo의 더 큰 round가 있으면 → not_target "더 새로운 차수의 공고가 대상입니다". bidCloseAt, registrationDeadline 둘 다 없으면 → not_target "공고정보에 마감 일정이 없습니다". 그 외 target. 시각은 `fireTimeOf`로 계산하고 now 이전은 뺀다. 라인의 times가 모두 비면 그 라인 제외, 라인이 0개면 target이되 lines [](화면은 "예정된 알림이 없습니다").

## SW 스케줄러 `src/background/deadline-scheduler.ts` (신설)
```ts
export const DEADLINE_ALARM = 'deadline-check';
export interface DeadlineSchedulerDeps {
  alarms: Pick<typeof chrome.alarms, 'create' | 'clear' | 'get'>;
  notifications: Pick<typeof chrome.notifications, 'create' | 'clear'>;
  storage: { local: Pick<chrome.storage.LocalStorageArea, 'get' | 'set'>; session: Pick<chrome.storage.SessionStorageArea, 'get' | 'set'> };
  toOffscreen: <T extends MsgType>(type: T, payload: PayloadOf<T>, timeoutMs: number) => Promise<ResponseOf<T>>;
  openDashboard: (hash: string) => Promise<unknown>;
  getURL: (path: string) => string;
  now: () => number;
}
export function registerDeadlineScheduler(d?: Partial<DeadlineSchedulerDeps>): void;
/** 캐시된 계획으로 due 알림 발송 + 발송 기록 + 알람 재예약. 파일 접근 없음. throw하지 않음 */
export async function dispatchDue(d?: DeadlineSchedulerDeps): Promise<{ sent: number; nextAlarmAt: number }>;
/** offscreen에 deadline/plan 요청 → 캐시 저장 → dispatchDue. reason 'list'는 session 'deadlineRefreshAt' 10분 스로틀. throw하지 않음 */
export async function refreshDeadlines(reason: 'alarm' | 'list' | 'manual' | 'startup' | 'job', d?: DeadlineSchedulerDeps): Promise<DeadlineRefreshSummary>;
export async function armDeadlineAlarm(atMs: number, d?: DeadlineSchedulerDeps): Promise<void>;
```
동작:
- `armDeadlineAlarm`: `max(atMs, now + 5초)`로 `clear` 후 `create(DEADLINE_ALARM, { when })`. 병합 규칙 없이 항상 덮어쓴다(계획이 바뀌면 다음 시각도 바뀌므로).
- `dispatchDue`: local에서 `deadlinePlan`, `deadlineSent`, `settingsCache` 읽기 → `duePlan` → `settings.notify.deadline`이 true일 때만 `showNotification(deadlineNotificationOf(n), d)` → 보낸 key를 `deadlineSent[key] = now ISO`로 기록(꺼져 있어 안 보낸 것도 기록한다, 나중에 켜도 재발송 안 함) → `pruneSent` → local 저장 → `armDeadlineAlarm(nextAlarmAt)`. 계획이 없으면 발송 0, 알람은 `nextKstHour(now, 9)`. 모듈 변수 Promise로 직렬화한다(진행 중이면 그 Promise를 기다려 결과를 반환하고 다시 실행하지 않는다).
- `refreshDeadlines`: list 스로틀 검사 → `toOffscreen('deadline/plan', undefined, 30_000)` → 응답을 `deadlinePlan`에 저장 → `dispatchDue` → summary. offscreen 오류 코드 `NEEDS_FS_PERMISSION`이면 `skipped: 'NO_FS'`, 그 외 오류는 `error`(문자열) 기록. 어느 경우든 `dispatchDue`는 캐시로 실행한다(계획 갱신 실패와 무관하게 알람이 이어지게).
- 리스너(최상위 동기 등록): `listen('deadline/refresh', (p, sender) => { assertExtensionSender(sender); return refreshDeadlines(p.reason === 'manual' ? 'manual' : 'list'); }, 'sw')`, `chrome.alarms.onAlarm`(name === DEADLINE_ALARM → `refreshDeadlines('alarm')`), `chrome.notifications.onClicked`(id가 `/^deadline:(.+):(bidClose|registration):(3|1|0)$/`에 맞을 때만 `openNoticeFromNotification(m[1], id, d)`), `chrome.runtime.onStartup`/`onInstalled` → `refreshDeadlines('startup')`, `addFinalListener(job => job.type === 'collect' && job.status === 'completed' → refreshDeadlines('job'))`(Job의 status 필드명은 `src/core/types/job.ts`에서 확인), `chrome.storage.onChanged`: `settingsCache.notify.deadline`이 false→true로 바뀌면 `dispatchDue`.
- `src/entrypoints/background.ts`에 `registerDeadlineScheduler()` 추가(registerResultScheduler 다음 줄).

## offscreen (`src/entrypoints/offscreen/main.ts`)
```ts
listen('deadline/plan', async () => buildPlan(await listNotices(fileStore), Date.now()), 'offscreen');
```
권한 없음 예외는 그대로 던진다(SW가 NO_FS로 받음). `listNotices`가 results.json 등을 읽는 것은 그대로(실패 무시 내장).

## 화면

### 설정 > 알림 `src/entrypoints/dashboard/NotifyCard.tsx` (신설)
- `SettingsPage.tsx` GROUPS의 `extra` 그룹 items 마지막에 `{ id: 'notify', label: '알림', Icon: Bell, card: () => <NotifyCard /> }`(lucide `Bell`). 그룹 label의 기존 문자열은 건드리지 않는다.
- Card title "알림", description "브라우저 OS 알림으로 보냅니다. macOS는 시스템 설정 > 알림에서 Chrome 알림을 허용해야 보입니다."
- 체크박스 3개(기존 `Field`/체크박스 컴포넌트가 있으면 재사용, 없으면 `<label><input type="checkbox"/></label>`):
  1. "개찰 순위 알림" help "팔로우한 공고의 개찰 순위가 나오면" → `notify.rank`
  2. "결과 확정 알림" help "낙찰, 탈락, 유찰, 추적 종료" → `notify.final`
  3. "마감 알림" help "메일 전달을 마친 공고의 입찰 마감과 참가등록 마감을 D-3, D-1, 당일 09:00에" → `notify.deadline`
- 바꾸면 즉시 `save({ ...settings, notify: {...} })`(저장 버튼 없음). 실패 시 InlineAlert error, 성공 표시 없음.
- `useSettingsStatus`: `out.notify = (rank || final || deadline) ? { tone: 'ok', text: '사용 중' } : { tone: 'idle', text: '꺼짐' }`.

### 홈 일정판 `src/entrypoints/dashboard/HomePage.tsx`
- 80-90행 "마감 예정" 카드를 제거하고 그 자리에 `<Card title="마감 일정" description="14일 안의 일정. 종 표시는 마감 알림 대상(메일 전달 완료)">`. 2열 그리드(lg:grid-cols-2)는 유지하되 일정판은 `lg:col-span-2`로 가로 전체를 쓰고 "최근 수집" 카드는 그 아래로 내린다(순서: 지표 띠 → 마감 일정 → 최근 수집 + 빈 칸 → 월별 수집). "최근 수집"은 `lg:grid-cols-2` 안에서 왼쪽 한 칸.
- 새 컴포넌트 `src/entrypoints/dashboard/home/ScheduleBoard.tsx`: `scheduleBoard(list, now)` 결과를 표로. 열: 공고(제목 한 줄 말줄임 + 아래 작은 글씨 공고번호, 기관), 참가등록 마감, 입찰 마감, 제안서 평가, 개찰. 각 일정 칸: 위 `formatDateTime(iso)`(font-mono tabular-nums), 아래 D-day(`formatDDay`, `dDayLevel`로 urgent=text-danger, soon=text-warn, 그 외 text-muted, 지난 것은 "지남" text-faint). 값 없음은 "—" text-faint. nextColumn 칸은 글자 굵게(font-semibold). 공고 칸 제목 앞에 notifyTarget이면 lucide `Bell` 14px(title="마감 알림 대상"). 행 클릭/Enter → `location.hash = noticeHash(noticeId)`(기존 Row와 같은 접근성 속성). 0행이면 `<EmptyState size="sm" title="14일 안에 예정된 일정이 없습니다." />`.
- 기존 `Row` 컴포넌트와 `stats.dueSoon`은 "최근 수집"과 StatCard에서 계속 쓰므로 삭제하지 않는다. "마감 예정" 카드 전용 코드만 제거.

### 공고 상세 개요 탭 `OverviewTab.tsx`
- "일정" 카드 안, 제안서 제출기간 줄 아래(없으면 Timeline 아래)에 `border-t border-line pt-4 text-sm` 블록:
  - target이고 lines 있음: 첫 줄 "마감 알림" 라벨(text-muted), 라인별로 `입찰 마감: D-3 10/19 09:00, D-1 10/21 09:00, 당일 10/22 09:00`(시각 font-mono tabular-nums). 라인마다 한 줄.
  - target이고 lines 없음: "마감 알림: 예정된 알림이 없습니다"(text-muted).
  - not_target: "마감 알림 없음. {reason}"(text-muted).
  - off: "마감 알림이 꺼져 있습니다. " + `<a href="#/settings/notify">설정에서 켜기</a>`(설정 섹션 해시 형식은 `settingsSectionOf`가 읽는 기존 형식을 Grep으로 확인해 맞춘다).
- 설정은 `useSettings()`로 읽는다(OverviewTab에 hook 추가 또는 NoticeDetailPage에서 내려줌, 둘 중 기존 패턴). index는 이미 props로 들어온다.
- 사전규격은 일정 카드가 없을 수 있다(`schedule` 그룹 없음). 그 경우 블록을 그리지 않는다.

### 메일 전달 완료 뒤 계획 갱신
- 대시보드에서 `mail/sent-add`(수동 "전달 완료 표시")를 보내는 곳(Grep `'mail/sent-add'` in `src/entrypoints/dashboard`)의 성공 직후 `void send('deadline/refresh', { reason: 'manual' }).catch(() => undefined)`.
- `HomePage`와 `NoticesPage`의 `notice/list` 로드 성공 직후 `void send('deadline/refresh', { reason: 'list' }).catch(() => undefined)`(10분 스로틀은 SW가 함).

## 단계

### S1 코어와 타입, index
대상: `src/core/types/deadline.ts`(신설), `src/core/types/index-file.ts`, `src/core/types/settings.ts`, `src/core/model/default-settings.ts`, `src/engine/notices/notice-store.ts`(entryOf, loadIndex, rebuildIndex, scan, saveNotice), `src/core/deadline/plan.ts`(신설), `src/core/dashboard/schedule-board.ts`(신설).
완료 조건: `npx tsc --noEmit`, 아래 테스트 통과.
- `tests/core/deadline-plan.test.ts`
  1. `fireTimeOf('2026-10-22T14:00:00+09:00', 3)` = 2026-10-19T00:00Z (09:00 KST). offset 1 → 10-21, 0 → 10-22 00:00Z.
  2. 마감이 KST 자정 직후(`2026-10-23T00:30:00+09:00`, UTC로는 22일 15:30)여도 날짜 기준은 KST 23일.
  3. `deadlineItemsOf`: delivered bid 2건 + none 1건 + prespec(delivered) 1건 + supersededBy 1건 + 같은 noticeNo round 000/001(둘 다 delivered) → 001만, prespec 제외, none 제외, supersededBy 제외. registrationDeadline 있으면 kind 둘 다 생성, bidCloseAt 해석 불가 문자열은 제외.
  4. `buildPlan`: now = 10-20 12:00 KST, 마감 10-22 14:00 → D-3(10-19 09:00)은 어제라 제외, D-1, 당일 포함. now = 10-19 15:00 KST → D-3(같은 날, 지났음)은 포함. 마감 지난 공고는 전부 제외. 정렬 fireAt 오름차순.
  5. `duePlan`: fireAt이 오늘이고 now 이전이며 sent에 없음 → due. sent에 있으면 제외. fireAt이 어제 → 제외. 마감 at <= now → 제외. nextAlarmAt = min(미래 fireAt, nextKstHour(now, 9)). 계획 비면 nextKstHour.
  6. `nextKstHour`: 10-20 08:59 KST → 10-20 09:00. 09:00 정각 → 10-21 09:00. 토요일 → 일요일 09:00(주말 건너뛰지 않음).
  7. `pruneSent`: plan에 없고 8일 지난 키 제거, 7일 이내는 유지, plan에 있으면 유지.
  8. `deadlineNotificationOf`: 제목 6종("입찰 마감 D-3", "입찰 마감 D-1", "오늘 입찰 마감", "참가등록 마감 D-3", "참가등록 마감 D-1", "오늘 참가등록 마감"), 본문 `${공고명} 10/22 14:00 마감`, 70자 공고명은 60자 + "…", id = key.
- `tests/core/schedule-board.test.ts`: 14일 경계(정확히 14일 뒤 포함, 15일 제외), nextAt/nextColumn 선택(지난 일정은 다음 후보에서 제외하되 cells에는 남김), 정렬, prespec 제외, latestBids, notifyTarget, 네 열 모두 없으면 제외.
- `tests/engine/notice-store.test.ts`(기존 파일에 추가): entryOf가 bid에서 schedule 세 값을 넣고 없으면 키 생략, prespec은 schedule 없음. loadIndex가 indexVersion 없는 유효 index를 읽으면 재생성해 indexVersion 2와 schedule을 채운다. saveNotice 결과 index에 indexVersion 2.
- `tests/core/default-settings.test.ts`: `notify.deadline` 기본 true, 저장본 `{ rank: false }`만 있으면 `{ rank: false, final: true, deadline: true }`.

### S2 공통 알림 모듈 추출과 result-scheduler 치환
대상: `src/background/notify.ts`(신설), `src/background/result-scheduler.ts`(73행 clip, 89-97행 notify, 180-186행 onNotificationClicked).
완료 조건: `tests/background/result-scheduler.test.ts` 무변경 전부 통과. `tests/background/notify.test.ts`: showNotification create 인자 정확 일치, create가 throw해도 resolve, openNoticeFromNotification이 encodeURIComponent된 해시로 openDashboard 후 clear, openDashboard throw여도 clear 호출, clipTitle 경계(60자 그대로, 61자 → 60 + "…").

### S3 프로토콜, offscreen, SW 스케줄러
대상: `src/messaging/protocol.ts`, `src/entrypoints/offscreen/main.ts`, `src/background/deadline-scheduler.ts`(신설), `src/entrypoints/background.ts`.
완료 조건: `tests/background/deadline-scheduler.test.ts`(result-scheduler.test.ts의 make() 패턴을 따라 deps 주입, chrome 전역 스텁):
  1. `armDeadlineAlarm`: 항상 clear 후 create(when), 과거면 now+5초.
  2. `dispatchDue`: 계획 2건 due(오늘 09:00, now 10:00) → create 2회, id는 key, deadlineSent에 두 키 기록, 알람 = 다음 fireAt. 다시 호출하면 create 0회(sent). notify.deadline false → create 0회지만 sent에는 기록. 계획 없음 → create 0회, 알람 = 다음날 09:00 KST. storage.set이 throw해도 resolve.
  3. `refreshDeadlines('list')`: `toOffscreen('deadline/plan', undefined, 30000)` 호출, 응답을 deadlinePlan에 저장, 10분 안 두 번째는 toOffscreen 미호출이지만 dispatchDue는 실행. 'manual'/'alarm'/'startup'/'job'은 무스로틀. offscreen이 code NEEDS_FS_PERMISSION으로 throw → skipped NO_FS, 캐시로 dispatchDue 실행, 알람 걸림. 일반 throw → error 문자열, 역시 dispatchDue. throw하지 않음.
  4. 리스너: onAlarm 'deadline-check'만 반응('other' 무시), onStartup/onInstalled가 refresh 1회, final listener가 collect completed에서만 refresh(compose, failed는 아님), storage.onChanged로 notify.deadline false→true면 dispatchDue 1회(true→false, 다른 키 변경은 아님), onClicked `deadline:R26BK00000001-000:bidClose:1` → openDashboard('#/notices/R26BK00000001-000/overview') + clear, `result:...` id는 무시.
  5. `deadline/refresh` 릴레이는 extension 발신자만(나라장터 탭 sender → SENDER_FORBIDDEN).
- offscreen 리스너는 단위 테스트 없이 S4 수동 검증.

### S4 화면
대상: `src/ui/notice-detail/view.ts`(deadlineNoticeView), `src/entrypoints/dashboard/notice/OverviewTab.tsx`, `src/entrypoints/dashboard/home/ScheduleBoard.tsx`(신설), `HomePage.tsx`, `NoticesPage.tsx`(refresh 호출 1줄), `NotifyCard.tsx`(신설), `SettingsPage.tsx`, `useSettingsStatus.ts`, `mail/sent-add` 호출부(refresh 1줄).
완료 조건: `tests/ui/notice-detail-view.test.ts`(기존 파일에 추가) deadlineNoticeView 상태별(off, 사전규격, 전달 전, 더 큰 round 존재, 일정 없음, target 라인과 지난 시각 제외, 모든 시각 지남 → lines []). `npx tsc --noEmit`, `npm test` 전체, `npm run build`(사용자는 dist 로드).

수동 검증(사용자):
1. 빌드 로드 → 홈에 "마감 일정" 표, 14일 내 공고 행과 D-day, 전달 완료 공고에 종 아이콘.
2. 설정 > 알림에 체크박스 3개, 마감 알림 끄고 켜기 저장.
3. 전달 완료 공고 상세 개요 "마감 알림" 줄에 D-3/D-1/당일 시각. 전달 전 공고는 "메일 전달을 마친 공고만…" 안내.
4. SW 콘솔에서 `chrome.alarms.get('deadline-check')` scheduledTime이 다음 알림 시각 또는 다음날 09:00 KST. `chrome.storage.local.get(['deadlinePlan','deadlineSent'])`에 계획 존재.
5. 테스트 발송: 마감이 오늘 이후인 전달 완료 공고에서 SW 콘솔로 `chrome.alarms.create('deadline-check', { when: Date.now() + 2000 })` → 오늘 09:00 이전이면 아무 것도 안 옴, 이후면 당일 것만 옴. 알림 클릭 → 상세 개요.
6. 폴더 권한 prompt 상태에서 알람 → 캐시로 발송되고 오류 없음.

## 하지 말 것
- SW에서 파일 읽기, offscreen에서 chrome.notifications 호출.
- `nextKstSlot`(평일 전용) 사용. 마감 알림은 주말에도 보낸다.
- 로컬 시간대(`new Date().getHours()` 등)로 09:00 계산. SW는 kstParts로만.
- `result/*` 프로토콜, `src/core/results/*`, `src/engine/results/*` 변경. result-scheduler.ts는 공통 모듈 치환 외 변경 금지.
- 알림 클릭 공통 라우터(모듈 전역 "한 번만 등록" 플래그). 스케줄러마다 자기 접두어 리스너.
- 계획 캐시 없이 알람 때 offscreen만 의존(권한 prompt면 알림이 끊긴다).
- `computeHomeStats.dueSoon` 삭제, StatCard "입찰마감 예정 7일" 변경.
- proposalPeriod 문자열 파싱(이번 범위 아님).
- IndexEntry에 알림 계획이나 발송 기록 저장.
- 꺼져 있던 동안의 알림을 켤 때 몰아서 발송(sent에 기록해 버린다).
- 가운뎃점(·) 사용.

## 흔한 오해
- "D-day"는 KST 달력 날짜 차이다. `formatDDay`(`src/ui/review/format.ts:31`)는 로컬 달력 기준이라 화면용으로만 쓰고 계획 계산에는 쓰지 않는다(사용자 PC가 KST면 결과는 같다).
- `latestBids`는 round를 Number로 비교한다. "000"/"001" 문자열 그대로 넣는다.
- index의 `mailStatus === 'delivered'`는 `sent-store.ts:176`의 saveNotice로 갱신되므로 믿어도 된다. 옛 delivered(legacy)도 notice.mail.status가 delivered라 포함된다.
- Chrome은 브라우저가 꺼진 동안 지난 when 알람을 시작 시 울린다. onStartup과 onAlarm이 거의 동시에 올 수 있으나 sent 기록과 dispatchDue 직렬화로 중복 발송이 막힌다.
- settings.notify.deadline을 꺼 두면 알림은 안 가지만 계획과 알람은 계속 돈다(켜면 그 뒤 것부터 받는다).

## 보고 형식
결론, 변경 파일 경로(줄 범위), 테스트 결과, 명세와 다르게 한 점과 이유, 실패 항목. 한국어, 가운뎃점(·) 사용 금지.
