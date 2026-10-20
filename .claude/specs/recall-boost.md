# 메일 항목 채움률 보강 (재분석 2,055건 근거)

작성 2026-10-20. 근거: 축평원·행안부·KOICA 최근 3년 SW·연구용역 2,055건 측정(`<R>/recent/measure.md`, `measure2.md`, `misses.json`). `<R>` = `C:/Users/admin/AppData/Local/Temp/claude/c--workspace-bidMate/072702e3-5f0c-4000-972e-8c6c74b66e90/scratchpad/research`.
기존 구조(2026-10-20 credibility-eval.md의 D7 확장 지점)를 따른다: 규칙·동의어 = `src/core/extraction/rules/default-rules.json`, 메일 합성 = `src/core/templates/composites.ts`, 문서 전용 보충 = `DOC_FILL_KEYS`(`src/engine/extraction/extract-step.ts`). 기관명 if 금지.

## 사용자 결정
- 배점이 문서에 없고 평가 주체 문장만 있을 때(예 "정량평가 : 조달청(경영상태), 수요기관(수행실적)") 그 **문서 문장을 그대로** 메일에 넣는다. 표준 배점 추정 금지.
- 공고문의 "입찰서 제출기간"은 제안서 제출기간으로 본다.
- 원칙: 값은 문서 실제 텍스트. 요약·변환하지 않는다(날짜 필드의 ISO 변환은 예외).

## 작업 (각 항목은 misses.json·measure2.md의 실제 원문으로 규칙과 테스트를 만든다)

### W1. 6 사업기간 — 표의 옆 칸 값
현재 `basic.projectPeriod` 규칙(default-rules.json, extras.projectPeriod)은 같은 줄 "라벨 : 값"만 잡는다. 표에서 라벨 셀(용역기간/사업기간/계약기간/과업기간/수행기간)과 값 셀이 나뉜 경우(예 R25BK00670449 "용역기간 | 계약체결일로부터 180일까지", R25BK00653097, R26BK01439250 "계약기간: | 계약체결일로부터 2027.12.31.까지")와 "총 용역기간 : 2025. 1. 1. ~ 2026. 12. 31."(R25BK00553902)을 잡는다.
- 추출 엔진이 표 셀을 어떻게 텍스트화하는지(`src/core/doc`, `src/core/extraction`의 Prepared/블록) 확인하고, 기존 전략으로 가능하면 규칙만, 아니면 기존 전략에 "같은 행 다음 셀" 옵션을 추가(새 전략 파일은 최소화). 값 셀에 기간 신호(일|개월|년|까지|~|\d{4}[.년])가 있어야 한다.
- 오탐 금지: "사업금액은 전체 사업기간을 기준으로…" 같은 값 없는 문장.

### W2. 3 제안서 제출기간·4 제안서 평가일시 — 공고문 보충
- 새 extras 규칙 `sched.proposalPeriodDoc`(window-regex, valueType text): "입찰서 제출기간|제안서 제출기간|(기술)?제안서 제출 (일시|기한|마감)" 줄의 날짜 범위/마감 원문. 날짜가 없는 상대 표현("마감일 전일 18:00까지", "입찰공고서에 의함")은 값 아님.
- 새 extras 규칙 `sched.proposalEvalDoc`: "제안서 평가일시|평가일시|발표일시|제안서 발표" 줄의 첫 날짜·시각. `schedule.proposalEvalAt`은 ISODate이므로 기존 날짜 파서(`src/adapters/g2b/html-parse.ts`의 toIsoKst 계열 등 저장소에 있는 것)로 변환, 실패하면 값 아님.
- `DOC_FILL_KEYS`에 `proposalPeriod`, `proposalEvalAt` 추가(사업기간과 같은 규칙: HTML/API 값이 있으면 건드리지 않음, user_edited 건너뜀). 화면값이 항상 우선.
- 측정 근거: 3번 문서 보충 가능 협상 674/995, 4번 62/995.

