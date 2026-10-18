# Gmail 2차: 작성 창 범위와 자동 첨부

## 목표
Gmail 작성 창(1차 주소 방식으로 연 창)에 공고 첨부파일을 자동으로 넣고 업로드 완료를 확인한다. 받는 사람, 참조, 제목, 본문은 1차처럼 주소로 넣고 다시 채우지 않는다. 본문 서식(HTML) 채우기는 3차.

배경: 1차(`.claude/specs/done/gmail-provider.md`)는 첨부를 수동으로 남겼다. probe 실측(`docs/probe/bidmate-probe-mail.google.com-20261019-002623.json`)에서 한 문서에 작성 창이 2개(숨은 임시보관 창 포함) 있음을 확인했다. 엔진(`src/adapters/naverworks/engine.ts`)은 문서 전역 첫 요소를 쓰므로 다른 임시보관 메일에 첨부될 위험이 있다. Fable 설계(2026-10-19).

## 공통 제약
- 전송 자동 클릭 금지 유지. 새 금지: Gmail "파일 첨부" 버튼(`[command="Files"]`) 클릭 금지(OS 파일 선택 창이 열림). Drive 전환 대화상자의 어떤 버튼도 누르지 않는다.
- 셀렉터 값 추정 금지. gmail-v1에는 실측으로 확인된 값만 넣는다. `:xx` 동적 id, `__fupc-*` id, 실측으로 확인되지 않은 2~3글자 클래스 금지.
- 화면 확인 없이 completed 금지. `prefilled`를 ok로 취급하지 않는다. 대조할 셀렉터가 없는 필드는 ok로 바꾸지 않는다.
- 작성 창이 여럿일 때 첫 요소, 보이는 것, 마지막 것으로 고르지 않는다. 모호하면 멈춘다.
- `blockingDialog`만 document 범위, 나머지 셀렉터는 전부 scope 범위.
- detect의 reason은 진단과 메시지 분기용. reason으로 "그래도 진행" 분기를 만들지 않는다.
- naverworks 경로 동작 불변(scope 미설정이면 root는 document 전체, anchor 미전송, fields 생략 시 4필드 전부).
- 가운뎃점 문자 금지(주석, 화면 문구 포함). 새 npm 패키지 금지. 기존 관례를 따른다.
- 함수 이름, 줄 번호가 명세와 다르면 같은 역할의 코드에 적용하고 보고. 명세 밖 구조 변경이 필요하면 멈추고 보고.

## 단계
| 단계 | 내용 | 의존 |
|---|---|---|
| S0 | probe 보완(inspect, watch 녹화, URL 변화 기록) | 없음 |
| S1 | 셀렉터셋 타입과 엔진(scope, anchor, pendingSelector, blockingDialog, limits, supported) | 없음 |
| S2 | 프로토콜, SW 릴레이, CS(anchor 전달, compose/fill fields) | S1 |
| S3 | planCompose, compose-job(fill 생략, 첨부 선별, reverify, 타임아웃) | S2 타입 |
| R | 사용자 실측 R1~R6 | S0 |
| S4 | gmail-v1 값 채우기, 수동 검증 후 verified | S1, R |
| S5 | UI 문구 | S3 |
| S6 | 문서 | S4 |
S0과 S1은 병렬. S2/S3는 타입 확정 뒤 병렬 가능.

---

## S0. probe 보완
대상: `src/entrypoints/probe.ts`, `src/entrypoints/sidepanel/probe-runner.ts`, `src/entrypoints/sidepanel/DiagnosticsSection.tsx`
- `inspect(selectors: string[], opts?: { depth?: number /*기본 4*/; maxMatches?: number /*기본 20*/ })`: 매치마다 `{ selector, cssPath, ancestors: Array<{tag,id,class,role,ariaLabel}>(body까지), subtree }`. subtree는 깊이 제한 트리(tag, class, role, aria-*, text 40자 이하, input은 type/name만, value 제외). 읽기 전용.
- `startRecording(opts?: { watch?: { selectors: string[]; intervalMs?: number /*기본 500*/ } })`: 간격마다 inspect 결과를 `watches[]`에 `{ t, results }`로 기록. 상한 200회, 직전과 같으면 생략.
- `hashchange`와 `location.href` 변화를 events에 기록.
- probe-runner: `callProbe(tabId, method, args?)`로 인자 전달. 출력은 기존처럼 maskDeep 통과.
- DiagnosticsSection: inspect 실행 버튼과 셀렉터 입력란(줄바꿈 구분), 녹화 시작 시 watch 셀렉터 입력란. 기존 컴포넌트와 스타일 재사용. inspect 결과는 기존 다운로드 경로로 json 저장(`kind: 'inspect'`).
- 실측 시나리오에서 쓸 기본 셀렉터 프리셋을 선택지로 제공(R1, R2, R4용, 아래 실측 절 참고).
- 테스트: inspect의 깊이/개수 제한, value 미수집, watch 중복 생략, 상한.

