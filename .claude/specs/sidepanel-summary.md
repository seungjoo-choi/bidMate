# 사이드 패널 공고 요약과 수집 기록

## 목표
- 나라장터 상세화면에서 이미 수집한 공고면 화면 오른쪽 아래 플로팅 패널에 초록 "수집 완료 D-n [요약 보기]" 칩을 보이고, 누르면 사이드 패널이 열려 그 공고 요약이 나온다.
- 사이드 패널은 공고 요약이 주인공이고, 그 아래 수집 과정 기록(타임라인)을 접어 둔다. 수집 중이면 기록이 펼쳐진 채 쌓이고 값이 나온 단계 아래에 값을 바로 붙인다.
- 개인정보(담당자 이름, 전화)는 요약과 기록 어디에도 넣지 않는다.

확정 목업: `/private/tmp/claude-501/-Users-seungjoochoi-workspace-bidMate/1152e340-2bcf-46a8-833c-f8eecdf4e1f7/scratchpad/sidepanel-history.html` (claude.ai 아티팩트 1tcX1aqGd1Yuxv4RvMKvzw)

## 단계와 의존
| 단계 | 내용 | 선행 |
|---|---|---|
| S0 | 칩에서 사이드 패널 열기 실험 | 없음 |
| S1 | 타입, 요약 함수, SW 기록(jobLog), useJobs/useJobLog | 없음 |
| S2 | 엔진 이벤트(파일 start/end, facts, ms) | S1 |
| S3 | NoticeLookup 확장과 화면 칩 | S0 |
| S4 | 사이드 패널 화면 재구성 | S1, S2, S3 |
| S5 | (선택) 세션 기록이 없는 공고의 정적 기록 | S4 |

---

## S0. 칩에서 사이드 패널 열기 실험
- `src/messaging/protocol.ts`: `ui/open` payload `page` 유니언에 `'sidepanel'` 추가.
- `src/background/router.ts` `registerUiMessages`의 `ui/open` 핸들러 첫 분기, 어떤 await보다 앞에서 `chrome.sidePanel.open({ tabId: sender.tab.id })`. 탭 id가 없으면 code `NO_TAB` 오류.
- `src/ui/g2b-panel/controller.ts`: `openSidePanel()` 추가. 실패 메시지는 `startError`가 아닌 별도 `sidePanelError` 상태.
- `src/ui/g2b-panel/Panel.tsx` idle 칩 onClick 임시 연결.
- 판정: 나라장터 상세화면에서 칩 클릭 시 패널이 열리면 통과. "user gesture" 오류면 실패.
- 실패 시 1차: `ui/open`의 sidepanel 분기만 `chrome.runtime.onMessage.addListener`로 동기 등록(bus.listen은 `Promise.resolve().then`으로 한 틱 늦게 부름, bus.ts:90). 주석 필수.
- 그래도 실패: 사용자 결정. 대안 A는 `setPanelBehavior({ openPanelOnActionClick: true })`로 툴바 아이콘이 사이드 패널을 열게 하고 칩은 안내만(팝업 사라짐).
- `open({ windowId })`가 아니라 `open({ tabId })`를 쓴다.

### S0 결과 (2026-10-19 확정)
- Gmail 트래커봇 메일의 "수집 완료" 버튼 클릭 → `ui/open {page:'sidepanel'}` → 패널 열림 확인. 칩/버튼에서 직접 여는 방식으로 간다(대안 A 미사용).
- 이미 반영된 코드: `bus.listen` 핸들러 동기 시작(src/messaging/bus.ts), router `ui/open` sidepanel 분기, g2b-panel `openSidePanel`/`sidePanelError`, 트래커봇 `RowSubAction`에 `'sidepanel'`과 done 버튼 클릭(src/ui/trackerbot/row-button.ts).

## 사이드 패널이 보여 줄 공고 (Gmail 등 나라장터 밖 탭 포함)
- `ui/open {page:'sidepanel', noticeId?}`: SW는 `const p = chrome.sidePanel.open({ tabId })`를 어떤 await보다 먼저 호출한 뒤, noticeId가 있으면 `storage.session`의 `sidepanel.focus = { noticeId, tabId, at }`를 쓰고 `await p`.
- 트래커봇 `onAction('sidepanel')`은 그 행의 noticeId(`handoffView(...)?.noticeId ?? key`, 기존 open-review와 같은 계산)를 함께 보낸다. g2b 칩은 noticeId를 보내지 않는다(사이드 패널이 탭에서 감지).
- 사이드 패널 선택 순서:
  1. 활성 탭이 나라장터이고 상세화면 공고가 감지되면 그 공고
  2. 아니면 `sidepanel.focus.tabId === 활성 탭 id`인 focus의 noticeId
  3. 아니면 진행 중(ACTIVE)인 collect/download_retry 잡
  4. 아니면 가장 최근 collect/download_retry 잡
