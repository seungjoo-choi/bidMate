# 팔로우 범위 선택: 개찰 결과만 / 낙찰까지 (follow-target) 구현 명세

작성 2026-10-21. Fable 설계. 기반 설계는 `.claude/specs/award-tracking.md`(낙찰 결과 추적), 결정 근거는 `.claude/specs/decisions.md` "2026-10-20 낙찰 결과 추적". 이 문서만 보고 구현한다(대화 참조 없음).

## 목표
- 공고를 팔로우할 때 "개찰 결과만"과 "낙찰까지" 중 하나를 고른다. 별(목록)이나 팔로우 버튼(상세)을 누르면 두 항목이 든 작은 메뉴가 뜬다.
- "개찰 결과만": 개찰 순위가 확인되면 알림을 보내고 그 자리에서 팔로우를 자동 해제한다(최종 낙찰까지 기다리지 않는다).
- "낙찰까지": 지금과 같다. 순위 알림 뒤 최종 결과(낙찰, 탈락, 유찰, 미참여, 추적 종료) 알림까지 보내고 자동 해제한다.
- 이미 팔로우 중이면 같은 메뉴에서 범위를 바꾸거나 해제한다.

## 확정 선택값 (바꾸지 않는다)
- 범위 값 이름: `FollowTarget = 'rank' | 'final'`. 화면 문구는 `rank` = "개찰 결과만", `final` = "낙찰까지".
- 기본값: `final`(낙찰까지). 메뉴를 열면 포커스가 기본값(또는 현재 값)에 놓인다.
- 메뉴 항목 순서: 개찰 결과만, 낙찰까지, (팔로우 중일 때만 구분선 뒤) 팔로우 해제.
- 옛 `follows.json`(target 없음)은 읽을 때 `final`로 본다. 파일을 고쳐 쓰는 마이그레이션은 하지 않는다. `schemaVersion`은 1 그대로.
- 전역 설정 `Settings.notify.rank`/`notify.final`과 공고별 범위는 독립이다. 전역 설정은 "그 종류의 OS 알림을 띄울지", 공고별 범위는 "어디까지 추적할지"를 정한다. SW 필터(rank 이벤트는 notify.rank, final/expired 이벤트는 notify.final)는 그대로 둔다. 전역 알림이 꺼져 있으면 해당 이벤트는 알림 없이 버려지고 팔로우는 규칙대로 해제된다. 메뉴 항목 설명에 "설정에서 ... 알림이 꺼져 있어 알림은 오지 않습니다"를 보여 준다.
- "개찰 결과만" 팔로우 공고에 순위 단계 없이 바로 최종 결과(미참여, 유찰, 첫 확인 때 이미 낙찰 확정 등)가 나오면 그 최종 결과 알림을 1회 보내고 해제한다. 알림 문구는 기존 final 문구 그대로.
- 결과가 이미 `ranked`인 공고는 "개찰 결과만"을 고를 수 없다(새 팔로우든 범위 변경이든). 메뉴 항목 비활성, 엔진은 `FOLLOW_RANK_DONE`.
- "개찰 결과만"으로 끝난 순위 알림의 본문 끝에 " (팔로우 종료)"를 붙인다.
- 팔로우 해제 뒤 결과 항목(results.json)은 유지하고 일반 확인 주기(backoff)로 돌아간다(현행 수동 해제와 같음).
- 범위 변경 시 `followedAt`, `notified`는 유지한다.