## S1. 타입과 엔진
### 타입 `src/adapters/naverworks/types.ts`
- `compose: { url?; openButton?; readySelector: string; inFrame?; scope?: string }`
- `attach: { ...기존; pendingSelector?: string; blockingDialog?: string; limits?: { perFileBytes?: number; totalBytes?: number } }`
- `ComposeState`에 `supported: { to: boolean; cc: boolean; subject: boolean; body: boolean; attachments: boolean }`(해당 셀렉터가 비어 있지 않고 scope 해석 성공)
- `export interface ComposeAnchor { subject?: string }`
- detect reason 주석에 `'SCOPE_NOT_FOUND' | 'SCOPE_AMBIGUOUS'` 추가(string 유지)

### 엔진 `src/adapters/naverworks/engine.ts`
- 생성자 `(selectorSet, root: Document, timing = {}, anchor?: ComposeAnchor)`.
- `resolveScope(): { el: ParentNode | null; reason?: 'SCOPE_NOT_FOUND' | 'SCOPE_AMBIGUOUS' }`
  - scope가 비면 `{ el: root }`(현행).
  - pin된 요소가 `isConnected`면 그대로.
  - 후보 = `root.querySelectorAll(scope)`. anchor.subject가 비어 있지 않으면 후보 안 `subject.input`의 value를 비교해 필터. 비교는 양쪽 `s.replace(/\s+/g, ' ').trim()`.
  - 후보 1개면 pin. 0개면 SCOPE_NOT_FOUND. 2개 이상이면 SCOPE_AMBIGUOUS. anchor가 없거나 subject가 빈 문자열이면 후보가 정확히 1개일 때만 선택.
  - pin이 끊어지면 재해석 1회, 실패하면 그 동작은 SCOPE_LOST(첨부는 AttachResult failed, error 'SCOPE_LOST'; readState는 빈 상태 + supported 전부 false).
- `q`/`qa` 기본 탐색 기준을 scope 요소로(iframe 본문 doc 인자 경로는 유지). `blockingDialog`만 document 기준.
- `detect()`: isCompose = scope 설정 시 후보 1개 이상, 아니면 readySelector 존재(현행). ready = scope가 유일하게 해석되고, `to.input`, `subject.input`, `body.editable` 중 비어 있지 않은 셀렉터가 모두 scope 안에서 발견됨. 셋 다 비면 `SELECTOR_MISSING`. ready false면 reason 포함.
- `itemUploading(item)`: 기존 조건 OR `(a.pendingSelector && scope.querySelector(a.pendingSelector) !== null)`.
- `attachFile` 업로드 대기 루프: 매 반복과 주입 직후(settle 뒤) `blockingDialog`가 document에 있으면 `failed`, error `DIALOG_SHOWN`.
- `dropZone === ':scope'`이면 scope 요소 자체를 드롭 대상으로.
- `attach.itemName`이 비면 item 자체 텍스트로 이름 매칭(현행 includes 매칭 유지, 이름에 크기 문자열이 붙어도 허용).
- `readState()`에 supported 채움.
- 클릭 추가 금지(forbidden-dispatch 테스트 유지).

### 테스트 `tests/adapters/engine.test.ts`(없으면 기존 엔진 테스트 파일에 추가)
scope 2개 중 subject 일치 1개 선택 / 둘 다 일치 → AMBIGUOUS, ready false / anchor 없음 + 후보 1개 → 선택 / anchor 없음 + 후보 2개 → AMBIGUOUS / 후보 0개 → NOT_FOUND / pin 후 요소 제거 → SCOPE_LOST / pendingSelector가 scope 안에 있으면 uploaded 미판정, 다른 scope에 있으면 무관 / blockingDialog 등장 → failed DIALOG_SHOWN / dropZone ':scope' / to.input 빈 값이어도 subject+body 있으면 ready / supported 플래그 / scope 미설정이면 현행 동작.