- 2~4에서 수집 중 잡이 생기면(같은 탭 origin) 그 잡이 우선한다: 즉 진행 중 잡이 있으면 3이 2보다 앞선다. 최종 순서는 1, 3, 2, 4.
- 선택 결과의 noticeId로 요약(`notice/get`)과 기록(`useJobLog`)을 그린다. 공고가 없으면 "나라장터 공고나 트래커봇 메일에서 수집 완료를 누르면 요약이 나옵니다" 빈 상태.

## S1. 타입과 SW 기록
### 타입 (`src/core/types/job.ts`)
```ts
export type LogStep = StepId | 'handoff';
export type JobEventBase = { seq: number; at: ISODate; attempt: number };
export type JobEvent = JobEventBase & (
  | { kind: 'attempt'; label: string }
  | { kind: 'step'; step: StepId; status: 'running' | 'done' | 'failed' | 'skipped'; label: string; ms?: number; error?: JobError }
  | { kind: 'file'; step: 'download_attachments' | 'extract'; phase: 'start' | 'end';
      file: { id: string; name: string; size: number | null }; status?: string; ms?: number; error?: string }
  | { kind: 'note'; step: LogStep; label: string }
  | { kind: 'facts'; step: 'fetch_basic' | 'extract'; facts: BasicFacts | EvalFacts }
  | { kind: 'handoff'; handoff: Handoff }
  | { kind: 'finish'; status: JobStatus; error?: JobError }
);
export interface JobLog { jobId: string; seq: number; events: JobEvent[] }
export type ProgressEvent =
  | { kind: 'file'; step: 'download_attachments' | 'extract'; phase: 'start' | 'end'; file: { id: string; name: string; size: number | null }; status?: string; ms?: number; error?: string }
  | { kind: 'note'; step: LogStep; label: string }
  | { kind: 'facts'; step: 'fetch_basic' | 'extract'; facts: BasicFacts | EvalFacts };
// JobProgress에 추가: event?: ProgressEvent; ms?: number
```
- `JobProgress.ms`는 엔진이 잰 단계 소요. 있으면 SW 시계 대신 쓴다(fetch_basic의 running~done 사이에 상세화면 읽기가 끼어 SW 시계로는 부풀려짐).

### 요약 함수 (`src/core/model/notice-summary.ts`, 신규)
```ts
export interface BasicFacts {
  kind: NoticeKind; noticeNo: string; round: string | null; title: string | null;
  orderingOrg: string | null; demandOrg: string | null; estimatedPrice: number | null;
  contractMethod: string | null; awardMethod: string | null; jointVentureAllowed: boolean | null;
  eligibility: string | null; projectPeriod: string | null; bidCloseAt: string | null; openingAt: string | null;
  attachmentCount: number;
  prespec?: { opinionCloseAt: string | null; assignedBudget: number | null; bizDivision: string | null };
}
export type EvalFactKey = 'performanceScore' | 'managementScore' | 'credibilityScore' | 'performancePeriod' | 'performanceMinAmount' | 'differentialScoring';
export interface EvalFactItem { value: unknown; status: FieldStatus; needsCheck: boolean }
export interface EvalFacts { items: Record<EvalFactKey, EvalFactItem>; reviewCount: number; conflictCount: number; extractionStatus: ExtractionStatus }
export function basicFacts(n: Notice): BasicFacts;
export function evalFacts(n: Notice, x: Extraction | null): EvalFacts;
```
- 열거된 키만 읽는다. `officerName`, `officerTel`, `customFields`, `sourceUrl`은 읽지 않는다(개인정보 제외 지점).
- `needsCheck`: `notice.evaluation[k].status`가 `needs_review` 또는 `missing`이면 true, `user_edited`와 `verified`는 false.
- `reviewCountOf/conflictCountOf`는 `src/engine/extraction/extract-step.ts`에서 `src/core/extraction/review-count.ts`(신규, 순수)로 옮기고 extract-step이 재export한다. 복제 금지.

