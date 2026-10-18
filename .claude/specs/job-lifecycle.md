# 수집 잡 생명주기/동시성 재설계 (Fable, 2026-10-17)

배경: 시간 기반 stale 판정/SW 선판정 때문에 동시 실행/상태 덮어쓰기 회귀가 반복됨. 병합 규칙(`src/core/model/merge.ts`)은 범위 밖(메인이 별도 수정 완료).

## 0. 원칙
- **실행 중 여부의 권위 = offscreen `JobRegistry`(메모리) 한 곳.** 입장(admission) 검사의 1차이자 유일한 위치. SW의 `findActiveConflict`/`findStale`는 삭제.
- **SW `storage.session` ledger = UI용 미러 + 이력.** 모든 쓰기는 SW `serial()` 안. ledger가 active라도 offscreen이 모르면 그 잡은 죽은 것(→ `interrupted`).
- **시간 기반 판정 폐기**: heartbeat/STALE 없음. `updatedAt`은 표시용.
- `job/start` 처리(ensureOffscreen → ledger queued → `job/run` 왕복 → ledger 확정 → 정합)는 **처음부터 끝까지 한 serial 구간**. 정합(reconcile)도 serial 안.
- 취소 중 도착한 finish가 completed/partial이면 그대로 채택(cancelling은 종결 아님).
- cancelling 탈출구는 타임아웃이 아니라 사용자 명시 강제 중단(`force`) = `chrome.offscreen.closeDocument()`.

## 1. 상태와 전이
상태: `queued | running | cancelling | completed | partial | failed | cancelled | interrupted`
- ACTIVE = {queued, running, cancelling}
- FINAL = {completed, partial, failed, cancelled}: progress/finish로 절대 덮어쓰지 않음. 벗어나는 길은 `retryOf`(attempt+1)뿐.
- `interrupted`: 준종결. attempt가 일치하는 늦은 finish만 덮어쓸 수 있음. retry 가능.

| from | to | 트리거 |
|---|---|---|
| – | queued | `job/start` ledger 선기록 |
| queued | running | `job/run` 응답 `accepted:true` |
| queued | (ledger에서 삭제) | `job/run` 응답 `accepted:false` → 호출자에 `JOB_ALREADY_RUNNING`+conflictJobId |
| queued | failed(OFFSCREEN_ERROR, retryable) | `job/run` 전송 실패/타임아웃 |
| queued/running | cancelling | `job/cancel` → offscreen `job/abort` 응답 `known:true` |
| queued/running | cancelled | `job/cancel` → offscreen 없음 / `known:false` / 전송 실패 |
| running/cancelling | completed/partial/failed/cancelled | `job/finish`(attempt 일치). cancelling에서도 finish status 그대로 |
| queued/running/cancelling | interrupted | 정합: offscreen 없음 / `job/status`/`job/run` 응답 active에 없음 / force로 offscreen 종료(대상 외 잡) |
| cancelling | cancelled | `job/cancel {force:true}` → closeDocument 후 |
| interrupted | completed/partial/failed/cancelled | 늦은 `job/finish`(attempt 일치) |
| interrupted/partial/failed/cancelled | queued | `retryOf`(attempt+1, done step 유지) |

SW 메시지 수용 규칙:
- `job/progress`: cur ∈ ACTIVE 이고 `p.attempt === cur.attempt`일 때만. cur가 cancelling이면 status 유지(running으로 되돌리지 않음). 아니면 무시.
- `job/finish`: `f.attempt === cur.attempt` 이고 cur ∈ ACTIVE ∪ {interrupted}일 때만. 그 외(FINAL/없음) 무시.

## 2. 중복 실행 방지
- offscreen `job/run` 수신 즉시 **동기적으로** 검사(등록 전 await 금지). 레지스트리에 같은 jobId가 있거나 `jobsConflict(기존, 신규)`가 참이면 거부(conflictJobId). 통과하면 등록 후 응답, 실행은 `setTimeout(run, 0)`.
- `jobsConflict(a, b)`: 같은 타입군(collect/download_retry/extract = 공고 쓰기군 / compose = 별도군)이고 `refsConflict`(noticeNo 같고 round 미지정/동일) 또는 noticeId 동일. 위치: `src/core/model/job-conflict.ts`(offscreen이 `background/`를 import하지 않게).
- 등록 해제: 러너 Promise settle 직후, **finish 전송 전**. finish는 ack될 때까지 1s 간격 3회 재시도.
- SW 시작(`registerCoordinator`)에서 `reconcile()`: ledger ACTIVE 잡이 있고 offscreen 없음 → 전부 interrupted / 있음 → `job/status` 질의 후 목록에 없는 것만 interrupted / 질의 실패 → 변화 없음.
- offscreen `main.ts` 로드 끝에 `engine/ready` 송신 → SW `reconcile()`(serial 안에서 그 시점에 질의. "새로 떴으니 비었다"고 가정 금지).
- 매 start: `job/run` 응답 `active`로 정합 — ledger ACTIVE 중 id ∉ active이고 지금 시작한 잡이 아닌 것 → interrupted.
- `JOB_STALE`/`STALE_MS`/`findStale`/`findActiveConflict` 삭제.

