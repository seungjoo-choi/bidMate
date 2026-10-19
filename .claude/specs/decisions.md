# 설계 결정 기록

## 2026-10-17, BidMate 최초 아키텍처 (Fable)
상세: `.claude/specs/architecture.md`

| 결정 | 이유 | 기각 대안 |
|---|---|---|
| 파일 I/O 단일 작성자 = offscreen 문서 | SW는 유휴 종료/Worker 불가, dashboard는 탭이라 닫힐 수 있음 | SW에서 I/O / dashboard에서 I/O |
| UI는 storage.session 잡 상태 구독 | 늦게 열린 UI도 즉시 렌더, 수신자 없는 메시지 오류 회피 | 진행 이벤트를 각 UI로 push |
| 사이트 CS 전부 동적 등록(optional_host_permissions) | 트래커봇/웹메일 호스트가 설정값 | manifest 정적 host_permissions |
| 네이버웍스 어댑터 = 범용 엔진 + SelectorSet JSON | 사이트 변경 시 셀렉터 교체로 흡수 | 사이트별 하드코딩 클래스 |
| DOM 디스패치는 dom-actions.ts 단일 모듈 + 전송 가드(셀렉터/텍스트/modifier 키/submit 금지) | 자동 전송 원천 차단 | 전송 버튼 셀렉터 금지만 |
| 첨부 = offscreen에서 파일 읽음 → SW 릴레이 → CS가 청크 base64로 File 재구성 → input/drop/paste | 메시지 직렬화 제약, offscreen은 tabs API 없음 | chrome.downloads 경유 |
| 빌드 = WXT (실패 시 수동 Vite) | MV3 멀티 엔트리/동적 CS/Shadow UI 지원 | crxjs(유지보수 공백), 수동 Vite |
| noticeId = `${noticeNo}-${round}`, 폴더 경로 생성 시 고정 | 멱등성/제목 변경에 안정 | 매번 제목으로 경로 계산 |
| 네이버웍스 DOM은 probe 리포트로 확정 후 셀렉터 작성 | 미확인 셀렉터 가정 금지 요구 | 추정 셀렉터 |

## 2026-10-17, P1-0 실측 결과 (사용자 확인)
| 결정 | 이유 | 기각 대안 |
|---|---|---|
| offscreen 문서를 FSA 단일 작성자로 유지 | 실측: offscreen에서 쓰기/읽기/삭제 성공 | 고정 탭 엔진으로 이전 |
| 폴더 권한은 세션마다 재승인 1회를 전제로 UX 설계: 잡 시작 시 `NEEDS_FS_PERMISSION`이면 그 자리(popup/sidepanel/플로팅 패널)에서 [폴더 접근 허용] 1클릭 | 실측: 브라우저 재시작 후 `prompt`, 재승인 창에 상시 허용 옵션 없음(허용/허용 안 함만) | 영속 권한 가정 |
| 네이버웍스 연동(P1-1 녹화 이후)은 보류, Phase 2(나라장터 수집)를 먼저 진행 | 개발 PC에서 네이버웍스 네트워크 차단, 사용자 지시 | 원래 순서 유지 |
| 프로젝트명 BidMate 확정(2026-10-18, TenderMate에서 변경: 입찰은 tender가 아니라 bid) | 사용자 지시 | 가칭 BidFlow, TenderMate |

## 2026-10-17, Phase 2 나라장터 실측 (메인)
실측 근거: `docs/probe/bidmate-probe-www.g2b.go.kr-*.json`, `tests/fixtures/g2b-servc-R26BK01722175.json`
| 결정 | 이유 | 기각 대안 |
|---|---|---|
| 기본정보/일정/첨부목록은 OpenAPI `BidPublicInfoService/getBidPblancListInfo{Servc,Thng,Cnstwk,Frgcpt}` `inqryDiv=2&bidNtceNo=` 단건 조회(유형 순차 시도) | 실측: 단건 조회 동작, 물품 API는 0건 | 목록 조회 후 필터 |
| 첨부 다운로드 = API `ntceSpecDocUrl1..10`/`ntceSpecFileNm1..10`을 offscreen에서 GET → FSA 스트리밍 | 실측: 로그인 없이 200, content-length/content-disposition 제공 | 나라장터 RaonK 다운로드 UI 자동화(기본 다운로드 폴더로만 저장됨) |
| 나라장터 화면값은 content script가 `#mf_wfm_container_mainWframe` 안 `input.w2input_readonly[title="…"]`의 value(보이는 것만)로 읽어 job/start에 동봉 (architecture §4.2의 'offscreen에서 html 어댑터 실행'을 변경) | WebSquare SPA라 URL이 고정이고 id(wq_uuid_*)는 동적, title은 한글 항목명으로 안정. offscreen에서 SPA fetch 불가 | id 셀렉터 / offscreen HTML fetch |
| 공고 식별: 화면 `title="입찰공고번호"` 값 또는 링크 URL `/link/PNPE027_01/single/?bidPbancNo=&bidPbancOrd=` | 새 나라장터는 URL에 공고번호 없음 | URL 파싱만 |
| 고정 호스트 `https://apis.data.go.kr/*`, `https://www.g2b.go.kr/*`는 manifest host_permissions에 정적 등록 | 설정값이 아닌 고정 호스트, offscreen fetch CORS 회피 | 런타임 요청 |
| 공고 폴더명 `notices/<게시연도>/<공고번호>-<차수>_<공고명40자>` | 정정공고(차수) 구분. 요구사항 예시(`R26BK…_사업명`)에 차수 추가 | 차수 없는 폴더 |

## 2026-10-17, 잡 생명주기 재설계 (Fable)
상세: `.claude/specs/job-lifecycle.md`
| 결정 | 이유 | 기각 대안 |
|---|---|---|
| 실행 중 여부의 권위/입장 검사 = offscreen `JobRegistry` 한 곳, SW ledger는 미러 | SW ledger 선판정과 현실 불일치가 동시 실행 버그의 근원 | SW 1차 + offscreen 2차 검사 |
| 시간 기반 stale/heartbeat 폐기, 정합은 `job/status` 질의/`job/run` 응답의 active 목록 | 시간으로 실행 여부를 추정하면 긴 다운로드를 오판 | 10분 STALE / heartbeat |
| `cancelling` 중간 상태, FINAL 덮어쓰기 금지, progress/finish에 attempt 가드 | 늦은 finish가 cancelled를 completed로 덮던 문제 | 즉시 cancelled 확정 |
| cancelling 탈출은 사용자 force = `offscreen.closeDocument()` | 실제 정지를 보장하는 유일한 방법 | cancelling 타임아웃 |
| 병합은 수집 1회당 [api, html] 단일 호출, 다시 조회한 출처의 값만 needs_review로 강등 (메인) | 2단계 병합 시 화면 전용 필드가 매번 needs_review | 2단계 병합 |

