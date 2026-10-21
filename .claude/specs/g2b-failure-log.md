# 나라장터 연동 실패 기록 (g2b-failure-log)

설계: fable-advisor, 2026-10-21. 결정 요약은 `.claude/specs/decisions.md` 같은 날짜 항목.

## 목표
나라장터(g2b)와 통신하는 모든 흐름의 **최종 실패**를 요약 레코드로 남기고, 대시보드 "개발자 진단"의 새 탭 "실패 기록"에서 본다.
응답 본문은 저장하지 않는다. 서비스키는 가린다.

## 배경 사실 (설계 전제)
- 평가 가져오기: 대시보드/패널 → SW `eval/collect`(`src/background/eval-collector.ts` `collect`) → `fetchEvalViaTab` → g2b 탭 CS `g2b/eval-fetch`(`src/entrypoints/g2b.content.ts:56`) → `src/adapters/g2b/eval-fetch.ts` `fetchEvalRaw`(6단계 POST). CS는 `BusError(code, "[단계 N] message")`만 던져 HTTP 상태·엔드포인트·ErrorMsg가 SW에 구조화되어 오지 않는다. 탭 종류는 `fetchRawOnce` 안에서만 안다.
- 평가 저장: SW → offscreen `eval/save` → `src/engine/evaluation/eval-api.ts` `saveEval` → `fetchOfficialResult`(OpenAPI). 실패는 warnings에 묻힌다.
- 낙찰 결과: SW `result-scheduler.ts` `refreshResults` → offscreen `result/run` → `src/engine/results/result-tracker.ts` `run()` → `fetchOpening/fetchAward`(`award-api.ts` → `openapi.ts` `fetchJsonOp`). 건별 실패는 `judge()`로 흡수되거나 backfill에서 `continue`로 사라진다. `result/probe`는 `result-probe.ts` `probeResult`.
- 공고 수집: offscreen `collect-job.ts`에서 `fetchNotice/fetchPrespec`(OpenAPI), 첨부 다운로드. 상세화면 읽기는 SW `detail-reader.ts` `readOne`. 잡 종료는 SW `job-coordinator.ts`가 `addFinalListener`(53줄 부근)로 외부에 알린다. `redactError`(181줄 부근)가 `JobError.detail`을 지운다.
- 서비스키 테스트: `router.ts` `relayG2bTest` → offscreen `g2b/test`.
- `openapi.ts` `fetchJsonOp`의 `err()`는 message에 `HTTP 503 (op)`처럼 문자열로만 넣는다. `JobError`에는 `detail?: unknown` 필드가 이미 있다.
- `bus.ts`: `Reply.error`는 `{code, message, path?}`. `toErrorReply`가 `path`를 보존하는 전례가 있다.
- offscreen은 chrome.storage를 못 쓴다(`protocol.ts:39` 주석). SW 저장소 쓰기는 모듈별 serial 체인으로 직렬화(`job-coordinator.ts:70` 패턴).
- 대시보드 구독 관례: `chrome.storage.get` + `onChanged`(`src/ui/hooks/useJobLog.ts`).
- 테스트 관례: 모듈별 `setXxxDeps` 주입, `vi.stubGlobal('chrome', { runtime: { id } })` 같은 부분 스텁. **새 모듈은 `chrome.storage`가 없어도 절대 throw하면 안 된다.**
- vitest는 반드시 대문자 드라이브 `C:\workspace\bidMate`에서 실행(소문자 `c:`면 전부 실패).

