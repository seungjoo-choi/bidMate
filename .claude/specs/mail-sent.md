# 메일 발송 이력 (Fable 설계, 2026-10-20 사용자 승인)

## 목표
- 공고별로 여러 번의 발송을 기록하고, 작성 기록(ComposeRecord)과 연결한다.
- 발송 확인: 웹메일 작성 탭에서 사용자의 보내기 클릭/단축키를 관찰해 자동 기록 + 대시보드 수동 기록으로 보완.
- 보는 위치: 대시보드 새 메뉴 "발송 이력"(`#/sent`) + 공고 상세 history 탭의 "발송 이력" 카드. 수신자/그룹별 이력은 범위 밖.

## 0. 전제 사실
- 작성 기록 `ComposeRecord`는 `<folder>/mail.json` 배열(src/engine/mail/record.ts). id는 `${jobId}-${attempt}`, compose 잡 결과 `ComposeResult.recordId`로 ledger에 남는다(src/engine/jobs/compose-job.ts:128-142, src/core/types/job.ts:93).
- compose 잡의 `composeTabId`는 잡이 끝나도 ledger에 남는다(재시도 시작 때만 지움, src/background/job-coordinator.ts:375). ledger 최대 20개(MAX_JOBS). SW는 "웹메일 탭 id → compose 잡 → noticeId, recordId"를 ledger만으로 역추적할 수 있다.
- 웹메일 CS(naverworks-compose.ts)는 `compose/open`에서 `plan.selector`가 있을 때만 주입된다(src/background/compose-relay.ts:66-75). Gmail은 gmail-v1이 unverified라 CS 미주입. 발송 감지는 기존 CS 주입 조건과 분리한다.
- 전송 버튼 실측: 네이버웍스 `button.lw_btn_point[data-hotkey="sendKey"]` 텍스트 "보내기"(docs/probe/bidmate-probe-mail.worksmobile.com-20261019-170832.json:7618). Gmail은 동적 id 요소에 `aria-label="보내기 (⌘Enter)"`, `data-tooltip="보내기 (⌘Enter)"`(docs/probe/bidmate-probe-mail.google.com-20261019-002623.json:2626-2635). 둘 다 Ctrl/⌘+Enter 단축키.
- 발송 뒤 화면 변화(팝업 닫힘, 토스트, URL)는 probe에 없음. S4 실측 필요.
- 별도 파일 + 파생 index 전례: src/engine/evaluation/eval-store.ts:34-62. index.json 손상 시 notice.json 스캔 재생성 전례: src/engine/notices/notice-store.ts:55-70.

## 1. 데이터 모델
`src/core/types/compose.ts`에 추가:
```ts
export type SendSource = 'auto' | 'manual';
export interface SendSignal {
  kind: 'click' | 'hotkey';
  confirmed: boolean;
  confirmation?: 'ui_gone' | 'toast' | 'unload';
}
export interface SendRecord {
  id: string;                 // crypto.randomUUID(), legacy는 `legacy-<noticeId>`
  noticeId: string;
  sentAt: ISODate;            // auto: 신호 수신 시 offscreen 시계, manual: 사용자 지정 또는 now
  recordedAt: ISODate;
  source: SendSource;
  provider?: MailProvider;
  composeRecordId?: string;
  jobId?: string;
  signal?: SendSignal;        // auto만
  summary: { subject: string; toCount: number; ccCount: number; attachmentCount: number };
  note?: string;              // manual 메모(선택, 200자)
  voidedAt?: ISODate;         // 취소. 삭제하지 않는다
}
export interface SentIndexEntry {
  id: string; noticeId: string; kind?: NoticeKind; noticeNo: string; round: string; title: string; orderingOrg: string; folder: string;
  sentAt: ISODate; source: SendSource; provider?: MailProvider; confirmed?: boolean;
  subject: string; toCount: number; ccCount: number; attachmentCount: number;
  composeRecordId?: string; voidedAt?: ISODate;
}
export interface SentIndexFile { schemaVersion: 1; generatedAt: ISODate; entries: SentIndexEntry[] }
```
- 진실: `<folder>/mail-sent.json`(SendRecord[]). 파생: 루트 `mail-sent-index.json`. mail.json은 건드리지 않는다.
- `notice.mail.status === 'delivered'` = 취소 안 된 SendRecord가 1개 이상. `deliveredAt` = 그중 최신 sentAt. `notice.mail.sentCount?: number` 추가. 모두 mail-sent.json에서 재계산하는 파생 값. IndexEntry, stats.ts 무변경.
- 옛 데이터(mail-sent.json 없음, status delivered, deliveredAt 있음): 마이그레이션 없음. 읽을 때 `legacy-<noticeId>` 가상 레코드(source manual, sentAt = deliveredAt, summary 빈 값)를 합성. 그 공고에 첫 쓰기(추가/취소) 때 실제 레코드로 먼저 물질화.