### SW 기록 (`src/background/job-coordinator.ts`)
- 상수 `MAX_LOG_EVENTS = 400`, `LABEL_MAX = 200`, `MESSAGE_MAX = 300`, 키 `jobLog.<jobId>`.
- `getJobLog(id)` export. 내부 `appendLog(jobId, attempt, items)`는 `serial()` 안에서만, `putJob` 직후 호출. seq와 `at` 부여. 쓰기 실패는 try/catch로 삼키고 잡 갱신은 유지.
- 상한 초과: 가장 오래된 회차의 이벤트를 통째로 버린다. 한 회차만으로 넘치면 그 회차의 오래된 `file` 이벤트부터 버린다(step, facts, finish, handoff는 유지).
- 모든 label, error.message, file.error는 기존 `redact()`를 거친다.
- `addJob`의 drop, `deleteJob`에서 `jobLog` 키도 지운다.
- `startJob`: `addJob` 직후 `attempt` 이벤트(수집 시작/다시 시도, compose는 메일 작성 시작). 거부로 되돌릴 때 이번 attempt 이벤트 제거(신규면 키 삭제).
- `onProgress`: StepState `startedAt`(첫 running), `endedAt`(done/failed/skipped) 채움. 해당 step의 이전 status와 다를 때만 `step` 이벤트(`ms = safe.ms ?? endedAt - startedAt`). `safe.event`가 있으면 전이와 무관하게 추가. bytes만 있는 progress는 기록 안 함. 순서는 putJob, appendLog, notifyTab.
- `onFinish`: `finish` 이벤트. `setHandoff`: `handoff` 이벤트. `syncActive`, `reconcile`, `cancelJob`에서 상태를 바꾼 잡마다 `finish`(interrupted/cancelled).
- CS에 기록을 주는 메시지는 만들지 않는다.

### 훅
- `src/ui/hooks/useJobs.ts`: `get(null)` 대신 `jobIds`를 읽고 `jobs.<id>`만 get. onChanged는 `jobIds` 또는 `jobs.` 키 변경 때만 reload.
- `src/ui/hooks/useJobLog.ts`(신규): `useJobLog(jobId: string | null): JobLog | null`, 그 키만 구독.

### 테스트 (`tests/background/job-coordinator.test.ts`)
- running 반복 progress 2회 → step 이벤트 1건
- bytes만 있는 progress → 0건
- event.facts 동봉 → facts 1건, step 전이 없음
- 재시도 → attempt 2 이벤트 누적, attempt 1 유지
- 401건째 → 오래된 회차 제거
- 잡 drop 시 로그 키 remove
- `p.attempt !== cur.attempt`인 늦은 progress → 기록 없음

## S2. 엔진 이벤트
- `src/engine/downloader/downloader.ts`: `DownloadEvent.type`에 `'start'` 추가(`a.status = 'downloading'` 직후). `'done'`에 `status`, `size`(savedSize ?? expectedSize), `error?`, `ms`(첫 시도부터, 재시도 백오프 포함).
- `src/engine/jobs/collect-job.ts`:
  - `step` 헬퍼에 `extra?: Pick<JobProgress, 'event' | 'ms' | 'progress'>` 추가.
  - `fetch_basic` done에 `ms`(상세화면 읽기 구간 제외)와 `facts: basicFacts(notice)`. 재시도로 fetch_basic을 건너뛰어도 notice를 불러온 뒤 facts 1회.
  - `onEvent`: `start`는 스로틀 없이 file start 이벤트, `done`은 file end 이벤트. 기존 소비자가 `type !== 'done'`을 bytes로 취급하므로 `start` 분기 필수.
  - `saveExtractionLatest` 뒤 `facts: evalFacts(notice, extraction)`를 실은 extract done progress.
  - html 동봉 시 fetch_html 라벨 `화면값 N개 항목 전달됨`.
- `src/engine/extraction/extract-step.ts`: 첨부별 file start/end(status는 rows 중 parsed가 있으면 parsed, 아니면 rows[0].status, ms는 rows 합, error는 첫 error). zip 내부 엔트리별 이벤트 없음. 쌍둥이 폴백도 1쌍.
- 테스트: `tests/engine/collect-job.test.ts` emit 수 단언 갱신, file start/end 쌍 수 = 첨부 수, facts 2건, fetch_basic ms < readDetail 지연, prespec facts에 officer 키 없음. `tests/core/notice-summary.test.ts`(신규): 결과 키 집합 = 허용 목록(`Object.keys` 단언), needsCheck 규칙, prespec 분기.