## 현재 코드 상태 (확인된 사실)
- 타입 `src/core/types/result.ts:39` `FollowEntry { noticeId; followedAt; notified: { rank?; final? } }`, `:42-45` `NotifyEvent`(rank/final/expired), `RESULT_TERMINAL`.
- `src/core/types/index-file.ts:15` `following?: true`(파생 필드, index.json에 저장 안 함).
- 프로토콜 `src/messaging/protocol.ts` `follow/set { noticeId; follow } → { following; nextFollowCheckAt; startAt }`, `result/done`.
- `src/engine/results/follow-store.ts:14-33` `FollowStore.load`(schemaVersion 1, entries 객체면 그대로 반환, 손상 시 rename). `save`는 `writeJson`.
- `src/engine/results/follow-api.ts:28-86` `setFollow(store, { noticeId, follow }, { now })`. 켜기: `:60` `follows.entries[id] ??= { noticeId, followedAt, notified: {} }`. 끄기: `:68-85` follows에서 제거, nextCheckAt을 backoff로 복귀. `SetFollowResult`(`:14`).
- `src/engine/results/result-tracker.ts:86-99` round 이전(`{ ...follows.entries[id], noticeId }`로 복사하므로 새 필드도 승계), `:147-152` 팔로우면 `followNextCheckAt`으로 nextCheckAt 덮어쓰기(이벤트 처리보다 먼저), `:158-175` 이벤트: rank는 `notified.rank` 기록만, final/expired는 알림 후 `delete follows.entries[id]`, `:203-210` finally에서 남은 팔로우의 nextCheckAt을 팔로우 주기로 당김.
- `src/engine/notices/notice-api.ts:20-49` `listNotices`가 `follows.json` entries 키 존재 여부로 `following: true` 병합(`:31`, `:46`).
- SW `src/background/result-scheduler.ts:74-85` `notificationOf`(rank 문구 `${t} 우리 N위, 참여 M개사`), `:87-93` `notify`(kind별 전역 설정 필터), `:128-141` `followSet`(noticeId 검사 후 offscreen 릴레이), `:22` `NOTIFY_ID_RE`.
- offscreen `src/entrypoints/offscreen/main.ts:217-221` `follow/set` 리스너(setFollow 호출 뒤 `result/done`으로 알람 재예약).
- 화면 `src/entrypoints/dashboard/FollowToggle.tsx`: `useFollowToggle`(`toggle(noticeId, follow)` → `FollowResult`), `FollowStar`(별 버튼, `aria-pressed`, 래퍼 div에서 클릭/키 전파 차단), `FollowButton`(상세 헤더 Button).
- `src/entrypoints/dashboard/NoticesPage.tsx`: `toggleFollow`(마스코트 토스트 + 낙관적 갱신), 헤더 `sr-only 팔로우`, 둘째 줄 힌트(BellRing + followHint), FollowStar 사용. 행은 `role="link"`, 목록 컨테이너는 `overflow-y-auto`라서 absolute 메뉴는 아래쪽 행에서 잘린다.
- `src/entrypoints/dashboard/notice/NoticeDetailPage.tsx`: `toggleFollow`, FollowButton, FollowTrack. `useSettings` 미사용.
- 뷰 `src/ui/notices/result-view.ts`: `isFollowing`(`=== true`), `followButton`, `followHint`, `trackSteps`, `followErrorText`, `followToastParts(following, startAt, now)`/`followToast`, `resultCell`.
- `src/entrypoints/dashboard/notice/ResultStrip.tsx` `FollowTrack({ result, now })` 3단계 표시.
- `src/entrypoints/dashboard/NotifyCard.tsx` rank 옵션 설명 문구.
- 메뉴/포털 패턴: `src/ui/components/MenuButton.tsx:39-58`(role menu, 화살표/Home/End 이동, Escape, 바깥 mousedown), `src/ui/components/Select.tsx:85-134,175-181`(createPortal + `position: fixed`, 아래 공간 부족하면 위로, scroll capture/resize로 닫기).
- 토스트: `useToast().show(text, { mascot, title })`(`src/ui/components/Toast.tsx`).
- 테스트: `tests/engine/follow-api.test.ts`, `tests/engine/notice-api.test.ts`, `tests/ui/result-view.test.ts`, `tests/background/result-scheduler.test.ts`, `tests/engine/result-tracker.test.ts`.

## 불변 원칙
- award-tracking.md의 불변 원칙 전부 유지(offscreen만 파일 쓰기, throw 없음, 키 미노출, 1순위는 낙찰 아님).
- 추가만 한다: FollowEntry에 `target` 추가, NotifyEvent rank에 선택 필드 추가, 프로토콜 payload에 선택 필드 추가. schemaVersion 변경 없음. `src/core/results/judge.ts`, `plan.ts`, `schedule.ts`, `src/adapters/g2b/*`는 수정하지 않는다.
- 범위 판단(언제 해제하는가)은 엔진(result-tracker)이, 알림 문구와 필터는 SW가, 메뉴 항목 계산과 문구는 `src/ui/notices/result-view.ts` 순수 함수가 맡는다.
- 가운뎃점(·) 금지(코드 주석, 화면 문구, 테스트 이름 모두).

## 데이터 모델