### W3. 9 대외신인도·10 실적점수
(i) 배점 표 보강: measure2.md의 "경영상태 표 라벨"(27건, 예 R25BK00674086 "경영상태 ⇒ 자기자본비율…"), "신용평가 표 라벨"(5건), "수행실적/유사용역/이행실적 표 라벨"(예 R25BK00670144 "기업경영상태, 용역수행실적(B) ⇒ 5") 사례를 열어 실제로 배점 숫자가 있는 행이면 mgmt.table/perf.table(또는 동의어)이 잡도록 보강. 숫자 없는 행·등급표·제출서류 줄은 제외(기존 제외 규칙 유지).
(ii) 문서 문장 보충: 배점을 못 찾았을 때 메일에 넣을 원문 문장.
- extras `eval.quantDoc`(window-regex, valueType text): "정량평가 …(경영상태|신용평가|신인도|수행실적|사업실적)…" 처럼 평가 주체·항목을 밝힌 한 줄(예 R25BK00571691 "정량평가 : 조달청(경영상태), 수요기관(수행실적)", R25BK00553902 "정량평가(사업실적, 사업관리자(PM) 자격요건 …) : 국가정보자원관리원", 공고문 "신인도 : [별표11]에 정한 기준에 따라 평가합니다"(20240134830)). 제출서류 줄("신용평가등급확인서 1부", "기업 신용평가서 제시"), 서식 목차("[별지 제3호 서식]"), "재무관", "수상실적", "위탁운영실적", "책임자" 경력 줄 제외.
- notice 평가 필드 `quantEvalDoc: FieldValue<string>` 추가(EVALUATION_KEYS 끝), DOC_FILL_KEYS에 추가.
- composites:
  - `credibilityEval`: 기존 조각(경영상태·대외신인도 점수)이 0개이고 quantEvalDoc이 있으면 그 문장을 text로, status ok. 둘 다 없으면 기존대로 '확인 필요'.
  - 새 가상 키 `performanceEval`: 현재 기본 템플릿 10번 text 항목(실적인정기간·실적점수·인정금액 조합, `default-template.ts`에서 확인)이 만드는 문자열과 **같은 결과**를 실적점수가 있을 때 내고, 실적점수·기간·금액이 모두 없고 quantEvalDoc이 있으면 그 문장. 모두 없으면 '확인 필요'. 기본 템플릿 10번을 `field('performanceEval', <기존 라벨>)`로 바꾸고, `normalize.ts`에 옛 문구 완전 일치 시 승격 추가(txt_cred 승격과 같은 방식). 변수 `실적점수평가` 등록.
- 검토 판정(review-count)은 바꾸지 않는다(문장만 있고 배점이 없으면 여전히 확인 필요로 센다). 자동 작성 멈춤도 그대로.

### W4. 결정 기록
`.claude/specs/decisions.md` 끝에 "2026-10-20 채움률 보강(2,055건 측정)" 절: 위 사용자 결정 3개, 규칙 추가 목록, 기각 대안(조달청 표준 배점 추정, 입찰서/제안서 구분 유지, 새 전략 남발).

## 테스트
- 각 규칙: misses.json에서 고른 실제 원문 줄을 `tests/extraction/regex-cases.test.ts`(기존 실측 사례 파일) 형식으로 양성 3개 이상·음성 3개 이상(위 오탐 예 포함).
- W1 표 옆 칸: 표 블록을 만드는 기존 테스트 헬퍼로 라벨/값 셀 케이스.
- W2: DOC_FILL 동작(화면값 있으면 유지, 없으면 문서값, user_edited 유지), proposalEvalAt ISO 변환 실패 시 미설정.
- W3: composites `credibilityEval`/`performanceEval` 케이스(점수 있음/문장만/둘 다 없음), 템플릿 승격.
- 기존 테스트 전부 통과(KOICA 카라바오 기대값 유지).

## 재측정(완료 조건의 일부)
`<R>/scripts/`의 측정 하네스(`extract.test.ts`, `measure.mjs`, `measure2.mjs`, research의 `vitest.config.mjs`)로 같은 2,055건을 다시 돌려 `<R>/recent/measure3.md`에 **변경 전(measure2) 대비 협상 그룹 항목별 채움률**과, 새로 채운 값 중 무작위 20건(항목별)의 원문 대조 표(공고번호, 추출값, 근거 줄, 맞음/틀림 판정)를 쓴다. 틀림이 보이면 규칙을 고쳐 다시 측정. DOMParser 주입 필요(하네스에 이미 있음). 3·4번은 화면값 없이 문서 보충만으로 측정.

## 완료 조건
`cd C:/workspace/bidMate && npx tsc --noEmit`, `npm test` 전체 통과(반드시 대문자 C: 경로) + 재측정 결과.

## 보고 (한국어)
변경 파일:줄범위, 규칙 목록, 테스트 결과(개수), 재측정 전후 표, 원문 대조에서 틀린 사례와 조치, 남은 한계.