## 핵심 결정
| # | 결정 |
|---|---|
| D1 | 기록자는 SW 단일. 저장은 `src/background/g2b-failures.ts`만. offscreen은 `diag/g2b-failure` 메시지, CS는 기존 오류 응답에 `detail`, 대시보드는 읽기만(지우기는 메시지) |
| D2 | `chrome.storage.local` 단일 키 `g2bFailures` = `{ v: 1, items: G2bFailure[] }` 최신 먼저, 최대 300건, `lastAt` 30일 지난 건 쓰기 시 정리 |
| D3 | 흐름 6종: `eval` / `result` / `collect` / `detail` / `attachment` / `key-test` |
| D4 | 최종 실패만 기록. 재시도 중 일시 상태(NO_RECEIVER 폴링 등)는 기록 안 함 |
| D5 | 제외 코드: `EVAL_NO_RESULT`, `EVAL_CANCELLED`, `JOB_CANCELLED`, `DETAIL_CANCELLED`, `EVAL_BAD_REF`, `RESULT_BAD_REF`, `SENDER_FORBIDDEN`, `NEEDS_FS_PERMISSION` |
| D6 | 버스 `Reply.error.detail` 추가(직렬화 2KB 상한), `BusError` 4번째 인자 `detail`. SW는 화이트리스트(`normalizeFailure`)로만 읽음 |
| D7 | OpenAPI 쪽은 `JobError.detail`에 `{ httpStatus?, operation, g2bMsg? }`. 잡 ledger는 기존대로 detail을 버림(collect 흐름은 message만) |
| D8 | collect·attachment는 SW `addFinalListener`에서 잡 스냅샷으로 파생(job-coordinator·collect-job 무수정). detail은 detail-reader가 직접 |
| D9 | 최신 항목과 flow·stage·code·noticeNo·round·message가 같으면 합산(`count++`, `lastAt` 갱신) |
| D10 | UI: 흐름 필터, 텍스트 복사, 지우기, 행 펼치기. 그 이상 없음 |

---

## 단계 A — 코어·버스·프로토콜

### A1. `src/core/diagnostics/g2b-failure.ts` (새, 순수 함수만, chrome 의존 없음)
```ts
export const G2B_FAILURES_KEY = 'g2bFailures';
export const G2B_FAILURES_MAX = 300;
export const G2B_FAILURES_MAX_AGE_MS = 30 * 86_400_000;
export const G2B_FLOWS = ['eval', 'result', 'collect', 'detail', 'attachment', 'key-test'] as const;
export type G2bFlow = (typeof G2B_FLOWS)[number];
export const G2B_FLOW_LABEL: Record<G2bFlow, string> = { eval: '평가점수 가져오기', result: '낙찰 결과 조회', collect: '공고정보 조회', detail: '상세화면 읽기', attachment: '첨부파일 다운로드', 'key-test': '서비스키 테스트' };
export const G2B_TAB_PATHS = ['own', 'reused', 'reused-reloaded', 'created', 'created-fallback'] as const;
export type G2bTabPath = (typeof G2B_TAB_PATHS)[number];
export const G2B_TAB_LABEL: Record<G2bTabPath, string> = { own: '요청한 탭', reused: '열린 탭', 'reused-reloaded': '열린 탭(새로고침)', created: '새 탭', 'created-fallback': '새 탭(기존 탭 복구 실패)' };

export interface G2bFailureInput {
  flow: G2bFlow;
  stage: string;        // eval: 'tab'|'fetch'|'save'|'official' / result: 'opening'|'award'|'run'|'probe' / collect: 'fetch_basic'|'prespec' / detail: 'read' / attachment: 'download' / key-test: 'bid'|'prespec'
  code: string; message: string;
  noticeNo?: string; round?: string; noticeId?: string; jobId?: string;
  step?: number;        // eval 1~6
  httpStatus?: number; endpoint?: string; g2bMsg?: string;
  tab?: G2bTabPath; ms?: number;
  trigger?: string;     // 'dashboard'|'panel'|'probe'|'probe-noid'|'list'|'follow'|'manual'|'alarm'|'eval-save' 등
}
export interface G2bFailure extends G2bFailureInput { id: string; at: ISODate; lastAt: ISODate; count: number }
export interface G2bFailureFile { v: 1; items: G2bFailure[] }   // 최신 먼저
```
`ISODate`는 `src/core/types/common`, `Job`·`CollectResult`는 `src/core/types/job`.