### `src/core/types/result.ts`
```ts
export type FollowTarget = 'rank' | 'final';
export const FOLLOW_TARGET_DEFAULT: FollowTarget = 'final';
export interface FollowEntry { noticeId: string; followedAt: ISODate; target: FollowTarget; notified: { rank?: ISODate; final?: ISODate } }
export type NotifyEvent =
  | { kind: 'rank'; noticeId: string; title: string; rank: number; bidders: number; followEnded?: true }   // followEnded: 개찰 결과만 팔로우라 이 알림으로 팔로우를 끝냄
  | ...(final, expired 기존 그대로)
```
- `FollowStore.load`: 유효한 파일이면 반환 전에 각 entry를 `{ ...e, target: e.target === 'rank' ? 'rank' : 'final' }`로 정규화한다(옛 파일 호환). 파일에 다시 쓰지 않는다. 손상 처리는 그대로.

### `src/core/types/index-file.ts`
```ts
following?: FollowTarget;   // 파생 필드. 팔로우 중이면 범위, 아니면 키 없음
```
`listNotices`: 팔로우 중이면 `following = follows[id].target === 'rank' ? 'rank' : 'final'`, 아니면 키를 넣지 않는다.

### 프로토콜 (`src/messaging/protocol.ts`)
```ts
| { type: 'follow/set'; payload: { noticeId: string; follow: boolean; target?: FollowTarget };
    response: { following: boolean; target: FollowTarget | null; nextFollowCheckAt: ISODate | null; startAt: ISODate | null } }
```
- `target`은 `follow: true`일 때만 의미가 있다. 없으면 `final`. `follow: false`면 무시.
- 응답 `target`: 팔로우 중이면 그 범위, 아니면 null.

## 엔진

### `src/engine/results/follow-api.ts` `setFollow`
```ts
export interface SetFollowResult { following: boolean; target: FollowTarget | null; nextFollowCheckAt: ISODate | null; startAt: ISODate | null }
export async function setFollow(store, p: { noticeId: string; follow: boolean; target?: FollowTarget }, opts): Promise<SetFollowResult>
```
켜기(`follow: true`), `target = p.target ?? 'final'`:
1. 기존 검사 순서 유지(NOT_FOUND, FOLLOW_UNSUPPORTED, FOLLOW_NO_SCHEDULE). 락 안에서 FOLLOW_FINISHED 검사 다음에 추가: `target === 'rank' && r && r.status === 'ranked'`면 `FOLLOW_RANK_DONE`("이미 개찰 순위가 확인된 공고라 개찰 결과만 팔로우할 수 없습니다").
2. follows에 이미 있으면 `target`만 바꾼다(`followedAt`, `notified` 유지). 없으면 `{ noticeId, followedAt: now, target, notified: {} }`.
3. 결과 항목 생성/nextCheckAt 재계산은 현행 그대로(범위와 무관).
4. 응답 `{ following: true, target, nextFollowCheckAt, startAt }`.
끄기: 현행 그대로, 응답에 `target: null`.

### `src/engine/results/result-tracker.ts` 이벤트 처리(147-176행 구간)
```
let entry = j.entry;
const f = follows.entries[id];
const endsByRank = !!f && f.target === 'rank' && j.event === 'rank';
if (f && !endsByRank) { 팔로우 주기로 nextCheckAt 덮어쓰기(현행) }
results.entries[id] = entry; touched, checked, updated, won 집계(현행)
if (!f || !j.event) continue;
if (j.event === 'rank') {
  if (!f.notified.rank && entry.rank !== undefined) {
    ev = { kind:'rank', ..., ...(endsByRank ? { followEnded: true } : {}) };
    f.notified.rank = now; followTouched.add(id);
  }
  if (endsByRank) { delete follows.entries[id]; followRemoved.add(id); }
} else { 현행(final/expired 알림 후 제거) }
```
- `endsByRank`일 때 nextCheckAt은 judge가 준 값(일반 backoff)을 그대로 둔다. finally의 "팔로우 주기로 당기기" 루프는 남은 팔로우만 돌므로 추가 처리 없음.
- `followRemoved`에 넣으면 finally에서 지워지므로 실행 중 다른 쓰기와 충돌해도 되살아나지 않는다(현행 규칙).
- round 이전, 일정 재계산은 그대로(target 승계됨).

### offscreen `src/entrypoints/offscreen/main.ts`
변경 없음(payload를 그대로 setFollow에 넘긴다). 타입만 맞춘다.

