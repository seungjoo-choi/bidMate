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