## S2. 프로토콜, SW 릴레이, CS
- `src/messaging/protocol.ts`
  - `compose/open` payload: `{ jobId; url; selector?; anchor?: { subject: string } }`
  - `compose/fill` payload에 `fields?: Array<'to'|'cc'|'subject'|'body'>`(생략 = 4개 전부). response는 요청한 필드만, 요청 순서.
  - `ComposeDetect`에 `reason?: string`
- `src/background/compose-relay.ts`: Cfg에 `anchor?`, open에서 CS configure 설정에 `anchor: p.anchor` 포함. detect 프레임 결과에 reason 전달. selector 없으면 종전처럼 주입 안 함.
- `src/entrypoints/naverworks-compose.ts`: ComposeCsConfig에 `anchor?`, `new GenericComposeAdapter(set, document, {}, cfg.anchor)`. detect 반환에 reason. `compose/fill`은 `p.fields ?? ['to','cc','subject','body']` 순서대로만 실행해 반환.
- 테스트: relay가 anchor를 configure에 전달, detect reason 전달, CS fill 부분 호출.

## S3. planCompose와 compose-job
### `src/engine/mail/compose-plan.ts`
- ComposePlan에 `fillFields: ComposeField[]`(= 4필드 중 prefilled도 omitted도 아닌 것, FIELDS 순서), `attachLimits?: { perFileBytes?; totalBytes? }`(셀렉터셋 attach.limits 복사), `detectTimeoutMs?: number`(needsUserOpen이 false면 30_000, 아니면 undefined).

### `src/engine/jobs/compose-job.ts`
- 감지 타임아웃: `plan.detectTimeoutMs ?? deps.detectTimeoutMs ?? 120_000`.
- `compose/open`: `plan.prefilled.includes('subject')`일 때만 `anchor: { subject: <주소로 넣은 제목> }`.
- 감지 루프는 마지막 reason을 기억. 타임아웃 시 마지막 reason이 SCOPE_AMBIGUOUS면 메시지 "같은 제목의 작성 창이 여러 개라 하나로 특정하지 못했습니다. 다른 작성 창을 닫고 다시 시도하세요"(code는 COMPOSE_NOT_DETECTED 유지).
- verified 경로 fields 초기값: prefilled → `{ status: 'prefilled', method: 'url' }`, omitted → `{ status: 'unsupported', method: 'none', error: 'URL_TOO_LONG' }`, 나머지는 채울 대상.
- fillFields가 비면 `compose/fill` 호출 안 함, step fill_fields는 skipped "주소로 전달됨, 확인 단계에서 대조". 비어 있지 않으면 `compose/fill { ..., fields: fillFields }`.
- 첨부 선별 순수 함수 `selectAttachTargets(files, maxBytes, limits): { targets; skipped: Array<{ file; error }> }`(`src/engine/mail/attach-limits.ts` 신규). 초안 순서 유지, 재정렬 금지:
  1. `size > maxBytes`(settings.download.maxFileMB) → `FILE_TOO_LARGE`(현행)
  2. `size > limits.perFileBytes` → `PROVIDER_FILE_LIMIT`
  3. 누적 + size > `limits.totalBytes` → `PROVIDER_TOTAL_LIMIT`(이 파일만 건너뛰고 다음 파일 계속 판정)
- reverify: `state.supported[field] === false`면 그 필드는 현 상태 유지. body이고 `method === 'url'`이면 비교 기준을 draft.text로: 제목과 첫 섹션 라벨 포함 AND `squash(bodyText).length >= squash(draft.text).length * 0.8`.
- mode: `plan.prefilled.length > 0 ? 'url' : 'auto'`. outcome 규칙 현행 유지(모든 필드 ok + 첨부 전부 uploaded일 때만 completed).
- 테스트(`tests/engine/compose-job.test.ts`, `tests/engine/compose-plan.test.ts`, `tests/engine/attach-limits.test.ts`): 테스트 전용 gmail verified 셀렉터셋으로 open에 anchor 포함 / compose/fill 미호출 + fill_fields skipped / attach 호출 / to, cc supported false → prefilled 유지 → partial / 전부 ok + uploaded → completed, mode url / 선별 3종 error / detect 30초 / AMBIGUOUS 메시지 / naverworks 기존 케이스(anchor 없음, fields 없음) 유지.