## 2026-10-17, Stage B 메시지 신뢰 경계 (메인)
| 결정 | 이유 | 기각 대안 |
|---|---|---|
| SW는 `senderKind`로 발신자를 extension(확장 페이지)/g2b(나라장터 탭 CS)/unknown으로 판별. g2b는 자기 탭(originTabId)/같은 공고의 잡만 조회/재시도/취소, unknown은 job/* 거부 | 대시보드도 탭이라 `sender.tab` 유무로는 구분 불가 | sender.tab 유무로 판별 |
| `job/progress`/`job/finish`/`engine/ready`는 offscreen.html 발신만 수용 | 엔진 보고 위조 차단 | 발신자 무검사 |
| CS의 잡 복원은 페이지와 공유되는 sessionStorage 대신 SW `job/latest-for-tab` 질의 | 페이지 스크립트가 sessionStorage를 읽고 위조 가능 | sessionStorage |
| 나라장터 화면값은 API에 없는 항목(eligibility/proposalPeriod/proposalEvalAt/differentialScoring/projectPeriod)만 읽음. 그리드는 헤더 이름으로만 열을 찾고 못 찾으면 생략 | 표기 차이로 인한 거짓 충돌/오판 방지 | 전 항목 대조 / 고정 열 번호 |

## 2026-10-17, 나라장터 document.open 대응 (메인, 실측)
| 결정 | 이유 | 기각 대안 |
|---|---|---|
| g2b content script는 1초 간격으로 body 교체/패널 분리를 확인해 패널을 재부착하고 controller 감시를 새 body에 재연결 | 실측: WebSquare가 로딩 중 `document.open()`으로 문서를 재작성해 붙여 둔 UI/MutationObserver/document 리스너가 조용히 사라짐(헤드리스 CDP 재현) | 1회 mount |
| 공고번호 정규식은 `R26BK01722175 - 000`(하이픈 앞뒤 공백) 허용 | 실측: 화면 입찰공고번호 input 값 형식 | 공백 없는 형식만 |
| `debugger`를 optional_permissions에서 제거 | Chrome이 debugger를 선택 권한으로 허용하지 않음(설치 경고). 네이버웍스 2차 입력 수단이 필요해질 때 재결정 | 필수 권한으로 승격 |

## 2026-10-17, 폴더 권한 실측 갱신 (사용자 확인)
| 결정 | 이유 | 기각 대안 |
|---|---|---|
| 폴더 권한은 첫 재요청 때 Chrome이 보여 주는 "방문할 때마다 허용"으로 영구화. 앞선 "세션마다 재승인 1회 전제" 결정을 대체(재승인 UX는 예외 경로로 유지) | 실측: 두 번째 requestPermission 프롬프트에 3지선다가 나타났고, 선택 후 재요청 없음 | 세션마다 재승인 |

## 2026-10-17, Phase 4 첨부문서 분석 설계 (Fable)
상세: `.claude/specs/phase4-design.md`, 실측: `.claude/specs/phase4-research.md`
| 결정 | 이유 | 기각 대안 |
|---|---|---|
| 파서는 offscreen 메인 스레드 + 협력적 yield, pdfjs worker만 사용 (architecture §1 "DocumentParser(Worker)" 대체) | DOMParser는 Worker에 없음, 실측 파싱 비용 ms~수백 ms | 전용 파서 Worker |
| HWP5 자체 구현(cfb + DecompressionStream deflate-raw + 레코드 level 스택) | hwp.js 실측 실패, 검증기로 표 위치까지 복원 | hwp.js / 로컬 보조 프로그램 |
| PDF는 줄 단위 문단만, 표 복원 안 함; hwp 쌍둥이 우선 | pdfjs 텍스트는 공백 누락/구조 없음 | PDF 표 휴리스틱 |
| 규칙 = JSON(strategy 5종 + 동의어) + strict 결정기 | 코드 수정 없이 확장, 자동 확정 금지 | 하드코딩 정규식 |
| Extraction 평탄화(items 키 = NoticeEvaluation 키) | 병합/검수/템플릿 1:1 | 요구사항 예시 중첩 구조 |
| 문서 값은 `mergeDocumentLayer`로 api/html 뒤에 병합 | API→HTML→첨부 우선순위, 덮어쓰기 방지 | document 단독 레이어 |
| extract = collect 선택 step + 단독 extract 잡, 공통 runExtractStep | 한 클릭 흐름 + 재추출 | 별도 잡만 / step만 |
| form/reference 파일, 2단계 이상 중첩 zip은 파싱 안 함 | 규정집은 이 공고 값이 아님 | 전부 파싱 |
| OCR/HWP3/로컬 보조 프로그램 제외, 누적 비율로 재검토 | 비용 대비 효과 미확인 | Tesseract.js |

## 2026-10-17 HWP 압축 해제를 fflate로 교체
- 무엇: `src/engine/parsers/hwp5/cfb.ts`의 `inflateRaw`를 `DecompressionStream('deflate-raw')`에서 fflate `Inflate` 스트리밍(64KB 입력 단위, 단위마다 취소/기한 확인, 출력 상한 유지)으로 바꿨다.
- 왜: Chrome은 압축 끝 뒤 여분 바이트를 "Junk found after end of compressed data" 오류로 처리하고, 실제 HWP 섹션 스트림에는 여분이 있다. Node의 구현은 여분을 허용해서 테스트에서는 드러나지 않았다(실사용에서 HWP 3개 모두 손상으로 판정).
- 기각: DecompressionStream 오류를 잡고 그때까지 받은 출력을 쓰는 방식. 오류 시점과 출력 완결 여부를 구분할 수 없다.

## 2026-10-17 축산물품질평가원 35건 점검으로 규칙 보정
- 점검 세트: OpenAPI로 받은 축산물품질평가원 SW/정보화 용역 35건(2024-10 ~ 2026-10). 스크립트와 첨부는 scratchpad/batch(프로젝트 밖)에 있고 저장소에는 넣지 않는다. 대표 문구는 tests/extraction/regex-cases.test.ts에 실측 사례로 고정했다.
- 질의답변: 표 첫 열에 "답변/회신" 행이 있으면 번호/"질의" 행을 근거에서 뺀다(`src/core/extraction/qna.ts`). 줄 번호를 원문과 맞추려고 renderText 뒤에 거른다.
- 차등점수제: "차등점수제(배점3점) 적용", "차등점수제를 미적용한", "차등점수(3점)를 부여하여" 형태를 받는다(괄호 20자 이내, 를/을, "부여"=적용).
- 인정조건 앵커: "유사용역의 정의", "유사사업은", "유사사업 범위 :"를 추가했다. "실적 인정 범위는 제안요청서에 정하되", "실적 인정 범위와 …"는 평가기준 상투 문구라서 제외한다. 이 때문에 카라바오 질의답변 답변("제안요청서에 명시된 기준을 적용")도 빠져, 인정조건이 verified가 됐다.
- 인정기간: 창업기업 예외는 후보에서 뺀다. 뒤가 "에 사업을 개시/창업"이거나, 앞 20자 안에 "창업"이 있고 그 사이에 다른 "N년"이 없을 때다. 글자 수만으로는 "창업기업에 대해서는 최근 7년간"(9자)과 "창업 후 7년 이내 기업은 최근 3년"(10자)을 가를 수 없어서 이 기준을 택했다.
- 수행실적 라벨 동의어: "실적", "유사사업", "유사용역"을 뺐다. "실적"이 "현실적으로"에 매치되고, 유사사업은 정성평가 항목("유사 사업 수행 여부")에 걸렸다. 남긴 것: 수행실적, 실적평가, 사업실적, 이행실적, 용역실적.
- 파일 분류: 파일명에서 공고명(공백 무시)을 지운 뒤 분류한다. "내부규정관리시스템 … 입찰공고문"이 "규정"으로 참고자료가 되던 문제.
- 인정금액: 이 기관은 고정 금액 대신 "사업규모 대비 수행실적 비율"로 평가하므로, 못 찾음이 맞는 결과다. 비율 기준 표시는 보류했다.
- 경영상태를 대외신인도와 별도 항목으로 분리(사용자 결정): 아래 "경영상태 항목 분리"에서 완료.
- 리뷰 반영: 차등점수제는 "적용 여부" 서식 제목과 "부여하지 않음/적용하지 아니한다" 같은 부정문을 적용으로 읽지 않는다. 분류는 공고명을 지운 이름으로 판정이 안 되면 원래 이름으로 다시 판정한다. 질의답변 라벨에서 등급표와 겹치는 단독 "A"를 뺐다.

## 2026-10-17 여러 기관 50건 점검으로 규칙 보정
- 점검 세트 2: OpenAPI 조건 검색으로 최근 3개월 SW/정보화 용역(키워드: 시스템 구축/고도화, 정보화, 플랫폼 구축, 유지관리, 홈페이지)을 기관당 2건씩 고르고, 수의계약과 무관한 공고(폐기물, 장비 임차 등)를 뺀 50건. 스크립트와 첨부는 scratchpad/batch.
- 배점: 0점은 배점 후보가 아니다("0점 처리"). table-score는 신용등급 기호(AAA, AA+, BBB, BB-, CCC, A2- 등)나 "에 준하는 등급"이 있는 행을 등급별 점수표 행으로 보고 버린다. 처음에는 "한 표의 같은 라벨 값이 3가지 이상이면 표 전체를 버림"으로 했으나, 리뷰에서 정상 배점표의 여러 행(유사사업 수행실적 10, 참여인력 수행실적 5 …)까지 지운다는 지적이 있어 행 단위 판정으로 바꿨다.
- 인정조건: 앵커에 "*유사사업:", "유사실적:", "유사사업 인정범위 :"를 추가했다. 앵커 줄에 콜론 뒤 내용이 8자 이상 있으면 다음 줄이 바로 번호 항목이어도 한 줄을 캡처한다. 같은 문서에서 정의 문장이 여러 개면 충돌(확인 필요)로 남긴다. 어느 문장이 맞는지는 사람이 고른다.
- 분류: "예규", "일반조건"을 참고자료로 본다(법제처 HWPML 형식 계약예규가 .hwpx로 올라온 사례).
- 보류: PDF 표가 "1 제안업체의 경영상태(기업신용평가등급) 5"처럼 "점" 없는 한 줄로 풀린 경우(85건 중 1건). HWPML 형식 파서.
- 실측상 못 찾음이 맞는 경우: 실적과 무관한 "원 이상"(계약금액, 사업금액 하한), 정량평가 항목이 없는 공고.

## 2026-10-17 경영상태 항목 분리 (Fable 설계, 명세 .claude/specs/management-split.md)
- 새 추출 항목 managementScore("경영상태 배점")를 credibilityScore 바로 뒤에 추가했다. 동의어: credibility = 대외신인도, 신인도 / management = 경영상태, 신용평가등급, 신용평가, 신용도. 규칙 mgmt.table, mgmt.inline, rules version 1.1.0.
- 사실 정정: 카라바오(KOICA) 공고의 "4점"은 대외신인도가 아니라 제안요청서 정량평가표의 경영상태(신용평가등급) 행이었다. 분리 후 이 공고는 경영상태 4 verified, 대외신인도 not_found다.
- 저장 데이터: 파일 마이그레이션 없음. 읽을 때만 보정한다(normalizeExtraction: 빠진 항목은 not_run, fillMissingFields: 빠진 notice 필드는 missing). Extraction schemaVersion 2, Notice는 1 유지. 옛 credibilityScore 값과 userEdited는 옮기지 않고, 재추출 때 경고("이전 버전에서 직접 수정한 대외신인도 값은 경영상태 배점이었을 수 있습니다")만 남긴다. 경영상태를 이미 직접 수정했으면 경고하지 않는다.
- 사용자 규칙에서 동의어가 두 항목에 겹치면 경고만 남긴다.
- 한쪽만 있는 공고는 다른 쪽이 not_found(확인 필요)가 되는 것이 정상이다. "해당 없음 확인" 기능은 범위 밖으로 미뤘다.
- 기각: 키 이름 변경, 옛 값을 근거 문맥으로 추정 이동, 일괄 마이그레이션, 빠진 항목을 not_found로 채움, 한쪽이 있으면 다른 쪽을 자동 해당 없음으로 확정.
- 리뷰 반영: 인정조건 한 줄 캡처는 앵커 뒤 콜론 다음 본문이 8자 이상이고 "참조/따름/제안요청서에" 같은 다른 문서 안내가 아닐 때만 한다.
- 남긴 리뷰 지적: 분류에서 "일반조건/지침/규정"이 제안요청서보다 먼저 판정돼 "제안요청서(계약일반조건 포함)" 같은 묶음 파일명은 참고자료가 된다. 분류 순서는 여러 번 바뀐 이력이 있어 실제 사례가 나오면 고친다.

## 2026-10-17 점검 확대(약 400건)와 정확도 대조
- 점검 세트: 축산물품질평가원 233건(2021-10 ~ 2026-10 용역 전체), 여러 기관 170건(SW/정보화 100, 연구용역/기본계획/컨설팅 70). 파일 약 1,500개 중 실패는 스캔 PDF 6개와 HWPML 1개.
- 정확도 대조: 배점 약 220개, 기간/금액/차등점수제 약 110개, 인정조건 약 25개를 근거 행과 대조했다. 틀린 값에서 찾은 원인과 조치:
  - 차등점수제: "(차등점수제를 적용한 경우 …)" 조건문, "심사대상이 아닙니다/적용대상이 아님" 부정 표현. 부정 대상 표현은 false, 값 뒤가 "한/할/하는 경우, 시(적용시킨다/시행/시스템 제외), 아닌 경우/아닌 사업/아니면, 대상여부"면 후보가 아니다.
  - 인정금액: 금액 구간별 점수표 행("10억원 이상 : 3", "10억원 이상 3점")은 최소 인정금액이 아니다. "이상" 뒤가 콜론+숫자이거나 숫자+점일 때만 제외한다("5억원 이상 1) 서류"는 유지).
  - 경영상태/수행실적 소계 행("기업경영상태, 용역수행실적(B) 10")과 이름만 신용도인 제재 이력 행("신용도 | 입찰참가제한 업무정지 | 2"): mgmt.table은 synonyms.mgmtExclude(수행실적 계열, 입찰참가제한, 업무정지, 부정당, 제재), perf.table은 management를 excludeLabel로 쓴다. 제외 판정은 라벨 칸과 그 행에만 있는 짧은 칸(한 행 한 열, 40자 이하)에서 한다. 여러 행에 걸친 분류 칸과 긴 설명 칸은 보지 않는다(리뷰 지적).
  - 등급별 점수표: 라벨 칸에 신용등급 기호(AAA, AA+, BBB, BB-, CCC, A2- 등, "A1-1"류 번호 제외)나 "에 준하는 등급"이 있는 행은 버린다. 설명 칸은 보지 않는다(리뷰 지적: "회사채 AAA~BBB- 등급별 차등 | 10"은 정상 행). 점수 칸에 숫자가 공백으로 여러 개("6 5 4 3 2 1")면 버린다.
  - 인정조건 캡처는 평가등급표 머리글(이행실적에 따른 배점, 수행실적 평가기준, 평가등급/항목, 실적등급, 평점)에서 멈춘다.
- 연구용역은 한 공고에 기준이 여러 개(연구수행실적 3년/유사용역 5년, 단일 건 5천만원/공동수급 지분 3천만원)인 경우가 많아 충돌(확인 필요)이 늘어난다. 원문에 실제로 값이 여럿이므로 자동 확정하지 않는다.
- 남은 한계: "수행실적 및 경영상태 4점" 같은 한 줄 묶음 문장(두 항목에 같은 값), PDF 표가 "점" 없는 한 줄로 풀린 경우.

## 2026-10-17 못 찾음 점검과 기간/금액 보정 (403건)
- 못 찾음 점검: 원문에 낱말과 숫자가 함께 있는데 못 찾은 경우를 항목별로 골랐다. 배점과 차등점수제는 실제 누락이 없었다("0점 처리", 조건문뿐). 인정기간과 인정금액은 누락이 있었다.
- perfAnchor에 유사실적, 사업실적, 이행실적, 용역실적, 동등실적, 유지보수실적, 납품실적을 추가했다("최근 3년간 유사 또는 동등 실적", "관련 사업 실적").
- perf.period
  - 꼬리에 "내"(내외 제외)와 "(" 추가. "("는 괄호 안이 연도로 시작할 때만 허용한다("5년(2021. 10. 1. ~ …) 내"는 받고 "2년(준공후)", "1년(연장가능)"은 막는다).
  - 제출 서류 작성 안내는 제외한다. 숫자 뒤 25자 안에 기재, 작성, 요약, ")증명서"가 있으면 뺀다. 단 같은 문장 40자 안에 한하, 한함, 인정, 만 작성, 만 기재, 평가, 기준, N점이 있으면 기준 문장으로 보고 남긴다(카라바오 "유사사업 수행실적만 작성"의 5년).
  - 붙임, 서식, 별지로 시작하는 줄(목차)은 제외한다.
- perf.amount: 원과 이상 사이의 괄호("(VAT 포함)")와 "/건"을 허용한다. 금액 구간별 점수 행("10억원 이상 : 3", "5천만원 이상 10", "4천만원 이상 ~ 5천만원 미만 8")은 제외한다. "추정가격/예정가격/기초금액" 바로 뒤의 금액은 공고 자체 금액이라 제외한다(조사나 콜론까지만 허용. 처음 10자 범위로 했다가 "추정가격 10억원, 유사실적 5억원 이상"의 5억원까지 막아 좁혔다).
- inline-score에 excludeLabel을 추가했다(스키마 선택 필드). "수행실적 및 경영상태 4점" 같은 묶음 문장은 두 항목 모두 후보가 아니다. 앞 문맥은 15자 안에서 마지막 숫자 뒤만 본다("경영상태 5점, 수행실적 6점"의 6점은 유지).
- 리뷰 2회 반영. 남긴 Minor: "붙임 서식 3. 최근 3년간" 목차(마침표 뒤라 제외되지 않음), "최근 10년 이내 실적, 최근 3년간 기재"의 10년 누락, "최근 5년(공고일 기준) 이내" 미인식, "1억원 이상: 3,000건" 미인식.

## 2026-10-18 남은 Minor 보정 (규칙 1.1.1)
- perf.period
  - 작성 안내 제외의 25자 창은 다른 실제 기간 표현("N년 이내/간/내", 앞이 숫자가 아님)에서 멈춘다. "최근 10년 이내 실적, 최근 3년간 기재"의 10년을 살린다. 처음에는 모든 "N년"에서 멈추게 했다가 "3년간(2021년~2023년) 기재", "3년간 1년 이상 … 기재"를 기준으로 잘못 읽어 좁혔다(리뷰 지적).
  - 목차 제외에 "붙임/별지 + 서식/양식 + 번호." 분기를 추가했다("붙임 서식 3. 최근 3년간"). 번호 마침표를 일반적으로 허용하는 방식은 "붙임1. 입찰참가자격: 최근 3년간 …" 같은 본문을 지워 기각했다.
  - 꼬리에 "(…기준)" 괄호 뒤 이내/간/내를 추가했다("5년(공고일 기준) 이내"). 괄호 내용을 넓게 받으면 "계약기간 1년(계약일로부터) 이내"가 걸려 "기준"으로 끝나는 괄호만 받는다.
- perf.amount: 금액 구간 점수 제외에서 콜론 뒤 숫자가 천 단위 표기("3,000건")면 점수가 아니다. 단 뒤에 조/억/만/천/원이 오면 천 단위로 보지 않는다(공백 제거 후 "5, 100억원"이 "5,100억원"이 되기 때문).
- 분류: 파일명의 "(… 포함)" 괄호는 판정에서 뺀다("제안요청서(계약일반조건 포함)"는 제안요청서).
- 남긴 Minor: "최근 3년간(10년 이내 실적 포함) 기재"를 3년으로 읽음, "5년(공고일 기준일) 이내" 미인식, "붙임 서식 제3호.", "별첨 서식 3." 목차 미제외.

## 2026-10-18 Phase 5 관리 기능 설계 (Fable, 명세 .claude/specs/phase5-management.md)
- 수신자/그룹/템플릿은 `config/*.json` 파일(chrome.storage 아님). 쓰기는 offscreen 단일 작성자, 세 파일 공용 락 `config`. 읽기는 보정만 하고 쓰지 않으며, 손상 파일은 사용자 버튼으로만 백업 후 초기화.
- 기본 그룹/템플릿의 진실은 `isDefault`. architecture §3의 `Settings.mail.defaultGroupId/defaultTemplateId`는 쓰지 않는다(충돌 명시).
- 템플릿은 구조형(제목, 인사말, 섹션 항목, 맺음말), 변수 `{한글이름}`, 값은 전부 HTML 이스케이프. 렌더 입력은 Notice만(`renderMail(template, notice)`, architecture §3의 extraction 인자 제거, `extraction.*` fieldKey 제거).
- 기본 템플릿은 요구사항 8절 양식 그대로(사용자 결정). 추가 항목은 템플릿 편집에서 넣고 뺀다.
- 초안은 `notices/<folder>/mail-draft.json`(MailDraft) 신설. `mail.json`(ComposeRecord)은 실제 웹메일 작성 이력 전용으로 남긴다. 초안 저장은 mail.status를 drafting까지만 올린다. 전달 완료는 사용자 수동 표시.
- 메일 준비 화면 범위: 초안 저장, 복사, 전달 완료 표시까지(사용자 결정). 네이버웍스 자동 입력은 어댑터 실측 뒤.
- 홈 지표는 index.json(IndexEntry)에서만 계산. 마감 예정 7일(목록의 임박 3일과 별개), 메일 작성 대기 = none/drafting 이면서 수집 실패 아님. 대시보드 기본 화면을 홈으로 변경(사용자 결정).
- 기각: chrome.storage 저장, 수신자+그룹 한 파일, 전체 파일 put 메시지, Settings 기본값 진실, 초안을 ComposeRecord로, 자유 HTML 본문 + sanitizer, "확인 필요" 색 표시, 홈을 notice.json 전수 읽기로, 손상 자동 초기화, 차트/DnD 라이브러리, 기본 그룹 삭제 시 자동 승격, 영문 변수명 병행.

## 2026-10-18 offscreen 메시지 발신자 검사 (Fable 확인)
- 문제: offscreen의 `listen(..., 'offscreen')`은 발신자를 보지 않아, 나라장터 탭 content script가 target 'offscreen'으로 직접 보내면 SW의 `assertExtensionSender`를 건너뛰었다(config/repair, recipients/delete, 기존 notice/*, extraction/* 포함).
- 결정: "offscreen target은 SW만 보낸다"를 `bus.listen`에서 강제한다. 같은 확장 id이고 sender.tab이 없을 때만 처리하고, 아니면 SENDER_FORBIDDEN 오류로 응답한다. runtime id를 모르면 거부(fail closed). type/target 불일치 판정 뒤에 검사한다.
- 같이 고침: SW의 `fs/*` 중계, `g2b/test`, `fs/permission-granted`에 `assertExtensionSender` 추가(대시보드만 보내는 메시지). `notice/lookup`, `ui/open`은 content script가 정상 발신자라 그대로.
- 제약: 대시보드(탭 안 확장 페이지)는 offscreen에 직접 보낼 수 없다. 항상 SW를 거친다.
- 기각: offscreen main.ts 래퍼(새 핸들러 추가 때 누락 재발), sender.url 허용 조건(SW url 값 추정 의존), 무응답 거부(일관성, 테스트 가능성 열세), senderKind 재사용(offscreen 번들이 background 모듈을 끌어옴).
- 오류 응답에 선택 필드 `path` 추가(CONFIG_CORRUPT 복구 대상 판정용).

## 2026-10-18, 메일 작성 이동(compose) 설계 (Fable, 사용자 승인)
상세: `.claude/specs/compose-flow.md`

| 결정 | 이유 | 기각 대안 |
|---|---|---|
| compose 잡은 offscreen이 실행하고, 탭/주입/CS 호출은 SW에 요청/응답으로 위임. 탭과 프레임 바인딩은 SW ledger(`composeTabId`, `composeFrameId`)가 진실 | 잡 생명주기(레지스트리, abort, 재시도) 재사용, offscreen은 tabs/scripting 불가, offscreen이 임의 탭을 지정하지 못하게 함 | SW가 직접 실행 / payload에 tabId 동봉 |
| 웹메일 CS는 compose 시점에 `scripting.executeScript({files})`로 주입(unlisted script). architecture "사이트 CS 동적 등록"의 수단 변경 | 잡 중에만 코드 주입, 등록 상태 관리 불필요, probe와 같은 방식 | registerContentScripts 상시 등록 |
| 첨부 파일 청크는 Port 대신 기존 요청/응답 릴레이(응답이 ack). architecture §0/§1.1의 Port 결정을 대체 | 백프레셔 내재, 새 인프라 없음, 타입 안전 | Port 2개 브리지 |
| 긴 대기(작성 화면 감지 120초, 업로드 상태 1.5초 간격)는 offscreen 폴링 | SW 생존 보장, 취소 반응성, 진행 라벨 갱신 | 긴 pending 응답 / CS push |
| 셀렉터셋에 status(unverified/verified). unverified면 수동 모드(탭 열기 + 복사 안내, 결과 partial). 실측 전 셀렉터 추정 금지 | 개발 PC에서 네이버웍스 차단으로 실측 자료 없음, 미검증을 완료로 표시하지 않음 | 추정 셀렉터로 시도 |
| compose 재시도는 전 단계 재실행, 항상 새 탭(이전 탭은 닫지 않음) | 탭/화면 상태를 신뢰할 수 없음 | 실패 step부터 재개 |
| compose 시작은 extension 발신자만(사이드패널, 대시보드). 플로팅 패널 진입은 보류, 이후 "수집 완료 시 메일 작성 자동 시작" 토글로 검토 | 나라장터 CS 신뢰 경계 유지, 결과를 볼 곳은 사이드패널 | g2b CS 발신 허용 |
| dom-actions 단일 디스패치 모듈 강제는 소스 스캔 vitest로 | ESLint 미설치 | ESLint no-restricted-syntax |
| ComposeResult에 본문 HTML/base64를 넣지 않음. 복사 데이터는 `mail/draft-get`으로 받음 | storage.session 대용량 금지 | result에 snapshot 포함 |
| 사이드패널은 상태 화면으로 개편하되 probe UI는 하단 접힘 "개발자 진단"으로 유지 | 웹메일 실측(S6) 선행 조건 | 대시보드로 이전 / 삭제 |
| 사이드패널 재시도는 `g2b/retry`로 나라장터 CS를 거쳐 보냄 | SW의 assertRetryAllowed(같은 공고, 같은 탭) 검사를 그대로 적용 | 사이드패널이 SW에 직접 job/start(확장 발신자로 검사 생략) |

## 2026-10-18, 디자인 개편 "면과 깊이" (Fable, 사용자 승인, 명세 .claude/specs/design-depth.md)

| 결정 | 이유 | 기각 대안 |
|---|---|---|
| 색은 무채색 유지, 바탕(canvas)만 한 단 낮추고 사이드바와 카드는 surface로 띄움 | 바탕과 카드 명도 차가 거의 없던 것이 밋밋함의 원인. 변경 범위 최소 | 브랜드 색 도입, 어두운 사이드바(사용자 기각) |
| 그림자 3단(card, raised, overlay) + 색은 `--color-shade-*`로 분리해 다크에서 덮어씀 | Tailwind v4는 `--shadow-*` 값을 빌드 시 인라인하므로 다크 블록에서 shadow 자체를 덮어쓰면 효과 없음 | `shadow-sm/md` 기본값, `@utility`/인라인 box-shadow(focus ring과 충돌) |
| 카드 테두리는 라이트/다크 모두 유지 | 다크에서 그림자가 거의 보이지 않음 | 그림자만으로 경계 |
| sunken은 surface 안에서만, 카드 안 상자는 rounded-ctl, `hover:bg-canvas` 금지 | 라이트에서 sunken이 canvas보다 밝아 바탕 위에 쓰면 떠 보임 | 카드 머리글 sunken 띠 |
| 월별 수집은 세로 누적 막대(정상 먹색 + 실패 빨강), 합계 직접 표기, 세부는 툴팁 | 가로 막대 초록/빨강과 줄마다 긴 숫자 나열이 어색하다는 사용자 의견 | 가로 막대 유지 |
| 로고는 관공서 건물(먹색 사각형), 글자 없음 | 사용자 선택. 공공입찰이 바로 읽힘 | 서류+체크, T 모노그램 |

## 2026-10-18, 트래커봇 메일 [공고 수집] 버튼 STEP 1-A (Fable, 사용자 승인, 명세 .claude/specs/trackerbot-mail.md)

| 결정 | 이유 | 기각 대안 |
|---|---|---|
| 범위: 입찰정보(`bidPbancNo`) 행에만 버튼. 사전규격(`bfSpecRegNo`), 발주계획(`oderPlanNo`)은 파서만 인식하고 이후 작업 | 기존 수집 엔진(공고번호+차수) 그대로 사용. 두 종류는 번호 체계와 API가 다름 | 세 섹션 동시 지원 |
| 대상은 네이버웍스 웹메일(설정 호스트). 링크는 나라장터 직접 URL, 본문 iframe 없음(사용자 확인) | Gmail은 임시 확인용 | Gmail 지원 |
| 트래커봇 메일 CS는 설정 호스트에 registerContentScripts 상시 등록(unlisted script) | 잡 없이 읽기 화면에 버튼이 먼저 있어야 함. compose의 잡 시점 executeScript와 목적이 다름 | manifest matches, 팝업 수동 주입 |
| 메일 판별은 URL이 아니라 g2b 링크 파싱 + 표 셀 + contenteditable 제외 | 경로 미확인, SPA. 편집기 안 삽입은 발송 메일 오염 | URL 경로, 발신자 주소 |
| 버튼은 앵커 뒤 형제 shadow host, 상태는 noticeId 키 맵, 같은 공고 여러 행은 상태 공유 | 원본 노드 비수정, 이동 유발 방지 | 앵커 내부, 행 끝 새 셀, DOM에 상태 저장 |
| SW 발신자 종류 `webmail` 추가, g2b와 동일 권한(collect만, 자기 탭 잡만) | 페이지 스크립트는 runtime 메시지 불가라 경계 동일 | 웹메일 탭을 extension 취급, 발신자 무검사 |
| 링크 파서는 adapters/g2b/link.ts, 쿼리 파라미터 이름으로 3종 판정. resolveRef URL 분기는 위임(g2b 외 호스트는 null로 강화) | 세 식별자 형태가 같아 파라미터 이름만이 종류를 가름 | 경로 코드 판정, 지금 NoticeRef 스키마 확장 |
| 플로팅 패널은 포팅하지 않고 행 버튼이 상태 표시, panelView만 재사용 | PanelController는 단일 잡 결합, 공통화는 코어 리팩터링 리스크 | PanelController 즉시 공통화 |

## 2026-10-18, 수집 완료 후 메일 작성 자동 시작 (Fable, 사용자 승인, 명세 .claude/specs/auto-compose.md)

| 결정 | 이유 | 기각 대안 |
|---|---|---|
| 자동 compose 주체는 SW 종결 리스너. `JobRequest.auto`는 SW 내부 전용(외부 메시지의 auto는 버림), 사이트 CS의 compose 시작 금지(176행) 유지 | 신뢰 경계를 넓히지 않고 두 수집 경로에 한 코드로 적용 | CS가 완료 후 job/start compose, offscreen에서 collect 뒤 compose 연속 실행, UI가 session 보고 시작 |
| 종결 리스너는 serial 체인 밖(setTimeout 0)에서 dispatch | 리스너 안 startJob이 같은 체인을 기다려 멈추는 것 방지 | serial 안 직접 호출 |
| collect 잡 `handoff` 필드가 CS 표시의 기준. 자동 compose 잡은 collect의 originTabId를 상속 | CS는 자기 탭 잡만 조회 가능, 새 권한 규칙 불필요 | CS 특례 조회 |
| 자동 compose는 storage.session 큐로 한 번에 1개 | 연타 시 웹메일 탭 폭주와 포커스 다툼 방지 | 동시 시작 |
| 중복 방지는 `CollectResult.mailStatus`(ready_for_review/delivered면 생략) + 큐/ACTIVE 동일 공고 거부 | 이미 작성한 공고 재수집 시 재작성 방지 | 없음 |
| `Settings.autoCompose` 신설(토글, 수신자 기본/그룹/개별+TO/CC, 템플릿, 검수 기준). id 참조만 저장, 삭제된 그룹/템플릿은 실패(GROUP_NOT_FOUND/TEMPLATE_NOT_FOUND) | 의도하지 않은 수신자 방지, 데이터 이중화 방지 | 기본값 대체, 이메일 직접 저장, 숨은 그룹, Settings.mail.defaultGroupId 재활용 |
| 검수 기준 3단계(errors_only/conflicts/any_review), 기본 conflicts(사용자 선택) | 추출기는 not_found도 needs_review로 기록해 any_review면 자동 작성이 거의 발동 안 함 | reviewCount>0 고정 |
| 토글 하나로 자동 작성과 검수 자동 이동을 함께 켜고 끔(사용자 선택) | 단순함 | 토글 2개 |
| 검수 이동은 대시보드 탭 재사용 + 앞으로 띄움(사용자 선택), `#/review/<id>?handoff=<사유>` 배너 | 탭 누적 방지 | 항상 새 탭, 백그라운드 열기 |
| 대시보드 메일 준비 화면에 [웹메일로 작성] 추가, ComposeCard 공통화(사용자 선택) | 검수 후 진행과 트래커봇 수동 모드가 대시보드에서 끝나도록 | 사이드패널에서만 작성 |
| 수신자 저장 시 기본 그룹이 없으면 고정 id `grp-all` '전체' 그룹을 만들어 기본 지정(기존 수신자 전원 포함), 이후 신규 수신자는 '전체'에 자동 추가(사용자 선택) | 수신자만 등록해도 메일 작성이 되게. 그룹 만들기, 기본 지정 단계를 없앰 | 그룹 없으면 사용 중 수신자 전원, 현 구조 유지 |

## 2026-10-18, 메일 서비스 선택(네이버웍스/Gmail)과 Gmail 주소 방식 작성 (Fable, 사용자 승인, 명세 .claude/specs/gmail-provider.md)

| 결정 | 이유 | 기각 대안 |
|---|---|---|
| 설정은 추가만, withDefaults 깊은 병합 | 이전 코드 없이 옛 저장본이 읽힘 | providers 맵으로 재구성 |
| 작성/수신 provider 분리, 호스트는 provider별 값에서 유도 | "Gmail 수신 + 네이버웍스 작성" 표현, 공유 지점이 용도별로 둘로 갈림 | 호스트 하나 공유, 수신 호스트 별도 문자열 |
| Gmail 호스트 상수, 계정은 accountIndex | 입력 불필요, u/N은 문서화된 경로 | authuser=email, u/N 생략 |
| provider 분기는 planCompose 한 곳, compose/open은 {url, selector?} | 2차 확장이 plan 수정으로 끝남 | compose-job 안 분기 산재 |
| Gmail 1차는 partial, mode url, 필드 prefilled | 화면 확인 없이 completed 금지와 일관 | prefilled를 ok 취급 |
| 본문은 draft.text | 템플릿이 text 렌더를 이미 만듦 | HTML 태그 제거 함수 |
| 8000자 초과면 body 생략(절단 금지) | 잘린 본문 전송 위험 | 절단 + 안내 |
| Gmail 1차 작성 화면 감지 생략 | 셀렉터 없이 가능한 건 URL 추정뿐, 오판 비용 큼 | tabs.get url 확인 |
| getWebmailHost 삭제, getInboxHost/getComposeHost | 호출부마다 용도를 고르게 함 | alias 유지 |
| 실험 저장본(host가 mail.google.com) 자동 보정 | 사용자가 이미 만든 상태, 멱등 | 수동 복구 |

구현 메모 (S1~S3 구현 중 명세와 달라진 점)
- `GMAIL_HOST` 상수는 순환 import를 피하려고 `default-settings.ts`에 정의하고, `mail-provider.ts`에서 재export한다.
- `originsToRequest`는 vitest 대상이 되도록 별도 파일 `mail-service-logic.ts`로 뺐다(MailServiceCard 안에 두지 않음).
- 실험 저장본 보정은 `sites.naverworks.host`를 trim과 소문자로 바꿔 `GMAIL_HOST`와 비교한다.

## 2026-10-19 메일 템플릿 목록형 양식과 문구 항목 (Fable, 명세 .claude/specs/template-list-layout.md)

| 결정 | 이유 | 기각 대안 |
|---|---|---|
| 항목은 field/text 두 종류 | 합성 문구와 고정 문구가 text 하나로 표현되고 kind 생략은 field라 옛 데이터가 그대로 읽힘 | suffix/prefix 필드, 자유 HTML |
| 섹션에 inlineValue(제목 옆 값) | "1. 기관명 : 값" 한 줄 양식을 항목 없는 섹션으로 표현 | 제목에 변수 치환 후 빈 섹션 렌더 |
| 항목 style(bold/underline) 플래그는 값에만, HTML 출력에만 | 라벨은 고정 양식이고 text 출력과 innerText 일치 유지 | 인라인 HTML/마크다운 |
| layout은 템플릿 수준 required, 저장값 없으면 table | 옛 템플릿 출력 불변, 한 메일 안 형식 통일 | 섹션별 레이아웃, 전역 설정 |
| 메일 값 서식: 날짜는 슬래시, 금액은 콤마, 실적인정금액만 amount_short, UI 서식은 불변 | 메일 양식 요구와 검수 UI 보존을 동시에 만족, 새 함수만 추가 | 변수 수식자 문법 |
| 기본 템플릿을 목록형으로 교체하되 저장된 tpl_default는 건드리지 않고 "기본 양식으로 새로 만들기" 버튼 제공 | 사용자가 수정했을 수 있는 저장본 보호 | 자동 마이그레이션, 덮어쓰기 |
| 공동수급 "(공동이행방식)"은 미지원 | 해당 값을 추출하지 않음 | 추출 항목 추가 |
| 제목/라벨/inlineValue/문구 전부 {변수} 치환 | 기존 substitute 한 함수로 통일 | text 항목용 별도 치환 |

- 2026-10-18 기록의 "기본 템플릿은 요구사항 8절 양식 그대로"는 이번 결정으로 대체된다.

## 2026-10-19, 수신자 화면 재설계 (사용자 선택)
| 결정 | 이유 | 기각 대안 |
|---|---|---|
| 그룹 중심 2단 배치: 왼쪽 '주소록 전체'와 그룹 목록, 오른쪽에 고른 목록. 사람 등록/수정은 오른쪽 서랍 패널 | 그룹 목록, 그룹 상세, 수신자 표가 한 화면에 같이 있어 어디서 무엇을 하는지 알기 어려웠음 | 주소록/그룹 탭 분리, 기존 3카드 유지 |
| 받는 방식(TO/CC)은 화면에서 그룹 안에서만 정한다. 사람 폼의 '기본 역할' 입력 제거. 저장 형식은 그대로(defaultRole은 기존 값 유지, 새 사람은 'to'), 그룹에서 바꾸면 roleOverrides에 기록 | "기본"이 기본 그룹, 기본 역할, 역할 덮어쓰기 없음의 세 뜻으로 쓰여 혼란 | 사람 폼에 평소 받는 방식 유지 |
| 새 수신자의 '전체' 자동 편입은 `recipients/save`에 groupIds가 없을 때만. 화면은 '전체'를 미리 체크해 두고 사용자가 뺄 수 있다. 기본 그룹이 없을 때 '전체'를 만드는 동작은 유지 | 숨은 자동 편입 대신 등록 폼에서 직접 선택(사용자 선택). 2026-10-18 결정 중 "이후 신규 수신자는 '전체'에 자동 추가"를 이 조건으로 좁힘 | 항상 자동 편입 유지 |
| 화면 용어: TO/CC는 "받는 사람/참조", 기본 그룹은 "메일 기본 선택", 사용 여부는 "메일 발송" | 내부 용어가 그대로 노출돼 뜻을 알기 어려웠음 | 기존 용어 유지 |

## 2026-10-19 템플릿 본문 형식 선택 제거 (사용자 요청)
- 편집 화면의 '본문 형식'(표/번호 목록) 선택칸을 없애고 번호 목록만 쓴다. 사용자가 표 형식이 필요 없다고 판단.
- 표로 저장된 옛 템플릿은 편집기에서 목록으로 열리고, 저장하거나 복제하면 목록으로 바뀐다. 열어 보지 않은 옛 템플릿은 발송 시 여전히 표로 나갈 수 있다.
- layout 필드, 표 렌더링 코드, 저장 검증은 그대로 둔다. 기각: 표 형식 완전 제거(저장 형식 변경과 옛 템플릿 출력 변경이라 Fable 검토 대상, 사용자가 범위를 이 선에서 정함).

## 2026-10-19, Gmail 2차 작성 창 범위와 자동 첨부 (Fable, 사용자 승인, 명세 .claude/specs/gmail-attach.md)

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
- 셀렉터 확정 근거: docs/probe/bidmate-probe-mail.google.com-20261019-002623.json

## 2026-10-19, 사전규격 수집과 메일 발송 (Fable, 사용자 승인, 명세 .claude/specs/prespec-mail.md)

| 결정 | 이유 | 기각 대안 |
|---|---|---|
| `NoticeRef.kind?`(없음=bid), `NoticeKind = bid/prespec/orderplan`(orderplan 예약) | 저장본/잡/테스트 무변환, 종류 추가가 유니언 1개 | 종류별 Ref 타입, 지금 orderplan까지 지원 |
| 차수 없는 종류의 noticeId는 번호만 | normalizeNoticeKey 무수정, bid id와 문자열 충돌 없음, 폴더명 자연스러움 | `prespec_` 접두사, `-PS` 접미사, 별도 폴더 |
| `Notice.prespec` 그룹 항상 존재, 읽을 때 채움, 표시용 basic 중복 채움 | 경영상태 분리와 같은 무마이그레이션 방식, 인덱스/목록 무수정 | 선택 그룹, customFields에 저장, entryOf/화면 kind 분기 |
| 수집은 `NoticeSource` 어댑터로 fetch_basic만 분기, 다운로드/저장 공유, 사전규격 extract 항상 skipped, 단독 extract 거부 | 발주계획 추가가 source 1개로 끝남. 규격서 초안 평가항목이 검수/자동작성을 오염하지 않게 | collect-job 복제, extract 허용 |
| 사전규격 데이터 출처는 OpenAPI 사전규격정보서비스 단건 조회. 엔드포인트/필드는 실측으로 확정, 매핑은 단일 상수 표 | 입찰정보와 같은 방식, 로그인 불필요(추정) | PRVA004_02 화면 CS 읽기 |
| 중복 판정은 kind를 둘 다 알 때만 비교, lookup은 kind 필터 | compose/extract 잡은 noticeId만 가져 kind 미상 | id 문자열에 kind 인코딩 |
| `Template.kind?`(없음=bid), isDefault는 종류별 하나, 변수 레지스트리 `kinds` 필터, 별칭 금지, 내장 사전규격 템플릿 | 종류별 변수 집합이 다름. VARIABLE_BY_KEY가 Map | 템플릿 하나에 두 변수 집합, 변수 별칭 |
| `Settings.autoCompose.prespecTemplateId` | templateId와 이중 출처 방지, 발주계획은 필드 1개 추가 | `templateIds` 맵 |
| `IndexEntry.bidCloseAt`에 사전규격은 의견등록마감 | 마감 임박/마감 예정 로직 재사용 | `deadlineAt` 신설 |
| 트래커봇 사전규격 표 제목 머리글 후보에 품명/규격명 추가(실측 후 조정) | 머리글 미확인 | 고정 열 번호 |

- 2026-10-18 트래커봇 결정의 "사전규격은 파서만 인식", "지금 NoticeRef 스키마 확장 기각", trackerbot-mail.md 27행 제약, "기본 템플릿은 isDefault 하나"는 이 결정으로 대체.

## 2026-10-19, 트래커봇 웹메일 우측 하단 진행 팝업 (Fable, 사용자 승인, 명세 .claude/specs/progress-popup.md)
| 결정 | 이유 | 기각 대안 |
|---|---|---|
| 우측 하단 카드, 행 버튼은 짧게 유지 | 사용자 선택. 페이지를 떠나지 않고 보임 | 크롬 사이드패널 |
| TrackerbotController 상태 구독 재사용(subscribe/getEntries) | stale 판정·compose 연결·폴링·orphan 처리가 이미 컨트롤러에 있음 | 팝업이 job/progress 직접 구독·자체 폴링 |
| 프로토콜·스키마 변경 없음(label·currentStep·progress·bytes만 사용) | 단계·파일명·바이트가 이미 ledger에 있음 | JobProgress에 파일 목록 추가(완료 파일 목록은 보류) |
| 한 공고 = 한 항목, 수집→메일 작성은 phase 전환 | 행 버튼과 같은 묶음, 소멸 규칙 단순 | collect/compose 별도 항목 |
| 끝난 상태 문구는 rowView 위임 | 행 버튼과 문구·톤 일치 | 팝업 전용 매핑 |
| 팝업 동작은 취소·닫기·행으로 이동만 | 재시도 등 상태 변경 동작 중복·경합 방지 | 재시도·설정도 팝업에 |
| seen(이 페이지에서 진행 중을 본 잡)만 종료 항목 노출, dismissed는 key→jobId | 재진입 시 옛 결과가 튀어나오지 않게, 같은 행 새 잡은 다시 보이게 | 끝난 잡 전부 표시 / key만으로 dismiss |
| ok 8초 자동 소멸(hover 중 보류), warn/error 수동 닫기, 접힘 유지 | 실패는 놓치면 안 되고 성공은 치움. 웹메일은 다른 일 하는 화면 | 전부 자동/수동, 새 잡 시 자동 전개 |
| vanilla shadow DOM + 인라인 style, 키 이벤트까지 stopPropagation | unlisted script라 CSS 산출물 주입 경로 없음, Gmail 단축키 | React+Tailwind, Panel.tsx 재사용 |

## 2026-10-19, 공고별 메일 편집과 수집 후 동작 선택 (Fable, 사용자 승인, 명세 .claude/specs/mail-edit.md)
| 결정 | 이유 | 기각 대안 |
|---|---|---|
| 공고별 편집은 `notices/<folder>/mail-edits.json`에 템플릿 복사본 + 수신자 이메일 + 제외 첨부 id로 저장 | 렌더 무변경, 섹션/항목 추가 삭제가 자연스럽게 표현됨, 원본 삭제에도 동작, 다음 공고로 이어 쓰지 않으므로(사용자 결정) 병합 불필요 | sectionId/itemKey diff 패치(필드 항목에 id 없음, 3-way 병합 필요), mail-draft.json 안에 저장, 숨은 템플릿을 templates.json에 저장 |
| 필드 항목 값 고치기 = 문구 항목으로 전환 | 공고 값 수정은 검수 화면 영역, 템플릿 모델에 새 종류 추가 회피 | `valueOverride` 필드, 공고 값 자체 수정 |
| 제목 수정 = 복사본 `template.subject` 수정 | 렌더 지점 단일화 | `subjectOverride` |
| 편집 파일이 있으면 요청 templateId보다 우선(경고만) | 공고별 수작업이 설정값보다 명시적 | templateId 우선 + 편집 폐기, 오류로 거부 |
| 적용 지점은 prepareMail 한 곳, compose-job 무변경 | 대시보드 저장과 compose 잡이 같은 초안을 봄 | compose-job에서 재적용 |
| 등록 안 된 이메일 직접 입력 허용(공고별 저장) | 사용자 결정. 일회성이라 수신자 저장소 오염 없음. 설정에 이메일 저장 금지 결정은 오래 가는 설정 대상이라 해당 없음 | 등록 수신자만 |
| `AutoComposeSettings.afterCollect: 'dashboard' \| 'compose'`를 enabled와 분리, 기본 'compose' | enabled 의존 코드 유지, 얕은 병합 호환, 기본값은 기존 동작 유지(사용자 결정) | 3값 enum, 기본 dashboard |
| 이번 건 선택은 `Job.afterCollect` 스냅샷(SW가 시작 시 기록) + `auto-compose/choose` | CS가 storage를 읽지 않는 결정 유지, 팝업이 ledger에서 읽음 | CS가 설정 읽기, job/start payload 전달 |
| Handoff `edit` 신설(대시보드 `#/mail/<id>?from=collect`) | review와 의미가 다름 | review 재사용, handoff 없이 열기만 |
| edit 경로는 already_composed 무시, 권한 검사 없음 | 사용자 결정. 화면을 여는 것은 중복 발송 위험 없음 | compose와 동일 생략 |
| 나라장터 플로팅 패널에는 선택 UI 넣지 않음 | 사용자 결정 | 패널에도 추가 |

- 2026-10-18 Phase 5 "메일 준비 화면 범위: 초안 저장, 복사, 전달 완료 표시까지"와 2026-10-19 진행 팝업 "팝업 동작은 취소·닫기·행으로 이동만"은 이 결정으로 대체(팝업에 완료 후 동작 선택 추가).

## 2026-10-19, 네이버웍스 사내 연락처 불러오기 (Fable, 사용자 승인, 명세 .claude/specs/naverworks-import.md)
| 결정 | 이유 | 기각 대안 |
|---|---|---|
| 연락처 API(`POST contact.worksmobile.com/v2/api/search`, 비공식)는 contact 탭에 `executeScript`로 함수를 주입해 같은 출처 fetch로 호출 | 쿠키·Origin·Referer·XSRF가 실제 웹앱과 동일, cookies 권한 불필요, 로그인 여부·domainId를 탭 URL로 판단 | SW/대시보드 `fetch(credentials:'include')`(Origin이 확장 출처, cookies 권한 필요, SameSite 미확인) |
| 호스트 권한은 optional 런타임 요청, 매니페스트 불변 | 고정 host_permissions 추가는 업데이트 시 비활성화 | host_permissions 추가 |
| domainId: 설정값 → 탭 URL 추출 → 수동 입력, 획득값은 대시보드가 `settings.sites.naverworks.contactDomainId`에 저장 | 첫 실행은 버튼 한 번, 이후 고정. SW는 설정을 쓰지 않음 | 항상 사용자 입력 / domainId 없이 호출 |
| diff는 core 순수 함수, 대시보드에서 실행. 키는 정규화 이메일, 대표 `email`만 사용 | 스냅샷이 이미 UI에 있고 테스트 가능. emails[]의 개인·별칭 메일 배제 | offscreen에서 비교 |
| 반영은 새 메시지 `recipients/import`(한 잠금, 파일 1회 기록). 수정은 name·dept만, 끄기는 enabled만, 그룹 파일 불변 | save 반복은 N회 재기록·부분 실패·'전체' 자동 편입 함정 | `recipients/save` 반복 |
| 새 사람은 그룹 없이(전체 자동 편입·기본 그룹 생성 없음), enabled true, defaultRole 'to' | 사용자 결정 | '전체' 편입 |
| 목록에 없는 사람은 발송 끄기 제안만(기본 해제), 삭제·자동 재활성화·주기 동기화·캐시 없음 | 되돌릴 수 없는 변경 회피, 사용자 결정 | 삭제, 자동 켜기, 주기 동기화 |
| 부서는 orgUnits를 ' / '로 결합. 휴직·협력사·계약직은 정확 일치로 판정해 미리보기 기본 해제(체크하면 enabled true) | 사용자 결정, 부분 일치는 오탐 | 팀 이름만, 부분 일치 |

## 2026-10-19, 수집 완료 후 동작을 팝업에서 고르기 (Fable, 사용자 승인, 명세 .claude/specs/after-collect-ask.md)
| 결정 | 이유 | 기각 대안 |
|---|---|---|
| `AfterCollect`에 `'ask'` 추가, 기본값 `'ask'`. 기존 dashboard/compose 자동 모드 유지 | 사용자 요청 "수집 끝난 뒤 버튼을 눌러야 진행". 추가만 해서 얕은 병합 호환 유지(저장본 변환 없음, 사용자가 설정에서 변경) | 수집 중 선택 UI만 제거하고 자동 진행 유지, dashboard/compose 모드 삭제, 저장본 자동 변환 |
| Handoff `{ action: 'ask' }`. 수집이 끝나면 SW가 대기만 기록하고, 팝업 [대시보드 편집][바로 작성]은 기존 `auto-compose/choose`로 해소(ACTIVE=스냅샷 변경, ask 대기=즉시 적용) | 신뢰 경계 유지: CS는 고르기만 하고 compose 시작은 SW `applyVerdict`. 메시지 하나로 충분 | 새 메시지 auto-compose/resume, 대시보드 편집을 ui/open으로만 처리(handoff가 ask로 남아 상태 불일치) |
| 팝업의 수집 중 '완료 후' 선택 UI는 모든 모드에서 제거. ask 항목은 자동으로 닫지 않고 새로고침 뒤에도 다시 보여 줌 | 사용자 명시 거부 / 응답 대기 상태 | warn 톤으로 자동 소멸 회피 |
| 나라장터 패널·대시보드에서 수집한 건도 ask면 조용히 멈추고 대시보드 메일 준비 화면에서 이어 감 | "누를 때만 진행" 원칙 일관(사용자 확인) | 패널에 선택 UI 추가 |
| ask 선택 뒤 compose 파라미터도 `paramsOf(settings, kindOf(ref))`를 거침 | 사전규격 공고에 bid 템플릿이 넘어가지 않게 함 | — |
- 대체 범위: 323행의 "기본 'compose'", 324행의 "수집 중 선택", 329행의 "팝업에 완료 후 동작 선택 추가"를 "완료 후 선택"으로 바꾼다. 210행(CS의 compose 시작 금지)은 유지한다.
- 같은 날 "진행 팝업 끝난 항목은 '행으로 이동' 대신 행 버튼과 같은 동작(actions)"으로 바꿨다(사용자 요청, 메인).

## 2026-10-19, 네이버웍스 작성 주소와 주소 채움 (메인, 사용자 실측)
| 결정 | 이유 | 기각 대안 |
|---|---|---|
| 기본 composePath = `/write/popup?srvid=mail&to=&orderType=new&memo=false` | 사용자 실측: [메일쓰기] 클릭 시 주소. 이전 기본 `/`는 받은메일함이 열림 | 사용자 설정 입력 |
| `/write/popup` 경로면 to/cc(쉼표 구분)/subject를 주소로 채우고 prefilled 처리(mode url). 본문, 첨부는 붙여 넣기/직접 | 사용자 실측: to 2명, cc, 한글 제목 모두 채워짐. 본문 파라미터는 미확인 | 셀렉터 실측까지 수동 모드 유지 |
| naverworks-v1 셀렉터셋 verified 1.0.0: 제목 `input[name=subject]`, 본문 iframe 안 `.workseditor-content`, 수신자는 주소 채움이라 비움 | probe(20261019-170832) + 콘솔 확인 | 수신자 칩 입력 자동화 |
| 본문은 서명 블록(`[data-workseditor="sign-content"]`, `body.keep`) 앞만 교체, 서명이 사라지면 KEEP_LOST 불일치 | 작성 화면 기본 서명 유지 필요 | 전체 선택 후 교체 |
| 비 scope detect에서 to.input은 있을 때만 요구 | 수신자를 주소로 채우는 서비스는 수신자 셀렉터 없음 | 네이버웍스용 위치 기반 to 셀렉터 추가 |
| 첨부 자동화는 첨부 목록 실측 전까지 끔(fileInput `#fileContent`만 기록) | 업로드 완료 판정 근거 없음 | 파일 칸 주입 후 성공 가정 |
| naverworks-v1 1.1.0: 첨부 자동 입력 켬. `#fileContent`(바깥 문서)에 파일 주입, 본문 iframe 안 `li.attachment_item`에 나타나면 첨부 완료(`attach.inBodyFrame`), 이름은 `.file_name_cover`를 공백, 점 제거 후 대조 | 실측: 상태가 보낼 때까지 '대기 중'이고 보내기 시점에 업로드됨(사용자 확인) | 업로드 진행률로 완료 판정 |
| 다시 수집한 공고도 이미 작성/전달 여부와 무관하게 메일 작성을 진행(already_composed 생략 폐지). 동시 실행 방지(compose_running)는 유지 | 사용자 결정 2026-10-19 | 중복 발송 방지를 위한 생략(2026-10-18 자동 작성 결정 대체) |

## 2026-10-19 트래커봇/대시보드 수집의 상세화면 읽기
| 결정 | 이유 | 기각 대안 |
|---|---|---|
| 확보 방식: SW가 비활성 탭(`active:false`)으로 상세 페이지를 열고 기존 g2b 콘텐츠 스크립트(`g2b/read-html`, readHtmlFields)를 폴링해 값을 받는다 | 화면 전용 필드(proposalPeriod 등)는 렌더된 DOM에서만 읽힘. 기존 파서·isVisible 그대로 재사용 | offscreen 내부 JSON fetch(엔드포인트 미확인), offscreen iframe(XFO·가시성 미확인), 최소화 창(포커스 깜빡임), executeScript func(import 직렬화 불가) |
| 책임 계층: collect-job의 `fetch_html` step이 요청(`readDetail` 의존성 주입 → offscreen이 `g2b/read-detail`로 SW에 요청), SW `detail-reader`가 탭을 연다 | offscreen은 chrome.tabs 사용 불가. API+html은 단일 mergeFields로 병합해야 하므로 병합 전에 확보 | startJob 선처리(serial 블로킹), html을 나중에 별도 mergeFields |
| 실패는 잡을 partial로 올리고 `DETAIL_*` 에러(retryable)를 기록. 취소(DETAIL_CANCELLED)는 cancelled. handoff는 `detail_failed` 사유로 검수 | 첨부/API 결과는 유효하므로 completed로 숨기거나 failed로 올리지 않음 | 실패를 completed로 은폐, failed 처리 |
| 동시 1개 FIFO, 항목당 45초 상한(큐 대기 제외) | 탭 폭주·창 포커스 경합 방지 | 병렬 탭 |
| 탭 배치: `active:false`, originTabId가 있으면 그 창(+openerTabId), 없으면 마지막 포커스 창. 사용자가 연 g2b 탭은 재사용·닫지 않음 | 사용자 작업 방해 최소화, 경합 회피 | 사용자 탭 재사용 |
| 렌더 판정: match 이후 연속 2회 fields 동일 + 첫 match 후 1.5초 경과 시 성공. 45초까지 못 안정되면 마지막 스냅샷, match가 없었으면 DETAIL_TIMEOUT | WebSquare 비동기 렌더로 일부 값이 늦게 채워짐 | 로드 완료 즉시 읽기 |