## SW `src/background/result-scheduler.ts`
- `notificationOf`: rank 이벤트에 `followEnded`가 있으면 message = `${t} 우리 ${rank}위, 참여 ${bidders}개사 (팔로우 종료)`. 없으면 기존 문구. id, title 변경 없음.
- `notify` 필터 변경 없음.
- `followSet(p)`: `target` 검사 추가. `p.target === undefined` → `'final'`, `'rank' | 'final'` → 그대로, 그 외 → `BusError('FOLLOW_BAD_TARGET', '팔로우 범위가 올바르지 않습니다.')`. offscreen에는 항상 `{ noticeId, follow: !!p.follow, target }`로 보낸다.
- 알람 재예약, 클릭 처리, 리스너 등록 변경 없음.

## 화면

### 순수 함수 `src/ui/notices/result-view.ts`
```ts
export const FOLLOW_TARGET_LABEL: Record<FollowTarget, string> = { rank: '개찰 결과만', final: '낙찰까지' };
export const isFollowing = (e: Pick<IndexEntry, 'following'>): boolean => e.following !== undefined;

export type FollowAction = { follow: false } | { follow: true; target: FollowTarget };
export interface FollowMenuItem { key: FollowTarget | 'off'; label: string; description?: string; warn?: boolean; checked?: boolean; disabled?: boolean; dividerBefore?: boolean }
/** 별/버튼 메뉴 항목. following: 현재 범위(아니면 null). rankDone: result.status === 'ranked'. notify: 전역 알림 설정(없으면 둘 다 true로 본다) */
export function followMenuItems(following: FollowTarget | null, rankDone: boolean, notify: { rank: boolean; final: boolean }): FollowMenuItem[];
```
`followMenuItems` 규칙:
- `rank`: label "개찰 결과만". description: rankDone → "이미 개찰 순위가 확인된 공고입니다"(disabled true). 그 외 notify.rank false → "설정에서 개찰 순위 알림이 꺼져 있어 알림은 오지 않습니다"(warn true). 그 외 → "순위가 나오면 알리고 팔로우를 끝냅니다". checked = following === 'rank'.
- `final`: label "낙찰까지". description: notify.final false → "설정에서 최종 결과 알림이 꺼져 있어 최종 결과 알림은 오지 않습니다"(warn true). 그 외 → "순위와 최종 결과를 모두 알립니다". checked = following === 'final'.
- `off`: following이 null이 아닐 때만. label "팔로우 해제", dividerBefore true.
- 항목 순서 rank, final, off.

```ts
/** 목록 둘째 줄 힌트. 팔로우 아니면 null */
export function followHint(e: Pick<IndexEntry, 'following' | 'result'>, now?: Date): string | null;
```
- 시작 전: `rank` → `${formatCheckAt(start)}부터 순위 확인`, `final` → `${...}부터 결과 확인`(현행).
- 시작 후: `rank` → "순위 확인 중". `final` → 현행("결과 확인 중", ranked면 "최종 결과 확인 중").

```ts
export function trackSteps(r: IndexEntry['result'] | undefined, now?: Date, target: FollowTarget = 'final'): TrackStep[];
```
- `target === 'rank'`: 현행 결과에서 세 번째 단계("최종 결과"/"최종 낙찰 대기")를 뺀 2단계만 반환. 그 외 현행.

```ts
export function followErrorText(code, message?): string   // 'FOLLOW_RANK_DONE' → "이미 개찰 순위가 확인된 공고라 개찰 결과만 팔로우할 수 없습니다", 'FOLLOW_BAD_TARGET' → "팔로우 범위가 올바르지 않습니다" 추가

/** 팔로우 적용 직후 마스코트 토스트. next: 적용 후 범위(해제면 null), prev: 적용 전 범위 */
export function followToastParts(next: FollowTarget | null, prev: FollowTarget | null, startAt: string | null, now?: Date): { title: string; text: string; mood: 'happy' | 'idle' };
```
- next null → { "팔로우를 해제했습니다", "이 공고의 결과 알림을 더 보내지 않아요", idle }
- prev null, next final → title "팔로우했습니다", text: startAt 미래면 `${formatCheckAt(startAt)}부터 확인해 순위와 최종 결과를 알려 드릴게요`, 아니면 "순위와 최종 결과를 알려 드릴게요". happy
- prev null, next rank → title "팔로우했습니다", text: startAt 미래면 `${...}부터 확인해 개찰 순위를 알려 드릴게요`, 아니면 "개찰 순위가 나오면 알려 드릴게요". happy
- prev 있음, next !== prev → title "팔로우 범위를 바꿨습니다", text: final → "최종 결과까지 알려 드릴게요", rank → "개찰 순위까지만 알리고 팔로우를 끝낼게요". happy
- prev === next(방어) → prev null 경우와 같은 문구.
- 기존 `followToast(following, startAt)`(문자열 1줄 버전)은 삭제한다.

