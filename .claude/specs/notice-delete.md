# 수집된 공고 삭제

## 목표
대시보드에서 수집된 공고를 삭제한다. 공고 목록에서 여러 건을 골라 지우거나, 공고 상세에서 한 건을 지운다.
공고와 함께 지우는 것: 공고 폴더 전체(첨부·추출·AI 제안 포함), index 항목, 평가 기록, 낙찰 결과 추적·팔로우, RFP 비교 세션, 자동작성 대기열 항목, AI 실행 세션 키.
**메일 발송 이력은 남긴다**(공고 폴더 밖으로 옮겨 보관). RFP 업로드(`rfp/uploads/`)는 공고와 별개라 지우지 않는다.

## 배경 사실 (코드로 확인함)
- 공고 저장: `src/engine/notices/notice-store.ts` — `INDEX_PATH='index.json'`, `NOTICES_DIR='notices'`, 공고 폴더 = `IndexEntry.folder`(`notices/<연도>/<폴더>`). `withLock(INDEX_PATH)`로 index 직렬화, `editLockKey(noticeId)`로 공고 단위 락. index가 없거나 손상되면 `scan()`이 notice.json을 훑어 재생성한다.
- 발송 이력: `src/engine/mail/sent-store.ts:12` `sentPath = <folder>/mail-sent.json`(폴더 안). `mail-sent-index.json`은 캐시이며 `SentStore.scan()`(231행 부근)이 index.json의 공고만 돌며 재생성한다.
- results/follows는 결과 추적 실행 때 prune되지만 서비스키·사업자번호가 없으면 실행되지 않는다(`result-tracker.ts:44-46`).
- 테스트 fake `tests/helpers/memory-store.ts:29` `remove`는 파일 하나만 지운다. 실제 FSA(`file-store.ts:135`)는 재귀. `rfp-service.ts:224` `removeDir`가 안의 파일을 먼저 지우는 패턴.
- `EvalStore.pathOf`(eval-store.ts:8,43)는 입찰공고 id(`R\d{2}[A-Z]{2}\d{8}-\d{3}`)만 허용, 사전규격 id면 `EVAL_BAD_ID` throw.
- 잡 경합 권위: offscreen `JobRegistry`(offscreen/main.ts:100, 228 `isNoticeBusy`). extract/collect='notice'군, compose=별도군(job-conflict.ts:16). AI: `AiRunner.isRunning(noticeId)`(ai-runner.ts:44). RFP 추출 inflight: rfp-service 내부 `inflight` Map, 키 `n:<noticeId>:...`(rfp-service.ts:134-135).

## 불변 조건 (모든 단계 공통)
1. **폴더 먼저, index 나중.** index를 먼저 지우면 폴더 삭제 실패 시 재시도 불가 + scan 재생성 때 되살아난다.
2. 각 단계는 멱등: 폴더 없음·entry 없음은 성공으로 본다.
3. 폴더 삭제는 반드시 `removeTree` 사용(`store.remove(folder)` 한 번으로 끝내지 않는다).
4. 락 순서: editLockKey → SENT_INDEX_PATH → INDEX_PATH. INDEX_PATH 락 안에서 다른 락을 잡지 않는다. `archiveForDelete`는 entry를 인자로 받아 index를 읽지 않는다. RESULTS_LOCK(removeTracking)은 editLock 밖에서 잡는다.
5. 사전규격(`kind==='prespec'`)은 EvalStore.remove를 부르지 않는다.
6. 관련 기록(평가·RFP 비교·results/follows) 삭제 실패는 `console.warn`만 하고 삭제 성공으로 본다. 단 `NEEDS_FS_PERMISSION`은 전체 중단(throw).
7. `router.ts`의 EXTENSION_ONLY_TYPES에 `'notice/delete'`를 넣지 않는다(전용 모듈과 이중 등록).

## 인터페이스
```ts
// src/messaging/protocol.ts — Msg 유니온, notice/get 다음
| { type: 'notice/delete'; payload: { noticeIds: string[] }; response: NoticeDeleteResult } // 대시보드→SW→offscreen. 건별 결과
export interface NoticeDeleteResult { deleted: string[]; failed: Array<{ noticeId: string; code: string; message: string }> }
export const NOTICE_DELETE_MAX = 200;
```
`deleted`에는 원래 없던 id도 포함한다(멱등).

---

## 단계 1 — 엔진 (implementer A)

### 1-1. `src/messaging/protocol.ts`
위 인터페이스 추가.

