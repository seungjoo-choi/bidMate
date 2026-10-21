# 나라장터 수집 카드 → 트래커봇 진행 카드 통일

## 목표
나라장터(g2b) 우측 하단 패널의 "수집 중" 카드를 트래커봇(네이버웍스 메일 화면) 진행 카드 컴포넌트로 교체한다. 같은 코드로 같은 UI(걸터앉은 마스코트·말풍선·단계 배지·'수집' 칩·막대 위 마스코트 러너·creep 차오름·arrive/fail 연출·알약)를 낸다. 대기(idle)·완료·오류 카드는 Panel.tsx 그대로 둔다.

## 불변 조건
- `src/ui/g2b-panel/panel-view.ts`의 `PanelView` 형태는 바꾸지 않는다(사이드패널 `src/entrypoints/sidepanel/App.tsx`가 progress 필드를 사용).
- 트래커봇 화면의 모양·동작·위치(fixed 20px)는 바뀌지 않는다. 새 옵션은 모두 optional이고 트래커봇은 넘기지 않는다.
- `activeItem`은 복사·변형하지 않고 공유한다. g2b 전용 차이는 반환값 spread 후 덮어쓴다.
- vitest는 대문자 `C:` 드라이브 cwd에서 실행한다(소문자 c:면 전부 실패).

## 단계 1 — 공용 폴더로 이동(동작 변경 없음)
1. 새 `src/ui/progress-card/types.ts`: `src/ui/trackerbot/progress-view.ts`의 `ProgressState, ProgressActionId, ProgressAction, ProgressItem, ProgressPanelView` 타입을 옮긴다.
   - `ProgressActionId`는 리터럴 합집합으로: `'retry' | 'grant' | 'open-mail' | 'open-review' | 'settings' | 'sidepanel' | 'choose-dashboard' | 'choose-compose'`. (현재 `'retry' | 'grant' | RowSubAction | PopupChoiceAction`과 같은 값인지 먼저 확인하고, 다르면 실제 값에 맞춘다.)
   - `ProgressItem.cancel`을 `{ target: 'collect' | 'compose'; cancelling: boolean; force?: boolean }`로 확장. 주석: "force: 취소 중일 때 '강제 중단' 버튼을 보인다. on.force 콜백 필요".
2. `git mv src/ui/trackerbot/progress-card.ts src/ui/progress-card/card.ts`, import를 `../mascot/dom`, `../mascot/step-icons`, `./types`로.
3. 새 `src/ui/progress-card/active-item.ts`: progress-view.ts의 `fmtSize`, `activeItem`을 옮기고 `export function activeItem(key: string, title: string, a: Job): ProgressItem`.
4. `src/ui/trackerbot/progress-view.ts`: 타입 정의 삭제 후 `export type { ... } from '../progress-card/types'`로 재export, `activeItem`은 import. `ProgressSession` 등 트래커봇 전용은 남긴다.
5. `src/ui/trackerbot/progress-popup.ts`: card import 경로를 `../progress-card/card`로.
6. `tests/ui/trackerbot-progress-card.test.ts` import 경로 수정.
- 완료 조건: `tsc --noEmit` 통과, 기존 테스트 전부 통과.

## 단계 2 — 카드 확장(`src/ui/progress-card/card.ts`)
- `on` 파라미터 타입을 `export type ProgressCardCallbacks`로 꺼내고 `force?(key: string): void` 추가.
- 시그니처: `createProgressCard(doc, on: ProgressCardCallbacks, opts: { inline?: boolean } = {})`.
- 기존 `TRANSIT_MS`를 `export const PROGRESS_TRANSIT_MS = 1300`으로(내부 사용처도 교체).
- STYLE:
  - `:host { all: initial; display: block; }`
  - `.root`에 `display: flow-root;` 추가(무조건)
  - font-family 맨 앞에 `'Pretendard Variable',` 추가
  - `.root.inline { position: static; right: auto; bottom: auto; z-index: auto; }`
- `opts.inline`이면 root className에 `inline` 추가, `render()`의 `doc.body.append(host)` 자동 부착을 하지 않는다. `host.isConnected` 검사(tick·transit)는 그대로.
- 강제 중단 버튼: `makeNode`에서 `btn('강제 중단', 'act stop', () => on.force?.(key))`를 cancel 바로 뒤에 추가, `ItemNode.force`. 갱신 시 `hidden = !(active && it.cancel?.cancelling && it.cancel.force && !!on.force)`. 기존 '취소 중…' 처리는 그대로.