### `src/entrypoints/dashboard/FollowToggle.tsx` (전면 교체)
```ts
export type FollowResult = { ok: true; following: FollowTarget | null; startAt: string | null; title: string; body: string; mood: 'happy' | 'idle' } | { ok: false; text: string };
export function useFollowToggle(): { apply(noticeId: string, action: FollowAction, prev: FollowTarget | null): Promise<FollowResult>; isBusy(id: string): boolean }
```
- `apply`: `send('follow/set', action.follow ? { noticeId, follow: true, target: action.target } : { noticeId, follow: false })` → `followToastParts(r.following ? r.target : null, prev, r.startAt)`로 title/body/mood. 오류는 `followErrorText`. busy 집합 관리는 현행.

```ts
export function FollowMenu(props: {
  variant: 'star' | 'button';
  following: FollowTarget | null;
  rankDone: boolean;
  notify: { rank: boolean; final: boolean };
  busy: boolean;
  disabled?: boolean; reason?: string;   // star 전용(결과 확정 공고). disabled면 메뉴를 열지 않는다
  title: string;                          // 공고명(aria-label용)
  onSelect: (action: FollowAction) => void;
}): JSX.Element
```
`FollowStar`, `FollowButton`은 삭제하고 `FollowMenu`로 대체한다.
- 트리거(star): 현행 FollowStar의 모양과 클래스 유지(별, 팔로우 중이면 fill, busy면 Loader2). `aria-pressed` 대신 `aria-haspopup="menu"`, `aria-expanded`. `aria-label`: 팔로우 중 `${title} 팔로우 메뉴 (현재 ${FOLLOW_TARGET_LABEL[following]})`, 아니면 `${title} 팔로우`. `title`(툴팁): disabled → reason, 팔로우 중 → `${FOLLOW_TARGET_LABEL[following]} 팔로우 중입니다. 누르면 범위를 바꾸거나 해제합니다`, 아니면 "팔로우하면 개찰 뒤 결과를 자주 확인해 알림으로 알려 드립니다. 누르면 범위를 고릅니다". 래퍼 div의 `onClick`/`onKeyDown` `stopPropagation`은 유지한다(행 열기 방지).
- 트리거(button): 현행 FollowButton의 Button(ghost, Star 아이콘, 팔로우 중이면 star 색 클래스) 유지. 라벨 "팔로우"(아님) / "팔로우 중"(중), 팔로우 중이면 라벨 뒤 작은 글씨(MenuButton의 hint 스타일 `border-l pl-2.5 text-xs text-muted`)로 `FOLLOW_TARGET_LABEL[following]`, 맨 끝에 `ChevronDown size-3.5`. `aria-haspopup="menu"`, `aria-expanded`. `title`은 star와 같은 문구.
- 트리거 키: Enter, Space, ArrowDown, ArrowUp → 메뉴 열기(기본 동작 방지). 클릭 → 토글.
- 메뉴: `createPortal(document.body)`, `position: fixed`, `z-50`, `min-w-64`, `rounded-card border border-line bg-surface p-1.5 shadow-overlay`(MenuButton과 같은 면). 위치: 트리거 `getBoundingClientRect()` 기준 `right = window.innerWidth - rect.right`(오른쪽 정렬), `top = rect.bottom + 6`. 아래 남은 공간이 180px 미만이고 위 공간이 180px 이상이면 `bottom = window.innerHeight - rect.top + 6`으로 위에 연다(Select.tsx 패턴). 열려 있는 동안 `scroll`(capture), `resize`에 닫는다. 바깥 `mousedown`(트리거와 메뉴 밖)에 닫는다.
- 메뉴 내용: `followMenuItems(following, rankDone, notify)`. `role="menu"`, `aria-label="팔로우 범위"`. rank/final 항목은 `<button type="button" role="menuitemradio" aria-checked={checked} disabled>`, off 항목은 `role="menuitem"`. 항목 모양은 MenuButton 항목과 같다(label `text-sm text-ink`, description `text-xs text-muted`). checked 항목은 label 왼쪽에 `Check size-3.5`(아닌 항목은 같은 너비의 빈칸으로 정렬). disabled는 `opacity-40`. warn description은 `text-warn`.
- 선택: checked 항목을 다시 고르면 닫기만(호출 없음). rank/final → `onSelect({ follow: true, target })`, off → `onSelect({ follow: false })`. 선택 후 닫고 트리거로 포커스 복귀.
- 메뉴 키: ArrowDown/ArrowUp(순환), Home/End, Enter/Space(선택), Escape(닫고 트리거 포커스), Tab(닫기). 대상은 `[role="menuitemradio"]:not(:disabled), [role="menuitem"]:not(:disabled)`. 메뉴 루트 keydown/click은 `stopPropagation`(포털이어도 React 합성 이벤트는 React 트리로 전파되어 목록 행의 Enter로 상세가 열린다).
- 열릴 때 초기 포커스: following이 있으면 그 항목, 없으면 `final` 항목. 그 항목이 disabled면 첫 활성 항목.
- `busy` 또는 `disabled`면 메뉴를 열지 않고 열려 있으면 닫는다.

