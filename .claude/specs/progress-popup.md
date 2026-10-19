# 트래커봇 웹메일 우측 하단 진행 팝업

## 목표
웹메일(네이버웍스·Gmail) 트래커봇 메일 화면 우측 하단에 진행 팝업 카드를 띄워, 공고별로 현재 단계·다운로드 중인 파일명·크기·진행률을 보여 준다. 행 버튼(row-button)은 지금처럼 짧게 유지한다.

## 전제(확정 사항)
- 프로토콜·스키마·백그라운드·엔진 변경 없음. 데이터는 ledger의 `Job.label`, `Job.currentStep`, `steps[].progress{done,total}`, `steps[].bytes{received,total,name}`만 쓴다.
- 팝업은 `TrackerbotController`(src/ui/trackerbot/controller.ts)의 `RowEntry` 상태를 구독만 한다. 팝업이 `job/get`·`job/progress`를 직접 호출·구독하지 않는다.
- 한 공고(RowEntry) = 팝업 항목 1개. collect 잡과 연결된 compose 잡은 같은 항목에서 phase만 바뀐다.
- 마운트: vanilla DOM + `attachShadow({mode:'open'})` + 인라인 `<style>` 문자열(row-button.ts와 같은 방식). React·Tailwind·`createShadowRootUi`·Panel.tsx 재사용 금지(trackerbot-mail.ts는 `scripting.registerContentScripts`로 js만 등록되는 unlisted script).
- 팝업의 상태 변경 동작은 취소뿐. 재시도·권한·설정·메일 열기는 행 버튼 전용.
- 엔진/coordinator를 고치지 말 것(다운로드 done 이벤트 뒤 `steps[].bytes`가 undefined로 덮이는 것은 의도된 동작).

## 작업 A — 라벨 맵 export (기계적)
- `src/ui/g2b-panel/panel-view.ts` 42~45행 `const DEFAULT_LABEL` → `export const COLLECT_STEP_LABEL: Record<string, string>`로 이름 변경, 내부 참조 갱신. 값은 바꾸지 않는다.
- `src/ui/compose-view.ts` 24~30행 `const STEP_LABEL` → `export const COMPOSE_STEP_LABEL`, 내부 참조 갱신.
- 완료: 타입체크 통과, `tests/ui/panel-view.test.ts`·`compose-view.test.ts` 무변경 통과.

## 작업 B — TrackerbotController 구독 지점 (src/ui/trackerbot/controller.ts)
추가 공개 인터페이스:
```ts
subscribe(fn: () => void): () => void;   // 해제 함수 반환
getEntries(): RowEntry[];                 // [...entries.values()]
focusRow(key: string): void;              // buttons.get(key) 중 isConnected인 첫 host에 scrollIntoView({ block: 'center', behavior: 'smooth' })
isOrphaned(): boolean;                    // this.orphaned || 주입된 orphan 판정 함수
```
- 기존 private 필드/의존성 이름 `isOrphaned`와 충돌하면 private 쪽을 `isOrphanedDep`로 rename.
- `private listeners = new Set<() => void>()`, `private notify()`는 각 리스너를 try/catch로 동기 호출.
- notify 호출 지점: `render(key)`에서 entry 조회 직후(버튼 set 유무와 무관하게 상태 변화가 전파되도록) / `markOrphaned()` 끝 / `scan()`에서 `entry.title`을 갱신한 경우 루프 뒤 1회.
- 코얼레싱은 구독자 책임(컨트롤러는 동기 호출).
- 필요하면 `ACTIVE`·`isActive`·`handoffQueued`(handoff.action==='compose' && state==='queued')를 export해도 된다.
- 테스트(`tests/ui/trackerbot-controller.test.ts`에 추가): subscribe 콜백이 scan→lookup 반영 뒤 1회 이상 호출 / 해제 후 미호출 / focusRow가 host의 scrollIntoView 호출(`Element.prototype.scrollIntoView = vi.fn()` 주입).