함수:
- `SKIP_CODES: ReadonlySet<string>` = D5 목록.
- `normalizeFailure(raw: unknown, redact: (s: string) => string): G2bFailureInput | null`
  - 비객체, `flow`가 `G2B_FLOWS` 밖, `code`·`stage`·`message`가 문자열이 아님 → null. `code`가 SKIP_CODES → null.
  - 알려진 키만 복사(스프레드 금지).
  - message·g2bMsg·endpoint에 `redact` 적용 후 자르기. 길이: stage 40, code 60, message 300, endpoint 120, g2bMsg 200, noticeNo 20, round 5, noticeId 40, jobId 60, trigger 20.
  - 숫자는 유한 정수만: step 1..9, httpStatus 100..599, ms ≥ 0. 범위 밖이면 키 제거. tab은 `G2B_TAB_PATHS` 안만.
- `appendFailures(file: G2bFailureFile | undefined, inputs: G2bFailureInput[], now: Date, newId: () => string): G2bFailureFile`
  - `file`이 없거나 `v !== 1`이거나 `items`가 배열이 아니면 빈 파일로 시작.
  - 입력을 순서대로: `items[0]`과 flow·stage·code·noticeNo·round·message가 모두 같으면 `count++`, `lastAt = now`(at 유지). 아니면 `{ ...input, id: newId(), at: now, lastAt: now, count: 1 }`을 앞에 넣는다(나중 입력이 items[0]).
  - 끝에 `lastAt < now - MAX_AGE` 제거, `slice(0, MAX)`.
- `failuresFromJob(job: Job): G2bFailureInput[]`
  - `job.type`이 `'collect' | 'download_retry'`가 아니거나 `status`가 `'failed' | 'partial'`이 아니면 [].
  - (a) `job.errors[0]`이 있고 `step === 'fetch_basic'`이고 code가 `G2B_` 또는 `PRESPEC_`로 시작 → `{ flow: 'collect', stage: code.startsWith('PRESPEC_') ? 'prespec' : 'fetch_basic', code, message }`.
  - (b) `(job.result as CollectResult)?.attachments` 중 `status`가 `'failed' | 'size_mismatch'`인 것이 있으면 1건 `{ flow: 'attachment', stage: 'download', code: 'ATTACH_FAILED', message: \`${n}건 실패: ${name}: ${error ?? status}; …\` }`.
  - 공통: `noticeNo/round`는 `job.ref`, `noticeId`, `jobId: job.id`. `fetch_html`·`extract` 오류는 무시.
- `formatFailures(items: G2bFailure[]): string` — 한 줄/건 `YYYY-MM-DD HH:mm:ss | flow/stage | noticeNo-round | code | 단계n | HTTP nnn | tab | message | g2b: … | endpoint | ×count`. 없는 필드는 칸 생략, `\n` 결합.

### A2. `src/messaging/protocol.ts`
- `Reply.error`: `{ code: string; message: string; path?: string; detail?: Record<string, unknown> }`.
- `Msg`에 추가:
  ```ts
  | { type: 'diag/g2b-failure'; payload: { failures: G2bFailureInput[] }; response: void }  // offscreen→SW 전용, 1회 50건 상한
  | { type: 'diag/g2b-failures-clear'; payload: void; response: void }                     // 대시보드→SW
  ```

### A3. `src/messaging/bus.ts`
- `BusError` 생성자 `(code, message, path?, detail?: Record<string, unknown>)`, `public detail?`.
- `toErrorReply`: `detail`이 평범한 객체(`object`, 비배열, 비null)이고 `JSON.stringify(detail).length <= 2000`(stringify 실패 시 제외)일 때만 포함. **없으면 키 자체를 넣지 않는다**(기존 `toEqual` 테스트 보호).
- `send`·`sendToTab`: `new BusError(reply.error.code, reply.error.message, reply.error.path, reply.error.detail)`.

