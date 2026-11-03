# Gmail 자동 첨부 이어서 하기 (세션 인계)

작성: 2026-10-19. 새 세션은 이 파일과 `.claude/specs/gmail-attach.md`(명세)를 먼저 읽는다.

## 한눈에
- 목표: BidMate가 주소로 연 Gmail 작성 창에 공고 첨부파일을 자동으로 넣고 업로드 완료를 확인한다.
- 완료: S0(probe 보완), S1(엔진 scope/anchor), S2(프로토콜, 릴레이, CS), S3(planCompose, compose-job, 첨부 선별). 리뷰 Critical 1건 수정 후 테스트 866건, 타입체크, 빌드 통과.
- 남은 것: 사용자 실측 R1~R4 → S4(gmail-v1 셀렉터 값) → 수동 검증 후 verified → S5(UI 문구) → S6(문서).
- 지금 gmail-v1은 여전히 `unverified`(빈 값)라 실제 동작은 1차(주소 방식, 첨부 수동)와 같다. 2차 코드는 셀렉터 값이 채워져야 동작한다.

## 1. 사용자가 할 일: 실측 녹화 R1~R4
준비
1. 최신 코드를 받아 `npm install`, `npm run build` 후 Chrome 확장 관리에서 `dist/chrome-mv3`를 로드(또는 새로고침).
2. 대시보드 설정의 "메일 서비스"에서 메일 작성 서비스를 Gmail로, `mail.google.com` 권한 허용. 나라장터 서비스키와 저장 폴더도 설정.
3. Gmail 표시 언어는 한국어(셀렉터가 한글 aria-label에 의존).
4. 파일 준비: 15~20MB 1개, 이름 60자 이상 작은 파일 1개, 30MB 초과 1개, 15MB 정도 2개.
5. Gmail 탭 새로고침.

공통: 사이드패널 [진단] 탭 사용. 보내기는 절대 누르지 않는다.

R1. BidMate로 연 화면 구조
1. 공고에서 [메일 작성]으로 Gmail 작성 창을 연다.
2. 그 탭에서 프리셋 [R1 화면 구조] → [inspect 실행].
3. [스냅샷].
4. 눈으로 확인해 기록: 작성 화면만 크게 떴는지 받은편지함 위 작은 창인지 / 제목칸 내용이 BidMate 제목과 같은지.

R2. 첨부 업로드 (R1과 같은 탭)
1. 프리셋 [R2 첨부 업로드] → [녹화 시작].
2. 클립 아이콘으로 15~20MB 파일 1개 첨부, 업로드 완료 후 10초 대기.
3. 이름이 긴 작은 파일 1개 추가 첨부.
4. [정지 후 저장].

R3. 작성 창 2개
1. 받은편지함 탭에서 [편지쓰기] 두 번, 제목 "A", "B" 입력, 하나는 최소화.
2. 프리셋 [R1 화면 구조] → [inspect 실행], 이어서 [스냅샷].

R4. 25MB 초과 대화상자 (녹화 중에는 inspect가 비활성이라 녹화하지 않는다)
1. 아무 작성 창에서 30MB 초과 파일 첨부 시도.
2. 대화상자가 떠 있는 상태로 프리셋 [R4 대화상자] → [inspect 실행]. 대화상자는 취소.
3. 15MB 파일 2개를 차례로 첨부, 두 번째에서 대화상자가 뜨는지 기록. 뜨면 같은 방법으로 inspect 1회 더.

산출물: 내려받은 `bidmate-probe-mail.google.com-*.json` 전부를 `docs/probe/`에 넣고, R1과 R4에서 눈으로 본 것을 세션에 알려 준다. R5(끌어다 놓기)는 첨부 입력란이 동작하면 생략.