## S3. lookup 확장과 화면 칩
- `src/messaging/protocol.ts` `NoticeLookup`에 `noticeId?`, `bidCloseAt?`, `title?`.
- `src/engine/notices/lookup.ts` `lookupInIndex`가 IndexEntry에서 채운다.
- `src/ui/g2b-panel/panel-view.ts`: idle 뷰를 `{ kind: 'idle'; buttonLabel; collected?: { tone: 'ok' | 'warn'; text: string; dday: string | null } }`로. `collectedChip`은 `collectedView(lookup, now)`로 대체(collected → 초록 수집 완료, partial/failed → 주황 일부 실패, D-day는 `src/ui/review/format.ts`의 `formatDDay`). completed 분기의 chip도 같은 타입.
- `src/ui/g2b-panel/Panel.tsx` idle 분기: collected가 있으면 알약 버튼(아이콘, 수집 완료, D-day, 안쪽 "요약 보기" 배지) onClick `ctl.openSidePanel` + 테두리 보조 "다시 수집". 없으면 기존 파란 버튼. `sidePanelError`는 note 자리에.
- `src/entrypoints/sidepanel/App.tsx`의 idle chip 사용부는 컴파일만 맞춘다.
- 테스트: `tests/ui/panel-view.test.ts` idle 3가지(수집 완료, 일부 실패, 미수집), D-day null.

## S4. 사이드 패널 화면
- `src/entrypoints/sidepanel/summary-view.ts`(신규, 순수): 상태 칩, 핵심 3칸(bid: 입찰마감 D-n, 추정가격, 낙찰방법+계약방법 / prespec: 의견등록마감, 배정예산, 사업구분), 기본 정보 6행, 평가 기준(prespec이나 추출 미실행이면 null), 첨부, 액션 정보. 서식은 `src/core/model/format.ts`와 `src/ui/review/format.ts` 재사용, 새 서식 함수 금지. null은 "-".
- `src/entrypoints/sidepanel/history-view.ts`(신규, 순수): 단계 순서 고정(상세화면 읽기, 공고정보 조회, 첨부파일 다운로드, 평가정보 추출, 후속 처리). 회차 라벨 "14:31 수집 (2회차)" + finish 상태 접미. 받는 중 파일 줄은 `job.steps[download].bytes`로 ratio. 현재 회차에 이벤트가 없고 이전에 done인 단계는 `carried`("이전 회차에서 완료"). 후속 처리는 handoff 이벤트와 compose 잡의 `composeView` 문구. 기본 펼침: completed 종결이면 접힘, 그 외와 요약이 없을 때는 펼침.
- `SummaryCard.tsx`, `HistoryCard.tsx`(신규): 목업 구조를 Tailwind 테마 토큰으로. 메일 작성은 기존 `ComposeCard` 재사용(새 compose 경로 금지), 검수는 `ui/open review`, 폴더 경로 복사는 기존 copyFolder.
- `App.tsx` 재구성: 상단 카드(종류 칩, 상태 칩, 제목, 공고번호, 수집 중 경과와 진행 막대). 취소, 강제 중단, 재시도(`g2b/retry`), 오류 액션 로직은 그대로 옮긴다. `noticeId = job?.noticeId ?? result?.noticeId ?? lookup.noticeId`로 `notice/get` → `basicFacts/evalFacts` → `summaryView`. 재조회는 noticeId 변경과 잡 종결 시. `useJobLog(job?.id)` → `historyView`. DiagnosticsSection은 맨 아래 유지.
- 테스트: `tests/ui/summary-view.test.ts`, `tests/ui/history-view.test.ts`(회차 분리, 반복 running이 줄을 늘리지 않음, carried, live ratio, 펼침 규칙 4가지, 절단 후 step/finish 유지).

## S5. (선택) 정적 기록
- `history-view.ts`에 `staticHistory(notice, extraction)`: 회차 1개 "저장된 기록", 첨부 savedAt/savedSize/lastError/attempts, 추출 files[].status/ms/error, 후속 mail.status. 기록과 잡이 모두 없을 때만 사용.

## 하지 말 것
- Job 객체에 events 넣기, 바이트 진행이나 라벨만 바뀐 running을 이벤트로 남기기
- 기록을 CS나 메시지로 전달하기(storage.session 구독만)
- notice/get 결과를 요약 함수 없이 직접 그리기
- SW 핸들러에서 sidePanel.open 앞에 다른 await 두기
- 로그 쓰기 실패가 잡 갱신을 막게 하기
- 플로팅 패널 PanelController를 사이드 패널과 공통화하기
- 사전규격 공고에 평가 기준 그리기

## 완료 조건
- 단계별 테스트 통과, `tsc --noEmit`과 전체 vitest 1회 통과
- 수동: 칩 클릭으로 사이드 패널 열림, 첨부 4건 이상 수집 시 파일별 줄과 값 표, 수집 중 늦게 열어도 지난 줄이 보임, 첨부 실패 후 재시도 시 회차 2개, 사전규격에서 담당자 정보 없음(`chrome.storage.session.get(null)`에서 officer 검색)