### 1-2. `src/core/types/compose.ts`
- `SentIndexEntry`에 `noticeDeleted?: true;` (삭제 항목은 `folder: ''`).
- 추가:
```ts
export interface SentArchiveFile {
  schemaVersion: 1; noticeId: string; deletedAt: ISODate;
  entry: Pick<IndexEntry, 'kind' | 'noticeNo' | 'round' | 'title' | 'orderingOrg'>;
  records: SendRecord[];
}
```

### 1-3. 신규 `src/engine/file-store/remove-tree.ts`
```ts
/** 디렉터리 안을 먼저 지운 뒤 디렉터리를 지운다. 없으면 무시. 권한 오류만 던진다. */
export async function removeTree(store: IFileStore, dir: string): Promise<void>
```
rfp-service.ts:224-232 `removeDir`를 옮긴다. `list` 실패(없음)는 return. 마지막 `store.remove(dir)` 실패는 `NEEDS_FS_PERMISSION`만 던진다. 하위 파일 삭제 실패는 던진다(부분 실패 복구 테스트 12번 위해). rfp-service의 `removeDir`는 이 함수 호출로 교체(동작 동일).

### 1-4. `src/engine/notices/notice-store.ts` — NoticeStore 메서드 추가
- `findEntry(noticeId): Promise<IndexEntry | undefined>` — loadIndex 후 find.
- `removeFromIndex(noticeId): Promise<boolean>` — `withLock(INDEX_PATH)` 안에서 `loadIndexRaw()` → 해당 entry 제거 + 다른 entry의 `supersededBy === noticeId`면 그 필드 삭제 → `generatedAt` 갱신 → writeJson. 변화 없으면 쓰지 않고 false.

### 1-5. `src/engine/mail/sent-store.ts`
- `export const SENT_ARCHIVE_DIR = 'mail-sent-archive';`
- `export const sentArchivePath = (noticeId: string) => \`${SENT_ARCHIVE_DIR}/${sanitizeSegment(noticeId, 80)}.json\``
- `async archiveForDelete(entry: IndexEntry, notice: Notice | null, now: Date): Promise<number>`
  - records = `readRecords(entry.folder)` 결과, 없으면 notice가 있고 `mail.status==='delivered'`일 때 기존 legacy 합성 1건(기존 legacy 생성 함수 재사용), 그 외 [].
  - records가 있으면 `writeJson(sentArchivePath(id), SentArchiveFile)` (entry 스냅샷 포함).
  - `withLock(SENT_INDEX_PATH)`: index raw 로드 → 해당 noticeId 항목 제거 → records가 있으면 `sentIndexEntryOf(r, entry)`에 `{ noticeDeleted: true, folder: '' }`를 덮어 push → writeJson. 쓰기 실패 시 기존 mutate의 폴백(index 파일 삭제, 161-168행 패턴).
  - 보관 건수 반환.
- `scan()` 수정: 기존 루프 뒤 `SENT_ARCHIVE_DIR` list(실패 시 빈 배열) → 각 `*.json` 읽고 `schemaVersion===1 && Array.isArray(records)`면 각 record에 대해 `sentIndexEntryOf(r, { ...a.entry, noticeId: a.noticeId, folder: '' } as IndexEntry)` + `noticeDeleted: true` push. 손상 파일은 건너뜀.

### 1-6. `src/engine/results/follow-api.ts`
```ts
/** 공고 삭제용. results/follows에서 id들을 지우고 다음 팔로우 확인 시각을 돌려준다. 바뀐 파일만 쓴다. */
export async function removeTracking(store: IFileStore, noticeIds: string[], opts: { now?: () => Date } = {}): Promise<{ nextFollowCheckAt: ISODate | null }>
```
`withLock(RESULTS_LOCK)`; results·follows 로드; 각 id 삭제; 변화 있는 파일만 updatedAt 갱신 후 save; 같은 파일의 `minNext(results, follows)` 반환.

### 1-7. `src/engine/rfp/rfp-service.ts`
반환 객체에 추가:
- `deleteComparesForNotice(noticeId): Promise<string[]>` — `listCompares`처럼 `RFP_COMPARES_DIR` list → 각 세션 read → prev.ref 또는 next.ref가 이 공고 문서면 `deleteCompare(id)`. 지운 id 반환.
- `isNoticeBusy(noticeId): boolean` — inflight 키 중 `n:${noticeId}:`로 시작하는 것이 있으면 true.