### `src/entrypoints/dashboard/NoticesPage.tsx`
- `useSettings()`의 `settings`로 `notify = settings?.notify ?? { rank: true, final: true }`.
- `toggleFollow(n)` → `applyFollow(n, action: FollowAction)`: `follow.apply(n.noticeId, action, n.following ?? null)` → `toast.show(r.body, { mascot: r.mood, title: r.title })`, 실패는 `toast.show(r.text)`. 낙관적 갱신: `r.following`이 있으면 `following: r.following`(startAt 처리는 현행 구조 유지), 없으면 `following` 삭제.
- FollowStar → `<FollowMenu variant="star" following={n.following ?? null} rankDone={n.result?.status === 'ranked'} notify={notify} busy={follow.isBusy(n.noticeId)} disabled={fb.disabled} reason={fb.reason} title={n.title} onSelect={(a) => void applyFollow(n, a)} />`.
- 둘째 줄 힌트는 `followHint` 결과를 그대로 쓴다.
- "팔로우" 필터와 카운트(`isFollowing`)는 변경 없음.

### `src/entrypoints/dashboard/notice/NoticeDetailPage.tsx`
- `useSettings()` 추가, notify 계산은 목록과 같다.
- `toggleFollow` → `applyFollow(action)`: `follow.apply(noticeId, action, entry.following ?? null)` → 토스트 → `load()`.
- FollowButton → `<FollowMenu variant="button" following={entry.following ?? null} rankDone={entry.result?.status === 'ranked'} notify={notify} busy={follow.isBusy(noticeId)} title={title} onSelect={(a) => void applyFollow(a)} />`(fb.visible && !fb.disabled 조건 유지).
- FollowTrack에 `target={entry.following}` 전달.

### `src/entrypoints/dashboard/notice/ResultStrip.tsx` `FollowTrack`
- props에 `target: FollowTarget`(필수) 추가. `trackSteps(result, now, target)` 사용.
- 제목 줄 "결과 추적" 오른쪽(다음 확인 시각 앞)에 `<span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">{FOLLOW_TARGET_LABEL[target]}</span>`.

### `src/entrypoints/dashboard/NotifyCard.tsx`
- rank 옵션 설명을 "우리 회사가 몇 위인지 먼저 알려 드립니다. 최종 낙찰이 아니라 중간 결과입니다. 개찰 결과만 팔로우한 공고는 이 알림을 끝으로 팔로우가 해제됩니다."로 바꾼다. 그 외 변경 없음.

## 단계