## 2. 새 세션(Claude)이 할 일
1. 실측 분석: 리포트에서 명세 "미결" 표 항목을 확정한다(compose.scope 컨테이너, 첨부 버튼 클릭 전 Filedata input 존재, progressbar가 `.dL` 안/밖과 완료 표식, itemError, blockingDialog, 25MB 파일별/합계, to/cc 칩 구조, 제목 일치). 분석 방법은 python으로 json을 걸러 본다(파일이 1MB 안팎). 첫 실측 리포트 `docs/probe/bidmate-probe-mail.google.com-20261019-002623.json`도 참고.
2. S4: `src/adapters/gmail/selectors/gmail-v1.ts`에 명세 S4의 확정 값과 실측 값을 채운다. 셀렉터 값 추정 금지. scope 없이, 첨부 완료 표식 없이 verified 금지. 동적 id(`:xx`), `__fupc-*` id, 실측으로 확인 안 된 짧은 클래스 금지.
3. 수동 검증: 명세 "수동 검증" 6항목을 사용자와 진행하고 `docs/gmail-verification.md`에 기록한 뒤에만 `status: 'verified'`, `version: '1.0.0'`.
4. S5(UI 문구), S6(문서: compose-flow.md, architecture.md, decisions.md에 셀렉터 근거).
5. 실측 결과가 설계 가정과 어긋나면(예: 전체화면이 아니라 받은편지함 위 팝업, Filedata input이 버튼 클릭 전에 없음, 진행 표시 위치가 예상과 다름) 구현 전에 사용자에게 알리고 Fable 확인을 거친다.

## 3. 이번 세션에서 정해진 것 (명세에 없는 구현 판단)
- detect의 완화 규칙(비어 있지 않은 셀렉터만 검사)은 scope가 설정된 경우에만 적용. scope 미설정(naverworks)은 종전과 동일.
- 첨부 error: scope가 처음부터 안 잡히면 SCOPE_NOT_FOUND/SCOPE_AMBIGUOUS, 잡았던 창을 잃으면 SCOPE_LOST.
- 제목 앵커 없이 잃은 창은 다시 고르지 않는다. 앵커가 있으면 같은 제목으로 재해석.
- 본문 탐색도 scope 안에서만(리뷰 Critical 수정). scope 미해석이면 본문 읽기/쓰기 안 함.
- `ComposeState.supported.to/cc`는 칩 셀렉터 기준(칩 미실측이면 to/cc는 prefilled 유지, 결과 partial).
- 주소 방식 본문 대조는 공백을 모두 뺀 길이끼리 0.8배 비교(textContent가 줄바꿈을 잃음).
- `compose/fill`은 4필드 전부면 `fields`를 보내지 않음(naverworks payload 불변).
- 감지 reason이 여러 프레임에서 오면 SCOPE_AMBIGUOUS 우선.

## 4. 주의
- 같은 저장소에서 다른 Claude 세션이 대시보드(수신자, 템플릿, html, wxt.config, popup, sidepanel/App.tsx, ui/components/Select.tsx)를 병행 작업했다. 커밋 전 `git status`로 섞인 변경을 확인하고, 이 작업 범위만 다룰지 사용자에게 묻는다.
- 저장소 맨 위의 빈 파일 `$f`는 다른 세션의 셸 실수로 보인다. 사용자 확인 전 삭제하지 않았다.
- Chrome 확장 ID는 로드 경로로 정해진다(manifest에 key 없음). 다른 컴퓨터에서 로드하면 ID가 달라 설정, 수신자, 템플릿을 다시 넣어야 한다.
- 규칙: 전송 자동 클릭 금지, Gmail "파일 첨부" 버튼 클릭 금지, Drive 전환 대화상자 조작 금지, 화면 확인 없이 completed 금지, 가운뎃점 문자 금지.

## 5. 관련 파일
- 명세: `.claude/specs/gmail-attach.md`, 1차 명세 `.claude/specs/done/gmail-provider.md`, 결정 `.claude/specs/decisions.md`(맨 끝 두 절)
- 엔진: `src/adapters/naverworks/engine.ts`, `src/adapters/naverworks/types.ts`
- Gmail: `src/adapters/gmail/selectors/gmail-v1.ts`, `src/adapters/gmail/compose-url.ts`
- 흐름: `src/engine/mail/compose-plan.ts`, `src/engine/mail/attach-limits.ts`, `src/engine/jobs/compose-job.ts`, `src/background/compose-relay.ts`, `src/entrypoints/naverworks-compose.ts`, `src/messaging/protocol.ts`
- 진단: `src/entrypoints/probe.ts`, `src/entrypoints/sidepanel/probe-runner.ts`, `src/entrypoints/sidepanel/DiagnosticsSection.tsx`
- 테스트: `tests/adapters/engine.test.ts`, `tests/engine/compose-job.test.ts`, `tests/engine/compose-plan.test.ts`, `tests/engine/attach-limits.test.ts`, `tests/adapters/compose-cs-fill.test.ts`, `tests/background/compose-relay.test.ts`, `tests/ui/probe-inspect.test.ts`