## S4. gmail-v1 값 채우기(실측 뒤)
`src/adapters/gmail/selectors/gmail-v1.ts`
- 이미 실측으로 확정: `subject.input = 'input[name="subjectbox"]'`, `body = { kind: 'contenteditable', editable: 'div[aria-label="메일 본문"][contenteditable="true"][role="textbox"]', insert: [] }`, `attach.fileInput = 'input[type="file"][name="Filedata"]'`, `attach.item = '.dL'`, `attach.itemName = ''`, `attach.methods = ['input', 'drop']`, `attach.limits = { perFileBytes: 26214400, totalBytes: 26214400 }`, `forbidden.send = ['div[role="button"][aria-label^="보내기"]']`.
- 실측 후 채움: `compose.scope`(= readySelector), `attach.pendingSelector`/`itemProgress`, `attach.blockingDialog`, `attach.dropZone`, `to/cc.chip`, `to/cc.chipEmail`, `attach.itemError`.
- 주석에 "Gmail 표시 언어 한국어 전제"(aria-label 한글 의존). 영어 UI는 3차.
- `status: 'verified'`, `version: '1.0.0'`은 수동 검증 결과를 `docs/gmail-verification.md`에 기록한 뒤에만. scope 없이 verified 금지. 첨부 완료 표식(pendingSelector 또는 itemProgress) 없이 verified 금지.

## S5. UI
- `src/ui/compose-view.ts`: completed에서 본문이 `method === 'url'`이면 "본문 복사(서식)" 유지. 첨부 error 문구: PROVIDER_FILE_LIMIT/PROVIDER_TOTAL_LIMIT → "Gmail은 첨부 합계 25MB를 넘으면 Drive 링크로만 보낼 수 있어 해당 파일은 직접 첨부해야 합니다", DIALOG_SHOWN → "Gmail 대화상자가 떠서 첨부를 멈췄습니다. 창에서 처리한 뒤 직접 첨부하세요", SCOPE_LOST → "작성 창이 닫혀 첨부를 멈췄습니다".
- `MailServiceCard.tsx`, `MailPreparePage.tsx` 안내 문구: verified 뒤 "첨부는 자동(합계 25MB까지), 서식 본문은 직접"으로.

## S6. 문서
`compose-flow.md` §1, §3의 Gmail 결과 문장 갱신, `architecture.md` 어댑터 절에 scope/anchor, `decisions.md`에 아래 결정 표와 셀렉터 근거 probe 파일명.

---

## 사용자 실측(S0 반영 후)
- R1 BidMate 주소로 열린 화면 구조(필수): [메일 작성]으로 연 Gmail 탭에서 inspect(`input[name="subjectbox"]`, `div[aria-label="메일 본문"]`, `input[type="file"][name="Filedata"]`, `[command="Files"]`, `h2`, `[role="dialog"]`, `[email]`, `[data-hovercard-id]`, `[role="listbox"]`, `[role="option"]`) + snapshot. 확정: 전체화면인지, 작성 창 컨테이너(scope), subjectbox 값이 주소 제목과 같은지(사용자 육안), 첨부 버튼 클릭 전 Filedata input 존재, to/cc 칩 구조, cc 영역 접힘 여부, sendCandidates.
- R2 첨부 업로드 구조(필수): watch(`.dL`, `[role="progressbar"]`, `[aria-label="첨부파일 삭제"]`, `input[type="file"][name="Filedata"]`)로 녹화, 15~20MB 파일 1개 첨부, 완료 후 10초 대기, 이름 60자 이상 작은 파일 1개 추가. 확정: progressbar가 `.dL` 안/밖, 완료 표식, 이름 텍스트 형식, 긴 이름 절단, 실패 표시.
- R3 작성 창 2개(필수): 받은편지함에서 제목 "A", "B" 작성 창 2개(하나는 최소화) 상태로 snapshot + inspect(`input[name="subjectbox"]`). 확정: scope 후보 2개 구분.
- R4 25MB 초과(필수): 녹화 중 30MB 파일 첨부 시도, 대화상자가 뜬 상태에서 inspect(`[role="alertdialog"]`, `[role="dialog"]`), 취소, 15MB + 15MB 순차 첨부. 확정: blockingDialog, 한도가 파일별/합계인지.
- R5 드롭 대상(선택): 녹화 중 파일을 작성 창 본문 위로 끌어 놓기.

