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
- 한쪽만 있는 공고는 다른 쪽이 not_found(확인 필요)가 되는 것이 정상이다. "해당 없음 확인" 기능은 범위 밖으로 미뤘다. (2026-10-20 보완: not_found는 유지하되 그룹의 다른 항목이 충족이면 확인 필요로 세지 않는다)
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

## 2026-10-19 사이드 패널 공고 요약과 수집 기록
| 결정 | 이유 | 기각 대안 |
|---|---|---|
| 수집 기록은 storage.session 별도 키 `jobLog.<jobId>` 이벤트 배열, Job 객체는 변경 없음 | Job은 CS로 그대로 나가므로 커지면 안 됨, 기존 비교 로직 유지 | Job에 events 필드, 공고 폴더 파일 기록(SW→offscreen 쓰기 경로 신설 필요) |
| 단계 이벤트는 SW가 status 전이에서 파생, 파일 start/end와 값 요약만 엔진이 JobProgress.event로 보냄. 바이트 진행은 이벤트 아님. 잡당 400건 상한 | 잦은 신호로 기록이 불어나지 않게, compose 잡까지 엔진 수정 없이 단계 시각 확보 | 모든 progress 기록 |
| 기록은 세션 한정, 재시작 후에는 notice.json/extraction.json에서 정적 기록 복원(선택) | 사용자 동기가 현재 세션의 지나가는 문구 | 영구 로그 파일 |
| 요약 값은 `core/model/notice-summary.ts` 허용 목록 함수 하나로 생성(수집 중 facts와 완료 후 notice/get 공통). 담당자 이름/전화, customFields는 읽지 않음 | 값 불일치 방지, 개인정보 제외 지점 단일화 | 화면에서 notice 직접 렌더, 새 요약 메시지 |
| 화면 칩 클릭은 `ui/open {page:'sidepanel'}` → SW가 첫 문장으로 `sidePanel.open({tabId})`. 제스처 전파는 S0 실험으로 확정 | tabId로 열어야 그 탭에 고정되고 사이드 패널이 바로 그 공고를 감지 | 칩에서 공고 id 전달, windowId로 열기 |