## 3. 메시지 프로토콜 (`src/messaging/protocol.ts`)
```ts
// 변경
| { type: 'job/run'; payload: JobRunPayload;
    response: { accepted: true; active: ActiveJob[] }
            | { accepted: false; code: 'JOB_ALREADY_RUNNING'; conflictJobId: string; active: ActiveJob[] } }
| { type: 'job/cancel'; payload: { jobId: string; force?: boolean }; response: { status: JobStatus } }  // UI→SW
| { type: 'job/finish'; payload: { jobId: string; attempt: number; status: JobStatus; result?: unknown; error?: JobError }; response: void }
| { type: 'job/progress'; payload: JobProgress; response: void }
// 추가
| { type: 'job/abort';  payload: { jobId: string }; response: { known: boolean } }         // SW→offscreen
| { type: 'job/status'; payload: { jobIds?: string[] }; response: { active: ActiveJob[] } }  // SW→offscreen
export interface ActiveJob { jobId: string; attempt: number }
```
`src/core/types/job.ts`:
```ts
export type JobStatus = 'queued'|'running'|'cancelling'|'completed'|'partial'|'failed'|'cancelled'|'interrupted';
export interface JobProgress { jobId: string; attempt: number; step: StepId; status: StepState['status'];
  progress?: StepState['progress']; bytes?: { received: number; total: number | null; name?: string }; label: string; }
```
`engine/ready`는 offscreen이 실제로 보내도록 한다.

## 4. 진행률
- bytes 진행: 다운로더 `bytes` 이벤트를 collect-job에서 **잡당 1초 trailing throttle**로 `job/progress`(step `download_attachments`, status `running`, `progress:{done,total}` 유지, `bytes:{received,total,name}`) 전송. 파일 완료(`done`)는 throttle 없이 즉시, 대기 중 bytes는 버림. 주기 `deps.progressIntervalMs`(기본 1000, 테스트 주입).
- SW `onProgress`는 bytes도 ledger에 기록. 라벨 예: `첨부파일 다운로드 중 (1/4), 제안요청서.hwp 12.3MB/45.6MB`.

## 5. 취소 전파
offscreen은 jobId당 AbortController 하나를 모든 하위 호출에 전달. abort 후 모든 러너는 "진행 중인 단일 단계의 타임아웃 이내"에 반환.
- `fetchNotice`: `G2bContext.signal?: AbortSignal`. 각 operation의 15s 타이머와 합성(`AbortSignal.any` 또는 리스너 수동 연결). catch에서 외부 signal aborted면 `JOB_CANCELLED`(retryable:false) 반환/루프 탈출. 루프 머리에서도 확인. 타이머 abort는 기존 `G2B_NETWORK`.
- `collect-job`: 시작 직후/fetch_basic 후/fetch_html 저장 전에 `signal.aborted` 확인 → `cancelled`. `JOB_CANCELLED` → `{status:'cancelled'}`. 짧은 로컬 저장(NoticeStore)은 중단하지 않고 끝냄.
- `downloader`: backoff `sleep`을 abort 가능하게(abort 시 즉시 `CancelledError`).
- compose(후속 계약, 지금 구현 안 함): `runComposeJob(input, {signal, emit})`. 릴레이 대기마다 signal과 race, abort 시 SW 경유 `compose/abort {jobId}`를 CS로. 탭은 닫지 않음.
- SW `cancelJob(jobId, force)` (serial):
  1. cur ∉ ACTIVE → 현재 status 반환(no-op).
  2. force 아님: offscreen 없음 → cancelled. 있음 → `job/abort`. `known:false`/실패 → cancelled. `known:true` → cancelling.
  3. force:true(UI는 cancelling 상태에서만 노출): `chrome.offscreen.closeDocument()` → 대상 cancelled, 그 외 ACTIVE 전부 interrupted.