### A4. `src/adapters/g2b/eval-fetch.ts`
- `StepError`에 `extra: { endpoint: string; httpStatus?: number; g2bMsg?: string }`(생성자 4번째 인자, 기본 `{ endpoint: '' }`).
- `EvalFetchResult` 실패형 error에 `endpoint?`, `httpStatus?`, `g2bMsg?` 추가.
- `call` 안 `const endpoint = ep.path`. 응답을 받은 뒤 던지는 모든 StepError(로그인, 해석 실패, HTTP 오류, ErrorCode≠0)에 `{ endpoint, httpStatus: res.status, g2bMsg: msg || undefined }`. 401/403 분기는 parse 전이므로 g2bMsg 없이. 응답 전 실패(전체 시간 초과, 취소, 타임아웃, 네트워크)는 `{ endpoint }`만.
- 바깥 catch에서 `error`에 `e.extra`를 합친다(undefined 필드는 넣지 않음). catch-all(StepError 아님)은 변경 없음.

### A5. `src/adapters/g2b/openapi.ts`
- `export interface G2bErrorDetail { httpStatus?: number; operation?: string; g2bMsg?: string }`, `export function g2bDetailOf(e: JobError): G2bErrorDetail`(detail이 평범한 객체면 세 키만 타입 검사해 복사, 아니면 `{}`).
- `parseResponse`의 error 변형에 `g2bMsg?: string`: cmmMsgHeader 분기는 `msg`, resultCode≠00 분기는 `String(header.resultMsg ?? '')`, 그 외 없음.
- `err()`에 마지막 인자 `detail?: G2bErrorDetail`(있을 때만 키 포함). `fetchJsonOp`: 네트워크 catch `{ operation }`, 비JSON HTTP 오류 `{ httpStatus: status, operation }`, parse 오류 `{ httpStatus: status, operation, g2bMsg }`.
- `fetchNotice`의 `G2B_KEY_MISSING`·`G2B_NOT_FOUND`, `prespec-api.ts`·`award-api.ts`·`open-result-api.ts`의 자체 err는 변경 없음.

### C1. `src/entrypoints/g2b.content.ts:56-60` (A3·A4 이후)
실패 시:
```ts
const { code, message, step, endpoint, httpStatus, g2bMsg } = r.error;
throw new BusError(code, `[단계 ${step}] ${message}`, undefined, { step, ...(endpoint ? { endpoint } : {}), ...(httpStatus !== undefined ? { httpStatus } : {}), ...(g2bMsg ? { g2bMsg } : {}) });
```
`[단계 N]` 접두 유지(`splitStep`·`withStep` 호환).

---

## 단계 B — SW 기록 모듈 (A 이후)

### B1. `src/background/g2b-failures.ts` (새)
```ts
export interface G2bFailuresDeps {
  storage: { get(key: string): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> };
  now?: () => Date; newId?: () => string; readServiceKey?: () => Promise<string | undefined>;
}
export function setG2bFailuresDeps(d: Partial<G2bFailuresDeps>): void;
export function recordG2bFailure(input: G2bFailureInput | G2bFailureInput[]): Promise<void>;
export function clearG2bFailures(): Promise<void>;
export function registerG2bFailures(): void;
```
- 기본 deps: `chrome.storage.local`, `new Date()`, `crypto.randomUUID`, `secrets.g2bServiceKey` 읽기. `globalThis.chrome?.storage?.local`이 없으면 `recordG2bFailure`는 조용히 resolve.
- `recordG2bFailure`: 모듈 serial 체인(`chain = chain.catch(() => undefined).then(fn)`) 안에서 `normalizeFailure`(redact = `redactKey(s, key)`) → 빈 배열이면 쓰기 생략 → `get(KEY)` → `appendFailures` → `set`. **모든 예외를 삼킨다(reject 금지).**
- `clearG2bFailures`: 같은 체인에서 `set({ [KEY]: { v: 1, items: [] } })`.
- `registerG2bFailures`:
  - `listen('diag/g2b-failure', (p, sender) => { if (!isOffscreenSender(sender)) throw new BusError('SENDER_FORBIDDEN', '허용되지 않은 발신자입니다.'); const list = Array.isArray(p?.failures) ? p.failures.slice(0, 50) : []; void recordG2bFailure(list); }, 'sw')` — 기록 완료를 기다리지 않고 즉시 응답.
  - `listen('diag/g2b-failures-clear', (_, sender) => { assertExtensionSender(sender); return clearG2bFailures(); }, 'sw')`.
  - `addFinalListener((job) => { void recordG2bFailure(failuresFromJob(job)); })`.
