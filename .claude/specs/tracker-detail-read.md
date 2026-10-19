# 트래커봇·대시보드 수집에 나라장터 상세화면 읽기 붙이기

작성일 2026-10-19. Fable 설계 기반.

## 목표
트래커봇 목록(`src/ui/trackerbot/controller.ts:263`)·대시보드 수집 테스트(`src/entrypoints/dashboard/CollectTestSection.tsx:102`)에서 시작한 수집 잡은 `html`(상세화면 값)이 없어 proposalPeriod·proposalEvalAt·projectPeriod·eligibility·differentialScoring가 항상 missing이다. 수집 잡이 스스로 SW에 요청해, SW가 비활성 탭으로 상세 페이지를 열고 기존 g2b 콘텐츠 스크립트의 `readHtmlFields` 결과를 받아 병합하게 한다. 패널 경로(`src/ui/g2b-panel/controller.ts:296`, html 동봉)의 동작은 바뀌지 않는다.

## 전제(코드로 확인됨)
- `src/entrypoints/g2b.content.ts`(matches `https://www.g2b.go.kr/*`)가 이미 `detail-page.ts`를 import하고 `g2b/detect` 등에 응답한다.
- `wxt.config.ts:15-18`에 g2b host_permission, `tabs`·`scripting` 권한이 있다. 권한 추가 없음.
- `startJob`(`src/background/job-coordinator.ts:297`)은 `serial()` 구간이다. 여기서 탭을 열면 안 된다.
- API+html은 **단일 `mergeFields` 호출**로 병합해야 한다(decisions.md 45행). 재시도 경로(`collect-job.ts` `isDone('fetch_basic')`, 123-127행 부근)는 "html이 있으면 불러온 notice에 병합"을 이미 지원한다.
- offscreen은 `chrome.tabs`를 못 쓴다. offscreen→SW 요청 패턴: `src/entrypoints/offscreen/main.ts:160` `send(type,payload,{target:'sw'})`, SW 가드: `src/background/compose-relay.ts:18` `isOffscreenSender`.
- 탭 열기·대기·닫기 참고: `src/background/naverworks-contacts.ts:39-95`. 직렬 큐 참고: `src/background/site-registry.ts:83-89`.
- `collect-job.ts:274-288`의 `fetch_html` step은 현재 '저장 중' 자리표시자.

## 하지 말 것
- `startJob`이나 `job/start` 리스너에서 탭 열기.
- html을 별도 `mergeFields`로 나중에 넣기(반드시 병합 전 확보).
- `chrome.scripting.executeScript({func: readHtmlFields})`(import 직렬화 불가).
- `ref.detailUrl`을 검증 없이 `tabs.create`에 넣기 → `detailUrlOf` 통과분만.
- 사용자가 열어 둔 g2b 탭 재사용·닫기. `active: true`로 열기.
- 읽기 실패를 completed로 숨기거나 failed로 올리기(→ partial).
- `readHtmlFields`의 `isVisible`을 우회.
- 이 명세 범위 밖 구조 변경. 필요하면 중단·보고.

## 작업

### 1. `src/adapters/g2b/link.ts` — `detailUrlOf`
`export function detailUrlOf(ref: Pick<NoticeRef,'kind'|'noticeNo'|'round'|'detailUrl'>): string | null`
- `ref.kind`가 있고 `'bid'`가 아니면 null.
- `ref.detailUrl`이 있고 `parseG2bLink(detailUrl)?.kind==='bid'`면 그 정규화 URL.
- 아니면 `https://www.g2b.go.kr/link/PNPE027_01/single/?bidPbancNo=<noticeNo>[&bidPbancOrd=<round>]`(round 없으면 생략). 생성 URL도 `parseG2bLink`로 재검증, 실패/kind!=='bid'면 null.

### 2. `src/messaging/protocol.ts` — 메시지 2개
```ts
// SW → g2b 탭 CS (target 'content')
| { type: 'g2b/read-html'; payload: { noticeNo: string; round?: string };
    response: { detected: <detectDetail 반환형> | null; match: boolean; html: HtmlFields | null; readyState: DocumentReadyState } }
// offscreen → SW (target 'sw', isOffscreenSender 가드)
| { type: 'g2b/read-detail'; payload: { jobId: string };
    response: { html: HtmlFields; elapsedMs: { detect: number; stable: number } } }
```
실패는 기존 BusError 방식으로 `code`를 실어 throw. 코드: `DETAIL_TIMEOUT`(match 없음), `DETAIL_TAB_CLOSED`, `DETAIL_REDIRECTED`(호스트가 www.g2b.go.kr 이탈), `DETAIL_CANCELLED`(잡이 ACTIVE 아님), `DETAIL_NO_URL`, `DETAIL_READ_FAILED`(그 외).
`JobRequest.html`·`JobRunPayload.html`은 그대로.