### S1 타입, 엔진, listNotices, SW
대상: `src/core/types/result.ts`, `src/core/types/index-file.ts`, `src/messaging/protocol.ts`, `src/engine/results/follow-store.ts`, `src/engine/results/follow-api.ts`, `src/engine/results/result-tracker.ts`, `src/engine/notices/notice-api.ts`, `src/background/result-scheduler.ts`(followSet, notificationOf), `src/entrypoints/offscreen/main.ts`(타입만).
`IndexEntry.following` 타입이 바뀌므로 화면 코드(`isFollowing`, 낙관적 갱신의 `following: true as const`)가 tsc에서 깨질 수 있다. S1에서는 `isFollowing`을 `e.following !== undefined`로 바꾸고 낙관적 갱신을 `'final'`로 바꾸는 최소 수정만 해서 tsc를 통과시킨다(S2에서 교체됨).
완료 조건: `npx tsc --noEmit`, 아래 테스트 통과(기존 테스트는 `following: true` 비교를 `'final'`로 고치는 것 외 무변경).
- `tests/engine/follow-api.test.ts`(기존 수정 + 추가)
  1. 기존 "켜면 항목을 만들고..." 응답이 `{ following: true, target: 'final', startAt }`, follows entry에 `target: 'final'`. 끄면 `target: null`.
  2. `target: 'rank'`로 켜면 entry `target: 'rank'`, 응답 `target: 'rank'`.
  3. 팔로우 중 `target`을 바꾸면 `followedAt`과 `notified`(미리 `{ rank: 'x' }`를 심어 둔다)가 유지되고 target만 바뀐다.
  4. 결과 status가 `ranked`일 때 `target: 'rank'` → `FOLLOW_RANK_DONE`. `target: 'final'`은 성공.
  5. target 없는 옛 follows.json을 읽은 뒤 다른 공고를 켜면 기존 entry가 `target: 'final'`로 저장된다.
- `tests/engine/result-tracker.test.ts`(추가)
  1. `target: 'rank'` 팔로우: waiting → ranked 시 events `[{ kind: 'rank', ..., followEnded: true }]`, follows에서 제거, `nextFollowCheckAt` null, 결과 항목은 `ranked`로 남고 nextCheckAt이 팔로우 주기가 아니라 judge의 backoff 값과 같다.
  2. `target: 'rank'` 팔로우: 첫 확인에서 바로 `not_participated` → events `[{ kind: 'final', status: 'not_participated' }]`, 제거.
  3. 기존 "이벤트는 팔로우 공고에만..." 케이스는 target final(기본)로 그대로 통과.
  4. round 이전 시 `target: 'rank'`가 승계된다.
- `tests/engine/notice-api.test.ts`: `{ following: 'final' }`(target 없는 옛 파일), `{ following: 'rank' }`(target rank), 팔로우 아니면 undefined.
- `tests/background/result-scheduler.test.ts`(추가): `notificationOf({ kind: 'rank', ..., rank: 1, bidders: 5, followEnded: true })` message가 `t 우리 1위, 참여 5개사 (팔로우 종료)`, followEnded 없으면 기존 문구. `follow/set` 릴레이: target 없으면 offscreen에 `target: 'final'`로 전달, `'rank'`는 그대로, `'x'`는 `FOLLOW_BAD_TARGET`로 거부(offscreen 미호출).

### S2 뷰 함수와 화면
대상: `src/ui/notices/result-view.ts`, `src/entrypoints/dashboard/FollowToggle.tsx`, `NoticesPage.tsx`, `notice/NoticeDetailPage.tsx`, `notice/ResultStrip.tsx`, `NotifyCard.tsx`.
완료 조건: `npx tsc --noEmit`, `tests/ui/result-view.test.ts` 통과.
- `tests/ui/result-view.test.ts`(기존 수정 + 추가)
  1. `isFollowing({ following: 'rank' })` true, `{}` false.
  2. `followMenuItems(null, false, { rank: true, final: true })` → rank, final 두 항목, checked 모두 false, off 없음, 설명이 기본 문구.
  3. `followMenuItems('final', false, ...)` → final checked, off 항목 있고 dividerBefore true.
  4. `followMenuItems('final', true, ...)` → rank disabled, 설명 "이미 개찰 순위가 확인된 공고입니다".
  5. `followMenuItems(null, false, { rank: false, final: true })` → rank 설명이 경고 문구이고 disabled 아님. `{ rank: true, final: false }`면 final 설명이 경고 문구.
  6. `followHint`: rank 시작 전 "…부터 순위 확인", rank 시작 후 "순위 확인 중", final은 기존 세 문구.
  7. `trackSteps(ranked 아님, now, 'rank')` 길이 2, `'final'` 길이 3.
  8. `followToastParts`: (null, 'final') 해제 문구와 idle, ('final', null, 미래) "부터 확인해 순위와 최종 결과를 알려 드릴게요"로 끝남, ('rank', null, null) "개찰 순위가 나오면 알려 드릴게요", ('rank', 'final', null) title "팔로우 범위를 바꿨습니다" text "개찰 순위까지만 알리고 팔로우를 끝낼게요", ('final', 'rank', null) text "최종 결과까지 알려 드릴게요".
  9. `followErrorText('FOLLOW_RANK_DONE')` 문구.
  10. 기존 `followToast` 테스트 삭제.