- import: `isOffscreenSender`·`assertExtensionSender`·`addFinalListener`는 `./job-coordinator`, `redactKey`는 `../adapters/g2b/openapi`. (이름이 다르면 같은 역할의 기존 export를 쓰고 보고)

### B2. `src/entrypoints/background.ts`
`registerG2bFailures()`를 `registerRouter()` 직후 호출.

---

## 단계 C — 각 흐름 연결

모든 `recordG2bFailure` 호출은 `void`로 fire-and-forget. 흐름을 기다리게 하지 않는다.

### C2. `src/background/eval-collector.ts` (B 이후)
- `fetchEvalViaTab(sender, ref, opts: { withoutIdHeaders?: boolean; trigger?: string } = {})`로 변경. 기존 2인자 호출 호환. `probe`는 `{ withoutIdHeaders, trigger: p.withoutIdHeaders ? 'probe-noid' : 'probe' }`, `collect`는 `{ trigger: senderKind(sender) === 'g2b' ? 'panel' : 'dashboard' }`.
- `interface FetchMeta { tab?: G2bTabPath }`. `fetchRawOnce(sender, ref, withoutIdHeaders, meta)`가 채운다: 획득 탭 kind → `meta.tab`(`own`/`reused`/`created`). `sendWithRecovery`의 `onSwitch`를 `onEvent: (e: { kind: 'reloaded' } | { kind: 'switched'; tab: AcquiredTab }) => void`로 바꿔, 새로고침 성공 뒤 `last()` 전에 `{kind:'reloaded'}` → `meta.tab = 'reused-reloaded'`; 새 탭 생성 시 `{kind:'switched', tab}` → 기존 처리(`tab = t; keep = false`) + `meta.tab = 'created-fallback'`.
- `fetchEvalViaTab`: `const meta: FetchMeta = {}; const t0 = d.now(); const p = chain.then(() => fetchRawOnce(...)).catch((e) => { void recordG2bFailure(evalFailureOf(e, ref, meta, d.now() - t0, opts.trigger)); throw e; });` 체인 처리는 기존대로.
- `evalFailureOf`: code = `e.code ?? 'INTERNAL'`; `detail = e.detail ?? {}`; `splitStep(e.message)`; stage는 code가 `EVAL_TAB_FAILED`·`EVAL_TAB_TIMEOUT`·`EVAL_CS_UNREACHABLE`이면 `'tab'`, 아니면 `'fetch'`; `step = detail.step(숫자) ?? splitStep의 step`; endpoint·httpStatus·g2bMsg는 detail에서 타입 검사해 복사; `tab: meta.tab`, `noticeNo`, `round`, `ms`, `trigger`.
- `collect()`의 `eval/save` 호출을 try/catch로 감싸 실패 시 `{ flow: 'eval', stage: 'save', code, message, noticeNo, round, trigger }` 기록 후 rethrow.

### C3. `src/background/detail-reader.ts` (B 이후)
- `readOne(jobId, requestedAt, meta: { noticeNo?: string; round?: string })`; noticeNo·round를 알게 된 직후 meta에 채운다.
- `readDetail`: `chain.then(() => readOne(..., meta)).catch((e) => { if (code !== 'DETAIL_CANCELLED') void recordG2bFailure({ flow: 'detail', stage: 'read', code: 문자열이면 code 아니면 'DETAIL_READ_FAILED', message, jobId, ...meta, ms }); throw e; })`. `now`는 `injected.now ?? Date.now`.

### C4. `src/background/result-scheduler.ts` `refreshResults` (B 이후)
- 응답 `r.error`가 있으면 `{ flow: 'result', stage: 'run', code: 'RESULT_RUN_FAILED', message: r.error, trigger: reason }`.
- 바깥 catch: `{ flow: 'result', stage: 'run', code: 문자열이면 code 아니면 'INTERNAL', message: redactKey(...), trigger: reason }`.
- `skipped`(NO_KEY·NO_BIZNO·THROTTLED·BUSY·NO_FS·KEY_INVALID)는 기록 안 함.