## 단계 3 — g2b 매핑 순수 함수(새 `src/ui/g2b-panel/progress-card-view.ts`)
```ts
type ProgressPV = Extract<PanelView, { kind: 'progress' }>;
type SettledPV = Extract<PanelView, { kind: 'completed' | 'partial' | 'error' }>;
export function collectProgressView(job: Job, v: ProgressPV, collapsed: boolean): ProgressPanelView;
export function settledProgressView(job: Job, v: SettledPV): ProgressPanelView;
```
collectProgressView:
- `collapsed` → `{ kind: 'pill', text: v.pillText, activeCount: 1 }` (카드 view의 pill 형태에 맞춘다)
- 아니면 card 뷰, 항목 1개:
  - `key = job.id`, `title = v.title ?? (job.ref ? noticeLabel(job.ref) : '공고')` (`noticeLabel`은 `src/core/model/ids.ts`, Job.ref 호환 확인)
  - 항목 = `{ ...activeItem(job.id, title, job), cancel: { target: 'collect', cancelling: job.status === 'cancelling', force: true } }`
  - `headline`: `v.foreignLabel !== undefined`면 `'BidMate · 다른 공고 수집 중'`, 아니면 `'BidMate · 1건 진행 중'`
  - `activeCount 1, settledCount 0, moreCount 0`. 오류 수는 표시하지 않는다.
settledProgressView(항목 1개, 끝난 상태):
- `key = job.id`, title 규칙 동일
- `state`: completed→`'ok'`, partial→`'warn'`, error→`'error'`
- `stepLabel`: completed/partial은 `v.headline`, error는 `v.message`
- detail·actions·cancel·ratio·stepSpan 없음
- `headline 'BidMate · 작업 완료'`, `activeCount 0, settledCount 1, moreCount 0`
(필드 이름·필수 여부는 types.ts의 실제 정의를 따른다.)

## 단계 4 — Panel.tsx 교체(`src/ui/g2b-panel/Panel.tsx`)
- 같은 파일에 `ProgressCardMount({ view, on })` 컴포넌트:
  - `useEffect([], ...)`에서 `createProgressCard(document, {cancel, force, toggleCollapse, hover → onRef.current 위임; dismiss·dismissAll·action은 no-op}, { inline: true })` 1회 생성, `handle.host`를 ref div에 append, cleanup에서 `dispose()`.
  - `onRef.current = on`으로 콜백 최신화(카드 재생성 금지).
  - `useEffect([view])`에서 `handle.render(view)`.
  - 렌더 본문에서 `createProgressCard`를 호출하지 말 것.
- `view.kind === 'progress'` 분기 전체(최소화 알약 포함)를 `<ProgressCardMount key="progress-card" view={...collectProgressView(st.job, view, minimized)} on={...} />`로 교체. view는 `useMemo`로 만든다.
  - `on.cancel` → `ctl.cancel(false)`, `on.force` → `ctl.cancel(true)`, `on.toggleCollapse` → `setMinimized(m => !m)`, `on.hover` → `setHover`.
  - 기존 새 잡 시작 시 `setMinimized(false)` effect 유지.
- 진행→완료 전환 연출:
  - `settling` state + `prevKindRef`. 직전 kind가 `'progress'`이고 지금 `completed|partial|error`이며 같은 job.id이고 `!minimized`이면 `settling = true`, `PROGRESS_TRANSIT_MS` 뒤 false.
  - settling 동안 body = `<ProgressCardMount key="progress-card" view={settledProgressView(st.job, view)} ... />` — progress 분기와 **같은 key·같은 자리**여야 카드 인스턴스가 유지돼 arrive/fail 연출이 재생된다.
  - `st.job?.id`가 바뀌면 settling 해제·타이머 취소. 언마운트 시 타이머 정리.
  - 완료 자동 접힘 effect(현재 `view.kind`·hover 기반 6초/foreign 3초)에 `settling` deps 추가, `if (settling) return;`.
  - progress→idle(취소 완료)과 minimized 상태에서 끝난 경우는 연출 없이 바로 전환.
- 쓰지 않게 된 import만 정리(`Loader2`, `X`는 다른 분기에서 쓰므로 유지 여부 확인).

## 단계 5 — 테스트
- `tests/ui/trackerbot-progress-card.test.ts` 추가 케이스:
  1. `inline: true` → render 후에도 `host.parentElement === null`, `.root.inline` 존재.
  2. `cancel: { target:'collect', cancelling:true, force:true }` + `on.force` 제공 → '취소 중…'(disabled)와 '강제 중단'이 보이고 클릭 시 `on.force(key)`. `on.force` 미제공 또는 `cancelling:false`면 '강제 중단' 숨김.
- 새 `tests/ui/g2b-progress-card-view.test.ts`:
  - running + 다운로드 단계 progress 3/6(bytes 포함) → stepLabel에 `(3/6)`, detail에 파일 정보, `cancel.force === true`, headline `'BidMate · 1건 진행 중'`, key === job.id
  - foreignLabel 있음 → headline `'BidMate · 다른 공고 수집 중'`, title 없으면 noticeLabel 폴백
  - collapsed → pill, text === v.pillText
  - cancelling → `cancel.cancelling === true`
  - settled: completed→ok(stepLabel=headline), partial→warn, error→error(stepLabel=message), ratio·actions 없음
- 기존 `panel-view`, `trackerbot-progress-view`, `trackerbot-progress-popup` 테스트 통과(변경 없음).

## 완료 조건
`tsc --noEmit` 통과, `tests/ui` 전체 통과, `npm run build` 성공.

## 보고 형식
단계별 변경 파일:줄범위, 명세와 다르게 한 부분과 이유, 테스트 결과 요약.