### 중복과 취소
- composeRecordId당 auto 레코드 최대 1개. 같은 composeRecordId의 두 번째 1차 신호는 무시, confirm 신호는 기존 레코드의 signal.confirmed/confirmation만 갱신.
- 같은 composeRecordId에 취소 안 된 레코드(출처 무관)가 있으면 auto 신호는 버린다. 취소된 레코드의 composeRecordId로 오는 늦은 신호도 버린다.
- 수동 추가는 항상 허용. UI는 기존 레코드를 먼저 보여 주고 버튼 문구를 "발송 1회 더 기록"으로.
- 수동 귀속: mail.json의 최신 ComposeRecord 중 composedAt이 "마지막 유효 발송 sentAt"보다 뒤인 것이 있으면 그것에 귀속, 없으면 composeRecordId 없음.
- 취소: voidedAt 소프트. 취소 뒤 notice.mail 재계산(유효 레코드 없으면 status는 초안 유무로 drafting/none, deliveredAt 제거). 취소 해제는 범위 밖.

### 조회와 락
- `mail/sent-list`는 SentIndexEntry[] 전체 반환. 정렬/필터는 대시보드 순수 함수. index가 2MB 넘으면 경고 로그만.
- 쓰기 경로는 `SentStore`(offscreen) 하나. 레코드 파일과 index를 `mail-sent-index.json` 락 하나로 함께 쓴다. notice.mail 갱신은 `editLockKey(noticeId)` 안.
- 락 순서 고정: editLockKey(바깥) → mail-sent-index.json(안쪽). index 락 안에서 notice를 저장하지 않는다. `saveNoticeLatest` 금지(editLockKey 재진입 교착), `saveNotice` 직접 사용.

## 2. 자동 감지(관찰 전용)
> 2026-10-21 예외: 대시보드 바로 발송은 `markSent('auto')`로 자동 클릭 신호를 낸다. 클릭은 send-watch가 아니라 `src/background/send-trigger.ts`에서만 한다(`.claude/specs/auto-send.md`).
- 새 unlisted script `src/entrypoints/send-watch.ts`. `compose/open`에서 서비스, 셀렉터 검증 여부와 무관하게 항상 주입. DOM에 어떤 이벤트도 보내지 않고 `isTrusted === true` 이벤트만 듣는다. dom-actions.ts import 금지. `dispatchEvent`, `.click(`, `execCommand`, `submit(` 금지(소스 스캔 테스트).
- 1차 신호 `click`: document 캡처 단계 click, isTrusted, 대상의 closest `button,a,[role=button],input`이 `sendWatch.buttons` 셀렉터에 맞거나 텍스트/aria-label/title이 `sendWatch.textPatterns`에 맞을 때.
- 1차 신호 `hotkey`: 캡처 단계 keydown, isTrusted, `(ctrlKey || metaKey) && key === 'Enter'`, `sendWatch.hotkey`가 true.
- 2차 확인(1차 뒤 20초 안): `ui_gone`(sendWatch.gone 셀렉터가 DOM에서 사라짐, 500ms 폴링), `toast`(sendWatch.toast 셀렉터+문구), `unload`(pagehide).
- CS는 1차 신호 즉시 `mail/send-signal {jobId, kind}`, 2차 확인 시 `mail/send-signal {jobId, kind: 'confirm', confirmation}`. 1차는 한 문서에서 1회만.
- 기록 정책: 1차 신호만으로 레코드 생성(confirmed=false), 2차가 오면 confirmed=true.
- forbidden(우리가 누르면 안 되는 것)과 sendWatch(사용자가 눌렀는지 보는 것)는 필드를 분리한다.

### 신뢰 경계
- SW `mail/send-signal` 수용 조건: (1) sender.id가 runtime id (2) sender.tab 존재 (3) `getJob(jobId)`가 있고 type 'compose' (4) `job.composeTabId === sender.tab.id`. 호스트 검사 안 함. 잡이 ACTIVE가 아니어도 됨. ledger에 없으면 거부.
- SW → offscreen `mail/sent-record`: noticeId, composeRecordId(`(job.result as ComposeResult).recordId`), provider, jobId는 SW가 ledger에서 꺼낸다. CS 페이로드에서는 jobId와 신호 종류만 쓴다.
- recordId가 없으면 composeRecordId 없는 auto 레코드.
- 주입 수명: `compose/open`의 waitComplete 뒤 `send-watch.js` 주입 + `__bidMateSendWatch.configure({jobId, sendWatch})`(allFrames: true). SW가 `tabs.onUpdated(status complete)`에서 tabId가 ledger compose 잡의 composeTabId와 같으면 재주입.
- 오탐(클릭했지만 안 보내짐)은 미확인으로 남아 사용자가 취소. 누락(ledger 소실, 재시작, 사용자가 연 다른 작성 창)은 수동 보완.