### C5. `src/background/router.ts` `relayG2bTest` (B 이후)
`!r.ok && r.error`면 `{ flow: 'key-test', stage: payload?.kind === 'prespec' ? 'prespec' : 'bid', code: r.error.code, message: r.error.message, trigger: 'manual' }`.

### C6. `src/engine/results/result-tracker.ts` (A 이후)
- `ResultTrackerDeps.onFailure?: (f: G2bFailureInput) => void`.
- 헬퍼 `fail(stage: 'opening' | 'award', e: IndexEntry, err: JobError)` → `{ flow: 'result', stage, code, message, noticeNo, round, noticeId, endpoint: g2bDetailOf(err).operation, httpStatus, g2bMsg, trigger: mode }`(undefined 키 생략). `try { deps.onFailure?.(…) } catch {}`로 감싼다.
- 호출: 개찰 조회 실패 시(키 오류 break 전), 낙찰 조회 실패 시, backfill의 개찰 실패 시.

### C7. `src/engine/results/result-probe.ts` (A 이후)
`probeResult(noticeNo, serviceKey, fetchFn = 기존 기본값, onFailure?)`. `toPart`가 `!r.ok`일 때 `onFailure?.({ flow: 'result', stage: 'probe', code, message, noticeNo, endpoint: g2bDetailOf(err).operation, httpStatus, g2bMsg, trigger: 'probe' })`.

### C8. `src/engine/evaluation/eval-api.ts` `saveEval` (A 이후)
`SaveEvalOpts.onFailure?`. 공식 결과 조회 실패 분기에서 `{ flow: 'eval', stage: 'official', code, message, noticeNo, round, trigger: 'eval-save', endpoint/httpStatus/g2bMsg ← g2bDetailOf }`. 기존 warning 유지.

### C9. `src/entrypoints/offscreen/main.ts` (C6~C8 이후)
- `const reportG2bFailure = (f: G2bFailureInput) => { void send('diag/g2b-failure', { failures: [f] }, { target: 'sw', timeoutMs: 5_000 }).catch(() => undefined); };`
- `eval/save` → `saveEval(..., { onFailure: reportG2bFailure })`, `result/run` deps에 `onFailure`, `result/probe` → `probeResult(noticeNo, serviceKey ?? '', undefined, reportG2bFailure)`.
- **await 금지.**

---

## 단계 D — UI (A 이후)

### D1. `src/ui/hooks/useG2bFailures.ts` (새)
`useG2bFailures(): G2bFailure[]`. `chrome.storage.local.get(G2B_FAILURES_KEY)` 초기화 + `onChanged`(area `'local'`, 키 일치). `useJobLog.ts`와 같은 구조. 파일 형태가 아니면 [].

### D2. `src/entrypoints/dashboard/diagnostics/G2bFailuresTool.tsx` (새)
- 상태: `flow: G2bFlow | ''`, `copied: boolean`.
- 상단: 설명 한 줄 "나라장터와 통신하다 실패한 기록입니다. 응답 본문은 저장하지 않습니다. 최근 300건, 30일 보관." + 오른쪽에 `Select`(옵션 `''`=전체 + `G2B_FLOWS`/`G2B_FLOW_LABEL`, `aria-label="흐름"`), `Button variant="secondary" icon={<Copy/>}` "복사"(필터 결과 `formatFailures` → clipboard, 성공 시 2초 "복사됨"), `Button variant="secondary" icon={<Trash2/>}` "지우기"(`window.confirm('실패 기록을 모두 지울까요?')` 뒤 `send('diag/g2b-failures-clear', undefined)`). 목록이 비면 둘 다 disabled.
- 목록(최신 먼저) 얇은 행:
  - 첫 줄: 시각 `HH:mm:ss`(오늘이 아니면 `MM-DD HH:mm:ss`, `title`에 ISO 전체), `StatusBadge status="error"`에 흐름 라벨, stage(+`단계 n`), `noticeNo-round`(font-mono), code(font-mono), `HTTP nnn`, 탭 라벨, `×count`(count>1). 없는 필드는 생략.
  - 둘째 줄: message(`wrap-anywhere`).
  - `RawDetails summary="자세히"`(`./parts`) 안에 endpoint·g2bMsg·trigger·jobId·noticeId·ms·at/lastAt `dl`.