## 6. 실측 결과 1차 (2026-11-03, R1 + R2 일부)
파일: `docs/probe/bidmate-probe-mail.google.com-20261103-210450.json`(R1 inspect), `...-212816.json`(R2 녹화)
- 화면: 주소 방식은 작성 화면 단독(제목 "편지쓰기 - ... - Gmail", 본문 폭 954px). 사용자 육안 확인은 아직 없음.
- scope 후보: `div[role="region"]`(class aoI). aria-label이 제목과 같음("[입찰공고 공유] ..."), subjectbox, 본문, Filedata, 첨부 목록(.dL), 보내기 버튼이 모두 그 안에 있음. 작성 창 2개에서 구분되는지는 R3 필요.
- 제목: region aria-label이 주소의 su와 일치(간접 확인).
- Filedata: 첨부 버튼 클릭 전부터 존재(`td > div.bAK > input[type=file][name=Filedata][multiple]`, 첨부 후 같은 자리에 새로 만들어짐). methods는 input 가능.
- to 칩: `div[aria-label="받는사람"]` 안 `[role="listbox"][aria-label="검색창"] > ... [role="option"][data-hovercard-id]`. 주소 to는 1명인데 칩이 2개(본인 gmail 포함)로 보임, 원인 미확인.
- 첨부 항목 `.dL`(region 안, `div.GM` 아래). 상태는 aria-label로 구분:
  - 업로드 중: "첨부파일 업로드 중: {이름}. ..." + 안에 `[role="progressbar"]`(div.dR, aria-valuenow)
  - 저장 중: "첨부파일({이름})을 저장 중입니다. ..." + progressbar 100
  - 완료: "첨부파일: {이름}. 파일을 보려면 ..." + `input[type=hidden][name="attach"]`, progressbar 없음
  - 이름 `.vI`, 크기 `.vJ` "(2,791K)", 삭제 `[aria-label="첨부파일 삭제"]`
  - progressbar는 .dL 안. 실패 표시, 긴 이름 절단은 미관측.
- 25MB 초과(52MB 1개): 작성 창 밖 body 직속 `[role="dialog"]`(문구 "첨부파일 크기가 25MB 이상입니다. Google Drive 링크로...")가 뜨고 **Drive 업로드가 자동으로 시작됨**(upload/drive/resumable). 파일별 한도는 확인, 합계 한도는 미확인. 확장은 25MB 초과 파일을 절대 넣지 않아야 함(attach-limits 유지).
- 52MB Drive 대화상자는 사용자가 취소함(2026-11-03 확인). 취소 버튼 클릭 뒤 대화상자 닫힘.
- 남은 실측: R2 긴 이름 파일, R3 작성 창 2개, R4 15MB+15MB 합계, R1 육안 확인.

## 7. 실측 결과 2차 (2026-11-03, R3)
파일: `docs/probe/bidmate-probe-mail.google.com-20261103-213623.json`(받은편지함, 작성 창 A(최소화), B)
- `div[role="region"]`(class aoI)이 창마다 하나씩, aria-label이 각 제목("A", "B"). subjectbox, 본문, Filedata, [command="Files"]가 각 region 안에만 있음. scope 구분 확정, 제목 anchor는 region aria-label로 가능.
- 최소화된 창(A)도 DOM에 subjectbox, Filedata가 그대로 있음(dialog class에 oO6Gqe 추가).
- **주의**: 받은편지함 작성 창은 바깥 컨테이너가 `[role="dialog"]`(div.nH.Hd)임. blockingDialog를 `[role="dialog"]`로만 잡으면 작성 창 자체를 막힘으로 오판. 25MB 대화상자는 body 직속 `div.uW2Fw-bHo[role="dialog"]`로 구조가 다름. blockingDialog는 region을 포함하지 않는 dialog로 한정해야 함(엔진 지원 여부 확인 필요).
- 페이지 전체에 region이 더 있는지는 미확인. scope는 `div[role="region"]:has(input[name="subjectbox"])` 형태로 좁히는 것을 우선 검토.
- 남은 실측: R4 15MB+15MB 합계, R2 긴 이름 파일, R1 육안 확인.

