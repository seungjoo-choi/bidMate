# 수집 완료 후 팝업에서 고르기(afterCollect 'ask')

## 목표
자동 작성이 켜져 있을 때, 수집 중에는 '완료 후' 선택 버튼을 보이지 않는다. 설정이 'ask'(새 기본값)면 수집이 끝난 뒤 진행 팝업의 끝난 항목에 [대시보드 편집] [바로 작성]을 띄우고, 사용자가 누를 때만 진행한다. 기존 'dashboard'·'compose' 자동 모드는 그대로 둔다.

## 이미 반영됨(메인)
- `src/core/types/settings.ts`: `AfterCollect = 'dashboard' | 'compose' | 'ask'`
- `src/core/types/job.ts`: `Handoff`에 `| { action: 'ask'; at: ISODate }`
- 진행 팝업의 끝난 항목에는 이미 `ProgressItem.actions`(최대 2칸, 첫 칸이 주 버튼)가 있고, 클릭하면 `on.action(key, id)` → `controller.onAction(key, id)`로 간다(progress-view.ts `settledActions`, progress-card.ts `acts`, progress-popup.ts).

## 불변 조건
- 사이트 CS(트래커봇)가 `job/start compose`를 보내는 경로를 만들지 않는다. compose 시작은 SW `applyVerdict`만 한다.
- `JobRequest.auto`는 SW 내부 전용으로 유지한다. `assertRetryAllowed`(job-coordinator.ts)의 compose 금지도 유지한다.
- `job-coordinator.ts`, `router.ts`는 수정하지 않는다.
- 저장된 설정을 변환하지 않는다(얕은 병합, 마이그레이션 없음).
- ask 상태에는 타임아웃이나 자동 해소를 넣지 않는다.
- 같은 작업 트리의 다른 세션이 대상 파일 다수를 미커밋으로 수정 중이다. 전체 파일 재작성이나 포맷 변경은 하지 않고, 필요한 부분만 정확히 치환한다.

## 단계 1: core/background (implementer A)
1. `src/core/model/default-settings.ts`: `autoCompose.afterCollect` 기본값 `'compose'`를 `'ask'`로.
2. `src/core/model/handoff.ts`: `Verdict`에 `| { kind: 'ask' }` 추가. `(job.afterCollect ?? s.afterCollect) === 'dashboard'` 줄을 다음으로 교체한다. needsReview 계산은 그 앞에 그대로 두고, 이후 already_composed·needsReview·compose 분기는 바꾸지 않는다.
   ```ts
   const mode = job.afterCollect ?? s.afterCollect;
   if (mode === 'dashboard') return needsReview ? { kind: 'review', reasons: ['needs_review'] } : { kind: 'edit' };
   if (mode === 'ask') return needsReview ? { kind: 'review', reasons: ['needs_review'] } : { kind: 'ask' };
   ```
3. `src/background/auto-compose.ts`:
   - `handleCollect`의 판정 적용 본문을 `async function applyVerdict(job: Job, verdict: Verdict): Promise<void>`로 분리한다.
     - 호출자가 이미 `q()` 안에 있다고 가정한다. 안에서 `q()`를 부르지 않고, compose 분기의 `await q(async () => {...})` 래핑은 벗긴다(파일 상단 q 주석 규칙).
     - `verdict.kind === 'ask'`면 `d.setHandoff(job.id, { action: 'ask', at: d.now() })`.
     - noticeId 없음 검사는 ask에도 적용한다(no_notice).
   - `handleCollect`는 `if (job.handoff) return; const verdict = decideHandoff(...); if (!verdict) return; await q(() => applyVerdict(job, verdict));` 형태로 줄인다.
   - 신설 `export function resolveChoice(collectJobId: string, value: 'dashboard' | 'compose'): Promise<boolean>`.
     - `q()` 안에서 getJob을 하고, `type === 'collect'`이고 `handoff?.action === 'ask'`가 아니면 false.
     - `decideHandoff({ ...job, afterCollect: value }, 현재 settings.autoCompose)`가 null이면 false.
     - 아니면 `applyVerdict(job, verdict)` 후 true.
   - `auto-compose/choose` 리스너는 발신자 검사를 그대로 두고, 그 뒤를 다음으로 바꾼다. 응답은 handoff 기록(edit면 openDashboard, compose면 enqueue와 pump)이 끝난 뒤 돌려준다.
     ```ts
     if (await deps().setAfterCollect(collectJobId, afterCollect)) return { applied: true }; // ACTIVE면 종전 동작
     if (afterCollect === 'ask') return { applied: false };
     return { applied: await resolveChoice(collectJobId, afterCollect) };
     ```
   - 금지: resolveChoice에서 handleCollect를 재호출하지 않는다(`if (job.handoff) return` 가드에 걸린다).
4. `src/messaging/protocol.ts`: `auto-compose/choose` 주석만 "ACTIVE collect면 스냅샷 변경, handoff ask 대기 중이면 즉시 해소"로 갱신.
5. 테스트
   - `tests/core/handoff.test.ts`
     - ask 모드 completed → `{kind:'ask'}`
     - needsReview면 review가 우선
     - mailStatus가 delivered여도 ask
     - `job.afterCollect:'compose'`가 설정 ask보다 우선
     - disabled면 skip
   - `tests/background/auto-compose.test.ts`
     1. onFinal ask → handoff `{action:'ask'}`, openDashboard·startJob·permissions 미호출
     2. ask 잡에 choose 'compose' → 권한 검사, 큐 적재, startJob, handoff compose started
     3. choose 'dashboard' → openDashboard `#/mail/<id>?from=collect`, handoff edit
     4. 같은 잡에 choose 2회 → 두 번째는 `applied:false`
     5. handoff가 edit·none·compose인 끝난 잡에 choose → false
     6. 끝난 잡에 'ask' → false
     7. ACTIVE 잡에 choose → 종전처럼 setAfterCollect
     8. 발신자 검사 유지
     9. 설정 disabled 상태에서 choose 'compose' → handoff none/disabled
   - 기본값 테스트(있으면): 기본 afterCollect가 'ask'.