## 작업 C — 순수 함수 src/ui/trackerbot/progress-view.ts (새 파일)
```ts
export interface ProgressSession {
  seen: ReadonlySet<string>;               // 이 페이지에서 ACTIVE(또는 handoff queued)로 관측한 잡 id(collect·compose)
  dismissed: ReadonlyMap<string, string>;  // key -> 닫힌 시점의 collect job id
  collapsed: boolean;
}
export type ProgressState = 'active' | 'ok' | 'warn' | 'error';
export interface ProgressItem {
  key: string;
  title: string;                 // entry.title ?? `${ref.noticeNo}${ref.round ? `-${ref.round}` : ''}`
  phase: 'collect' | 'compose';
  state: ProgressState;
  stepLabel: string;
  detail?: string;
  ratio?: number;                // active에서만 0..1
  cancel?: { target: 'collect' | 'compose'; cancelling: boolean };
}
export type ProgressPanelView =
  | { kind: 'hidden' }
  | { kind: 'pill'; text: string; activeCount: number }
  | { kind: 'card'; headline: string; items: ProgressItem[]; moreCount: number; activeCount: number; settledCount: number };
export function progressPanelView(entries: RowEntry[], session: ProgressSession): ProgressPanelView;
```
import: `rowView`(row-view.ts), `progressRatio`·`COLLECT_STEP_LABEL`(panel-view.ts), `COMPOSE_STEP_LABEL`(compose-view.ts). 상수 `MAX_ITEMS = 5`. 로컬 `fmtSize(n)`: `n < 1048576 ? (n/1024).toFixed(1)+' KB' : (n/1048576).toFixed(1)+' MB'`.

항목 규칙(엔트리별, 위에서부터 판정):
1. `entry.starting && !isActive(entry.job)` → `{phase:'collect', state:'active', stepLabel:'시작 중', ratio:0}`, cancel 없음.
2. `!entry.job` 또는 (`job.status==='cancelled'`이고 compose가 active 아님) → 항목 없음.
3. `A = isActive(compose) ? compose : (isActive(job) ? job : null)`. A가 있으면 active 항목:
   - `phase = A.type==='compose' ? 'compose' : 'collect'`
   - `base = (phase==='collect' ? COLLECT_STEP_LABEL : COMPOSE_STEP_LABEL)[A.currentStep] ?? (phase==='collect' ? '수집 중' : '메일 작성 중')`; `A.status==='queued' && !A.currentStep`이면 `base='대기 중'`.
   - `step = A.steps.find(s => s.id === A.currentStep)`; `stepLabel = step?.progress ? `${base} (${done}/${total})` : base`.
   - detail: `step?.bytes?.name`이 있으면 `` `${name} · ${fmtSize(received)}${total ? `/${fmtSize(total)}` : ''}` ``. 없으면 `rem = A.label?.startsWith(base) ? A.label.slice(base.length).replace(/^\s*\(\d+\/\d+\)\s*,?\s*/, '').trim() : (A.label ?? '')`, `detail = rem || undefined`.
   - `ratio = progressRatio(A.steps)`, `cancel = { target: phase, cancelling: A.status==='cancelling' }`.
   - A가 없고 `handoffQueued(job)` → `{phase:'compose', state:'active', stepLabel:'메일 작성 대기 중', ratio:0}`, cancel 없음.
4. 끝난 상태: `!seen.has(job.id) && !(compose && seen.has(compose.id))` → 항목 없음. `dismissed.get(key) === job.id` → 항목 없음. 그 외 `rv = rowView(entry, { orphaned: false })`:
   - `rv.kind==='done'` → `state = rv.tone==='ok' ? 'ok' : 'warn'`, `stepLabel = rv.label`, `detail = rv.detail`의 앞 3줄('\n' 기준).
   - `rv.kind==='error'` → `state='error'`, 나머지 동일.
   - 그 외 kind → 항목 없음.
   - `phase = compose || job.handoff?.action==='compose' ? 'compose' : 'collect'`. ratio·cancel 없음.
5. 정렬: active 먼저(해당 엔트리 job `createdAt` 오름차순), 그 뒤 끝난 항목(`updatedAt` 내림차순; compose가 있으면 compose와 job 중 큰 값). 최대 5개, 넘친 수는 `moreCount`.
6. 항목 0개 → `hidden`. `collapsed` → `pill{ text: activeCount>0 ? `작업 ${activeCount}건 진행 중` : `완료 ${settledCount}건`, activeCount }`. 아니면 `card{ headline: activeCount>0 ? `BidMate · ${activeCount}건 진행 중` : 'BidMate · 작업 완료', ... }`. activeCount/settledCount는 절단 전 전체 기준.

진행 중 상태에 `rowView`를 쓰지 말 것(라벨이 20자 절단된다). `job.label`을 stepLabel에 그대로 쓰지 말 것.