- 비었을 때 `EmptyState title="실패 기록이 없습니다"`.
- 컴포넌트: `Button, EmptyState, Select, StatusBadge`는 `../../../ui/components`, 아이콘 `lucide-react`. 주변 진단 도구(EvalProbeTool 등)의 간격·글자 크기 관례를 따른다.

### D3. `src/entrypoints/dashboard/diagnostics/DiagnosticsPanel.tsx`
`TOOLS` 맨 뒤에 `{ id: 'failures', label: '실패 기록', Tool: G2bFailuresTool }`. 31줄 부근 주석 "셋 다" → "모두".

### D4. `src/entrypoints/dashboard/evaluations/EvalAutoDock.tsx`
실패 목록 아래 `text-xs text-muted` 한 줄: "자세한 원인은 설정 > 개발자 진단 > 실패 기록에서 볼 수 있습니다." (링크 없음)

---

## 금지·주의
- `g2bFailures` 키를 `g2b-failures.ts` 외에서 쓰지 않는다(대시보드 직접 set 금지 — 경쟁으로 지운 항목 부활).
- 기록 모듈은 어떤 경우에도 reject·throw 금지. 깨지면 eval-collector·detail-reader·router·result-scheduler 기존 테스트가 연쇄 실패.
- final listener에서 `fetch_html`(DETAIL_*)·`extract`·`OFFSCREEN_ERROR`·`DISK_FULL` 기록 금지.
- `job-coordinator` `redactError` 수정 금지.
- 버스 `detail`·offscreen 페이로드를 스프레드로 레코드에 넣지 않는다. 반드시 `normalizeFailure`.
- `[단계 N]` 접두 제거 금지.
- `diag/g2b-failure` 리스너의 `isOffscreenSender` 검사 필수.
- 범위 밖 구조 변경이 필요해 보이면 멈추고 보고.

---

## 위임 단위와 순서
| 단위 | 내용 | 선행 |
|---|---|---|
| U1 | A1 + A2 + A3 | — |
| U2 | A4 + A5 + C1 | U1(C1이 BusError 4번째 인자 사용) |
| U3 | B1 + B2 | U1 |
| U4 | C2 + C3 + C4 + C5 | U2, U3 |
| U5 | C6 + C7 + C8 + C9 | U2, U3 |
| U6 | D1 + D2 + D3 + D4 | U1 (U3의 clear 메시지 타입은 A2에서 정의됨) |

U4·U5·U6은 대상 파일이 겹치지 않아 병렬 가능.

## 테스트 항목

`tests/core/g2b-failure.test.ts` (U1)
- normalize: flow 밖·필수 누락·비객체 → null / SKIP_CODES 각각 → null / 자르기(message 300, g2bMsg 200, endpoint 120) / step 0·10·소수 제거, httpStatus 99·600 제거 / 알 수 없는 키 제거 / redact 적용(message·g2bMsg·endpoint) / tab 값 검증.
- append: 빈 파일 1건 → count 1, at=lastAt / 동일 키 연속 → count 2, lastAt 갱신, at 유지 / 공고번호만 다르면 2건 / v 다름·items 비배열 → 초기화 / 301건째 가장 오래된 것 탈락 / 31일 지난 항목 제거 / 나중 입력이 items[0].
- failuresFromJob: completed → [] / failed+fetch_basic+G2B_NOT_FOUND → collect/fetch_basic(noticeNo·round·jobId) / partial+PRESPEC_FETCH_FAILED → collect/prespec / fetch_html DETAIL_TIMEOUT → [] / 첨부 2건 실패 → attachment 1건(두 파일명) / compose 잡 → [] / download_retry 첨부 실패 → attachment.
- formatFailures: 칸 생략, ×count 표기.