## 수동 검증(verified 전환 조건, `docs/gmail-verification.md`)
1. 첨부 2개(합 20MB 이하) 자동 첨부, 창에서 항목 2개 확인, 결과 uploaded
2. 다른 작성 창이 열린 받은편지함 탭이 있어도 BidMate 탭 창에만 첨부
3. 같은 제목 창 2개를 한 문서에 둔 뒤 실행 → COMPOSE_NOT_DETECTED(모호 메시지), 첨부 0건
4. 30MB 파일 포함 → 해당 파일 PROVIDER_FILE_LIMIT, 대화상자 미출현
5. 첨부 없는 초안에서 칩 셀렉터 확정 시 completed, 미확정 시 partial(to/cc prefilled)
6. 첨부 도중 창 닫기 → SCOPE_LOST, partial, 다른 탭 영향 없음

## 결정과 기각 대안
| 결정 | 이유 | 기각 대안 |
|---|---|---|
| 작성 창은 scope + 제목 anchor로 식별, 0개/2개 이상이면 중단 | 오선택(남의 임시보관 메일에 첨부) 비용이 재시도 비용보다 훨씬 큼. 제목은 BidMate가 직접 넣은 값이고 셀렉터가 실측됨 | 보이는 창, 가장 최근 창, 첫 요소 |
| 2차는 감지, 첨부, 업로드 확인, 대조만. 본문 서식은 3차 | 미지수를 하나씩, 실패 원인 귀속 | 첨부와 본문 HTML 동시 |
| compose/fill에 fields 추가 | 3차가 프로토콜 변경 없이 fillFields=['body']로 끝남 | fill 호출 생략만 |
| completed는 대조 ok + 첨부 전부 uploaded일 때만, 칩 미실측이면 partial | 화면 확인 없이 completed 금지와 일관 | prefilled를 ok 취급 |
| 25MB 초과는 주입 전 걸러 skipped, Drive 대화상자 미조작, 예상 밖 대화상자는 DIALOG_SHOWN 실패 | 외부 저장 발생을 자동화하지 않음, 일부라도 자동 첨부가 유용 | Drive 전환 자동 클릭, 전체 첨부 포기, 큰 파일부터 제외 |
| 첨부 버튼 클릭 금지, input 주입 후 실패 시 drop | OS 파일 선택 창이 열림 | 버튼 클릭 경로 |
| pendingSelector(scope 범위) 신설 | 진행 표시가 항목 바깥에 있을 가능성(실측상 컨테이너 다름) | itemProgress만 |
| Gmail 감지 타임아웃 30초 | 사용자 조작 없음, 120초는 실패만 늦춤 | 120초 유지 |

## 미결(실측 후 결정)
| 항목 | 시점 | 미결 시 동작 |
|---|---|---|
| compose.scope | R1, R3 | verified 금지 |
| 첨부 버튼 클릭 전 Filedata 존재 | R1 | 없으면 methods ['drop'], dropZone은 R5 |
| pendingSelector/itemProgress, 완료 표식, itemError | R2 | verified 금지 |
| blockingDialog | R4 | 타임아웃으로만 실패(허용) |
| 25MB 파일별/합계 | R4 | 둘 다 25MB 유지 |
| to/cc 칩 | R1 | to/cc prefilled 유지, 결과 partial |
| subjectbox 값 = 주소 제목 일치 | R1 | 불일치 사례 시 정규화 규칙 조정 |
| 영어 UI | 3차 | selectorOverrides |

## 보고 형식
결론, 변경 파일 경로, 테스트 결과, 명세와 다르게 한 점과 이유, 실패 항목. 한국어로 작성, 가운뎃점 금지.