## 8. 실측 결과 3차 (2026-11-03, R4)
파일: `docs/probe/bidmate-probe-mail.google.com-20261103-213833.json`(녹화), `...-213836.json`(inspect)
- 이미 20,765K 첨부가 끝난 창에 19.4MB 파일을 추가하자 25MB 대화상자가 뜸. 각 파일은 25MB 미만이므로 **한도는 합계 기준**으로 확정. gmail-v1 limits에 perFileBytes와 totalBytes를 모두 넣어야 함(attach-limits.ts가 PROVIDER_TOTAL_LIMIT로 건너뜀).
- 이번에는 사용자 조작 없이 Drive 업로드가 100%까지 진행된 뒤 대화상자가 **스스로 닫히고**, 본문에 Drive 링크 칩(`div.gmail_chip.gmail_drive_chip`)이 들어감. 첨부 목록(.dL)에는 항목이 생기지 않음. 즉 한도를 넘기면 실패 표시 없이 Drive 링크로 바뀜. 대화상자는 약 3.7초만 떠 있어 blockingDialog로 잡기 어려움. 예방은 합계 한도 사전 차단뿐.
- 그 뒤 body 직속에 Drive 공유 대화상자(`[role="dialog"][guidedhelpid="drive_share_dialog"]`, aria-hidden="true", 화면 밖)가 남음. blockingDialog는 `[role="dialog"]:not(:has([role="region"])):not([aria-hidden="true"])` 수준으로 좁혀야 오판이 없음.
- 제목이 빈 작성 창의 region aria-label은 "새 메일".
- 남은 실측: R2 긴 이름 파일, R1 육안 확인, 받는 사람 칩 2개 원인.

## 9. S4 구현 (2026-11-03)
- 반영: types.ts attach에 itemLabelAttr, itemDone, convertedMarker. engine.ts에 labelHasName(경계 포함 대조), itemUploading의 itemDone 조건, attachFile의 blocked()(DRIVE_CONVERTED 우선). gmail-v1.ts 값 채움(status unverified 유지, version 0.9.0-unverified). 결정은 decisions.md 2026-11-03 절.
- 네이버웍스: 새 필드가 없으면 기존 경로 그대로(리뷰 확인). naverworks-v1.ts는 손대지 않음.
- 리뷰 Minor 반영 메모:
  - 실제 25MB 초과 시 경고창이 Drive 칩보다 먼저 떠서 대부분 DIALOG_SHOWN으로 끝난다. 실패를 돌려준 뒤에도 Gmail은 Drive 업로드를 계속해 본문에 링크를 넣을 수 있다. 실제 예방은 limits 사전 차단뿐.
  - blockingDialog의 :has 셀렉터는 jsdom 테스트로 검증되지 않는다. 수동 검증에서 받은편지함 작성 창 첨부가 DIALOG_SHOWN으로 오판되지 않는지 확인.
- 화면 문구(DRIVE_CONVERTED 안내)는 S5에서. 현재 첨부 실패 사유는 툴팁에 코드로만 보인다.
- 수동 검증은 gmail-v1 status를 selectorOverrides로 verified로 덮어쓰거나, 검증용 빌드에서 임시로 verified로 바꿔 진행해야 한다(compose-plan.ts 49행이 verified일 때만 셀렉터 사용). 방법은 사용자와 정한다.
- 수동 검증 추가 항목(Fable): 7 긴 이름/한글 공백 파일, 8 이미 15MB 첨부된 창에서 15MB 재실행(DRIVE_CONVERTED 또는 DIALOG_SHOWN, 중복 항목 없음), 9 합계 24~25MB 두 파일 uploaded. 기존 4번은 30MB 1개 PROVIDER_FILE_LIMIT, 15+15 두 번째 PROVIDER_TOTAL_LIMIT로 보강. 추가로 받은편지함 작성 창 첨부 시 DIALOG_SHOWN 오판 없음.