`tests/messaging/bus.test.ts` 추가 (U1)
- toErrorReply: 평범 객체 detail 포함 / 배열·문자열·2KB 초과 → 키 없음 / send가 detail을 BusError.detail로 복원.

`tests/g2b/eval-fetch.test.ts` 추가 (U2)
- HTTP 422+ErrorMsg → `{ code: 'EVAL_API_ERROR', step: 1, httpStatus: 422, endpoint: EVAL_ENDPOINTS.open.path, g2bMsg }` / 403 → EVAL_NOT_LOGGED_IN + httpStatus 403 + endpoint / 네트워크 throw·타임아웃 → endpoint만.

openapi 테스트 추가 (U2)
- 비JSON 503 → detail `{ httpStatus: 503, operation }` / cmmMsgHeader 오류 → g2bMsg=errMsg / resultCode≠00 → g2bMsg=resultMsg / `g2bDetailOf` 비객체 → `{}`.

`tests/background/g2b-failures.test.ts` (U3)
- 주입 storage로 record → set 1회, items[0] 형태 / 연속 record 직렬 / storage.get throw → resolve, 이후 정상 / chrome 미정의 → resolve / `diag/g2b-failure`: offscreen OK, 대시보드 SENDER_FORBIDDEN, 51건 → 50건 / clear: 확장 OK, g2b 탭 거부, 빈 파일 set / final listener: failed collect 잡 → record.

`tests/background/eval-collector.test.ts` 추가 (U4, `vi.mock('../../src/background/g2b-failures')`)
- CS가 `BusError('EVAL_API_ERROR', '[단계 1] HTTP 422: x', undefined, { step: 1, httpStatus: 422, endpoint: '/ep', g2bMsg: 'x' })` → record `{ flow: 'eval', stage: 'fetch', step: 1, httpStatus: 422, endpoint: '/ep', g2bMsg: 'x', tab: 'reused', trigger: 'dashboard', noticeNo, round }` (collect 경유) / 새로고침 뒤 성공 → 미호출 / 새로고침 뒤 실패 → tab 'reused-reloaded' / 새 탭 폴백 뒤 실패 → 'created-fallback' / EVAL_CS_UNREACHABLE → stage 'tab' / probe → trigger 'probe' / eval/save throw → stage 'save' / g2b 발신 collect → trigger 'panel', tab 'own'.

`tests/background/detail-reader.test.ts` 추가 (U4): DETAIL_TIMEOUT → record `{ flow: 'detail', jobId, noticeNo, round, ms }` / DETAIL_CANCELLED → 미호출.
`tests/background/result-scheduler.test.ts` 추가 (U4): r.error → stage run, trigger reason / skipped만 → 미호출.
`tests/background/router.test.ts` 추가 (U4): g2b/test `{ok:false}` → key-test.
result-tracker 테스트 추가 (U5): opening 실패 → onFailure 1회(noticeId·endpoint) / award 실패 → stage award / onFailure throw해도 run 완료.
eval-api 테스트 추가 (U5): official 실패 → onFailure stage 'official', warning 유지.
(테스트 파일이 해당 경로에 없으면 기존 관례 위치를 찾아 추가하고 보고)

## 완료 조건
- 위 테스트 추가분 통과, 기존 테스트 전체 통과, `tsc --noEmit` 통과, 빌드 통과.
- 수동 확인(사용자): 로그아웃 상태 평가 가져오기 → 실패 기록 탭에 EVAL_NOT_LOGGED_IN·HTTP·endpoint·탭 종류·단계 표시 / 같은 공고 2회 실패 → ×2 / 복사 텍스트에 서비스키 없음 / 지우기 후 새 실패 정상 기록 / 브라우저 재시작 후 유지.

## 보고 형식 (각 단위)
- 변경 파일과 줄 범위, 명세와 다르게 한 점과 이유, 추가 테스트 목록, 실행한 테스트 결과. 한국어로 작성.