수동 검증(사용자, dist 빌드 로드):
1. 목록에서 별 클릭 → 두 항목 메뉴, 포커스가 "낙찰까지"에 있음. Enter → 토스트 "팔로우했습니다 / 순위와 최종 결과를 알려 드릴게요", 둘째 줄 "결과 확인 중".
2. 같은 별 다시 클릭 → "낙찰까지"에 체크, 구분선 아래 "팔로우 해제". "개찰 결과만" 선택 → 토스트 "팔로우 범위를 바꿨습니다", 둘째 줄 "순위 확인 중".
3. 목록 맨 아래 행의 별 → 메뉴가 잘리지 않고 위로 열림. 스크롤하면 닫힘. Escape로 닫히고 별에 포커스.
4. 상세 헤더 버튼 "팔로우 중 | 개찰 결과만 ▾", 결과 추적 줄에 2단계와 "개찰 결과만" 표시.
5. 설정 > 알림에서 개찰 순위 알림을 끄면 메뉴 "개찰 결과만" 설명이 경고 문구로 바뀜.
6. ranked 상태 공고에서 메뉴의 "개찰 결과만"이 비활성.
7. 개찰 결과만 팔로우한 공고의 순위 알림 본문 끝에 "(팔로우 종료)", 알림 뒤 목록에서 팔로우 표시가 사라짐.

## 하지 말 것
- `follows.json`을 열자마자 target을 채워 다시 쓰기. 읽을 때 정규화만 한다.
- `schemaVersion` 올리기, `FollowFile`에 새 상위 필드 추가.
- 전역 `notify.rank`/`notify.final`로 메뉴 항목을 비활성화하기(설명 경고만). 전역 설정을 공고별 범위로 덮어쓰거나 그 반대.
- SW에서 범위 판단(해제 여부)을 하기. 해제는 엔진이 하고 SW는 문구와 필터만.
- `judge.ts`, `schedule.ts`, `plan.ts` 수정. "개찰 결과만"의 확인 주기는 "낙찰까지"와 같다.
- 메뉴를 absolute로 목록 행 안에 그리기(overflow 컨테이너에 잘린다). 포털 + fixed.
- 별 트리거에 `aria-pressed` 남기기.
- `IndexEntry.following`을 `true`와 범위 두 필드로 나누기. 한 필드(`FollowTarget`)로 간다.
- 가운뎃점(·) 사용.

## 흔한 오해
- "개찰 결과만"은 확인 주기를 줄이는 게 아니라 해제 시점을 앞당기는 것이다.
- "개찰 결과만" 팔로우가 끝나도 결과 항목은 남아 목록을 열 때 일반 확인을 계속하므로 나중에 낙찰되면 목록 표시는 바뀐다. 다만 OS 알림은 오지 않는다.
- 개찰 순위 단계가 없는 결과(미참여, 유찰, 첫 확인 때 이미 확정)는 rank 이벤트가 나지 않는다. "개찰 결과만"이어도 final 알림 1회 후 해제된다. 이는 final 이벤트이므로 `notify.final`로 걸러진다.
- 전역 `notify.rank`가 꺼진 상태에서 "개찰 결과만" 팔로우는 알림 없이 조용히 해제된다. 메뉴 설명 경고로 충분하다.
- `result-tracker.ts`의 팔로우 주기 덮어쓰기는 이벤트 처리보다 먼저 온다. "개찰 결과만"으로 해제되는 경우에는 이 덮어쓰기를 건너뛰어야 결과 항목이 일반 backoff로 돌아간다.
- round 이전 코드는 entry 전체를 spread하므로 `target`이 저절로 승계된다.
- 상세 헤더의 FollowMenu는 `fb.visible && !fb.disabled`일 때만 그린다(현행).

## 보고 형식
결론, 변경 파일 경로(줄 범위), 테스트 결과, 명세와 다르게 한 점과 이유, 실패 항목. 한국어, 가운뎃점(·) 사용 금지.