### 1-8. 신규 `src/engine/notices/delete-notice.ts`
```ts
export interface DeleteNoticeDeps {
  store: IFileStore;
  isBusy: (noticeId: string) => boolean;
  deleteCompares: (noticeId: string) => Promise<unknown>;
  mark?: { begin(noticeId: string): void; end(noticeId: string): void };
  now?: () => Date;
}
export async function deleteNotices(ids: string[], d: DeleteNoticeDeps): Promise<NoticeDeleteResult & { nextFollowCheckAt: ISODate | null }>
```
- 입력: 비어 있거나 문자열 아닌 값·빈 문자열 → `INVALID_VALUE` throw(프로젝트의 기존 에러 생성 방식 사용). 중복 제거.
- 건별 순차 처리:
```
mark?.begin(id)
try {
  await store.withLock(editLockKey(id), async () => {
    if (d.isBusy(id)) throw err('JOB_ALREADY_RUNNING', '이 공고의 수집·추출·메일 작성 또는 AI 실행이 진행 중입니다.');
    const entry = await ns.findEntry(id);
    if (!entry) return;                       // deleted로 분류
    const notice = await ns.loadNotice(id) (실패 시 null);
    await sentStore.archiveForDelete(entry, notice, now());
    await removeTree(store, entry.folder);
    await ns.removeFromIndex(id);
    if (kindOf(entry) === 'bid') best-effort EvalStore(store).remove(id)
    best-effort d.deleteCompares(id)
  });
  deleted.push(id)
} catch (e) {
  if (code === 'NEEDS_FS_PERMISSION') throw e;
  failed.push({ noticeId: id, code: e.code ?? 'DELETE_FAILED', message })
} finally { mark?.end(id) }
```
- 루프 후 `removeTracking(store, deleted)` 호출(deleted 비어도 호출)해 nextFollowCheckAt 반환. 실패는 best-effort(권한 오류만 throw, 그 외 nextFollowCheckAt=null 아님 → 실패 시 결과에서 생략하지 말고 `null`로).
  - 주의: removeTracking 실패 시 알람이 잘못 꺼지지 않도록, 실패하면 `nextFollowCheckAt`을 `undefined`로 돌려 SW가 result/done을 보내지 않게 한다. 타입은 `ISODate | null | undefined`.
- `kindOf`는 `core/model/ids` 기존 함수(notice-api.ts:41 용례).

### 1-9. 테스트 `tests/engine/delete-notice.test.ts` (MemoryStore, sent-store.test.ts:14-21의 `sampleNotice()` 패턴)
1. 기본: 공고 + extraction.json + attachments/a.hwp + ai-review.json → 삭제 → deleted=[id], index 비어 있음, `notices/` 하위 파일 없음.
2. 없는 id → deleted 포함, failed 없음, 파일 변화 없음.
3. `isBusy: () => true` → failed[0].code `JOB_ALREADY_RUNNING`, 폴더·index 그대로.
4. 3건 중 2번째만 busy → deleted 2, failed 1.
5. mail-sent.json 2건(1건 voided) → archive records 2건, entry.title 스냅샷 일치, SentStore index 2건 모두 `noticeDeleted: true`, `folder: ''`.
6. mail-sent.json 없고 mail.status='delivered'+deliveredAt → archive records 1건(legacy).
7. 이력 없음 → archive 파일 없음, sent index 항목 없음.
8. 5번 후 `mail-sent-index.json` 삭제 → SentStore.loadIndex()가 archive로 `noticeDeleted` 항목 복원.
9. 평가 기록 있으면 삭제 후 EvalStore index 비어 있음. 사전규격 공고는 throw 없이 성공.
10. results/follows에 두 공고 → 하나 삭제 → 해당 id만 제거, nextFollowCheckAt = 남은 팔로우의 nextCheckAt; 유일 팔로우 삭제면 null.
11. RFP 비교 3개(prev가 이 공고/next가 이 공고/무관) → 앞 둘만 삭제(`createRfpService` 생성이 어려우면 rfp-service 테스트 파일에 별도 케이스).
12. `mem.remove`가 한 번 던지게 스파이 → failed 1, index entry 남음 → 재호출 성공, 잔여 파일 없음.
13. index에 entry만 있고 폴더 없음 → 성공, entry 제거.
14. `mem.list`가 `NEEDS_FS_PERMISSION` throw → 전체 throw.
15. 다른 entry의 `supersededBy === id` → 삭제 후 undefined.
16. 빈 배열·비문자열 → INVALID_VALUE, 중복 id 1회 처리.
removeTree 단위 테스트(중첩 디렉터리 삭제, 없는 경로 무시)도 추가.

### 단계 1 완료 조건
`tsc --noEmit` 통과, 위 테스트와 기존 sent-store·rfp-service·follow 관련 테스트 통과. (테스트는 `C:\workspace\bidMate`에서 실행 — 소문자 `c:` cwd면 vitest가 전부 실패.)