## 6. 파일 단위 변경
- `src/background/job-dedup.ts` 삭제. `refsConflict` → `src/core/model/job-conflict.ts`로 이동 + `jobsConflict(a: Pick<Job,'type'|'ref'|'noticeId'>, b)`. 테스트 `tests/background/job-dedup.test.ts` → `tests/core/job-conflict.test.ts`(stale 테스트 삭제, collect vs compose 비충돌 추가).
- `src/core/types/job.ts`, `src/messaging/protocol.ts`: §3.
- `src/engine/jobs/job-registry.ts` 신규(순수): `class JobRegistry { tryRegister(job): {ok:true}|{ok:false;conflictJobId}; signal(jobId): AbortSignal; abort(jobId): boolean; release(jobId): void; active(): ActiveJob[] }`.
- `src/entrypoints/offscreen/main.ts`: controllers Map → JobRegistry. `job/run`: tryRegister → 거부 즉시 응답 / 수락 `{accepted:true, active}` 후 `setTimeout(run,0)`. run 종료 → release → finish(attempt 포함, ack 실패 시 1s×3). `job/abort`/`job/status` 리스너. 로드 끝 `engine/ready` 송신.
- `src/background/job-coordinator.ts`: startJob 전체를 한 serial로. `onProgress`/`onFinish` attempt 가드/FINAL 보호/cancelling 유지/interrupted 수용. `markInterruptedIfOrphaned` → `reconcile()`. `engine/ready` 리스너. `cancelJob` §5. STALE 전부 삭제. 테스트를 위해 `storage`/`send`/`offscreen` 3개 의존성을 모듈 setter로 주입 가능하게.
- `src/adapters/g2b/openapi.ts`: signal 합성, `JOB_CANCELLED`.
- `src/engine/jobs/collect-job.ts`: signal 전달/경계 확인/bytes throttle/모든 emit에 `attempt`.
- `src/engine/downloader/downloader.ts`: backoff sleep abort 가능화만.
- `src/entrypoints/dashboard/CollectTestSection.tsx`: cancelling 표시(amber, "취소 중…"), cancelling에서만 [강제 중단](force) 버튼, 진행 라벨에 bytes 표시.

금지: SW ledger로 충돌 선판정 / engine/ready를 "레지스트리 비었음"으로 해석 / job/run 등록 전 await / release를 finish ack 이후로 미룸 / cancelling 타임아웃 / cancelling 때문에 finish status를 cancelled로 바꿈 / merge.ts 수정.

## 7. 테스트 시나리오 (vitest)
1. JobRegistry: 같은 jobId 재등록 거부 / 같은 noticeNo(round 미지정) 거부 / round 다르면 수락 / collect vs compose 같은 공고 수락 / release 후 수락 / abort known 반환 / active에 attempt 포함.
2. job-conflict: 기존 케이스 + 타입군.
3. collect-job 취소: fetch_basic 중 abort(지연 fake fetch) → cancelled, fetch 호출 수 1 / download 중 abort → cancelled, notice.json 저장됨 / bytes throttle: 1초 내 bytes N개 → progress 1~2회, done 즉시.
4. downloader: backoff 대기 중 abort → sleep 끝나기 전 CancelledError.
5. fetchNotice: 외부 abort → JOB_CANCELLED, 타이머 abort → G2B_NETWORK.
6. job-coordinator(fake 주입):
   - progress/finish attempt 불일치 무시 / FINAL에 finish 무시 / interrupted + attempt 일치 finish 수용 / cancelling 중 progress가 running으로 안 되돌림 / cancelling 중 finish completed → completed
   - start: accepted:false → ledger에 잡 안 남고 JOB_ALREADY_RUNNING+conflictJobId / accepted:true, active:[]인데 ledger에 다른 running → 그 잡 interrupted
   - reconcile: offscreen 없음 → 전부 interrupted / 일부만 활성 → 나머지만 / 질의 실패 → 변화 없음
   - cancel: known:false → cancelled / known:true → cancelling / force → closeDocument 호출 + 대상 cancelled + 나머지 interrupted

수동(확장 로드): 큰 첨부 중 같은 공고 start → JOB_ALREADY_RUNNING, bytes 1초 갱신 / fetch_basic 중 취소 → 수 초 내 cancelled, 직후 재시작 시 요청 두 벌 없음 / 다운로드 중 취소 → 부분 파일 없음, retry 시 skip / SW stop → 잡 상태 유지 / 확장 리로드 → interrupted, retry 재개 / 강제 중단.