## 단계 2: UI (implementer B)
1. `src/ui/handoff-view.ts`
   - `HandoffView.kind`에 `'ask'` 추가.
   - `h.action === 'ask'` → `{ kind: 'ask', text: '수집 완료. 대시보드에서 편집하거나 바로 작성할 수 있습니다', tone: 'info', action: 'open-mail', actionLabel: '편집', ...base }`. 같은 파일의 다른 분기 형태를 따른다.
2. `src/ui/trackerbot/row-view.ts`: `switch (h.kind)`에 `case 'ask':`를 추가한다. 결과는 `edit`과 같게 `{ kind: 'done', label: '수집 완료', tone: 'ok', canRetry: false, detail: tip, ...act }`.
3. `src/ui/trackerbot/controller.ts`
   - `export type PopupChoiceAction = 'choose-dashboard' | 'choose-compose';`
   - `export const handoffAsk = (job?: Job | null) => job?.handoff?.action === 'ask';` (기존 handoffQueued 옆, 같은 형태로)
   - `chooseAfterCollect(key, value: 'dashboard' | 'compose')`의 조건을 `job.type === 'collect' && (isActive(job) || handoffAsk(job))`로 바꾼다.
   - `onAction`의 인자 타입에 `PopupChoiceAction`을 추가한다. `'choose-dashboard'` → `chooseAfterCollect(key, 'dashboard')`, `'choose-compose'` → `chooseAfterCollect(key, 'compose')`.
4. `src/ui/trackerbot/progress-view.ts`
   - `ProgressItem.choice`, `activeItem`의 choice 스프레드, `AfterCollect` import를 삭제한다.
   - `ProgressActionId`에 `PopupChoiceAction`을 추가한다.
   - `ProgressItem.awaiting?: true`를 추가한다(끝났지만 사용자 선택 대기, 자동 소멸 제외).
   - `settledActions`에 entry를 받는다. `rv.kind === 'done' && handoffAsk(entry.job)`이면 `[{ id: 'choose-dashboard', label: '대시보드 편집' }, { id: 'choose-compose', label: '바로 작성' }]`를 반환하고, 그 항목에 `awaiting: true`를 붙인다.
5. `src/ui/trackerbot/progress-card.ts`
   - `on.choose` 콜백과 choice·choiceDash·choiceCompose 노드를 삭제한다.
   - `.choice`, `.choice-label`, `.act[aria-pressed]` CSS와 updateNode의 choice 관련 줄, `AfterCollect` import도 삭제한다.
6. `src/ui/trackerbot/progress-popup.ts`
   - `choose` 콜백을 삭제한다.
   - seen 기준을 `isActive(e.job) || handoffQueued(e.job) || handoffAsk(e.job)`로 바꾼다. 새로고침 뒤에도 ask 항목이 다시 보이게 하기 위해서다.
   - 자동 소멸 대상(okKeys)을 `i.state === 'ok' && !i.awaiting`으로 바꾼다.
   - 클래스 주석의 동작 목록에 '완료 후 선택'을 추가한다.
7. `src/entrypoints/dashboard/AutoComposeCard.tsx`
   - `AFTER` 맨 앞에 `{ id: 'ask', label: '수집이 끝나면 진행 팝업에서 고르기(대시보드 편집 / 바로 작성)' }`를 추가한다.
   - "수집 중에는 … 이번 건만 바꿀 수 있습니다" 도움말을 다음으로 바꾼다: "'고르기'면 웹메일 화면 오른쪽 아래 진행 팝업에 [대시보드 편집] [바로 작성] 버튼이 나옵니다. 나라장터 패널이나 대시보드에서 수집한 건은 대시보드 메일 준비 화면에서 이어 갑니다."
   - 토글 라벨: "수집 완료 후 메일 작성으로 이어가기"
   - description: "수집이 끝나면 고른 동작(팝업에서 고르기 / 대시보드 편집 / 바로 작성)을 합니다. 끄면 이 연결과 검수 화면 이동이 모두 꺼집니다."
8. 테스트
   - `tests/ui/handoff-view.test.ts`, `tests/ui/trackerbot-row-view.test.ts`: ask → done '수집 완료' ok, action open-mail '편집'.
   - `tests/ui/trackerbot-progress-view.test.ts`
     - choice 테스트 삭제
     - 끝난 ask 항목 → actions 2개(choose-dashboard, choose-compose), `awaiting:true`, state ok
     - handoff가 edit·compose면 awaiting 없음
   - `tests/ui/trackerbot-progress-card.test.ts`: choice 테스트 삭제. actions 2개를 그리고, 클릭하면 `on.action(key, 'choose-compose')`.
   - `tests/ui/trackerbot-progress-popup.test.ts`
     - choose 관련 테스트를 "끝난 ask 항목의 버튼 클릭 → `auto-compose/choose` 후 `job/get`"으로 교체
     - ask 항목은 8초 뒤에도 닫히지 않음
     - 시작 시 seen에 없던 ask handoff 잡도 보임
     - 닫기 뒤에는 숨김
   - `tests/ui/trackerbot-controller.test.ts`
     - 끝난 ask 잡에서는 choose 전송을 허용하고, edit 잡에서는 무시
     - onAction 'choose-dashboard' → choose 호출

## 완료 조건
`npx tsc --noEmit` 통과, 관련 테스트 통과.