---

## 단계 2 — 백그라운드·offscreen (implementer B, 단계 1 후)

### 2-1. `src/entrypoints/offscreen/main.ts`
- `const deletingNotices = new Set<string>();`
- `listen('job/run')`(193행 부근) `tryRegister` 앞: `p.job.noticeId && deletingNotices.has(p.job.noticeId)`면 `{ accepted: false, code: 'JOB_ALREADY_RUNNING', conflictJobId: '', active: registry.active() }` 반환(`conflictJobId` 타입이 빈 문자열을 허용하는지 확인, 안 되면 보고).
- `sentStore`·`rfp`·`aiRunner` 선언 뒤에 리스너:
```ts
listen('notice/delete', async ({ noticeIds }) => {
  const r = await deleteNotices(noticeIds, {
    store: fileStore,
    isBusy: (id) => registry.findConflict({ type: 'extract', noticeId: id }) !== undefined
      || registry.findConflict({ type: 'compose', noticeId: id }) !== undefined
      || aiRunner.isRunning(id) || rfp.isNoticeBusy(id),
    deleteCompares: (id) => rfp.deleteComparesForNotice(id),
    mark: { begin: (id) => deletingNotices.add(id), end: (id) => deletingNotices.delete(id) },
  });
  if (r.nextFollowCheckAt !== undefined) void send('result/done', { events: [], nextFollowCheckAt: r.nextFollowCheckAt }, { target: 'sw' }).catch(() => undefined);
  return { deleted: r.deleted, failed: r.failed };
}, 'offscreen');
```
(`findConflict`의 실제 시그니처·`fileStore` 변수명은 파일에서 확인해 맞춘다. follow/set이 result/done을 보내는 219-223행과 같은 방식.)

### 2-2. `src/background/auto-compose.ts`
```ts
/** 공고 삭제용. 큐에서 이 공고들의 대기 항목을 빼고 handoff를 none('dequeued')로 기록한다. */
export function dequeueByNotice(noticeIds: string[]): Promise<number>
```
기존 `dequeue`(185행 부근)와 같은 구조: `q(...)` 안에서 readQueue → 분리 → writeQueue → 각 항목 `deps().setHandoff(e.collectJobId, none('dequeued'))`(실패 무시). 제거 건수 반환.

### 2-3. 신규 `src/background/notice-delete.ts`
```ts
export function registerNoticeDelete(): void
```
`listen('notice/delete', async ({ noticeIds }, sender) => {...}, 'sw')`:
1. `assertExtensionSender(sender)`.
2. 검증: 배열·각 원소 비어있지 않은 문자열, 중복 제거, 0건 → `INVALID_VALUE`, `> NOTICE_DELETE_MAX` → `PAYLOAD_TOO_LARGE` (router.ts의 ai/batch-run 검증과 같은 형태).
3. `await ensureOffscreen()`; `send('notice/delete', { noticeIds }, { target: 'offscreen', timeoutMs: Math.min(600_000, 30_000 + 5_000 * noticeIds.length) })`.
4. 후처리(await 하지 않음, 실패 무시): `dequeueByNotice(r.deleted)`, `chrome.storage.session.remove(r.deleted.map(id => \`${AI_RUN_SESSION_PREFIX}${id}\`))`(상수 실제 이름 확인), `refreshDeadlines('manual')`(deadline-scheduler.ts:95 부근).
5. `return r`.
- `src/entrypoints/background.ts`의 등록 목록에 `registerNoticeDelete()` 추가.
- router.ts는 수정하지 않는다.

### 2-4. 테스트
- `tests/background/notice-delete.test.ts`(router.test.ts·ai-router.test.ts의 chrome 모킹 패턴): 비확장 sender → `SENDER_FORBIDDEN`; 201건 → `PAYLOAD_TOO_LARGE`; 중복 제거 후 offscreen 전달 확인; offscreen 응답 후 dequeueByNotice·storage.session.remove·refreshDeadlines('manual') 호출, 응답 그대로 반환.
- auto-compose 기존 테스트 파일에: 큐에 두 공고 → `dequeueByNotice([a])` → b만 남고 a의 setHandoff('dequeued') 호출.

### 단계 2 완료 조건
`tsc --noEmit` 통과, 새 테스트와 기존 background·offscreen 테스트 통과.

---

## 단계 3 — 화면 (implementer C, 단계 1 후, 단계 2와 병렬 가능)