### 3. `src/entrypoints/g2b.content.ts` — `g2b/read-html` 리스너
`listen('g2b/read-html', ...,'content')` 1회 등록. `detectDetail(document,{url: location.href})`; `match = detected && detected.noticeNo===noticeNo && (!round || !detected.round || detected.round===round)`; match면 `readHtmlFields(document,{isVisible: defaultIsVisible})`, 아니면 html null. `readyState: document.readyState`. DOM 쓰기 없음. PanelController는 건드리지 않음.

### 4. 신규 `src/background/detail-reader.ts`
```ts
export interface DetailReaderDeps {
  tabs: Pick<typeof chrome.tabs, 'create'|'get'|'remove'|'onRemoved'>;
  windows: Pick<typeof chrome.windows, 'getLastFocused'>;
  sendToTab: typeof sendToTab;            // 기존 bus 함수
  getJob: (id: string) => Promise<Job | undefined>;
  now?: () => number; sleep?: (ms: number) => Promise<void>;
  pollMs?: number /*700*/; settleMs?: number /*1500*/; timeoutMs?: number /*45_000*/;
}
export function setDetailReaderDeps(d: Partial<DetailReaderDeps>): void;   // 테스트 주입
export function readDetail(jobId: string): Promise<ResponseOf<'g2b/read-detail'>>;
export function registerDetailReader(): void; // listen('g2b/read-detail', (p,s)=>{ isOffscreenSender 가드; return readDetail(p.jobId) }, 'sw')
```
- 모듈 전역 promise chain으로 **동시 1개 FIFO**. 45초 상한은 항목 시작부터(큐 대기 제외).
- 항목 시작: `getJob` 없음/비ACTIVE → `DETAIL_CANCELLED`(탭 생성 안 함). `detailUrlOf(job.ref)` null → `DETAIL_NO_URL`.
- 탭: `tabs.create({ windowId, url, active:false, openerTabId? })`. windowId = `job.originTabId`가 있으면 `tabs.get(originTabId).windowId`(실패 시 `windows.getLastFocused()`), 같은 창일 때만 `openerTabId: originTabId`.
- `onRemoved`로 닫힘 감지 → `DETAIL_TAB_CLOSED`.
- 폴링(pollMs 간격) 매 틱: `tabs.get` URL 호스트가 www.g2b.go.kr 아니면 `DETAIL_REDIRECTED`(로딩 중 about:blank/빈 URL은 무시); `getJob` 비ACTIVE면 `DETAIL_CANCELLED`; `sendToTab(tabId,'g2b/read-html',{noticeNo,round},{timeoutMs:2000})`. 수신자 없음/타임아웃 오류는 일시 상태로 보고 계속.
- 완료 판정: match가 처음 true가 된 시점 이후 (a) 연속 2회 `JSON.stringify(html.fields)` 동일 **그리고** (b) 첫 match 후 settleMs 경과 → 성공. timeoutMs 도달 시 match가 한 번이라도 있었으면 마지막 스냅샷으로 성공, 없으면 `DETAIL_TIMEOUT`.
- `elapsedMs.detect`=시작→첫 match, `stable`=시작→성공.
- `finally`: 항상 `tabs.remove`(이미 닫혔으면 무시) + `onRemoved` 리스너 해제.

### 5. `src/entrypoints/background.ts`
다른 `register*` 옆에 `registerDetailReader()` 호출.

### 6. `src/engine/jobs/collect-job.ts`
- `CollectJobDeps`에 `readDetail?: (jobId: string) => Promise<HtmlFields>` 추가.
- 로컬 `let html = input.html; let detailError: JobError | undefined;`
- 헬퍼 `acquireHtml()`:
  - html 있음 → `step('fetch_html','done','화면값 전달됨')`.
  - `!src.acceptsHtml || !deps.readDetail` → `step('fetch_html','skipped', !src.acceptsHtml ? '상세화면 대상 아님' : '상세화면 읽기 건너뜀')`.
  - 그 외 → `step('fetch_html','running','상세화면 읽는 중')` → 성공 시 `html = 결과`, `step('fetch_html','done','상세화면 읽기 완료')`. 실패 시 code = e.code가 `DETAIL_`로 시작하면 그것, 아니면 `DETAIL_READ_FAILED`. `DETAIL_CANCELLED`이거나 `deps.signal?.aborted`면 잡은 기존 취소 경로대로 `cancelled` 반환(에러 기록 없음). 그 외 `detailError={code,message,step:'fetch_html',retryable:true}`, `step('fetch_html','failed',message)`.