## 3. 화면
- 메뉴 `sent`("발송 이력"), 라우트 `#/sent`, MENU에서 '공고' 다음, 아이콘 Send.
- SentHistoryPage: 표(발송 시각, 공고번호/차수, 공고명, 기관, 제목, 받는 사람 수, 첨부 수, 출처 자동/수동, 확인 여부, 서비스), 기본 sentAt 내림차순. 필터: 기간 프리셋(7일/30일/이번 달/전체/직접 입력), 검색(공고명, 공고번호, 제목, 기관 부분 일치), 출처, 취소 포함 토글(기본 숨김). 행 클릭 → `noticeHash(noticeId, 'history')`. 빈 상태 "기록된 발송이 없습니다".
- HistoryTab "메일" 카드 아래 "발송 이력(N)" 카드: 목록 + [발송 완료로 기록](시각 datetime-local 기본 지금, 메모 선택) + 행마다 [취소](confirm 1회). 취소된 레코드는 취소선. auto 미확인은 "완료 확인 없음" 배지.
- MailPreparePage 헤더: [전달 완료로 표시]/[전달 완료 해제]를 [발송 완료로 기록](delivered면 "발송 1회 더 기록")으로 교체, 옆에 마지막 발송 시각과 "이력 보기" 링크. 해제는 history 탭에서만.
- MAIL_STATUS delivered 라벨 '전달 완료' → '발송 완료'.

## 4. 단계
### S1 모델과 저장소
1. `src/core/types/compose.ts`: 위 타입 추가. `src/core/types/index.ts` 재export.
2. `src/core/types/notice.ts`: delivered 주석을 "mail-sent.json에서 파생, 자동/수동"으로, `mail.sentCount?: number` 추가.
3. `src/core/mail/sent-derive.ts`(새, 순수):
   - `deriveMailStatus(records: SendRecord[], hasDraft: boolean, prev: Notice['mail']): Notice['mail']`: 유효 레코드 있으면 delivered + deliveredAt 최신 + sentCount, 없으면 deliveredAt/sentCount 제거, status는 prev가 delivered였으면 hasDraft ? drafting : none, 아니면 prev.status 유지.
   - `legacyRecord(notice: Notice): SendRecord | null`
   - `attributeCompose(records: SendRecord[], composes: ComposeRecord[]): ComposeRecord | null`
   - `summaryOf(c: ComposeRecord | null, d: MailDraft | null)`
   - `sentIndexEntryOf(r: SendRecord, e: IndexEntry): SentIndexEntry`
4. `src/engine/mail/sent-store.ts`(새): `SENT_INDEX_PATH = 'mail-sent-index.json'`, `sentPath(folder)`. class SentStore(store):
   - `list(noticeId): Promise<SendRecord[]>`(파일, 없으면 legacy 합성, 권한 오류만 던짐)
   - `loadIndex(): Promise<SentIndexFile>`(없거나 손상이면 index.json 공고를 돌며 재생성)
   - `addManual(p: {noticeId; sentAt?; note?}, now): Promise<{record; notice}>`
   - `recordAuto(p: {noticeId; jobId; composeRecordId?; provider?; kind: 'click'|'hotkey'}, now): Promise<{record: SendRecord | null}>`(중복이면 null)
   - `confirmAuto(p: {noticeId; jobId; composeRecordId?; confirmation}): Promise<void>`(composeRecordId 또는 jobId로 찾아 갱신, 없으면 무시)
   - `voidRecord(p: {noticeId; recordId}, now): Promise<{notice}>`(legacy id면 먼저 물질화)
   - 공통 `mutate(noticeId, fn)`: editLockKey → loadNotice → legacy 물질화 → SENT_INDEX 락 안에서 파일+index 쓰기 → 락 밖에서 deriveMailStatus → ns.saveNotice.
5. `src/engine/mail/prepare.ts` setMailStatus 삭제, `readDraft` export(hasDraft 판정용).
6. `src/messaging/protocol.ts`: `mail/set-status` 제거, 추가:
   - `mail/sent-list` void → SentIndexEntry[]
   - `mail/sent-get` {noticeId} → SendRecord[]
   - `mail/sent-add` {noticeId; sentAt?: ISODate; note?: string} → {record: SendRecord; notice: Notice}
   - `mail/sent-void` {noticeId; recordId} → {notice: Notice}
   - `mail/send-signal` {jobId; kind: 'click'|'hotkey'|'confirm'; confirmation?: 'ui_gone'|'toast'|'unload'} → void (CS→SW)
   - `mail/sent-record` {noticeId; jobId; composeRecordId?; provider?: MailProvider; kind; confirmation?} → {recorded: boolean} (SW→offscreen)