공통 확인 문구(DESC):
"공고 파일과 첨부, 추출 결과, AI 제안, 평가점수, 낙찰 결과 추적, RFP 비교가 함께 지워집니다. 메일 발송 이력은 발송 이력 화면에 남습니다. 되돌릴 수 없습니다."
확인 창은 기존 `ConfirmDialog`(ui/components, 기본 confirmLabel '삭제', danger) 사용 — PerformancesCard·RfpPage 용례를 따른다.

### 3-1. `src/entrypoints/dashboard/NoticesPage.tsx`
- `picking` 타입에 `'delete'` 추가(68행 부근). `selOf`는 delete면 `{ ok: true }`.
- 상태: `confirmDelete`, `deleting`, `deleteFailed: Array<{ noticeId: string; message: string }> | null`.
- `!picking` 버튼 블록(298-307행 부근)에 `<Button variant="secondary" className="!h-9" icon={<Trash2 />} onClick={() => setPicking('delete')}>삭제할 공고 고르기</Button>` (lucide `Trash2`).
- picking==='delete' 안내 막대: eval 막대(315-325행)와 같은 모양. 제목 `${picked.length}건 선택`(0건이면 `삭제할 공고를 고르세요`), 보조문 "공고 파일과 첨부, 추출 결과, AI 제안, 평가점수, 낙찰 추적, RFP 비교가 함께 지워집니다. 메일 발송 이력은 남습니다.", 버튼 [취소](stopPicking) [선택한 공고 삭제](`variant="danger"`, `disabled={picked.length===0 || deleting}`, `loading={deleting}`, → setConfirmDelete(true)).
- 선택 행 배경(394행 부근): delete면 `bg-danger-wash/60`.
- 헤더 체크박스 title(358행 부근): delete면 `'보이는 공고 모두 선택'`.
- ConfirmDialog: title `선택한 공고 ${picked.length}건을 삭제할까요?`, description DESC, onConfirm → 닫고 `runDelete(picked)`.
- `runDelete(ids)`: setDeleting(true), setDeleteFailed(null); `send('notice/delete', { noticeIds: ids }, { timeoutMs: 35_000 + 5_000 * ids.length })` → stopPicking → `await load()` + `void loadEvalHave()` → 토스트(실패 있으면 `${deleted}건 삭제, ${failed}건 실패`, 아니면 `${deleted}건 삭제했습니다`) → 실패 있으면 deleteFailed 설정(code `JOB_ALREADY_RUNNING`이면 '작업이 진행 중입니다. 끝난 뒤 다시 시도하세요', 아니면 message). catch → `[{ noticeId: '', message }]`. finally setDeleting(false).
- 실패 표시: `aiError` InlineAlert(232행 부근) 옆에 `<InlineAlert tone="error">`로 항목마다 `제목: 메시지`(noticeId ''면 메시지만). 실패 건은 목록에 남아 있으므로 load 후 `titleOf` 사용 가능.
(실제 함수·변수 이름이 다르면 파일 관례에 맞춘다.)

### 3-2. `src/entrypoints/dashboard/notice/NoticeDetailPage.tsx`
- MoreMenu items(205-212행 부근) 끝에 `{ key: 'delete', label: '공고 삭제', icon: <Trash2 />, disabled: busy || deleting, title: busy ? '작업이 끝난 뒤 삭제할 수 있습니다' : undefined, onSelect: () => setConfirmDelete(true) }`. `MoreMenuItem`에 `disabled`가 없으면 MoreMenu.tsx에 추가(버튼 disabled로 렌더).
- ConfirmDialog title "이 공고를 삭제할까요?", description DESC. onConfirm: 닫고 setDeleting(true) → `send('notice/delete', { noticeIds: [noticeId] }, { timeoutMs: 40_000 })` → failed 있으면 `setAlert(code==='JOB_ALREADY_RUNNING' ? '이 공고는 다른 작업이 진행 중입니다' : message)`; 성공이면 `location.hash = '#/notices'`. catch → setAlert. finally setDeleting(false). (알림 상태 이름은 파일 관례에 맞춘다.)

### 3-3. `src/entrypoints/dashboard/SentHistoryPage.tsx`
`r.noticeDeleted`인 행: 행 onClick 무시·`cursor-pointer` 제거, 발송 시각 `<a>` 대신 `<span>`(116행 부근), 공고 제목 옆(119행 부근)에 `<StatusBadge status="idle">삭제된 공고</StatusBadge>`.

### 단계 3 완료 조건
`tsc --noEmit` 통과, 기존 dashboard 테스트 통과.

---

## 보고 형식 (각 단계)
변경 파일:줄범위 목록 / 명세와 다르게 한 점과 이유 / 확인 못 한 가정 / 테스트 결과 요약. 보고는 한국어로 작성.