테스트 `tests/ui/trackerbot-progress-view.test.ts`(trackerbot-row-view.test.ts의 헬퍼 패턴 복제; collect steps `fetch_basic, download_attachments, extract, fetch_html`, compose steps는 compose-view.test.ts 참고):
1. job 없음 → hidden. starting만 → card 1항목 '시작 중' active.
2. 다운로드: steps[1] running progress{2,6} bytes{1258291, 3565158, 'a.hwp'} → stepLabel '첨부파일 다운로드 중 (2/6)'(COLLECT_STEP_LABEL 값 기준), detail 'a.hwp · 1.2 MB/3.4 MB', cancel{collect,false}, ratio = progressRatio 값.
3. bytes 없음, label '첨부파일 다운로드 중 (3/6)' → detail undefined.
4. extract progress{0,3}, label '평가정보 추출 중 (1/3), b.pdf' → detail 'b.pdf'.
5. bytes.total null → 'a.hwp · 512.0 KB'.
6. queued & currentStep 없음 → '대기 중'. cancelling → cancel.cancelling true.
7. collect completed + handoff{compose, queued} → phase compose '메일 작성 대기 중' active, cancel 없음.
8. compose active open_compose, label '웹메일에서 [메일쓰기]를 눌러 주세요 (남은 30초)' → stepLabel = COMPOSE_STEP_LABEL.open_compose, detail = label 원문(base로 시작하지 않을 때), cancel{compose}.
9. compose attach_files bytes name → 파일명·크기 detail.
10. completed, seen에 없음 → hidden / seen에 있음 → ok '수집 완료' / dismissed===job.id → hidden / dismissed 다른 id → 표시.
11. partial(seen) → warn '일부 실패', detail 3줄 이하. failed(seen) → error '수집 실패'.
12. compose composed(seen에 compose id만) → ok '메일 작성됨' phase compose. compose 실패 → error '메일 작성 실패'.
13. cancelled → hidden.
14. 정렬·절단: active 2(createdAt 역순 입력) + 끝난 2 → 순서 검증. 7개 입력 → items 5, moreCount 2.
15. collapsed → pill '작업 2건 진행 중' / active 0 → '완료 1건'. headline 두 가지.

## 작업 D — DOM 카드 src/ui/trackerbot/progress-card.ts (새 파일)
```ts
export interface ProgressCardHandle { host: HTMLElement; render(view: ProgressPanelView): void; dispose(): void }
export function createProgressCard(doc: Document, on: {
  cancel(key: string): void; dismiss(key: string): void; dismissAll(): void;
  toggleCollapse(): void; focusRow(key: string): void; hover(over: boolean): void;
}): ProgressCardHandle;
```
- host `div[data-bidmate="progress"]`를 `doc.body`에 append, shadow open. `:host { all: initial; }`, `.root { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000; width: 320px; max-width: calc(100vw - 32px); }`. 카드는 흰 배경, 테두리 `#e5e7eb`, 둥근 모서리 8px, 그림자. 폰트 `-apple-system,'Segoe UI','Malgun Gothic',sans-serif` 12px. 색: active `#2563eb`, ok `#16a34a`, warn `#f59e0b`, error `#dc2626`, 보조 텍스트 `#6b7280`.
- `render(view)`: 매번 `if (!host.isConnected) doc.body.append(host)`. hidden → `.root` 비움(host 유지). pill → 버튼 1개(text, 클릭 toggleCollapse). card → 헤더(headline, [접기]→toggleCollapse, settledCount>0이면 [모두 닫기]→dismissAll) + `.list`(max-height 40vh, overflow-y auto, 재렌더 전후 scrollTop 보존) + moreCount>0이면 `외 n건`.
- 항목: 1행 title(ellipsis, title 속성) + phase 칩('수집'/'메일 작성') / 2행 stepLabel(state 색) / 3행 detail(있을 때, `white-space: pre-line`, 최대 3줄 line-clamp, title 속성) / active면 게이지(width ratio*100%, transition 200ms) / 하단 버튼: active+cancel → [취소](cancelling이면 disabled '취소 중…'). 끝난 항목: warn/error면 힌트 '행의 버튼에서 다시 시도·설정을 열 수 있습니다' + [행으로 이동] + [닫기], ok면 [행으로 이동] + [닫기].
- host에 click/pointerdown/mousedown/keydown/keyup/keypress stopPropagation(Gmail 단축키 방지). wheel은 막지 않음. mouseenter/mouseleave → on.hover(true/false).
- 테스트 `tests/ui/trackerbot-progress-card.test.ts`(jsdom, trackerbot-row-button.test.ts 패턴):
  1. hidden → `.root` 자식 0, host는 body에 연결.
  2. card → 항목 수·title·stepLabel·detail 출력, active에 '취소', 끝난 항목에 '닫기'.
  3. 콜백: 취소→cancel(key), 닫기→dismiss(key), 모두 닫기→dismissAll, 접기→toggleCollapse, 행으로 이동→focusRow(key). body의 click/keydown 리스너로 전파 안 됨.
  4. pill → 버튼 텍스트, 클릭 → toggleCollapse.
  5. host.remove() 후 render → 다시 body에 연결.
  6. `.list.scrollTop = 40` 후 re-render → 40 유지.