## 2026-10-19 조달평가 점수 분석 (Fable 설계, 사용자 승인, 명세 .claude/specs/eval-analysis.md)
| 결정 | 이유 | 기각 대안 |
|---|---|---|
| 평가위원별 세부 점수는 나라장터 내부 API(비공식)로 가져온다. 공개 API(낙찰정보)는 업체별 합계만 준다 | 사용자 핵심 요구가 업체 × 위원 × 세부항목 분석. 내부 API 한 번에 전 업체 점수(샘플 384줄), 재계산값이 화면 팝업과 일치 | 팝업 DOM 파싱, 엑셀다운로드 파싱 |
| 내부 API는 g2b 탭 CS(ISOLATED)의 같은 출처 fetch, 대시보드 트리거는 SW가 g2b 탭 재사용/비활성 생성 | 쿠키 Origin Referer 동일, 네이버웍스 연락처 결정과 동일 원칙, detail-reader 수단 재사용 | offscreen/SW fetch, MAIN world, 사용자가 탭 열기 |
| 잡이 아닌 요청/응답 `eval/collect`(90초), SW FIFO 1개 | 수 초, 단계 재개 무의미, JobType 추가 파급 회피 | eval_collect JobType |
| 저장 `evaluations/<noticeId>.json` + 파생 `evaluations/index.json`, 공고 폴더와 분리 | 미수집 공고도 분석, 락 분리, 스캔 한 곳. 단일 사용자(사용자 결정)라 로컬 폴더로 충분 | notices 폴더 안, index.json 열 추가, IndexedDB, 서버 DB |
| 원문 미보관, 허용 목록은 CS 안에서 적용. 위원은 elmbNo만, 업체는 사업자번호와 상호만 | 위원 목록 응답에 실명(elmbNm 평문, 화면은 elmbNmRlsYn N으로 비공개), 업체 담당자 연락처, 대표자명 포함 | source/*.json 원문 보관 |
| 우리 회사 = Settings.company(bizNo, name), 보기 전환(우리 회사 기준/전체)은 localStorage | 사용자가 두 보기 모두 요구. 비밀 아님, 설정 추가만, 보기는 데이터가 아님 | secrets, Settings에 보기 저장 |
| 지표는 core 순수 함수, 대시보드 계산, 누적은 eval/get-many(상한 500) | 상호작용 왕복 없음, 레코드 소형 | offscreen 집계 메시지 |
| 공개 API 낙찰정보는 별도 절, 자동 대조 금지 | techEvlNaturVal(85.245)과 위원 평균(84.725) 차이 원인 미확인 | 보정 |
| 재수집은 덮어쓰기(firstCollectedAt 유지), 미확정은 provisional | 확정 결과 불변 | 이력 보관 |
| 차트 라이브러리 없음, 표와 CSS 막대/히트맵 | 기존 결정 유지 | recharts 등 |
| 미검증: 로그인 필요 여부, 비참여 공고 접근(evlRsltRlsYn N인데 조회됨), 헤더 필요 여부, prcmBsneSeCd 업무구분, evlUseEvstCnt 2인데 evstNo는 1종인 의미, elmbNo 공고 간 동일성. S1 실측 뒤 기록 | 코드로 확인 불가 | — |

## 2026-10-19 공고 상세 화면(탭)
Fable 설계, 사용자 승인. 명세 `.claude/specs/notice-detail.md`.

| 결정 | 이유 | 기각 대안 |
|---|---|---|
| 라우트 `#/notices/<id>/<tab>`, 탭은 경로 세그먼트, URL이 탭 상태의 단일 원천, key는 noticeId만 | id가 encode돼 split 안전, 뒤로가기와 북마크 단위가 탭, 탭 전환에 재조회 없음 | `?tab=` 쿼리, useState 탭, 탭마다 remount |
| `#/review/<id>?handoff=`는 파서 별칭(tab=review)으로 유지. SW, auto-compose, 패널, 트래커봇, 사이드패널 무변경 | 진입 경로 여러 곳이 SW 문자열에 의존, 외부 생성 URL 호환 | 전 경로 일괄 치환, `ui/open` page 값 추가 |
| 검토 화면은 ReviewTab으로 이동만, 편집은 그 탭에서만. 개요의 "평가 기준(공고정보 기준)"은 읽기 전용 | 사용자 결정(조회 전용), 추출값과 공고정보값의 출처 구분 | 개요에서 인라인 편집 |
| 정정공고 연결은 `notice/list`에서 같은 noticeNo 다른 차수를 클라이언트가 계산 | `previousNoticeId`는 어디서도 채워지지 않고 `supersededBy`도 복사만 됨 | 수집 시 previousNoticeId 기록(스키마 변경), 새 메시지 |
| 첨부 열기는 대시보드 탭이 IDB 루트 핸들로 읽기 전용 접근, pdf/이미지/txt만 새 탭, 나머지는 경로 복사 | 메시지로 Blob 전달 비효율, 확장은 OS 앱 실행 불가, 읽기 1회는 "offscreen 단일 작성자"(쓰기 정합성) 결정의 이유에 해당하지 않음. Grant/FsErrorAlert가 이미 대시보드에서 핸들 사용 | `attachment/read` 메시지(base64), 모든 형식 복사본 다운로드, `downloads.open`(권한 추가) |
| 수집/메일 이력은 notice.collect, notice.mail, mail/draft-get, storage.session 잡만. 영구 이력 없음 | 사이드패널 결정(세션 한정 기록)과 일치, 백엔드 변경 없음 | 폴더에 이력 파일, 그룹/템플릿 이름 조회 |
| 평가 점수 탭은 NOTICE_TABS 항목 + 탭 컴포넌트 추가로 연결 예정, 이번 범위 제외 | eval S4 진행 중(사용자 보류 지시) | 지금 `#/evaluations/<id>` 링크 탭 선삽입 |
| (2026-10-20 추가) 단일 공고 화면 맨 위에 "승부 분해"(기술/가격 분해, 교환비, 역전 거리)와 등급 분포를 두고 위원 성향은 아래로 | 사용자 요구는 다음 입찰에서 이길 지표. 위원은 공고마다 무작위라 재사용성이 낮음 | 위원 성향 중심 배치 |
| (2026-10-20 추가) 점수 공식 의존 지표는 공고마다 공개 API 값으로 자기 검증(가격 = 가격배점 × 최저가 ÷ 투찰가, 차등보정 = 기술 원점수 + (기술배점 − 최대 원점수)), 실패 시 해당 지표 숨김 | 샘플 1건으로 역산한 공식이라 공고별로 다를 수 있음. AI 없이 규칙만으로 틀린 조언을 막음 | 공식 고정 적용 |
| (2026-10-20 Fable) 승부 분해의 각 칸은 자기 기준만 말한다. 역전 거리(위원 점수, 선택한 위원)는 behind/tie/ahead 3상태이고 "종합", "가격" 언급 금지. 공식 분해와 교환비는 pickDuel basis가 official일 때만 표시. pickDuel은 judges basis에서만 위원 제외 반영. 위원 제외나 공식 기술점수/위원 합계 방향 불일치는 안내 한 줄(basisNotes) | 위원 기준 칸이 공식 결과의 결론을 대신 말해 동점, 공식 결과 없음, 위원 제외 시 모순 발생 | 공식 값과 위원 값을 한 함수에서 섞는 duelVerdict, 위원 제외 시 공식 값 숨김/흐림, judges basis 쌍 고정, totalDiff 가드만 추가 |

## 2026-10-20 메일 발송 이력
Fable 설계, 사용자 승인. 명세 `.claude/specs/mail-sent.md`.

| 결정 | 이유 | 기각 대안 |
|---|---|---|
| 발송 기록은 `<folder>/mail-sent.json`(SendRecord[]) 진실 + 루트 `mail-sent-index.json` 파생 인덱스. mail.json 무변경 | 공고 폴더 단위 보존, 전체 이력은 파일 1개로 조회, 손상 시 index.json 순회로 재생성(EvalStore 전례) | mail.json outcome 'sent', 전역 단일 파일 진실, IndexEntry 열 추가 |
| notice.mail.status delivered/deliveredAt은 mail-sent.json에서 파생(자동/수동). 옛 delivered는 읽을 때 legacy 레코드 합성, 첫 쓰기 때 물질화 | 홈 통계/인덱스 무변경, 일괄 변환 금지 원칙 | deliveredAt 단일 필드 유지, 일괄 마이그레이션 |
| 취소는 voidedAt 소프트 처리, 삭제 없음 | 늦게 오는 자동 신호가 레코드를 되살리는 것 방지 | 삭제 |
| composeRecordId당 auto 1개, 같은 id에 유효 레코드가 있으면 auto 신호 폐기, 수동은 항상 허용 | 자동+수동 중복을 귀속 키로 해소 | 시간 창 기반 중복 판정 |
| 감지는 별도 unlisted script send-watch.ts(관찰 전용, dom-actions 미사용, isTrusted만), 셀렉터셋 검증 여부와 무관하게 compose/open에서 항상 주입 | 전송 가드 결정 유지, Gmail(unverified)에서도 감지, 오류 비용이 누락뿐 | naverworks-compose.ts 확장, forbidden 셀렉터 재사용 |
| 1차 신호(클릭/Ctrl+Enter)로 즉시 기록(confirmed=false), 2차(ui_gone/toast/unload)로 확인 갱신 | 팝업이 발송 직후 닫히면 2차가 못 옴, 사용자가 취소로 교정 가능 | 2차 확인 뒤에만 기록 |
| SW는 sender.tab.id === ledger composeTabId인 compose 잡의 jobId만 수용, noticeId/recordId는 ledger에서 추출, 호스트 미검사 | 작성 호스트와 수신 호스트가 다를 수 있음, CS 페이로드 위조 차단 | senderKind 'webmail' 호스트 검사, CS가 noticeId 전달 |
| ledger 소실(20개 초과, 재시작)로 못 잡은 발송은 수동 보완, 별도 영속 매핑 없음 | 단순함, 수동 경로가 이미 요구사항 | 탭→공고 매핑 영속화 |
| `mail/set-status` 폐기, sent-add/sent-void로 대체 | 상태 덮어쓰기와 이력이 이중 진실이 됨 | 병행 유지 |
| 2026-10-19 공고 상세 결정 "영구 이력 없음"을 메일 발송에 한해 대체 | 사용자 요청 | 없음 |

## 2026-10-20 가감점 표 인식과 사업기간 문서 보충
Fable 설계, 사용자 승인(신인도는 표 위치 안내 + 직접 입력). 명세 `.claude/specs/bonus-period-extract.md`.

| 결정 | 이유 | 기각 대안 |
|---|---|---|
| 가감점 표(1열 가점/감점 라벨 + 배점 열, 점수 칸에 숫자)를 `bonus-table` 전략으로 찾아 `extras.bonusTable`에 두고, 신인도가 not_found일 때만 `reason: 'no_total'`(값 null, raw "가점 n항목, 감점 m항목", 근거 표)로 바꾼다 | KOICA 양식은 총 배점이 없고 행별 최댓값 합도 택일 여부가 문서에 없어 추정이 된다. 자동 확정 금지 결정 유지. 사용자는 근거로 표를 열어 직접 입력 | 가점/감점을 credibility 동의어로 추가(table-score가 0.5를 verified로 냄), 가점 최대 합 자동 산출, 값 타입을 문자열로 변경(6곳 파급, 모호성 그대로) |
| "(미해당)" 행은 해석하지 않고 항목 수에 포함. 합산을 도입하면 라벨이 (미해당)으로 시작하는 행 제외 | 값을 만들지 않으므로 영향 없음 | 없음 |
| 사업기간은 `extras.projectPeriod`(window-regex, valueType text, prefer_priority)로 뽑고 extract-step이 basic.projectPeriod가 비었을 때만 채운다. HTML/API 값과 user_edited는 건드리지 않고 충돌도 기록하지 않는다 | items 키 = 평가 키 결정과 computeStatus 유지. HTML과 문서 표현이 달라 문자열 충돌이 무의미 | ExtractionKey 추가, mergeDocumentLayer 경유(HTML 덮어쓰기 또는 상시 충돌), mergeFields 한 키 레이어(다른 문서 값이 needs_review로 떨어짐) |
| window-regex `valueType: 'text'`는 d 플래그 indices로 원문 띄어쓰기를 복원 | compact 값은 메일에 못 쓴다 | 새 label-value 전략 |
| 기존 공고는 "다시 추출"로 적용, 마이그레이션 없음 | 규칙 재실행이 그대로 갱신 | 일괄 변환 |
| 보류: 조달청식 신인도 범위 표기("±2", "+1~-2"), 두 칸 표 "사업기간 / 값", "해당 없음" 확정 UI | 로컬 표본 없음, HTML이 보통 채움, 기존 결정상 범위 밖 | 없음 |

## 2026-10-20 대외신인도 평가 합성 항목과 검토 그룹
Fable 설계, 사용자 결정(경영상태 등 대외신인도와 비슷한 개념은 대외신인도 평가로 본다, 평가방법은 문서 원문, 공동수급은 "허용(공동이행방식)"). 명세 `.claude/specs/credibility-eval.md`.

| 결정 | 이유 | 기각 대안 |
|---|---|---|
| D1 credibilityScore/managementScore 분리 유지, 합치는 곳은 메일 표시와 검토 판정뿐 | 데이터 정확성 유지(분리 결정 존중) | 한 항목으로 병합, 서로 값 복사 |
| D2 메일 가상 키 credibilityEval(경영상태 먼저, `, ` 연결, 0개면 확인 필요) | 템플릿 문법 확장 없이 합성 | 템플릿 조건 문법 |
| D3 REVIEW_GROUPS: 다른 멤버가 충족이고 값 없음(not_found/no_total/no_documents)이면 covered, conflict/low_confidence는 그대로 | 한쪽만 있는 공고의 오탐 확인 필요 제거 | not_found를 verified로 바꾸기 |
| D4 bonus-period-extract(no_total, 사업기간 보충) 유지 | 이미 결정됨 | 없음 |
| D5 evalMethodDoc 신규 필드 + 가상 키 evalMethodText(문서 원문 우선, 없으면 API 값). API 값은 {공고정보평가방법} | 사람 요약보다 문서 원문 | evalMethod에 문서값 덮어쓰기 |
| D6 공동수급은 메일에서만 jointVentureText(`허용(<방식>방식)`) | 사이드패널 등 표기 보존 | formatJoint 변경 |
| D7 확장 지점: default-rules.json, composites.ts, REVIEW_GROUPS, DOC_FILL_KEYS | 기관명 분기 없이 확장 | 기관명 분기 코드 |

## 2026-10-20 공고 필드 직접 수정(notice/field-edit)
Fable 설계, 사용자 결정(메일 화면 "확인 필요" 팝업에서 [이 메일에만]과 [공고에 저장] 둘 다). 명세 `.claude/specs/notice-field-edit.md`.

| 결정 | 이유 | 기각 대안 |
|---|---|---|
| D1 UI 진입점은 `notice/field-edit` 하나, 서버가 ExtractionKey를 editExtraction에 위임(extraction 없으면 notice만) | UI가 키 종류를 몰라도 되고, 추출 전 공고의 평가 키 수정 구멍 제거 | UI 분기, extraction/edit payload 확장 |
| D2 FieldValue에 `userEdit { editedAt, note?, before? }` 추가, status는 기존 user_edited. 재수정 시 before는 최초 자동값 승계 | 기존 user_edited 검사 코드 재사용, 기본정보는 되돌릴 자동값 출처가 없음. 스키마 버전 유지 | notice.userEdits 오버레이, candidates에 보관 |
| D3 mergeFields가 user_edited 키의 값은 보존하고 `userEdit.before`만 이번 수집 자동값으로 갱신 | 되돌리면 "지금 수집했으면 나올 값"이 기대 동작 | before 고정, 되돌릴 때 재수집 |
| D4 noticeNo·round와 파생 템플릿 키(sourceUrl 등)는 수정 불가 | id·index·잡 충돌 판정 근거 | sourceUrl 편집 허용 |
| D5 합성 키는 하위 실제 키로 펼쳐 편집(credibilityEval→경영상태·신인도, evalMethodText→evalMethodDoc·evalMethod) | "합치는 곳은 표시뿐" 결정 유지 | 합성값 저장 |
| D6 custom.* 편집 포함(없던 키 생성, 되돌리면 삭제) | 쓰는 경로가 전혀 없어 {custom.x}가 영구 값 없음 | 제외 |
| D7 값 검증·입력 파싱은 core `field-edit.ts` 단일 출처, VALUE_CHECK 이동, parseAmount는 core로 이동 | UI와 서버가 같은 표 사용 | 중복 표 |
| D8 되돌리기=value null, 비수정 필드에 null은 no-op | 멱등 | NOT_EDITED 오류 |
| D9 공고에 저장 후 메일 화면은 초안도 다시 저장 | 디스크 초안 불일치 방지 | setNotice만 |
| 한계: projectPeriod를 고쳤다 되돌리면 before(대개 missing)로 가고 다음 추출 때 문서값이 다시 채워진다(fillDocOnlyFields는 before 갱신 안 함) | 범위 축소 | fillDocOnlyFields 수정 |
| UI: Fable 안의 field-fix-view 표시 모델은 쓰지 않고 이미 만든 ResolveDialog의 안내·근거 표시를 유지, 입력·대상만 core 함수 사용 | 중복 구현 회피 | 설계대로 신규 표시 모델 |
| 리뷰 후속: extraction.json이 없을 때 notice에만 고친 평가 키는 첫 추출의 saveExtractionLatest가 items.userEdited로 옮겨 심는다 | 안 하면 메일엔 사용자 값, 검토 화면·reviewCount엔 확인 필요로 어긋남(D1의 빈틈) | 추출 전 평가 키 수정 금지 |
| 리뷰 후속: 팝업의 합성 항목은 처음 값에서 바뀐 칸만 저장 | 손대지 않은 자동값이 user_edited로 굳어 재수집 갱신이 멈추는 것 방지 | 모든 칸 저장 |

## 2026-10-20 채움률 보강(2,055건 측정)

근거: 축평원·행안부·KOICA 최근 3년 SW·연구용역 2,055건 측정(measure2.md, misses.json) → 재측정 measure3.md. 명세: `.claude/specs/recall-boost.md`.

| 사용자 결정 | 이유 |
|---|---|
| 배점이 없고 평가 주체 문장만 있으면 그 **문서 문장을 그대로** 메일에 넣는다(표준 배점 추정 금지) | 값은 문서 실제 텍스트 원칙. 틀린 배점을 만들지 않는다 |
| 공고문의 "입찰서 제출기간"은 제안서 제출기간으로 본다 | 협상 공고에서 입찰서=제안서 전자제출, 3번 문서 보충 상한이 이 표기에 집중 |
| 값은 문서 실제 텍스트, 요약·변환 금지(날짜 ISO 변환만 예외) | 위와 같음 |

규칙 추가(`default-rules.json`, 모두 window-regex·text·prefer_priority):
- `basic.projectPeriod` 보강: "총/전체 사업기간", 신호에 `~`·`까지` 추가
- `basic.projectPeriodParen`: "(총 용역기간 : …)" 줄 중간 표기(총기간만, 단계별 예산 옆 기간은 제외)
- `basic.projectPeriodCell`: 라벨만 있는 셀(용역/사업/계약/수행/과업기간) 다음 셀 값. blocksAfter 1, 기존 전략 재사용
- `sched.proposalPeriodDoc`(→ extras.proposalPeriod), `sched.proposalEvalDoc`(→ extras.proposalEvalAt, ISO 변환 실패 시 값 아님), `eval.quantDoc`(→ extras.quantEvalDoc, notice.evaluation.quantEvalDoc)
- 합성 `performanceEval`(기본 템플릿 10번을 합성 항목으로, 옛 txt_perf 문구는 normalize에서 승격), `credibilityEval`은 점수 0개일 때 quantEvalDoc 문장
- `DOC_FILL_KEYS`에 proposalPeriod·proposalEvalAt·quantEvalDoc 추가(화면값 우선, user_edited 건너뜀). 검토 판정(review-count)·자동 작성 멈춤은 그대로

기각한 대안:
| 대안 | 기각 이유 |
|---|---|
| 조달청 표준 배점(경영상태 N점 등) 추정 | 문서에 없는 숫자를 만들면 틀릴 수 있고 원문 원칙 위반 |
| 입찰서/제안서 제출기간을 구분 유지 | 사용자 결정(입찰서=제안서). 구분하면 3번 문서 보충이 대부분 비게 됨 |
| 새 전략 파일 추가(표 옆 칸 전용) | 기존 window-regex의 blocksAfter로 충분(셀이 한 줄 단위로 평탄화됨) |
| 셀 값에 "15개월"처럼 숫자+단위만 있어도 기간으로 인정 | KOICA 카라바오 문서의 "SW사업 적정 사업기간 산정" 표 15개월이 실제 용역기간과 충돌(기대값 깨짐). 날짜·까지·~·계약(체결)일 신호가 있을 때만 인정 |
| 경영상태·수행실적 표 라벨 보강(mgmt.table/perf.table 변경) | 열어 본 사례는 conflict(같은 표 점수 중복)·제출서식(점수 없음)·등급표뿐. "기업경영상태, 용역수행실적(B) 5"는 두 항목 합산이라 한쪽에 배정하면 오답 위험 → 문장 보충(quantEvalDoc)으로만 처리 |

## 2026-10-20, AI 재검토 "AI로 다시 찾기" (Fable 설계, 사용자 승인, 명세 .claude/specs/ai-review.md)

| 결정 | 이유 | 기각 대안 |
|---|---|---|
| AI는 확인 화면 버튼으로만 실행, 범위 ①확인 필요 항목 ②7개 전체를 실행 때 선택 | 규칙 추출이 기본, AI는 사용자가 이상하다고 느낄 때 보완 | 추출 후 자동 실행 |
| AI 결과는 근거 인용이 붙은 제안으로만 표시, [적용]해야 반영 | 자동 확정 금지 원칙 | 바로 반영 |
| 공급자 Claude/OpenAI/Gemini × 방식 API/반자동, 설정 `ai.provider/mode/models[provider]`, 키 `secrets.ai[provider]`. 기본 Gemini API(무료 등급) | 사용자 요구. 비용 0 + 1클릭 | 공급자 1개, 기본 반자동 |
| 결과는 `notices/<folder>/ai-review.json`(run 이력 최대 10) + `ai/<runId>-{prompt,response}.txt`. extraction.json·Notice 스키마 불변 | 규칙 산출물과 AI 제안 분리, run 단위 메타(공급자·모델·프롬프트 버전·토큰) | ExtractedItem에 aiSuggestion 필드 |
| [적용] = userEdited(+`origin: ai`) 경로, notice source `{kind:'user', ref:'ai:<runId>'}`. SourceKind 'ai' 추가 안 함 | 보존·되돌리기·상태 계산 재사용, mergeDocumentLayer가 비문서 값을 영구 우선하는 함정 회피 | SourceKind 'ai', items.value에 기록 |
| 재추출 후 이전 run은 stale(표시·적용 불가), 마이그레이션 없음 | 텍스트가 바뀌어 인용 대조·비교 무효 | 제안 이식·재검증 |
| 실행은 offscreen(발췌·fetch·검증·저장), SW는 키·설정·권한 주입 릴레이, 진행은 storage.session `aiRun.<noticeId>`. JobType 아님 | 텍스트 파일·쓰기가 offscreen, 긴 응답을 pending으로 기다리지 않음, JobType 파급 회피 | SW fetch, 대시보드 fetch, extract 잡 step |
| SDK 미사용, 공급자 어댑터(요청 조립·스키마 방언·응답/오류 해석·모델 목록) + 공통 ai-client(fetch·타임아웃·재시도) | 엔드포인트 2개뿐, 번들·MV3 호환 부담, Gemini responseSchema가 JSON Schema 방언이 아님 | SDK 3종, JSON Schema 하나 공유 |
| API 호스트는 키 저장 시 optional host permission 요청, clipboardRead는 optional_permissions | manifest 고정 권한 추가 금지 결정 | host_permissions 추가 |
| 프롬프트에 기존 값·후보·확인 필요 사유를 넣지 않음(①② 공통). 비교는 코드(decide.valueKey) | 앵커링 방지 | ①에서 후보 제공 |
| 인용문은 파일 전체 텍스트에서 태그·`\|`·공백 제거 후 대조, 실패 시 카드 제외(요약에서만 펼침). 값은 VALUE_CHECK | 근거 없는 값 차단 + 투명성 | 경고 달고 표시, 완전 폐기 |
| 발췌 = 규칙 동의어 + 고정 키워드 줄 창 [-6,+30], 표는 끝까지, 파일 16k/전체 48k자, 반자동은 공급자별 상한(초기 30k) | 비용 상한, 무료 웹 붙여넣기 제한 | 전문 전송 |
| 반자동은 클립보드 + 새 탭만. 요청 마커·runId 에코로 오인 방지. 초과 시 파일 체크리스트로 run을 나눔, 제안 표시는 키별 최신 run | 약관(웹 자동 조작 금지), 답 하나 = JSON 하나 검증 구조 | 웹 DOM 조작·URL 프리필, 여러 메시지 분할 |
| 429는 AI_RATE_LIMIT(재시도)과 AI_QUOTA(무료 한도·크레딧 소진, 다른 공급자 안내)로 분리 | Gemini 무료 등급, OpenAI insufficient_quota | 429 단일 코드 |
| 스캔·암호 문서는 AI 전송 제외, PDF 직접 전송 안 함 | 인용 대조 불가, 비용 | document 블록 전송 |
| 외부 API 형태·모델 ID·웹 URL·붙여넣기 상한은 S0 실측 전 확정하지 않음 | 코드로 확인 불가, 추정 금지 | 기억으로 하드코딩 |

한계/결정(채움률 보강 후속):
- quantEvalDoc 문장은 항목별 키워드 필터를 통과할 때만 쓴다: credibilityEval은 `경영상태|신용|신인도`, performanceEval은 `실적`(문장은 자르지 않음, 없으면 '확인 필요'). measure3 원문 대조에서 항목 무관 문장 6건이 나온 데 따른 결정
- 한계: "기업경영상태, 용역수행실적(B) 5" 같은 합산 배점 행은 한쪽에 배정하지 않는다(현행 유지)
- 한계: 시각 없는 제안서 평가일("2024. 3. 7.(목)")은 ISO 변환 실패로 값이 아니다(현행 유지)
- 한계: 접두어 없는 "제출기한: …" 줄은 제안서 제출기간으로 잡지 않는다(현행 유지)
- 한계: 사업기간에 서로 다른 값의 줄이 둘 이상이면 기존대로 conflict(대표값 유지)

### 2026-10-20 AI 공급자 실측 (S0, Gemini만. Claude·OpenAI는 키 없음, 미실측)
| 항목 | 결과 |
|---|---|
| 키 형식 | 신규 키는 `AQ.`로 시작(53자). `AIza` 접두 가정 금지 |
| 인증·엔드포인트 | `x-goog-api-key` 헤더 + `POST /v1beta/models/{model}:generateContent` 동작 확인(Node fetch, 확장 출처 CORS는 미확인) |
| 구조화 출력 | `responseMimeType:'application/json'` + `responseJsonSchema`(표준 JSON Schema, `const`·타입 배열 `['number','string','null']` 동작) 채택. `responseSchema`(OpenAPI)도 되지만 숫자가 문자열로 와서 기각. 응답은 순수 JSON |
| 응답 | `candidates[0].content.parts[]`에 `text`와 `thoughtSignature`가 섞임 → text 파트만 이어 붙인다. `finishReason: STOP`, usage `promptTokenCount/candidatesTokenCount/thoughtsTokenCount` |
| 생각 단계 | `generationConfig.thinkingConfig.thinkingLevel:'low'` 사용. `'minimal'`은 3.8-flash에서 400 |
| 속도(짧은 예시, 무료 등급) | gemini-3.5-flash(low) 2.3초, 3.5-flash-lite 1.1초, 3.1-flash-lite 1.7초, **3.8-flash 47~247초**(생각 0이어도 느림, 대기열로 추정) |
| 기본 모델 | **`gemini-3.5-flash` + thinkingLevel low**. 3.8-flash는 120초 타임아웃을 넘길 수 있어 기본에서 제외(선택은 가능, AI_TIMEOUT 시 "가벼운 모델 선택" 안내) |
| 모델 목록 | `GET /v1beta/models`에 TTS·이미지·음악·로보틱스·에이전트 모델이 섞이고, 목록에 있어도 신규 사용자는 404인 모델이 있음(gemini-2.5-flash). 목록은 generateContent 지원 + 이름 필터(tts·image·banana·lyria·transcribe·robotics·computer-use·deep-research·antigravity·omni·customtools·gemma 제외) |
| 오류 | 잘못된 키 401 `UNAUTHENTICATED`(→AI_AUTH), 없는/사용 불가 모델 404 `NOT_FOUND`(→AI_BAD_REQUEST "모델을 쓸 수 없습니다. 다른 모델을 고르세요"). 429 할당량 형태는 미확인 |
| 공유 스키마 | `providers/schema.ts`의 `items.anyOf`(키별 object, value 타입 배열, enum) 형식을 gemini-3.5-flash·3.5-flash-lite가 그대로 수용, 4항목 정답(차등점수 미적용 false 포함) |
| 503 | `{"code":503,"status":"UNAVAILABLE","message":"This model is currently experiencing high demand..."}` 실제 관측 → AI_OVERLOADED(재시도 1회) 매핑 맞음. 3.5-flash에서 간헐 발생 |

## 2026-10-20, AI 재검토 진입점 확장 (Fable 설계, 사용자 승인, 명세 .claude/specs/ai-entrypoints.md)

| 결정 | 이유 | 기각 대안 |
|---|---|---|
| AiScope에 `auto`·`keys` 추가, run 파일에는 해석값(pending/all/keys)만 저장. run.keys가 단일 진실 | 프롬프트·검증 영향 0, 무마이그레이션 | keys 배열 일원화, scope 객체화 |
| 키별 최신 run 판정을 "요청한 키" 기준으로 바꿈. 검증 실패 시 이전 제안으로 폴백하지 않고 빈칸(기존 구현과 다름) | 항목별 재실행 결과를 새 값으로 오해하는 것 방지 | 현행 유지 |
| 기본 범위 = 확인 필요가 있으면 그것만, 없으면 7개 전체(원클릭·사이드패널·일괄 공통) | 사용자 결정 | 항상 전체 |
| 일괄은 API 전용, offscreen `AiBatch` + storage.session `aiBatch` 단일 키, JobType 아님 | 반자동 일괄 비현실적, offscreen 상주·SW 비상주, 기존 JobType 회피 결정 유지 | 반자동 일괄, SW 루프, JobType |
| 순차 1개·2초 간격, QUOTA/AUTH 즉시 중단, RATE_LIMIT 60초 대기 1회, OVERLOADED 연속 3회 중단, 나머지는 건별 기록 후 계속 | 무료 등급 한도, 503 간헐 실측 | 동시 실행, 무조건 계속 |
| 배치 고아는 batch-get 시 SW가 offscreen 생존으로 판정 | 기존 고아 run 정리와 같은 "읽을 때 정리" | offscreen 시작 push |
| 공고당 1 run 유지, 항목별 클릭 큐 없음 | 단순성, 응답 2~3초 | 항목 큐 |
| 사이드패널은 실행·요약만, 적용은 대시보드 | 근거 대조 UI 중복 회피 | 패널 적용 |
| 목록 선택은 컴포넌트 state(필터 변경 시 유지, 페이지 이동 시 소멸) | 오래된 선택 오실행 방지 | 세션 보존 |
| 버튼 아이콘은 가능하면 실제 공급자 아이콘, 시각 디자인은 목업 확인 후 구현 | 사용자 요청 | 공통 아이콘(Sparkles)만 |

## 2026-10-20, AI 재검토 v2 — 범용 프롬프트·문서 전달·정확도 검증 (Fable 설계, 사용자 승인, 명세 .claude/specs/ai-review-v2.md)

계기: 실적 인정금액 AI 재검토가 규칙 추출보다 부정확(발췌 누락 → 분모 25억 선택 → 단위 오환산). 공고별 pitfall 추가로 고치던 방식은 과적합이라 폐기.

| 결정 | 이유 | 기각 대안 |
|---|---|---|
| 항목 정의를 개념+식별법+혼동 개념 3부 구조로, 공고 고유 문구·숫자 금지(린트로 강제), 예시는 가상 표시 | 실패가 정의 부재에서 옴, 범용성 | 공고별 pitfall 누적 |
| credibilityScore 정의를 대외신인도(가감점) 배점으로 바로잡음 | 기존 프롬프트가 신용평가등급으로 정의해 규칙·UI와 반대 | — |
| 금액·기간은 원문 표기 문자열로 받고 코드가 환산(10^k 보정은 안전망) | AI 환산 오류 제거 | 환산 지시 강화 |
| 조건별 다중 값은 AiSuggestion.variants에만, Extraction 스키마 불변, 적용 시 variant 선택 | 마이그레이션 0 | ExtractedItem.value 배열화 |
| API 모드 기본 전문 전송(40만자 상한, 초과 시 섹션 발췌), 수동 모드는 섹션 발췌+주석 결속+참조어 추적 | 발췌 누락이 1차 실패 원인, 정확도 우선(비용 증가 사용자 승인) | 2단계 질의, 파일 업로드 |
| 표 렌더링 행 자기완결형(rs 반복·셀 줄 ` / `·중첩표 태그 깊이≥1만) + verify 렌더→원문 맵 | 중첩표·여러 줄 셀에서 행이 깨짐 | 렌더링 유지 |
| 규칙 후보는 프롬프트에 계속 숨기고 사후 비교 배지(ruleRelation). 동봉은 A/B 후 | 앵커링 실측 없음 | 후보 동봉 |
| "값이 여럿이면 평가기준표 값" 규칙 삭제, 우선순위는 문서 종류 간에만 | 표 밖 주석을 무시하게 만듦 | 위치 우선 규칙 |
| 정답표+오프라인 회귀(커버리지·리플레이·린트)+온라인 평가 스크립트, 평가 통과가 프롬프트 채택 조건 | 한 공고 기준 수정 사이클 차단 | 수동 확인 |
| managementScore 하위 항목 여럿이면 부문 소계, "※ 해당 사업규모 … 이상"은 실적 1건 하한 | 사용자 승인 | — |

추가(2026-10-20, 기준선 측정 후 사용자 승인): v2 단계 순서를 "S4 중 검증(표 행 인용 대조) → S2 → S3 → S5"로 변경. 기준선(v1.1.0, Gemini 3.5 Flash, 유효 9회)에서 경영·실적 배점 값은 9/9 정답이었으나 인용 대조 실패로 전부 거부됨 — 손실의 최대 원인이 검증이었음. 대외신인도는 정답 "없음"을 확정 채점(ambiguous 제거).

추가(2026-10-20, S2 채택): 프롬프트 v2.0.0 채택. 같은 검증 기준 재채점에서 v1.1.0 대비 오답 7→0, 하락 항목 없음(대외신인도 2/9→8/8, 인정조건 8/9→8/8, 인정금액은 분모 선택이 사라지고 조건별이면 null+note). 함께 반영: verify 표 행 대조(셀 안 이어진 줄을 같은 행으로, 셀 태그 뒤 6줄 한도), 긴 인용 12줄 허용(partial 제외), 행 조각 대조(searchRow, 값이 행에 있어야 인정), `|` 뒤 글머리 무시(숫자 부호 보존), coerce가 "5년 이내"·"최근 5년"·"5억원 이상" 수용. 한계: 정답표 4건이 모두 같은 기관 양식, 유효 실행 8회 — 다른 기관 공고 추가 후 재평가 필요.

추가(2026-10-20, S3·S5 반영):
- S3: AI 출력 스키마 v2(variants), AiSuggestion.variants/verdict 'multi'/ruleRelation, 적용 시 variantIndex(note `[조건] 메모`, 조건 60자·note 500자 제한), 규칙 reason 'multi'(금액 한 줄 조건 구분자, 확인 필요 집계는 conflict와 동일). 스키마에 maxItems 넣지 않음(Claude structured outputs 미지원) — 개수 제한은 파서. 프롬프트 2.1.0. 실측: Gemini가 variants 스키마 수용, 팔레스타인 유형별 4개 정확.
- S5: API 기본 전문 전송(설정 ai.sendFullText, 기본 true), 상한 25만 자(실측 약 2자/토큰 → 약 12.5만 토큰), 초과 시 발췌. 수동은 발췌 v2(섹션 확장·주석 결속·참조어 추적). 항목 단독 요청 근거 누락 4/28→0.
- 전문 실패 시 자동 발췌 재실행은 넣지 않음: 새 runId를 일괄 실행·취소가 모르는 동시성 문제. 대신 AI_TIMEOUT·AI_BAD_REQUEST 실패 화면에 '관련 구간만 전송' 안내. 기각: runner 재실행(취소 경합).

## 2026-10-20, AI 비교 실행 (Fable 설계, 사용자 승인, 명세 .claude/specs/ai-compare.md)

| 결정 | 이유 | 기각 대안 |
|---|---|---|
| 표시 규칙을 "키별 최신 run 1개"에서 "키별, 공급자별 최신 요청 run"으로 확장. 기존 buildAiCards 결과가 primary, 다른 공급자 제안은 others | 따로 돌린 결과가 서로를 가리는 문제는 비교 실행 없이도 생김 | compareId 그룹만 비교 표시 / 별도 비교 테이블 화면 |
| primary 선정 규칙 불변("요청한 키 기준 최신") | 사이드패널, 확인 일치 배지, 기존 테스트 무영향 | 설정 공급자 우선 |
| AiRunner.execCompare가 같은 공고 잠금을 쥔 채 공급자를 순차 실행 | 공고당 1 run, 세션 키 1개, 고아 정리, 취소가 모두 단일 실행 전제 | 동시 실행 / 대시보드가 ai/run 순차 호출 / AiBatch 재사용 |
| 2번째 이후 run은 scope keys, keys = 첫 run.keys로 고정 | 실행 중 적용으로 pending이 줄어도 같은 항목을 비교 | 매 run 같은 scope 재해석 |
| 한 공급자 실패는 기록하고 계속, 취소만 남은 공급자 중단 | 공급자마다 키와 한도가 별개 | 첫 실패 시 중단 |
| AiRun.compareId?(파일), AiRunState.compare?(세션)만 추가. AI_MAX_RUNS(10) 유지 | 패널 묶음과 진행 표시용 최소 정보 | 비교 전용 파일 |
| 적용은 고른 공급자 제안만 appliedAt, 다른 제안은 남김. 무시도 그 공급자만 | 다른 AI 값으로 바꾸는 흐름 유지 | 적용 시 나머지 자동 무시 |
| 비교는 API 방식 전용, 시작 UI는 AiRunDialog의 "여러 AI로 비교" 전환 | prepareRun이 기존 awaiting run을 취소하는 구조와 충돌 | 반자동 포함 / 메뉴에 공급자 조합 나열 |

진입점 확장의 "공고당 1 run" 결정은 그대로 유지된다(비교 시리즈 전체가 잠금 1개).
구현 보강: 다음 run을 prepare하는 동안(직전 runId가 잠금에 남아 있음) 고아 정리가 방금 만든 requesting run을 닫지 않도록 잠금 항목에 preparing 표시를 둔다.

## 2026-10-20 공고정보 검토 탭(필수 12개 항목)
- 무엇: 검토 탭이 사용자 필수 12개 + 경영상태 배점을 13줄(잎 16개)로 검토한다. 탭 이름 "공고정보 검토". 실적점수 평가는 묶음 행(수행실적 배점 + 인정기간/금액/조건). 화면은 접힌 목록 + 결정 필요 행 자동 펼침.
- 데이터: ExtractionKey는 확장하지 않는다. 코어 `review-rows.ts`에 행 정의와 `leafReviewState`를 두고, 문서 잎 7개는 Extraction item, 공고 잎 8개는 notice FieldValue에서 만들어 공통 뷰 모델로 합친다. 스키마 변경, 마이그레이션 없음.
- 상태: API/HTML 값은 status verified면 확인 완료, missing/needs_review면 확인 필요. 탭 배지와 상단 요약은 `pendingLeafKeys` 하나로 센다. `pendingKeys`, `reviewCountOf`, handoff 게이트, 사이드패널 개수는 문서 추출 의미로 유지. not_run은 세지 않는다.
- 쓰기: 화면의 모든 수정/확정/되돌리기는 `notice/field-edit`(D1). "이 값이 맞음" = 같은 값으로 user_edited, "확인함"은 저장값 == 자동값 비교로 파생(필드 추가 없음).
- AI 재검토 범위는 문서 항목 7개 유지. 공고 필드 행에는 AI 버튼 없음. → 같은 날 사용자 결정으로 변경, 아래 "AI 재검토 대상 13행 확장" 참조.
- 입찰참가자격등록은 소스에 시작값이 없어 "마감" 한 값만 표시, 공고게시일시로 합성 금지.
- 기각: ExtractionKey에 8개 추가(Record 전수 파급, AI 스키마 변경, 문서 추출 의미 훼손), notice FieldValue만으로 구성(EvidenceRef, 후보 근거, AI 연결 상실).
- 기존 결정 변경: 2026-10-19 "검토 탭 count는 extraction 있을 때만, 라벨 평가정보 검토" → extraction 없어도 count, 라벨 공고정보 검토.

## 2026-10-20 낙찰 결과 추적과 팔로우 알림 (Fable 설계, 사용자 승인, 명세 .claude/specs/award-tracking.md)

| 결정 | 이유 | 기각 대안 |
|---|---|---|
| "낙찰"은 낙찰정보 API(2단계)에서 낙찰 업체가 우리일 때만. 1순위는 중간 상태 | 협상 결렬, 적격심사 탈락으로 1순위가 뒤집힘. 거짓 낙찰이 더 비쌈 | 비협상 공고는 1순위를 낙찰로 간주 |
| 결과는 루트 results.json(파생 캐시), 팔로우는 follows.json(사용자 의사) 별도 파일. offscreen만 씀 | notice.json은 수집 잡 덮어쓰기 경합, index.json은 재생성 시 유실. 파생 캐시와 사용자 의사의 손상 처리 분리 | notice.json/index.json 필드, chrome.storage, 공고별 파일 |
| IndexEntry.result, following은 listNotices에서 파생 병합 | 화면은 notice/list 하나만 보면 됨 | 대시보드가 별도 메시지로 읽기 |
| 일반 공고는 목록 진입 시만 확인(10분 스로틀, 15건 상한). 주기 알람 없음 | 배지는 목록을 열어야 보임(사용자 결정) | 60분 주기 알람 |
| 팔로우 공고만 단일 when 알람으로 확인 후 OS 알림. 개찰 전 0회, 시작 = max(개찰, 제안서 평가), 6시간 10분 간격, 이후 평일 9~17시 정시, 순위 후 평일 10/14/17시 | 결과는 담당자 근무 시간에 게시, 며칠 걸리는 경우 대응(사용자 결정) | 공고별 알람, 고정 간격 |
| 알림은 SW가 발송, 중복 방지는 follows.notified + notification id 교체 | offscreen은 chrome.notifications 불가 | offscreen 발송 |
| 결과 확정 또는 120일 경과 시 알림 후 팔로우 자동 해제 | 끝난 공고 계속 확인 불필요 | 수동 해제만 |
| 수동 결과 덮어쓰기 없음 | 공개 API로 재계산 가능한 파생값, 충돌 규칙이 생김 | 사용자 수동 확정 |
| 1단계 행은 차수로 거르지 않음(결과는 마지막 차수 기준) | 000만 수집한 정정 공고가 영원히 대기가 되는 것 방지 | 차수 일치 행만 |
| 2단계 오퍼레이션, 필드는 추정. S0 실측 후 AWARD_FIELDS 확정 | 코드로 확인 불가 | 추정대로 바로 구현 |

## 2026-10-20 AI 재검토 대상 13행 확장
사용자 요구 "AI가 13개 모두 찾을 수 있어야" (행 버튼, 전체 재검토, 사이드패널 원클릭, 일괄 실행 모두). 명세 `.claude/specs/ai-review-13.md`.

| 결정 | 이유 | 기각 대안 |
|---|---|---|
| AiKey = ReviewLeafKey(16). run.keys, suggestions, ai/apply, ai/dismiss key 전부 AiKey | AI 파이프라인 전체가 키 색인 맵, ReviewLeafKey가 라벨/kind/상태/수정 가능 여부가 정의된 유일한 집합 | ExtractionKey 확장 / extras 경로 / key: string |
| 공고 잎 9개는 문서 원문 표기 string으로 받고 코드가 환산(docDateToIso, toIsoKst, parseKoreanAmount, parseJointVenture), 검증은 validateFieldValue | v2 원칙과 같음, AI 환산 오류 제거, raw 보존 | AI가 ISO/정수/boolean 직접 제공 |
| 시각 없는 날짜는 값이 아님(note만) | FieldValue ISODate 의미 유지, 00:00 채우면 늘 differs | 날짜만 허용 |
| verdict 기준값은 공고 잎 = 현재 FieldValue. text는 compact 후 포함 관계(짧은 쪽 4자 이상)면 match, datetime은 Date.parse 동일 | 형식만 다른 API 값이 전부 differs로 뜨는 소음 방지 | 정확 일치 / 프롬프트에 API 값 제공(앵커링) |
| 적용은 applySuggestion 안에서 분기: 공고 잎은 editNoticeField(source.ref 'ai:<runId>'), stale 검사 공통 | UI 진입점 하나, appliedAt 기록 유지 | UI가 field-edit로 우회 |
| "AI 적용" 표시는 source.ref가 'ai:'로 시작하는지로 파생 | 스키마 불변 | userEdit.origin 추가 |
| 범위 계산은 pendingLeafKeys 하나(all = 16). pendingKeys, reviewCountOf, handoff 게이트는 유지 | 탭 배지, 메뉴 힌트, run.keys가 같은 수 | 진입점별 7/16 |
| AI_MAX_TOKENS 8192 → 16384, 타임아웃 유지 | 16개 항목 출력 잘림 방지 | 두 run으로 분할(공고당 1 run 위반) |
| 프롬프트 2.2.0, AI_SCHEMA_TAG /2 유지 | 응답 구조 동일 | 태그 /3 |
| S3 이후(엔진, 프로토콜, ai-view, 화면)는 AI 비교 커밋 뒤 | 같은 파일 동시 수정 충돌 | 동시 진행 |
| (같은 날 추가, 사용자 결정) 사이드패널 "검수" 버튼 배지도 noticeReviewCount(13행 기준). "평가 기준" 묶음 배지, 나라장터 패널 "평가정보: 확인 필요 n건", handoff 게이트는 문서 항목 기준 유지 | 검수 버튼은 검토 탭으로 가는 입구라 탭 배지와 같아야 함. 나머지는 평가정보만 가리키는 표시이거나 자동 메일 게이트 | 사이드패널 전부 13행 |

## 2026-10-20 입찰 전 기능 5종 방향 (Fable 검토, 사용자 "추천대로")
검토 요약 `.claude/specs/prebid-features.md`. 진행 순서 4(마감 알림) → 1(자격 판정) → 2(예상 점수) → 3(기관 이력) → 7(투찰가 시뮬레이터).

| 결정 | 이유 | 기각 대안 |
|---|---|---|
| 마감 알림은 이미 구현된 award-tracking 인프라(권한, result-scheduler, notify 설정)를 공유. 알림 발송과 클릭 처리를 `src/background/notify.ts`로 추출하고 스케줄러마다 자기 id 접두어(`result:`/`deadline:`) 클릭 리스너를 둔다. 명세 `.claude/specs/deadline-notify.md` | 알림 체계 이중화 방지, result-scheduler 테스트 무변경 | 기능별 알림 체계 / 공통 클릭 라우터 |
| 알림 계획은 offscreen이 계산해 storage.local `deadlinePlan`에 캐시, SW는 캐시로 발송 | SW는 파일을 못 읽고 폴더 권한이 prompt일 수 있음 | 알람 시 offscreen 기동 후 읽기만 |
| 회사 등급/속성은 `Settings.company` 확장, 실적 목록은 `config/performances.json` | 스칼라는 settings 전례(393행), 목록은 config 파일 전례(148행) | 둘 다 settings / 둘 다 파일 |
| 자격 판정은 저장하지 않고 화면에서 계산, "미달 확정" 문구 금지(미달 가능), 인정조건 원문이 있으면 확인 필요 | 실적 목록 변경 시 stale 방지, 추출 오류로 입찰을 포기하는 비용이 큼 | 판정 결과 저장 / 미달 확정 표시 |
| 예상 정량 점수는 공고별 직접 입력 + 근거 표시(`<folder>/estimate.json`). 기본 비율표 추정은 쓰지 않고 등급표 자동 추출은 보류 | 추출기는 배점만 보유, 497행 "문서에 없는 숫자 생성 금지" 유지 | 기본 비율표 추정 / 등급표 추출 선행 |
| 기관 이력은 수요기관(dminsttCd) 기준 3년, 수동 갱신 + 로컬 캐시 `orgs/<기관코드>.json`, 착수 전 공개 API probe | 조달청 대행 공고는 공고기관이 조달청, 일일 호출 한도, 기간 검색/낙찰 목록 오퍼레이션 미확인 | 공고기관 기준 / 자동 주기 조회 |
| 투찰가 시뮬레이터는 저장 없이 계산, 분모 기본 추정가격(변경 가능), 경쟁 최저 투찰률 기본 88%(기관 분포가 있으면 그 값), 낙찰하한율 아래는 계산 제외 경고 | 기초금액은 API에 없음, 공식은 평가 이력 검증 비율과 함께 "가정"으로 표기 | 공식 고정 적용 |

S0 실측 1차(2026-10-20): 1단계(OpengCompt, inqryDiv=4)는 확인됨. 필드는 prcbdrBizno, opengRank, totalEvlAmtVal(높을수록 상위, SCORE_RANK_DESC=true 확인), rbidNo, opengRsltDivNm("개찰완료"). 낙찰 플래그 필드는 없음(openingWon 비활성 유지). 개찰 전 공고는 0건 응답(오류 아님). 2단계 getScsbidListSttus* 는 inqryDiv=2 + bidNtceNo로 "08 필수값 입력 에러" → inqryDiv=4(공고번호 조회)로 변경, 재실측 필요.
S0 실측 2차(2026-10-20): 2단계는 inqryDiv=4 + bidNtceNo로 성공. 용역 공고는 getScsbidListSttusServc만 1건, 나머지 op는 0건(성공). 필드 bidwinnrBizno, bidwinnrNm, sucsfbidAmt, fnlSucsfDate(YYYY-MM-DD), rlOpengDt, prtcptCnum 확인. AWARD_FIELDS 추정값 그대로 확정. 유찰 공고는 실측 못 함(openingNoBid 비활성 유지).

## 2026-10-21 입찰공고 수집 시 연계 사전규격 첨부 동반 수집 (Fable 설계, 실측으로 조정, 사용자 승인, 명세 .claude/specs/prespec-link.md)
배경: R26BK01631407-000은 첨부가 공고서뿐이라 배점표(제안요청서)를 못 찾음. 제안요청서는 연계 사전규격 R26BD00246532에만 있음.

| 결정 | 이유 | 기각 대안 |
|---|---|---|
| 입찰공고 수집마다 `bfSpecRgstNo`로 사전규격을 조회해 첨부를 같이 받음(조건부 아님, 설정 토글 없음) | 공고서만 올리고 제안요청서는 사전규격에만 두는 경우가 흔함. 조건부는 추출 뒤 흐름을 한 번 더 돌려야 함 | 배점 not_found일 때만 받기 |
| fetch_basic 안에서 처리, 새 StepId 없음. 사전규격 첨부는 같은 `attachments` 배열과 폴더에 `origin: 'prespec'`으로 이어 붙임 | 경로 가정과 단계 라벨이 여러 곳에 고정 | `fetch_prespec` 단계, `attachments/prespec/` 하위 폴더, 별도 배열 |
| 미존재(`G2B_NOT_FOUND`)는 정상, 그 외 실패는 partial(`PRESPEC_FETCH_FAILED`, retryable). 재시도에서는 재조회 안 함 | 오래된 공고는 사전규격이 흔히 없음. 진행 중 첨부 배열이 다시 짜이면 다운로드 상태와 어긋남 | 모든 실패 무시 / 미존재도 partial |
| 사전규격 API에는 파일명 필드가 없음(실측). 다운로드 시 확장자 없는 이름은 `content-disposition` 파일명으로 교체 | 이름 없이 저장하면 추출이 형식을 모름. 단독 사전규격 수집의 같은 문제도 해결 | 매직 바이트로 확장자만 추정 |
| 중복 판정은 다운로드 후 한 번: 이름 키(NFC, 소문자, 공백과 괄호 제거, 확장자 포함)가 같거나, 크기가 같고 sha256이 같으면 사전규격 파일을 지우고 행은 skipped + `duplicateOf`로 남김. 이름 같고 내용 다르면 입찰공고판 채택 | 다운로드 전엔 이름을 모름. 입찰공고판이 최종본이고 사전규격 초안 배점 혼입 방지 | 다운로드 전 이름 비교(Fable 원안, 실측으로 불가), 둘 다 보관 |
| 추출은 입찰공고 첨부 우선: bid 후보가 있으면 prespec 후보는 결정에서 빼고 candidates에만 남김. bid 후보가 없을 때만 prespec 값으로 verified, 화면에 "사전규격 첨부" 출처 | 공고서와 초안 차이로 매번 충돌이 생기는 것 방지, 차이는 검토 화면에서 볼 수 있음 | 동급 경쟁, prespec 값은 항상 needs_review |
| 메일 첨부에 사전규격 첨부 포함(중복 행은 skipped라 제외) | 사용자 결정 | 공고서만 첨부 |
| 이미 수집한 공고는 수동 "다시 수집"으로 반영 | API 일일 한도, 폴더 권한 | 일괄 보충 |

- 2026-10-19 결정의 "사전규격 extract 항상 skipped"는 사전규격 공고 단독 수집에만 해당. 입찰공고에 연계된 사전규격 첨부는 bid 공고의 보충 문서로 추출하되 bid 후보가 우선.

## 2026-10-21 정량평가 표 기반 "해당 없음" (Fable 설계, 사용자 승인, 명세 .claude/specs/not-applicable.md)
배경: R26BK01631407-000은 정량평가가 경영상태 10점 하나뿐인데 실적과 신인도가 "확인 필요"로 남음.

| 결정 | 이유 | 기각 대안 |
|---|---|---|
| 새 전략 `quant-table`이 정량표를 `extras.quantTable`("<합계>:<범주>")로 요약, decide 후처리 `applyQuantTable`이 not_found 항목만 `verified + value null + reason not_applicable`로 바꿈 | no_total/bonus-table과 같은 구조, 숫자를 만들지 않음 | 경영상태가 있으면 나머지 자동 해당 없음(표 근거 없는 추정), 새 status 값 |
| 표 완결성: 합계 배점과 행 배점 합 일치, 행/열 잘림 탈락, 범주를 하나도 못 읽으면 탈락, 제목에 정성/기술/가격평가가 함께 있으면 양식 A 제외 | 표를 일부만 읽은 거짓 해당 없음 방지 | 행 수 임계값, 제목만으로 판정 |
| 범주는 배점 열(머리글이 배점 동의어인 모든 열)만 빼고 모든 칸에서 부분 일치 | 계층 표의 오른쪽 세부 항목 누락 방지, 오탐은 "있다고 봄" 방향 | 배점 열 왼쪽만, 라벨 길이 제한 |
| 해당 없음은 그룹 충족(대외신인도/경영상태) 근거가 아님 | 경영상태 파싱 실패를 신인도 해당 없음이 덮는 것 방지 | 그대로 충족 |
| 공고 필드는 `verified + null + note NA_NOTE`, mergeKey는 이를 해석 실패로 돌리지 않음 | FieldValue에 reason이 없음, 병합에서 needs_review로 바뀌면 메일 템플릿이 확인 필요로 표시 | FieldValue에 reason 추가 |
| 적격 판정 verdict 불변, 사유 문구만 해당 없음 | 참가자격 쪽 실적 요건이 따로 있을 수 있음 | 해당 없음이면 충족 |
| 규칙 1.4.0, 스키마 유지, 기존 공고는 다시 추출 | 가산적 변경 | 스키마 버전 올림 |
| 같은 날 perf.period: "…제시"(제안서 작성 안내), 하수급인/하도급 계약금액 대비 실적 기간 제외. valueKey는 끝 "이내"만 다른 값을 같게 봄. 제안서 평가일시 라벨 옆 칸 규칙 `sched.proposalEvalDocCell` 추가 | 전자출하 제안요청서 실측 오탐/누락 | 없음 |

## 2026-10-21 실적 집계 (Fable 설계, 화면 목업 .claude/specs/bid-stats-mockup.html)
배경: 앱에 등록하고 결과를 추적한 공고의 투찰/낙찰 건수와 금액, 순위 분포, 기관별 집계. 대시보드 "실적" 페이지 + 공고목록 위 요약 띠.

| 결정 | 이유 | 기각 대안 |
|---|---|---|
| 우리 투찰금액은 개찰결과 1단계 우리 행의 `bidprcAmt`를 `ResultEntry.ourAmount`에 저장 | 이미 호출하는 응답에 있어 추가 호출 0회. 평가 분석에서 실측 확인됨(eval-analysis.md:31) | 2단계 sucsfbidAmt만 사용, 추정가격 대용 |
| 낙찰금액은 `amount`(sucsfbidAmt) 우선, 없으면 `ourAmount` | 협상 계약은 sucsfbidAmt가 빈 값일 수 있음 | amount만 사용 |
| schemaVersion 1 유지, 선택 필드 `ourAmount?`, `amountCheckedAt?` 추가 | 버전을 올리면 ResultStore.load가 기존 파일을 버리고 전부 재조회 | 버전 2 + 마이그레이션 |
| 종료 항목 백필은 list 모드에서만, 1단계만 호출, 1회 10건 상한, judge 재실행 없이 `applyOurAmount`로 금액만 채움. 성공 응답이면 값 유무와 무관하게 `amountCheckedAt` 기록 | 종료 상태가 재판정으로 바뀌는 위험 차단, 우리 행 없는 건 반복 호출 방지 | 수동 "금액 가져오기" 버튼, judge 재실행, follow 모드 실행 |
| 집계 입력은 `notice/list`의 IndexEntry만(`result`에 ourAmount, openingAt 병합). 순수 함수 `core/results/stats.ts` | 기존 병합 경로 재사용, 목록 띠와 실적 페이지 숫자 일치 | 새 메시지 + offscreen 집계 |
| 월 귀속 = openingAt(로컬 시간) | 모든 항목에 있는 유일한 날짜 | awardedAt, collectedAt |
| 투찰 = won, lost, rank 있는 ranked/expired. 낙찰률 분모 = won + lost | 미확정을 분모에 넣으면 개찰 직후 낙찰률이 일시적으로 떨어짐 | 투찰 전체 분모 |
| 차트 라이브러리 미도입, div 막대(홈 MonthlyBars 방식 복제) | 막대 최대 12개, 번들과 톤 일치 | recharts, 직접 SVG |
| 색은 낙찰 = ok, 전체 투찰 = 회색 두 가지만. 탈락에 danger 색 미사용 | 실적 화면이 경고판처럼 보이지 않게 | 상태별 다색 |
| 일반 판정 루프에서 1단계 성공 + 종료 상태로 판정되면 `amountCheckedAt`도 찍는다(구현 중 보정) | 같은 응답에서 이미 ourAmount를 읽었으므로 다음 실행의 백필 재호출 방지 | 백필에서만 기록 |
| 실적 페이지는 독립 메뉴 "실적". 홈은 숫자 카드 아래 한 줄 띠만, 공고목록 위에도 같은 띠(사용자 결정) | 홈은 살짝만, 상세는 따로 | 홈에 섹션 추가, 홈 맨 아래 카드, 공고목록 띠 제거 |


## 2026-10-21 팔로우 범위 선택 (Fable 설계, 명세 `.claude/specs/follow-target.md`)
사용자 요구: 별을 누르면 "개찰 결과만 / 낙찰까지" 중에 고르는 작은 메뉴.

| 결정 | 이유 | 기각 대안 |
|---|---|---|
| FollowEntry.target('rank'/'final'), 기본 final. 옛 follows.json은 읽을 때 final로 정규화하고 다시 쓰지 않음, schemaVersion 1 유지 | 추가만으로 호환 | 마이그레이션 쓰기 / 버전 올림 |
| 전역 notify.rank/final은 알림 스위치, 공고별 target은 추적 범위. 독립이며 메뉴는 경고 설명만 | 두 개념 분리, 전역 설정이 공고 선택을 막지 않게 | 전역 설정으로 메뉴 비활성 |
| 개찰 결과만 해제는 저장 시점(finally)의 target으로 판정하고, finally는 follows 항목을 덮지 않고 notified만 합침(구현 중 리뷰 Major 보정) | 실행 중 사용자의 범위 변경이 덮이거나 무시되는 경합 방지 | 실행 시작 때 읽은 항목으로 통째 덮기 |
| final에서 rank로 바꾸면 notified.rank를 비움(리뷰 Minor 보정) | 새 round에서 순위 알림 없이 조용히 해제되는 것 방지 | 그대로 유지 |
| 메뉴는 포털 + fixed, 아래 공간 부족하면 위로 | 목록 overflow 컨테이너에 잘림 방지 | 행 안 absolute |
| (2026-10-21 사용자 결정) 마감 알림 대상을 "메일 전달 완료 또는 팔로우 중"으로 넓힘(`isDeadlineTarget`). 팔로우 변경 시 deadline/refresh | 팔로우한 공고에 마감 알림이 안 오는 어긋남 해소, 알림 수는 계속 통제 | 수집 공고 전부 / 전달 완료만 유지 |

## 2026-10-21 대시보드 바로 발송 (Fable 설계, 명세 `.claude/specs/auto-send.md`)
사용자 요구: 웹메일 작성 탭에 가지 않고 대시보드 [바로 발송]으로 보내기. 작성 탭은 뒤에서 처리.

| 결정 | 이유 | 기각 대안 |
|---|---|---|
| 웹메일 작성 탭 자동화로 발송(작성 탭을 백그라운드로 열고 보내기 클릭) | 기존 채우기·첨부·발송 감지 재사용, 인증 신설 없음. S0 실측: 합성 클릭으로 발송됨, 숨은 탭에서도 발송됨 | 네이버웍스 메일 API(OAuth·앱 등록) / SMTP(확장에서 불가) |
| 2026-10-18 compose 설계의 "전송 경로 없음"을 `src/background/send-trigger.ts`의 executeScript 클릭 1개에 한해 대체. dom-actions 금지·send-watch 관찰 전용은 유지, 스캔 테스트로 `.click(` 1회 고정 | 채움 엔진은 끝까지 보내기를 못 누르게 격리 | dom-actions 금지 완화 / Ctrl+Enter 합성 / chrome.debugger |
| 동의는 대시보드 미리보기 한 곳. 토큰(fingerprint + expectSentCount)으로 미리보기와 실제 입력이 다르거나 사이에 발송이 생기면 클릭 안 함 | 되돌릴 수 없는 동작의 유일한 동의 지점 | 잡 중 재확인 |
| 새 잡 타입 없이 compose 잡의 `send_mail` 단계. 재시도(attempt>1)·자동 작성 잡은 자동 발송 금지 | abort·진행·탭 바인딩 재사용, 이전 클릭 결과 불명 상태에서 재발송 방지 | 별도 send 잡 |
| ledger `send.clickedAt`을 클릭 전에 기록, 클릭 rpc 재시도 없음(오류=발송 여부 불명) | 중복 발송 방지 | 클릭 후 기록 |
| 발송 확인 = ui_gone / toast / unload / 클릭 뒤 작성 탭 제거(onRemoved). S0: 숨은 탭은 보낸 뒤 스스로 닫힘 | 숨은 탭 타이머 스로틀·자체 닫힘 대응, SW 능동 확인 병행 | CS 폴링만 |
| 확인되면 탭 닫기(설정 없음), 15초 안에 미확인·조건 미달·오류면 탭을 앞으로 | 사용자 요구(뒤에서 처리), 이상 시 사람에게 넘김 | 항상 앞으로 |
| 모든 compose 탭 `autoDiscardable:false` | 백그라운드 채움 중 탭 폐기 방지 | 미적용 |
| 자동 작성 큐 연동 기각 | 사용자가 본 적 없는 메일이 나가면 안 됨 | 자동 작성 후 바로 발송 |
| 버튼은 메일 준비 화면에만, 재발송 허용 + 경고(사용자 결정) | 미리보기에 필요한 초안이 있는 유일한 화면 | 사이드패널·상세·트래커봇 행 |
| (구현 중 실측 보정) 네이버웍스 받는사람·참조는 URL 전달이라 verify에서 늘 prefilled. 가드 4는 recipientLists가 있으면 prefilled를 허용하고, 클릭 직전 화면 주소 목록(`.list_addrobj`, 순서 받는사람·참조·숨은참조)을 칸별로 대조: 1번째=to, 2번째=cc, 3번째 이후는 비어 있어야 함(RECIPIENT_MISMATCH). 순서는 2026-10-21 사용자 실측으로 확인(받는사람·참조·숨은참조 각 1명, 이름 붙은 칩 `이름 <주소>`도 주소만 추출) | 잘못된 수신자 발송이 가장 비싼 실수 | prefilled 무조건 허용 / to∪cc 집합 대조(받는사람·참조 뒤바뀜 못 잡음) |

## 2026-10-21 메일 작성 진입을 대시보드로 일원화

| 결정 | 이유 | 기각 대안 |
|---|---|---|
| 수집 뒤 바로 작성(afterCollect compose)·고르기(ask) 제거. `decideHandoff`는 afterCollect와 무관하게 edit/review만 반환. 저장된 compose·ask 값은 스키마 그대로 두고 무시 | 사용자 결정: 메일 작성은 무조건 대시보드 메일 준비 화면에서 | 설정 유지하고 수동 버튼만 변경 / AfterCollect 타입·저장값 마이그레이션 |
| 사이드 패널 요약 카드의 ComposeCard를 대시보드 이동 버튼 하나로, 나라장터 하단 알약에 [메일 발송](대시보드 이동) 추가, 트래커봇 팝업 [바로 작성] 제거 | 진입점 일원화 | 진행 상태 줄 유지 |

## 2026-10-21 나라장터 수집 카드 → 트래커봇 진행 카드 통일

| 결정 | 이유 | 기각 대안 |
|---|---|---|
| g2b 패널의 수집 중 카드를 트래커봇 `createProgressCard`로 교체. React 안에서 ref로 마운트하고 카드에 `inline` 옵션(static 위치, body 자동 부착 안 함) 추가 | 사용자 요구 "같은 UI". 같은 코드여야 드리프트 없음. React 트리 안이라 WebSquare 재마운트·note 배너·hover가 그대로 적용 | Panel 밖 별도 fixed 마운트(결합부 과다) / React 포팅(중복) / 바깥 CSS 덮어쓰기(shadow root라 불가) |
| 카드·뷰 타입·`activeItem`을 `src/ui/progress-card/`로 이동, progress-view는 재export | 두 플랫폼 공용 컴포넌트는 중립 위치 | trackerbot 폴더에 두고 g2b가 참조 |
| 카드에 optional `cancel.force` + `on.force`로 '강제 중단' 추가 | g2b의 멈춘 취소 탈출구 유지, 트래커봇 무영향 | 강제 중단 제거 |
| 진행 중 오류 수 미표시, 끝난 뒤 완료 카드가 담당. 알약 글자는 '수집 중 n/m' 유지 | 트래커봇과 같은 원칙 / 사용자 선택 | detail에 오류 수 표기 / '작업 1건 진행 중' |
| 진행→완료 시 카드가 1.3초 arrive/fail 연출 후 기존 Done/Error 카드로 전환, 자동 접힘 타이머는 연출 뒤 시작 | 트래커봇과 같은 완료 연출 | 즉시 전환 |
| 수집이 끝나도 대시보드를 저절로 열지 않음(edit·review 모두 handoff만 기록, opened:false). 나라장터 완료 카드·대기 알약과 트래커봇 팝업에 [상세](`#/notices/<id>`, ui/open page 'notice' 추가)·[메일 작성] 버튼, 검수 필요면 [검수]도 | 사용자 결정: 바로 띄우지 말고 버튼을 눌러 이동, 상세로 가고 싶을 수도 있음. 버튼은 handoff와 무관하게 완료 카드에 둠(자동 메일 작성 설정이 꺼져 있으면 handoff가 없음) | 완료 즉시 대시보드 열기 / handoff 줄에만 버튼 |

## 2026-10-21 RFP 요구사항 비교 (Fable 설계, 명세 `.claude/specs/rfp-compare.md`)

| 결정 | 이유 | 기각 대안 |
|---|---|---|
| D1 추출 결과(RequirementSet)만 파일 캐시, 짝짓기·diff는 저장하지 않고 화면에서 순수 함수로 계산 | 짝 규칙·임계값을 고쳐도 마이그레이션 없음. 세트 2개 + override로 결정적 재현 | 비교 결과 JSON 저장(규칙 변경마다 stale) |
| D2 수집 공고 RFP는 비교에 고를 때 온디맨드 재파싱, `notices/<folder>/rfp/<attachmentId>.json`에 캐시. 수집 시 선생성은 선택 단계 | 기존 공고는 어차피 재파싱 필요, 파싱은 수 초 이내. 수집 경로 무변경 | 수집 잡 강제 포함 / 전체 일괄 백필 |
| D3 업로드 파일은 원본 바이트도 보관(`rfp/uploads/<id>/source.<ext>`) + 세트 JSON + 렌더 텍스트 | 추출기 버전 상승 시 재추출, "올린 문서" 보관함 재사용 | 세트 JSON만 저장 |
| D4 업로드 파싱은 offscreen(대시보드→SW→offscreen base64) | 파서·pdf 자산·파일 쓰기가 offscreen, 단일 작성자 유지 | 대시보드 로컬 파싱(pdfjs 중복) |
| D5 짝짓기: 정규화 ID 일치(이름·본문 유사도 모두 낮으면 "ID 충돌" 보류) → 유사도 그리디 → 분할/병합(포함률) | 번호 재배정·재사용을 ID만 믿으면 엉뚱한 짝이 "변경"으로 뜸 | ID만 / 유사도만 |
| D6 유사도 = 정규화 텍스트 문자 bigram Dice | 형태소 분석기 없이 한국어에 안정적, 의존성 0 | 어절 Jaccard / 임베딩 |
| D7 diff = 어절 Myers + 짧은 교체 구간(≤30자) 문자 재세분, 자체 구현 | 숫자·기간 변경이 눈에 띄어야 함, `diff` 패키지 미설치 | 문자 전체(노이즈) / 외부 패키지 |
| D8 수동 짝 맺기/풀기 지원, 세션 파일 `rfp/compares/<id>.json`에 override·확인함·AI 요약만 저장 | 자동 짝은 틀릴 수 있음, 저장 데이터는 사용자 의사만 | 수정 불가 / 결과 전체 저장 |
| D9 AI 입력은 변경·신규·삭제 diff만(동일 제외), 항목당·전체 상한, 실행 전 글자 수 표시, 자동 실행 없음 | 비용 통제 | 문서 전문 전송 |
| D10 AI 요약은 AiRunner·AiReviewFile과 별도 경로(요청/응답 1회, 세션에 저장) | 공고 검토 파이프라인은 noticeId·검증에 결합, 업로드끼리 비교는 공고 없음 | AiRunner 재사용 |
| D11 공급자 어댑터 입력 `spec` → `schema`+`schemaName` 일반화 | 다른 출력 스키마의 첫 사례, 작은 변경 | 어댑터 복제 / spec에 선택 필드 |
| D12 독립 메뉴 `#/rfp` + 결과 `#/rfp/compare/<id>`, 공고 상세 [변경점 비교] → `#/rfp?next=<noticeId>` | 사용자 결정(C안). 세션 id가 주소에 있어 새로고침·뒤로가기 동작 | 상세 탭 / 모달 |
| D13 공고 피커 추천 정렬(같은 수요·공고기관, 제목 bigram ≥0.3) | "유사 사업·같은 기관"이 1차 탐색 축 | 최신순만 |
| 슬롯 이름 "이전 문서 / 이번 문서", 상세 버튼은 이번 문서를 채움(사용자 확인) | 용도가 작년 제안서 재활용 → 신규/삭제 뜻 고정 | 기준/비교(방향 모호) |
| 코어(extract.ts, match.ts)는 메인 직접 또는 리뷰 필수, 임계값은 S5 실측 후 constants.ts에서 조정. PDF는 문단형 폴백만(기존 결정 유지) | 틀리면 비싼 로직 | — |
| (사용자 결정) 화면 명칭 "이전/이번" → "비교 대상/기준"(내부 키 prev/next·URL·세션 필드는 유지). 비교 대상=회색 ○ 칩, 기준=primary ● 칩 + 상세 비교 기준 열 옅은 primary 바탕 | "이전/이번"이 글자 한 자 차이라 한눈에 구분 안 됨(사용자 피드백) | 과거/현재, 기존/새 공고 |
| (사용자 결정) `IndexEntry.demandOrg?` 추가, INDEX_VERSION 3, migrateIndex를 "항목별로 필요한 보충(schedule·demandOrg)만" 하도록 일반화. RFP 공고 고르기의 기관 표시·필터·같은 기관 추천은 `demandOrg || orderingOrg` 기준 | 조달청 대행 공고는 공고기관이 모두 "조달청"이라 기관 구분이 무의미. 기존 schedule 보충과 같은 파생 인덱스 패턴이라 위험 낮음 | 공고기관만 유지 / 공고 열 때마다 notice.json 개별 조회 |
| 파일명·공고명 등 문서를 가려내는 이름은 말줄임 금지(줄바꿈으로 전부 표시). RFP 칸의 첨부 바꾸기는 공용 Select 대신 펼침 목록 | 사용자 요구 "파일명이 한번에 다 안 나오면 안 됨". 공용 Select 수정은 다른 화면 영향 | 공용 Select에 줄바꿈 옵션 추가 |
| 공고 연도 = 공고번호 앞자리(R26… → 2026), 아니면 수집일 연도 | 인덱스에 게시일 없음, 나라장터 번호 체계로 충분 | 게시일 인덱스 추가 |
| 짝짓기: 같은 번호를 먼저 확정하지 않고 ID_BONUS(0.15) 가산점으로만 반영해 전체 후보를 점수순 그리디로 짝짓는다(같은 번호도 명칭·본문 기준 미달이면 후보 제외 + id_collision) | 실측(출연연 NFIS 2026→2027): COR-003 삭제로 번호가 당겨지자 COR-005 "특수조건(1)"↔COR-005 "특수조건(2)"가 번호 짝으로 먼저 확정돼 대폭 변경이 연쇄 발생 | 번호 일치 우선 확정(기존 D5 1단계) |
| (사용자 결정) 내용은 같고 번호만 바뀐 짝은 same이 아니라 changed + `number_only` 태그("번호만 바뀜", 상세에 "조견표 번호를 고쳐 주세요") | 조견표·제안서의 요구사항 번호를 고쳐야 하는 실제 변경. same은 기본 숨김이라 놓침 | same + renumbered 유지 |

## 2026-10-21 라이트 모드 톤 개편

| 결정 | 이유 | 기각 대안 |
|---|---|---|
| (사용자 결정) 라이트 중성색을 쿨 그레이(canvas #f1f3f6, surface #fcfcfd)로. 카드 그림자 제거(테두리로만 구분), 보조 버튼 면은 새 토큰 `btn-face`(카드 면보다 한 톤 낮음) | 누런 회색 바탕 + 순백 카드·버튼 + 그림자로 면마다 "붕 떠" 보임(사용자 피드백) | 순수 뉴트럴 / 웜 통일(카드 아이보리) / 배경만 교체 |
| Button primary = 파란 채움(화면당 주 동작 하나), 나머지 변형 그림자 없음 | 연파랑 면 primary가 흰 버튼 사이에서 다른 재질처럼 보임 | 연파랑 면 유지 |
| `--font-mono` = 본문 글꼴 + `.font-mono` tabular-nums | Consolas 등 고정폭 글꼴에 한글이 없어 '원'·'해당 없음'만 다른 글꼴로 떨어짐 | 호출부 117곳 개별 수정 |
| 제목 앞 세로 막대(.title-mark::before) 제거, 탭은 검은 알약 → 밑줄 탭(공고 상세·메일 관리) | 막대가 커서처럼 보이고 알약 탭이 무거움 | — |
| (사용자 결정) 공고 상세 헤더: 원문 보기·변경점 비교·메일 작성 준비만 밖에, 평가점수·폴더 경로 복사·다시 추출은 [더보기](MoreMenu). 진행 중인 동작은 밖에 표시 | 버튼 6개가 한 줄에 늘어서 산만 | 전부 노출 |

## 2026-10-21 추출 판정: 해당 없음 확대·서식 구간·기간 비교

| 결정 | 이유 | 기각 대안 |
|---|---|---|
| (사용자 결정) 문서에 "정량평가 : 없음/미실시/해당없음"이 명시되고 정량표가 없으면 신인도·경영·실적 배점(못 찾은 것만)을 해당 없음. 가감점 표가 있으면 신인도 제외. 실적 하위 3개는 공고문 참가자격에 실적 제한(extras.perfRestriction)이 없을 때만 상위를 따라 해당 없음(명시 문구면 충돌 후보도 덮음, 후보는 candidates로 보존) | 정성평가만 하는 협상계약(출연연 NFIS 2027)에서 7건이 거짓 확인 필요. 실적은 참가자격 제한에도 쓰여 하위 항목이 남을 수 있음 | 무조건 6개 해당 없음 |
| 명시 문구가 없어도 정성 항목만으로 100점인 배점표(extras.qualOnlyTable, 새 전략 qual-table)가 있으면 같은 판정. 단 배점 3개 모두 못 찾음 + quantEvalDoc·quantMention(문서 어디든 "정량") 없음일 때만, 실적 하위는 못 찾은 것만 덮음 | 추정 근거라 반대 증거가 있으면 검토로 남겨야 함(리뷰 Major) | 명시 문구만 인정 |
| 서식 구간(표 밖 제목 문단 "[별지 제N호 서식]"·"<서식 N>"·"…계약서(안)" 등 ~ 다음 장·붙임 제목) 후보는 같은 문서에 본문 후보가 있을 때만 판정에서 빼고 candidates 뒤에 붙임(사전규격 처리와 같은 방식). EvidenceRef 저장 형식은 그대로(Candidate.inForm 메모리 전용) | 개인정보처리위탁 계약서(안)의 빈칸 "계약 기간 : 20 년 월 일"이 사업기간과 충돌. 문서 간 우선순위는 유지해야 공고문 값이 조용히 밀리지 않음 | 서식 후보 삭제 / 전 문서 대상 후순위 |
| 기간 값은 periodKey(시작~종료일, 종료 연도 생략 시 시작 연도·월일이 앞서면 다음 해, 끝 괄호 무시)로 비교. valueKey(후보 충돌)와 merge normalize(필드 병합) 모두 적용 | "2026. 1. 1. ∼ 2026. 12. 31.(12개월)"과 "2026. 1. 1. ∼ 12. 31."을 고르라고 하는 건 무의미(사용자 피드백) | 문자열 앞 40자 비교 유지 |
| (사용자 결정, Fable 검토) ExtractedItem.naKind?('quant_table'|'quant_none'|'perf_aggregate', 없으면 quant_table) 추가, 문구는 review-count NA_NOTES 한 곳. NA_NOTE 문자열 불변, 공고 필드는 note 문자열 유지·isNotApplicableField는 NA 문구 집합으로 판별. 마이그레이션 없음(재추출). 자격 판정 verdict 불변, 사유만 종류별 | 해당 없음 사유가 하나뿐이라 "합산 비율 평가"에 "정량평가 표에 해당 항목 없음"이 뜨고 자격 판정 안내가 틀림 | reason에 새 값(비교 10곳 이상) / FieldValue에 필드 / 문구 저장 |
| 실적 인정금액: "사업규모·사업금액·추정가격 대비 … 실적 … 합산"(extras.perfAggregate)이고 수행실적 배점은 찾았으며 건당 하한 문구(extras.perfPerCase: 건당·단일(계약/용역)건·1건 … N억 이상 / 금액의 N% 이상)가 없고 인정조건에 건당 표현이 없을 때만 해당 없음(perf_aggregate). 단일·1건·최대·공동수급·구성원·지분이 붙은 합산은 제외. "실적 비율"만 있는 표현은 보류 | 한우 경영성과(R26BK01689006)는 합산 비율 평가라 건당 하한 없음. 그러나 KOICA 양식 4건은 비율 평가와 "단일 건 3억 이상"이 공존(정규식이 원 없는 금액을 놓쳐 not_found) → 가드 필수 | 합산 문구만으로 판정 |

## 2026-10-21 수집된 공고 삭제

| 결정 | 이유 | 기각 대안 |
|---|---|---|
| (사용자 결정) 공고 삭제 시 평가·낙찰 추적/팔로우·RFP 비교·자동작성 대기열은 함께 삭제, 메일 발송 이력만 보관. 위치는 목록 선택 삭제 + 상세 더보기 메뉴 | 원본 없는 고아 기록 방지, 발송 기록은 증빙 | 공고만 삭제 / 전부 삭제 |
| 메시지는 다건 하나 `notice/delete { noticeIds }`, 응답은 건별 deleted/failed. 없던 id는 deleted(멱등) | 단건·다건이 같은 정합성 경로, 부분 실패 표시 | 단건 메시지 + UI 반복 호출 |
| 본체는 offscreen 엔진 `deleteNotices`, SW 전용 모듈 `background/notice-delete.ts`가 릴레이 + 후처리(자동작성 큐·AI 세션 키·마감 알림). 팔로우 알람은 offscreen이 result/done으로 재예약 | 큐·알람은 SW 전용, applyDone 재사용 | router EXTENSION_ONLY_TYPES 릴레이 |
| 순서: 바쁨 검사 → 발송 이력 보관 → 폴더 삭제(removeTree) → index 제거 → 관련 기록 best-effort. 공고당 editLockKey 안에서 | index 먼저면 폴더 삭제 실패 시 재시도 불가 + scan 재생성 때 되살아남 | index 먼저 / 전체 롤백(FS 불가) |
| 발송 이력은 폴더 안(`<folder>/mail-sent.json`)이라 삭제 전 `mail-sent-archive/<noticeId>.json`(공고 메타 스냅샷 포함)으로 옮기고 sent index 항목은 `noticeDeleted: true, folder: ''`. SentStore.scan이 archive도 읽음 | sent index는 캐시라 재생성 시 유실 | mail-sent.json만 남긴 폴더 / index 항목만 유지 |
| 삭제 중 잡 진입은 offscreen `deletingNotices` Set으로 job/run에서 거부 | SW가 ledger queued 후 job/run을 보내는 틈의 경합 차단 | SW ledger 검사(이중 권위) |
| 목록 UI는 기존 `picking` 모드에 'delete' 추가 | 체크박스를 평소 숨기는 기존 의도 유지 | 상시 체크박스 |

## 2026-10-21 · RFP 비교 엑셀 내보내기
- 무엇: 비교 결과를 xlsx로(시트 변경점/번호 대조/요약). 범위는 내보낼 때 고름(분할 버튼: 주=달라진 것만, 메뉴=전체·동일 회색). "바뀐 내용" 칸은 서식 있는 텍스트(지운 말 빨간 취소선, 새 말 초록 굵게, 같은 줄 생략).
- 왜: 제안서 재활용 시 팀 공유·작업표(반영 여부·메모 빈 열)와 조견표 번호 수정(번호 대조 시트)에 바로 쓰기 위해(사용자 결정).
- 구현: 라이브러리 없이 fflate로 OOXML 직접 생성(기존 실적 양식과 같은 방식). 대시보드에서 계산·다운로드, 저장 안 함.
- 기각: 원문 두 칸만(어디가 바뀌었는지 직접 비교해야 함), SheetJS 등 새 의존성.
- 관련: 추출기 v2 — 셀 안 중첩 표를 한 행=한 줄, 칸=탭으로(화면은 구분선, 엑셀은 " | "). 원문 탭은 공백으로 바꿔 구분자와 섞이지 않게 함.

## 2026-10-21, 나라장터 연동 실패 기록 (Fable)
상세: `.claude/specs/g2b-failure-log.md`

| 결정 | 이유 | 기각 대안 |
|---|---|---|
| 저장소 = `chrome.storage.local` 단일 키 `g2bFailures`, SW 단일 작성자, 300건/30일 | 쓰기 주체 하나로 유실 방지, onChanged 구독, 재시작 후 유지 | storage.session(재시작 소실), IndexedDB(구독·테스트 부담), 저장 폴더(권한 문제 진단 불가), 건별 키 |
| 구조화 오류 전달 = 버스 `Reply.error.detail`(2KB 상한, SW 화이트리스트) + `JobError.detail`(fetchJsonOp) | 단계·엔드포인트·HTTP·ErrorMsg는 CS/offscreen 안에서만 앎 | message 문자열 정규식 파싱 |
| 기록 제외: EVAL_NO_RESULT·취소·입력검증·FS 권한 | g2b 통신 실패가 아니며 자동 배치에서 실제 오류를 밀어냄 | 전부 기록 |
| collect/attachment는 잡 종료 리스너에서 파생, detail은 detail-reader 직접, result/official/probe는 offscreen 콜백 → `diag/g2b-failure` | job-coordinator·collect-job 무수정 | 잡 ledger에 detail 보존(redactError 수정) |
| 응답 본문 미저장, ErrorMsg 200자, 서비스키 가림 | 평가위원 실명 등 민감정보 차단 | 응답 앞부분 저장 |

## 2026-10-21 · 공고 통합검색 (Fable)
상세: `.claude/specs/notice-search.md` (구현 전)

| 결정 | 이유 | 기각 대안 |
|---|---|---|
| 상세 전문을 render-text 형식 txt로 `source/text/[상세] 나라장터 상세화면.txt`에 저장, `Notice.detailText?` 추가, 마이그레이션 없음(재수집) | 첨부 txt 도구(TextDrawer, locateQuote, excerpt)를 고치지 않고 재사용하고 경로 검증도 통과. DOM은 렌더된 탭에서만 얻을 수 있어 백필 비용이 큼 | HTML 원본 저장 / Extraction.files에 끼워 넣기(재추출 시 사라짐) / 전 공고 일괄 백필 |
| 검색은 대시보드 메모리에서 수행, `notice/texts`로 한 번에 로드, 인덱스 파일 없음 | 공고 1건 코퍼스는 선형 검색으로 수 ms. 인덱스는 stale 관리 부담만 늘림 | offscreen 검색 메시지(키 입력마다 왕복) / IndexedDB 역색인 |
| 결과 단위 = 줄 또는 표 행, 그룹 안은 문서 순서, 점수 없음. 띄어쓰기 무시 정규화와 원문 역매핑 | 사용자는 문서를 훑어 찾음. 성격이 다른 문서끼리 점수로 섞으면 혼란 | BM25 랭킹 / 문단 병합 단위 |
| `buildTextBlocks`를 core/doc으로 이동(ui는 re-export) | core에서 ui를 import할 수 없음 | 코어에 표 행 파서 복제 |
| UI는 전역 Provider와 오른쪽 패널, 결과는 TextDrawer 재사용(겹침). 단축키 `Ctrl+Shift+F`·`/` | 공고 id만으로 어디서든 열리고 보던 화면을 유지 | 상세 탭 추가 / 라우트 `#/search/<id>` / 패널 안 자체 뷰어 |
| 2단계는 로컬 후보 40k자 + 인용 위치 검증 + "전문 재질문" 탈출구, API 전용, 별도 `AskRunner`·`search/asks.json` | 대화형 비용 통제. 발췌 누락 교훈은 탈출구로 흡수. 재검토 파이프라인은 키 색인에 묶여 있음 | 매번 전문 전송 / AiRunner·ai-review.json 재사용 / 반자동 붙여넣기 / 임베딩 검색(의존성·인덱스) |
| 답의 값은 검증하지 않고 인용 위치만 검증, 검증 실패 인용도 회색으로 표시 | 자유 질문에는 값 의미가 없음. 숨기면 답의 근거가 사라짐 | 미검증 인용 삭제 / 값까지 검증 |
| (2026-10-22 교체) 상세 전문을 AI 재검토 입력에 기본 포함(체크리스트 첫 행, 해제 가능). 가상 attachmentId `__detail__`·priority 0·발췌 상한 10k(`ExcerptFileInput.maxChars`), `run.files`·`DocKind`·`AiRun` 스키마 불변, `finishRun`과 근거 열기만 분기, 프롬프트에 상세화면 우선 규칙 1줄(2.3.0). 상세: notice-search.md 1.5절 | 사용자 결정. 공고 잎의 1차 출처가 상세화면. 기존 파이프라인이 textPath 기반이라 식별자만 더하면 됨. 상세는 발췌 키워드를 거의 다 포함해 파일별 상한 없이는 수동 30k를 잠식 | 미포함 유지 / DocKind 확장 / Extraction.files 삽입 / 전문 상한 상향 / 상세 출처 match 별도 배지 |

## 2026-10-22 · 입찰 전 기능 2·3·7 구현 설계 (Fable)
선행: `.claude/specs/prebid-features.md`. 구현 순서 2 → 7 → 3(S0 실측 후) → 7 분포 연결.

| 결정 | 이유 | 기각 대안 |
|---|---|---|
| 2: 우리 점수는 항목별 직접 입력, 배점은 notice.evaluation에서 읽기만. 등급·가점으로 자동 계산 안 함 | 등급표 추출 보류(2026-10-20 결정) | 기본 비율표 추정 |
| 2: 신용평가등급은 3종(기업신용·회사채·기업어음) 선택 맵 `company.credit?`, 가점은 `attributes?: string[]` + 프리셋 | 종류를 묻지 않아도 타입 확정, 기관마다 항목명이 다름 | 종류 1개 고정 / enum |
| 2: 저장은 `<folder>/estimate.json`, offscreen 단일 작성 | notice.json 잡 저장과 경합 회피, 공고 삭제 시 함께 정리 | notice.json / storage.local |
| 7: 순수 함수 계산, 저장 없음. 가격점수 = 배점 × 최저투찰가 ÷ 투찰가. 역산 G≥0: r=L·W/(W−G), G<0: r=L·(W+G)/W | 평가 이력 `verifyPriceFormula`와 같은 식 | 기관별 공식 |
| 7: 화면은 공고 상세 개요 탭 카드(prebid 원안에 위치 미지정) | 분모·가격 배점이 그 공고 것 | 기관 이력 탭 |
| 7: `NoticeEvaluation.priceEvalRate`(API bidPrceEvlRt), 옛 공고는 evalMethod 문자열에서 보정. 분모 기본은 추정가격(budgetAmount 아님) | 재수집 불필요, 부가세 포함 금액은 기준이 다름 | 재수집 요구 |
| 3: S0 probe 실측 필요(기관 기간 검색 오퍼레이션·기간 상한·낙찰률 필드가 저장소 자료에 없음). probe 진단 도구를 먼저 구현 | 추정으로 본 구현하면 연쇄 수정 | 추정값으로 본 구현 |
| 3: 기관·분류 코드는 `Notice.codes?`(FieldValue 아님). prebid 원안 "NoticeBasic 선택 필드"에서 변경 | NoticeBasic은 검토 행·필드 편집·템플릿 변수에 자동 노출됨. 옛 공고는 source/api-*.json으로 보정 | NoticeBasic 키 추가 |
| 3: 2단계 수집(A 기관 공고·낙찰 목록, B 공고별 개찰 참여업체는 선택), 호출 예산 상수 `ORG_CALL_BUDGET`, 한도 초과 시 모은 만큼 truncated 저장 | 트래픽 한도 미확정, 한도를 두 번 쓰지 않음 | A만 / B 전부 / 실패 시 폐기 |

## 2026-10-22 · 통합검색 상세 전문 읽기 시점 (메인, 리뷰 후속)
| 결정 | 이유 | 기각 대안 |
|---|---|---|
| `g2b/read-html` payload에 선택 필드 `withText?`. detail-reader는 안정 판정 뒤 마지막 1회만 `withText: true`로 전문을 읽고, 그 1회가 실패하면 전문 없이 진행. 패널 수집(1회 읽기)은 항상 포함 | notice-search 1.1은 read-html 핸들러에서 매번 전문을 만들게 했으나 폴링마다 전체 DOM 순회와 30만 자 전송이 2초 tick 시간 초과·45초 DETAIL_TIMEOUT을 부를 수 있음. 5절 8번(전문은 안정 판정에서 제외)과 같은 취지 | 매 tick 전문 생성(원안) / 별도 메시지 `g2b/read-text` 신설 |

## 2026-11-03, Gmail 2차 실측 반영 S4 (Fable, 사용자 승인, 근거 .claude/specs/gmail-attach-handoff.md 6~8절)
| 결정 | 이유 | 기각 대안 |
|---|---|---|
| attach.itemLabelAttr 신설, Gmail은 aria-label에 파일 이름 포함 대조 | 업로드 중 .dL에 .vI가 없어 10초 뒤 재주입 위험, 항목 글자에 크기가 붙어 완전 일치 실패 | .vI 단독, sameFileName에 크기 접미사 제거 |
| attach.itemDone 신설, Gmail은 input[type=hidden][name=attach] | 실패 표시 미관측이라 진행 표시 부재만으로 완료 판정은 약함 | progressbar 부재만 |
| limits 파일별/합계 25,000,000 | 합계 기준 실측 확인, 단위 미확정이라 작은 쪽. 넘기면 Drive 업로드라는 비대칭 비용 | 26,214,400, 인코딩 마진, .vJ 크기 파싱 |
| attach.convertedMarker 신설, Drive 칩 증가 시 DRIVE_CONVERTED(DIALOG_SHOWN보다 우선) | 기존 첨부가 있는 창은 사전 차단 불가, 경고창이 3.7초 뒤 스스로 닫힘 | 경고창만으로 감지, 비워 두고 타임아웃 |
| blockingDialog = dialog 중 region 미포함, aria-hidden 아님 | 받은편지함 작성 창 자체가 dialog, 변환 뒤 숨은 공유 dialog 잔존 | [role="dialog"] 그대로 |
| scope = div[role="region"]:has(input[name="subjectbox"]), anchor는 subjectbox 값(엔진 현행) | 창마다 region 하나, 빈 제목 region aria-label은 "새 메일" | div.aoI, region aria-label anchor |
| to/cc 칩 보류(partial), methods ['input'] | 칩 안 주소 표기 미실측, 끌어다 놓기 미실측 | 추정 셀렉터 |
| 엔진 변경은 새 선택 필드가 있을 때만 작동 | 네이버웍스 동작 불변(사용자 요청) | 엔진 분기 복제 |

## 2026-11-03 낙찰방법 기반 "해당 없음" (메인, 정답셋 80건 근거)
배경: 나라장터 최근 12개월 용역 80건 정답셋 측정에서 룰이 확정한 값은 대부분 맞았으나, 수의/적격/최저가 공고의 배점과 실적 항목을 해당 없음으로 못 가려 공고당 약 5건의 거짓 확인 필요가 생겼다(소액수의견적 25건은 8개 항목 모두 정답이 해당 없음).

| 결정 | 이유 | 기각 대안 |
|---|---|---|
| (사용자 요구) 해당 없음에는 사유 문구와 원문 근거를 반드시 붙인다. 나라장터 낙찰방법(API awardMethod)과 공고문의 같은 낙찰방법 문장(새 규칙 na.awardMethodDoc, docKinds notice/rfp/other)이 모두 있을 때만 판정 | "해당 없음"만 표시하면 사용자가 판단 근거를 확인할 수 없음 | API 값만으로 판정, 문서 문장만으로 판정 |
| 소액수의견적: 배점 3개, 차등점수제, 실적 하위 3개(참가자격 실적 제한 없을 때만), 제안서 평가일자를 해당 없음(naKind small_quote). 배점에 못 찾음/해당 없음이 아닌 상태가 하나라도 있거나 정량표/정성표가 있으면 판정 안 함 | 정답셋 25/25가 해당 없음. 실적 하위는 2026-10-21 결정과 같은 가드 | 무조건 8개 |
| 적격심사, 최저가(제한적최저가 포함): 차등점수제만 해당 없음(qualified, lowest_price) | 배점과 실적은 적격심사 세부기준으로 평가될 수 있음(정답셋에서 값/문서없음/해당없음 혼재) | 배점까지 해당 없음 |
| 수의시담, 규격가격동시, 2단계는 제외 | 수의시담인데 문서는 협상 평가인 공고가 정답셋에 2건 | 수의 전체 |
| decide에 ctx(awardMethod) 선택 인자 추가, NaKind 3개 추가, 문구는 NA_NOTES. 규칙 1.13.0, 재추출로 반영 | 기존 해당 없음 구조 확장 | 새 status, 저장 문구 |
| 메일 템플릿 NA_KEYS에 differentialScoring, proposalEvalAt 추가, 공고 상세의 제안서 평가 행도 해당 없음 표시 | 검토 탭과 메일이 같은 판정을 보여야 함(리뷰 Major) | 없음 |

결과: 정답셋에서 206개 항목이 확인 필요에서 해당 없음으로 바뀌고 정답과 어긋난 것은 1건(최저가+제안서 적합판정의 차등점수제, 정답 표기는 문서 없음).
같은 날 후속: 공고문 파일명 "[공고]...", "[GH공고 제N호]...", "...공고 제N호", "공모 공고(안)"을 notice로, "과업이행요청서"를 rfp로 분류(classify). 정답셋 수치 변화 없음. 정답셋은 scripts/gold(README에 실행법과 기록 표).

## 2026-11-03 실적 인정조건 보강 (메인, 정답셋 80건 근거)
| 결정 | 이유 | 기각 대안 |
|---|---|---|
| perf.condition anchor에 글머리표(-, ㅇ, ○ 등), "동등이상 사업/용역(범위):", "동일종류 사업/용역(및평가비율):", "실적의 관련분야는" 추가 | 정답셋 놓침 사례의 실제 표현 | "동일용역:" 포함(평가표 칸 "동일용역 : 5건 이상 10점" 오탐 위험, 리뷰 Minor) |
| block-capture: 콜론 뒤 본문(8자 이상, 참조 문구 아님)이 있으면 20자 미만 한 줄도 캡처 | "- 유사용역 : 어업피해영향 조사 용역"이 제목으로 버려짐. 이 전략은 perf.condition만 사용 | 길이 기준 낮추기 |
| 정의 문단이 없으면(not_found, 후보 없음) 공고문/제안요청서의 "… 실적이 있는/을 보유한/갖춘 …" 한 줄(새 extras.perfConditionLine)로 인정조건 보충. 하수급, "있는 경우", "신용과 실적", "수행할 수 있는" 줄 제외. 해당 없음 판정 뒤 실행 | 참가자격 문장으로만 실적 조건을 밝힌 공고가 많음 | 같은 target 규칙 추가(정의 문단과 충돌) |
| 소액수의 해당 없음에서 perfConditionLine도 실적 단서로 봄(실적 하위 3개 유지) | 실적 조건 줄이 있는데 해당 없음이 되는 것 방지(리뷰 Minor) | perfRestriction만 |
| 자격 판정: 보충 줄도 인정조건 원문으로 보아 verdict review | 기존 정책(원문이 있으면 사람이 확인). 분야 조건을 기간/금액만으로 충족 판정하면 틀릴 수 있음 | ruleId perf.conditionLine은 present에서 제외(리뷰 Major 제안, 사용자 확인 대기) |

결과: 인정조건 놓침 18→11, 정답 37→42, 오탐 증가 없음, 다른 항목 변화 없음. 규칙 1.14.0.

## 2026-11-03 정량평가 표 인식 확장 (메인, 정답셋 80건 근거)
배경: 협상 공고 다수가 정량평가 표에 수행실적 행이 없는데도 표 자체를 못 찾아 실적/신인도 항목이 확인 필요로 남음. 2026-10-21 Fable 설계(applyQuantTable, 완결된 표만 인정)는 그대로 두고 표 인식 입력만 넓힘.

| 결정 | 이유 | 기각 대안 |
|---|---|---|
| eval.quantTable title을 "(?:정량(?:적)?평가|정량적?(?![가-힣]))"로: 라벨 칸 "정량 (10)", "정량적 (30)" 인정, "정량제안서" 제외 | 실제 평가표의 라벨 표기 | "정량(?:적)?(?:평가)?(?![가-힣])"(정량평가기준, 정량평가표 같은 기존 제목이 떨어지는 회귀, 리뷰 Major) |
| 합계를 라벨 전체가 "정량(적)?(평가)?(N점?)"인 괄호 숫자에서도 읽음 | "정량평가 (10)"은 "점"이 없어 합계를 못 읽음 | 합계 없이 인정(완결성 조건 훼손) |
| 0열이 라벨보다 긴 세로 병합 묶음 칸이면 1열 정량 라벨도 인정(범위는 1열 라벨의 rowSpan) | "기술능력평가" 세로 병합 아래 "정량평가 (7)" 형태 | 모든 열에서 라벨 탐색 |
| COMBINED에 "정성" 단독 추가 | "정량/정성 배점" 같은 결합 제목이 caption 경로로 새로 통과하는 것 방지(리뷰 Minor) | 없음 |

결과: 실적 배점 정답 46→52, 신인도 정답 36→46, 해당 없음 못 가림(배점, 실적, 차등) 142→121, 오탐/틀림 변화 없음. 규칙 1.15.0.

## 2026-11-03 작성 안내 문장의 실적 값 해당 없음 (메인, 정답셋 근거)
| 결정 | 이유 | 기각 대안 |
|---|---|---|
| 완결된 정량표에 실적 행이 없어 수행실적 배점이 해당 없음일 때, 참가자격 실적 제한(extras.perfRestriction)이 없고 실적 인정기간/금액의 근거가 모두 작성 안내(WRITING_GUIDE: 기재하고, 기재하여, 만 기재, 제시한다, 작성하여 등)뿐이면 찾은 값도 해당 없음(quant_table). 찾은 값은 candidates로 보존 | 실적 평가가 없는 협상 공고에서 "… 2천만원 이상 건에 대하여 기재하고", "… 실적 등을 명료하게 제시한다"의 숫자가 확정값으로 나옴(정답셋 3건). 2026-10-21 결정(못 찾은 것만 덮음, 참가자격 제한 존중)의 좁은 확장 | 정량표만으로 찾은 값까지 모두 덮기 |
| 인정조건(performanceCondition)은 제외 | 여러 줄 묶음이라 한 줄의 작성 안내로 전체 정의가 덮일 위험(리뷰 Minor) | 첫 줄만 검사 |

결과: 정답셋에서 3개 항목만 바뀜, 다른 결과 변화 없음. 확정값 실제 오류 약 12→9. 규칙 1.16.0.
참고: 정답셋 "틀림" 일부는 정답셋 쪽 문제로 확인(사업금액은 앱이 추정가격+부가세를 쓰며 공고문 금액과 일치, R26BK01735789 "1억원 이상의 실적만 인정"은 룰이 맞음).

## 2026-11-06 유찰 감지와 재공고 추적 (Fable 설계, 사용자 승인, 명세 .claude/specs/no-bid-reannounce.md)

| 결정 | 이유 | 기각 대안 |
|---|---|---|
| 유찰은 1단계 `opengRsltDivNm` "유찰" 행 또는 유찰 목록 op(1단계 판정이 waiting일 때만 1회 추가 호출) 건수로 판정. 1단계 0건, 2단계 0건은 유찰 근거가 아님 | 0건은 개찰 전과 구분 불가. 추가 호출은 waiting 항목당 1회 | 0건을 유찰로 / 2단계 0건을 유찰로 |
| 유찰 목록 op 이름과 필드, 기간 검색 응답 필드, 한도 초과 오류 코드는 실측 후 확정. 상수 빈 문자열(빈 배열) = 비활성 | 코드로 확인 불가, AWARD_FIELDS 관례 | 추정으로 본 구현 |
| 재공고 연결 키는 재공고 쪽 `befBidBbancNo`(+ `reNtceYn` Y). 제목 정규화 일치는 보조. `ntceKindNm`과 차수 증가는 쓰지 않음 | 실데이터(gold 80건) 재공고 14/14건 일치, "등록공고"로 표기된 재공고 있음, 차수 증가 사례 0건, 차수 증가는 정정공고 로직 담당 | 차수 증가 / 제목+기관 / `ntceKindNm` |
| 연결은 수동(재공고 수집 시 `notice.reannounceOf`로 자동 연결, 전 공고) + 능동 검색(유찰 항목 전부, 수요기관 코드 기간 검색 PPSSrch). 팔로우는 평일 10시, 15시 정시, 비팔로우는 목록 진입 시 24시간 간격, 한 실행 5건, 호출 예산 20 | 사용자 결정(비팔로우도 배지로 보려면 검색 필요). 한도는 간격과 예산으로 보호. 수동 연결은 트래커봇 메일로 재공고가 들어오는 경우를 0회 호출로 처리 | 팔로우만 검색 / 비팔로우 무제한 / 검색만 |
| 팔로우 범위에 `reannounce`("재공고까지") 추가. 유찰 확정 공고도 이 범위로만 팔로우 가능(재공고 확인된 공고는 불가) | 기존 분기가 FollowTarget 하나, "개찰 결과만+재공고"는 무의미, 유찰 배지를 보고 팔로우하는 흐름 | 별도 boolean / 유찰 공고 팔로우 금지 유지 |
| 감시 상태는 results.json `ResultEntry.reannounce`(파생, 팔로우 여부 무관하게 유찰 항목 전부에 생성), 의사는 follows.json `target` | 2026-10-20 파생/의사 분리 기준. 팔로우 전환 시 since 유지 | 새 파일 / follows에 상태 / 팔로우 항목에만 생성 |
| 감시 60일 공통. 배포 전 유찰 항목은 `ensureWatches`로 보충하되 60일 지난 것은 호출 없이 expired | 재공고는 며칠에서 몇 주 뒤 근무시간 게시. 과거 공고 일괄 검색 방지 | burst / 120일 / 과거 항목 무시 |
| 알림(유찰, 재공고 발견, 추적 종료), 자동 수집, 팔로우 승계는 팔로우 공고만. 비팔로우는 "유찰, 재공고 있음" 표시와 상세 카드 수집 버튼까지 | 알림은 팔로우 전용이라는 기존 규칙 유지. 수집은 첨부, 추출, 자동 메일로 이어져 비용이 크고 배포 직후 폭주 위험 | 전 유찰 공고 자동 수집 / 비팔로우 알림 |
| 발견 알림은 원 공고 기준, 자동 수집은 SW `applyDone`에서 `startJob(collect)`, 승계는 재공고가 index에 들어온 뒤 list 모드에서(범위 `reannounce` 유지, notified 초기화) | 수집 전엔 noticeId 없음, 잡 시작은 SW만 가능, 승계 대기 동안 원 공고 팔로우가 자리 표시 | 발견 즉시 해제 / offscreen 수집 / 낙찰까지로 승계 |
| 재공고 수집으로 원 공고가 waiting 또는 expired면 유찰 추정(`inferredNoBid`). won, lost, ranked, not_participated는 불변 | 유찰 op가 없어도 재공고 자체가 강한 근거. 확정 결과 우선 | 추정 없음 |
| 재공고 알림은 `notify.final`에 묶음. 새 설정 없음 | 설정 추가 최소화(사용자 선택) | 별도 토글 |
| (수정) 2026-10-20 "낙찰 외 상태 비표시"를 "유찰은 필터와 배지로 표시(warn 색조), 낙찰 강조와 구분"으로 수정. resultCell은 이미 전 상태를 idle로 그리고 있었음 | 사용자 요청 | 유찰 비표시 유지 |
| (수정) 2026-10-20 "결과 확정 시 팔로우 자동 해제"에 예외: 유찰 + 재공고까지는 감시로 전환 | 재공고 추적 요구 | 예외 없음 |
| (수정) award-tracking "entryOf 불변"에 예외: notice.json 원천값 `reannounceOf`만 index에 복사. 결과 파생값은 여전히 index에 넣지 않음 | 재생성 시 유실 없음 | 결과 추적 실행 때마다 notice.json 읽기 |
| `Notice.codes`(prebid-impl 3 S2 계획)를 이번에 수집 잡에서 채움(dminsttCd, ntceInsttCd, pubPrcrmntClsfcNo, opKind). 옛 공고는 감시가 필요할 때 `fetchNotice`로 보충해 watch에 저장 | 기간 검색에 수요기관 코드와 업무구분 필요, notice.json은 고치지 않음 | 재수집 요구 / 옛 공고 검색 제외 |

S0 실측(유찰): (실측 후 기록) 유찰 목록 op 이름, inqryDiv, keys, 1단계 유찰 공고 응답 형태(0건 또는 "유찰" 행), 2단계 0건 여부, 재입찰 공고의 1차 유찰 기록 유무.
S0 실측(기간 검색): (실측 후 기록) PPSSrch op 성공 여부, keys에 befBidBbancNo와 reNtceYn 포함 여부, inqryDiv 의미, 기간 상한, 한도 초과 오류 코드와 메시지.

## 2026-11-09 계약과정 진행 단계 표시 (Fable 설계, 사용자 선택: 공고 상세에 단계 줄)
| 결정 | 이유 | 기각 대안 |
|---|---|---|
| 계약과정통합공개서비스(`ao/CntrctProcssIntgOpenService/getCntrctProcssIntgOpen{Servc,Thng,Cnstwk,Frgcpt}`, inqryDiv=1, bidNtceNo)를 공고 상세 개요 탭을 열 때 1회 조회, "다시 조회" 수동 | 사용자가 볼 때만 필요, 일일 한도 보호 | 결과 추적 주기에 합침 / 목록 일괄 |
| 캐시는 공고 폴더 `process.json`(offscreen 작성), 마지막 차수에 계약이 있으면 재조회 안 함, 없으면 12시간 TTL | 탭 전환 remount 흡수, 계약 후 불변. results.json은 결과 추적 파생 캐시라 분리 | results.json 필드 / 캐시 없음 |
| 결과 추적(judge, 알림)과 병행, 판정에 불참여. 읽기 전용 표시 | 낙찰 판정 규칙(2단계 낙찰정보 기준)을 바꾸지 않음 | judge 입력 추가 / 2단계 API 대체 |
| 빈 차수는 "유찰"로 표기하지 않음. 낙찰/계약은 마지막 차수 기준 | 정정공고도 이전 차수는 비어 있음. 유찰 판정은 no-bid-reannounce 규칙 담당 | 000차 빈 낙찰 = 유찰 |
| 대표자명(bidwinrInfoList 4번째 칸)과 raw 응답 미저장 | 개인정보 | 원본 보관 |
| 별도 카드 "계약 진행", Timeline 재사용(Milestone.sub 추가), 차수마다 공고 점, 계약 여러 건은 점 1개 + 건별 행 | 일정 타임라인의 next 강조/마감 알림과 분리 | 일정 타임라인에 합침 |
| op는 Servc→Thng→Cnstwk→Frgcpt 순회 후 성공 op 기억. 4개 이름 모두 실측 확인(2026-11-09) | fetchAward listOp 규칙과 동일 | 업무구분 추정 |
| 사전규격 공고는 relatedBidNo가 있을 때만 그 번호로 조회, 없으면 카드 숨김 | bfSpecRgstNo 조회 inqryDiv 미확인 | bfSpecRgstNo 조회 |
| 실패 기록 flow `process` 추가 | 기존 g2b-failure 경로 재사용 | flow result 재사용 |