7. `src/background/router.ts`: set-status 대신 sent-list/get/add/void를 확장 발신 전용 중계 목록에. `src/entrypoints/offscreen/main.ts`: set-status 교체 + 4개 listen + `mail/sent-record` listen.
8. 테스트: `tests/core/sent-derive.test.ts`(파생 상태, legacy, 귀속, 중복), `tests/engine/sent-store.test.ts`(메모리 store로 추가/취소/index 재생성).
완료 조건: 옛 delivered 공고가 `mail/sent-get`에서 legacy 1건, 취소하면 none/drafting. 기존 테스트의 set-status 참조 교체.

### S2 대시보드 (S1 뒤)
route.ts, App.tsx(MENU), `src/core/dashboard/sent-filter.ts`(새, `filterSent(entries, {from?, to?, query, source: SendSource|'all', includeVoided})`, sentAt desc, 소문자 부분 일치), `SentHistoryPage.tsx`(새), HistoryTab.tsx(카드, 필요 시 `onNoticeChange?(n)` props), MailPreparePage.tsx(버튼 교체), src/ui/notice-detail/view.ts 라벨. 테스트 `tests/core/sent-filter.test.ts`.
완료 조건: 수동 기록 2회 → history 탭 2행, 전체 이력 2행, 홈 월별 delivered는 공고 1건.

### S3 자동 감지 1차 신호 (S1 뒤, S2와 병렬 가능)
1. `src/adapters/naverworks/types.ts`: `ComposeSelectorSet.sendWatch?: { buttons: string[]; textPatterns?: string[]; hotkey?: boolean; gone?: string; toast?: { selector: string; textPattern: string } }`.
2. naverworks-v1: `{ buttons: ['button[data-hotkey="sendKey"]'], textPatterns: ['보내기'], hotkey: true, gone: '#cont_flex_area input[name="subject"]' }`. gmail-v1: `{ buttons: ['[aria-label^="보내기"]', '[data-tooltip^="보내기"]'], textPatterns: ['보내기'], hotkey: true }`. status 변경 금지.
3. `src/engine/mail/compose-plan.ts`: `plan.sendWatch`를 검증 여부와 무관하게 포함.
4. `src/entrypoints/send-watch.ts`(새 unlisted script, wxt.config 등록 필요 시), 중복 주입 가드, 위 리스너.
5. `src/background/compose-relay.ts`: waitComplete 뒤 send-watch 주입 + configure, 기존 CS 주입과 독립 try/catch. `compose/open` payload에 `sendWatch?`(compose-job.ts에서 plan.sendWatch 전달).
6. `src/background/send-signal.ts`(새): `mail/send-signal` 신뢰 검사 후 offscreen으로 `mail/sent-record`. 실패는 삼킴. tabs.onUpdated 재주입(셀렉터셋을 SW에서 import 못 하면 compose/open 때 Map<jobId, sendWatch> 보관, SW 재시작 시 재주입 포기).
7. `src/entrypoints/background.ts`: 등록.
8. 테스트: send-signal(탭 불일치/잡 없음/collect 잡 거부, 전달 payload가 ledger 값), send-watch(jsdom: isTrusted false 무시, 버튼 매칭, 1회 제한), 소스 스캔(금지 호출 없음).

### S4 실측 (사용자)
본인에게 테스트 메일 1통씩 실제 발송하며 probe 녹화. 네이버웍스: 보내기 뒤 팝업 닫힘/화면 전환 요소와 문구/URL 변화, 수신자 없을 때 오류 요소. Gmail: 토스트 요소와 문구, 작성 영역 소멸, hash 변화, ⌘Enter 시 동일 여부, 보내기 요소 role.

### S5 2차 확인 (S4 뒤)
셀렉터셋 gone/toast 값 채움(추정 금지), UI 배지 확인.

### S6 문서
architecture.md 저장 레이아웃, compose-flow.md 주입 단계.

## 금지
- send-watch에서 이벤트 dispatch, dom-actions import.
- SW가 CS 페이로드의 noticeId/recordId 사용.
- 호스트 검사로 신호 허용.
- auto 신호로 레코드 삭제/취소 해제.
- 옛 delivered 일괄 변환.
- compose 잡 실행 중 수동 기록 차단.
- 자동 기록 시 알림 띄우기.
- gmail-v1.status 변경.