## 작업 E — 글루 src/ui/trackerbot/progress-popup.ts (새 파일)
```ts
export interface ProgressPopupDeps { now?: () => number; createCard?: typeof createProgressCard; autoDismissMs?: number; hoverRecheckMs?: number }
export class ProgressPopup {
  constructor(doc: Document, controller: TrackerbotController, deps?: ProgressPopupDeps);
  start(): void;   // controller.subscribe + 최초 refresh
  stop(): void;    // 구독 해제, 타이머 정리, card.dispose()
  getSession(): ProgressSession; // 테스트용
}
```
- 상태: seen Set, dismissed Map(key→jobId), collapsed=false, hover=false, okSince Map, timers Map, scheduled 플래그.
- notify → `queueMicrotask`로 1회 refresh(코얼레싱).
- refresh: (1) `controller.isOrphaned()`면 hidden 렌더 후 종료. (2) entries 순회해 seen 갱신: isActive(job)→job.id, isActive(compose)→compose.id, handoffQueued(job)→job.id. (3) `view = progressPanelView(...)`. (4) ok 항목: okSince 없으면 now 기록 + 타이머(autoDismissMs 기본 8000). ok가 아닌 키는 okSince·타이머 삭제(수집 완료→메일 작성 흐름에서 중간에 사라지지 않도록). 타이머 콜백: hover면 hoverRecheckMs(기본 2000) 뒤 재시도, 아니면 그 entry의 현재 job.id로 dismissed.set 후 refresh. (5) card.render(view).
- 콜백: cancel→`void controller.cancel(key)` / dismiss→dismissed.set(key, entry.job.id)(job 없으면 무시)+refresh / dismissAll→현재 view의 non-active 항목 전부 / toggleCollapse→반전+refresh / focusRow→controller.focusRow / hover→hover=b.
- 테스트 `tests/ui/trackerbot-progress-popup.test.ts`(jsdom, vi.useFakeTimers, trackerbot-controller.test.ts의 setup()처럼 실제 TrackerbotController + mock send):
  1. job/start→job/get running → card 1항목 active.
  2. onJobUpdate(completed) → ok, 8초 후 hidden. 7초에 hover true면 유지, hover false 후 2초 뒤 소멸.
  3. partial → warn, 30초 지나도 유지. 닫기 → hidden. 같은 key 새 jobId running → 다시 표시.
  4. 복원: job/list-for-tab가 끝난 completed 잡 반환 → 팝업 hidden.
  5. completed + handoff compose queued → active '메일 작성 대기 중', 자동 소멸 안 함 → compose running → phase compose → compose completed → ok → 8초 후 소멸.
  6. 접기 → pill, 새 잡 시작해도 pill 유지, 클릭 → card.
  7. orphaned → hidden.
  8. 취소 클릭 → send('job/cancel') 호출, compose active면 compose id.

## 작업 F — 엔트리포인트 src/entrypoints/trackerbot-mail.ts (메인 직접)
`new TrackerbotController(document)` 다음, `controller.start()` 앞에 `new ProgressPopup(document, controller).start()`.

## 작업 G — 결정 기록 (메인 직접)
`.claude/specs/decisions.md`에 핵심 결정·기각 대안 추가.

## 완료 조건
- 위 테스트 전부 통과, 기존 panel-view/compose-view/trackerbot-* 테스트 통과, `tsc --noEmit` 통과.

> 2026-10-19 갱신: 팝업에 "완료 후: [대시보드 편집] [바로 작성]" 선택이 추가됨(이번 건만 변경, `auto-compose/choose`). 상세는 `.claude/specs/mail-edit.md`.