- 호출 위치: (1) 재시도 분기에서 notice 로드 후 `if (!isDone('fetch_html')) await acquireHtml()` → 그 뒤 기존 "html 있으면 병합" 코드. (2) 신규 조회 분기에서 `src.fetch` 성공 직후, `mergeFields` 전.
- 끝부분(274-288행 부근)의 `fetch_html` '저장 중' running emit과 '저장 완료' done/skipped emit, `current='fetch_html'` 지정 제거. 저장 예외 귀속은 기존 toError 흐름 유지.
- partial 조건·`collect.errors`에 detailError 포함(`failedAtts.length || extractError || detailError`). 반환 error 우선순위: extractError → detailError.

### 7. `src/entrypoints/offscreen/main.ts` `runCollect`
deps에 `readDetail: async (jobId) => (await send('g2b/read-detail',{jobId},{target:'sw',timeoutMs:240_000})).html`.

### 8. `src/core/types/job.ts:12` `HandoffReason`에 `'detail_failed'` 추가.
### 9. `src/core/model/handoff.ts`
REASONS·LABELS에 `detail_failed: '상세화면 읽기 실패'`. `decideHandoff` partial 분기에서 EXTRACT 검사 다음, `collect_failed` 폴백 전에 `job.errors.some(e=>e.code.startsWith('DETAIL_'))`면 `detail_failed` 추가.

### 10. `src/ui/g2b-panel/panel-view.ts:43` `COLLECT_STEP_LABEL.fetch_html` → `'상세화면 읽는 중'`.

### 11. `src/adapters/g2b/detail-page.ts:169` 사업기간 정규식에 용역기간 추가: `/사업기간|계약기간|용역기간/`.

### 12. `.claude/specs/decisions.md` 끝에 "2026-10-19 트래커봇/대시보드 수집의 상세화면 읽기" 항목 추가: 확보 방식(비활성 탭+기존 CS 폴링), 책임 계층(collect-job fetch_html 요청, SW detail-reader), 실패=partial·retryable, 동시 1 FIFO·45s, 탭 배치(active:false, originTabId 창), 렌더 판정(2회 동일+1.5s). 기각 대안: offscreen 내부 JSON fetch(엔드포인트 미확인), offscreen iframe(XFO·가시성 미확인), 최소화 창(포커스 깜빡임), 사용자 탭 재사용(경합), startJob 선처리(serial 블로킹), executeScript func(import 불가).

## 테스트 (기존 폴더 관례, vitest)
- `tests/g2b/link.test.ts` `detailUrlOf`: detailUrl 있는 bid → 정규화 URL / 번호+round → 생성 URL / round 없음 → ord 생략 / prespec·orderplan kind → null / 비g2b detailUrl → 생성 URL로 대체.
- 신규 `tests/background/detail-reader.test.ts`(deps 주입, fake timers 또는 주입 now/sleep): (1) 2회 동일+1.5s 후 성공, remove 1회 (2) match 없음 45s → DETAIL_TIMEOUT, 탭 닫힘 (3) onRemoved → DETAIL_TAB_CLOSED (4) 폴링 중 잡 취소 → DETAIL_CANCELLED, 탭 닫힘 (5) URL 호스트 변경 → DETAIL_REDIRECTED (6) 동시 2요청 → 두 번째 create는 첫 remove 이후 (7) 수신자 없음 3회 후 응답 → 성공 (8) 매 틱 다른 스냅샷 → 45s에 마지막 스냅샷으로 성공 (9) 큐 대기 중 잡 취소 → create 없이 DETAIL_CANCELLED (10) originTabId 창 사용 / 없으면 lastFocused.
- `tests/engine/collect-job.test.ts` 추가: (1) html 없음+bid+readDetail → 호출, 병합 결과에 projectPeriod 등 반영, fetch_html done (2) DETAIL_TIMEOUT throw → partial, collect.errors[0].code==='DETAIL_TIMEOUT', fetch_html failed, 나머지 step 정상 (3) DETAIL_CANCELLED → cancelled (4) html 제공 → 미호출, done (5) prespec → 미호출, skipped (6) readDetail 미주입 → skipped (7) 재시도 fetch_basic done·fetch_html pending → 호출·병합 (8) 재시도 fetch_html done → 미호출. 기존 테스트 중 끝의 '저장 완료' emit 기대는 수정.
- `tests/core/handoff.test.ts`(없으면 기존 handoff 테스트 위치): partial + DETAIL_TIMEOUT → review, reasons `['detail_failed']`.
- `tests/g2b/detail-page.test.ts`: 용역기간 셀/입력 → projectPeriod 1건.

## 완료 조건
- `cd C:/workspace/bidMate && npx tsc --noEmit` 통과.
- `cd C:/workspace/bidMate && npm test` 전체 통과. **반드시 대문자 `C:` 경로로 cd 후 실행**(소문자 c: cwd면 vitest가 전 파일 실패하는 환경 문제).

## 보고 형식 (한국어)
변경 파일:줄범위 목록, 명세와 다르게 한 점과 이유, 테스트 결과(개수), 미해결·의심 사항.
