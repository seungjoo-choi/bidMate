# 가감점 표 인식과 사업기간 문서 보충 명세

작성 2026-10-20. Fable 설계, 사용자 승인(신인도는 "표 위치 안내 + 직접 입력"). 결정 근거는 `.claude/specs/decisions.md`의 "2026-10-20 가감점 표 인식과 사업기간 문서 보충" 절.

## 목표
1. 신인도: KOICA 양식처럼 "신인도" 대신 "정량평가 가감점 평가표"(1열 가점/감점 라벨 + 배점 열)만 있는 공고에서, 신인도를 not_found 대신 `reason: 'no_total'`(값 null, raw "가점 n항목, 감점 m항목", 근거 = 그 표)로 표시한다. 숫자는 만들지 않는다. 사용자는 근거로 표를 열고 검토 탭에서 직접 입력한다.
2. 사업기간: 상세화면(HTML)/API에 값이 없을 때 첨부 문서의 "사업기간/용역기간/계약기간/수행기간/과업기간 :" 문구로 `notice.basic.projectPeriod`를 채운다.

## 확인된 사실(설계 근거)
- credibilityScore는 문서 추출이 유일한 출처. 가감점 표 배점 칸 예: "0.5점\n(최대 0.5점)", "건별 0.5점 (최대 2.0점)", "최대 0.4점". 총 배점 숫자는 없다. "(미해당)" 표기 행이 있을 수 있다.
- 기존 `table-score`에 "가점"을 신인도 라벨로 넣으면 첫 행 0.5가 verified로 나온다(금지 이유).
- 같은 제안요청서의 별지 자가진단표는 머리글 "점수" + 1열 "가점/감점"이지만 점수 칸이 비어 있다(오탐 후보).
- 규칙 엔진은 `extras.<name>` 타깃을 지원한다(`schema.ts:5`, `decide.ts:53-58`). extras는 `computeStatus`와 검토 카드에 영향이 없다.
- `basic.projectPeriod`는 `src/adapters/g2b/detail-page.ts:175-184` HTML에서만 채운다.
- `mergeDocumentLayer`(`merge.ts:101-108`)와 `mergeFields`(ALL_FIELD_KEYS 순회, `merge.ts:53-59`)를 사업기간 보충에 쓰면 HTML 덮어쓰기, 상시 충돌, 다른 문서 출처 평가값 강등이 생긴다(사용 금지 이유).
- 픽스처: `tests/fixtures/docs/R26BK01722175/`(이 공고 실제 hwp 3종). 현재 `tests/extraction/rules.test.ts:41`, `tests/engine/extract-flow.test.ts:25`가 credibilityScore not_found를 기대한다.

## 작업

### U1. 타입과 규칙 스키마
- `src/core/types/extraction.ts`: `ExtractedItem.reason` 유니언에 `'no_total'` 추가.
- `src/core/extraction/rules/schema.ts`:
  - Rule 유니언에 `| { strategy: 'bonus-table'; scoreHeader: string; rowLabel: string }` 추가.
  - window-regex `valueType`에 `'text'` 추가(유니언과 허용값 검사 배열 모두).
  - `validateRule`에 `case 'bonus-table': terms('scoreHeader', 'rowLabel'); break;`(기존 패턴에 맞춤).

### U2. 전략
`src/core/extraction/strategies/bonus-table.ts`(새 파일)
```ts
export function bonusTable(p: Prepared, rule: Extract<Rule, { strategy: 'bonus-table' }>, syn: Synonyms): RawHit[]
```
- `headerRe = new RegExp(expandTerm(rule.scoreHeader, syn))`, `labelRe = new RegExp('^' + expandTerm(rule.rowLabel, syn) + '$')`. (기존 전략의 헬퍼 이름, Grid API는 table-score.ts를 참고해 실제 것을 쓴다.)
- 표마다: 머리글 행에서 배점 열 `sc`를 찾는다(없으면 건너뜀). 머리글 아래 행들의 own cell 중 `c < sc`이고 compact 텍스트가 labelRe에 완전 일치(compact 길이 10 이하)하는 셀을 라벨 셀로 모은다.
- 라벨 셀이 없으면 건너뜀. 라벨 셀마다 덮는 행 구간 `[r, r + rowSpan)`의 배점 칸 중 하나라도 숫자(`/\d/`)가 있어야 한다. 없으면 그 표는 건너뜀(자가진단표 배제).
- 표당 RawHit 하나: value = 라벨별 `${라벨} ${rowSpan}항목`을 ", "로 이은 문자열(예 "가점 6항목, 감점 2항목"), raw = 같은 값, location = `표${t.index} r${first.r}c${first.c}`, page/sheet/line = 첫 라벨 셀 위치, evidence = 첫 라벨 행 텍스트, context = 머리글 행 텍스트 + "\n" + 첫 라벨 행 텍스트.
- `src/core/extraction/run-rules.ts`: `case 'bonus-table': return bonusTable(doc, rule, syn);`

`src/core/extraction/strategies/window-regex.ts`
- `valueType === 'text'`이면 정규식 플래그에 `d`를 더해 named group `v`의 indices로 원문(compact 전) 구간을 잘라 `.replace(/\s+/g, ' ').trim()`을 값으로 쓴다. indices가 없거나 빈 문자열이면 후보를 내지 않는다. `toValue` 변환은 거치지 않는다. TS lib에 indices 타입이 없으면 국소 캐스팅.
- compact 위치와 원문 위치를 대응시키는 기존 헬퍼가 있으면 그것을 쓴다(없으면 compact 인덱스를 원문 인덱스로 매핑하는 작은 함수 추가).

### U3. 결정기
`src/core/extraction/decide.ts`
- `export const BONUS_TABLE_EXTRA = 'bonusTable'`.
- `decide()` 반환 직전 `applyBonusTable(items, extras)`:
  - 조건: `items.credibilityScore`가 `status 'needs_review'` + `reason 'not_found'`이고 `extras[BONUS_TABLE_EXTRA].value !== null`.
  - 처리: `items.credibilityScore = { value: null, status: 'needs_review', reason: 'no_total', raw: String(bt.raw ?? bt.value), evidence: bt.evidence }`. candidates는 넣지 않는다.
  - verified, conflict, low_confidence면 손대지 않는다. `computeStatus` 변경 없음.

### U4. 규칙 JSON `src/core/extraction/rules/default-rules.json`
- `version` → `"1.2.0"`.
- synonyms에 `"bonusLabel": ["가점", "감점", "가감점", "가․감점", "가·감점", "가ㆍ감점", "가산점", "감산점"]` 추가(원문 기호라 JSON 안에서만 가운뎃점 변형 허용). credibility 동의어에는 추가하지 않는다.
- 규칙 추가:
  - `{ "id": "cred.bonusTable", "target": "extras.bonusTable", "strategy": "bonus-table", "scoreHeader": "scoreHeader", "rowLabel": "bonusLabel", "weight": 1, "conflictPolicy": "prefer_priority" }` (scoreHeader 동의어 키가 실제로 없으면 기존 배점 머리글 동의어 키 이름을 쓴다)
  - `{ "id": "basic.projectPeriod", "target": "extras.projectPeriod", "strategy": "window-regex", "weight": 1, "blocksAfter": 0, "valueType": "text", "conflictPolicy": "prefer_priority", "anchor": "^[^가-힣]{0,8}(?:사업|용역|계약|수행|과업)기간[:)]", "pattern": "^[^가-힣]{0,8}(?:사업|용역|계약|수행|과업)기간[:)]+(?=[^:]{0,40}(?:\\d{4}[.\\-/년]|\\d{1,3}(?:개월|일|년|주)|계약(?:체결)?일|착수일|협약일))(?<v>[^:]{2,80})" }`
  - 패턴은 compact 텍스트(공백 제거, 전각 콜론 → ":") 기준. 줄 머리 비한글 8자 이내 접두만 허용, "기간" 뒤 ":" 또는 ")" 필수, 값에 날짜/기간 단위/계약일 등 필수.

### U5. extract-step 보충 `src/engine/extraction/extract-step.ts`
- `docFieldsOf`에 분기: `it.status === 'needs_review' && it.reason === 'no_total' && source && it.raw` → `out[k] = { value: null, raw: it.raw, status: 'needs_review', note: '가감점 표만 있음, 합계 배점 없음', source }`.
- `export function basicFieldsOf(extras, fetchedAt): Partial<Pick<FieldMap, 'projectPeriod'>>`: `extras.projectPeriod`를 docFieldsOf와 같은 규칙으로 FieldValue로 변환. verified → verified / conflict → `{ value, raw, status: 'needs_review', note: '문서 간 값이 서로 다름', candidates }` / low_confidence → needs_review, note '질의답변 문서에만 있는 값' / not_found → 키 없음.
- `export function fillBasicFromDocs(notice, fields): void`(키 루프):
  - `prev.status === 'user_edited'` → 건너뜀.
  - `prev.value != null && prev.source?.kind !== 'document'` → 건너뜀(HTML/API 우선, 충돌 기록 안 함).
  - `fields[key]` 있음 → 대입.
  - 없음 + `prev.source?.kind === 'document'` + `prev.value != null` → `{ ...prev, status: 'needs_review', note: '최근 추출에서 값이 확인되지 않음' }`.
  - 그 외 그대로. mergeFields/mergeDocumentLayer 사용 금지.
- `runExtractStep`에서 평가 필드 반영 직후 `fillBasicFromDocs(notice, basicFieldsOf(extras, nowIso))` 호출.

### U6. 검토 문구 `src/ui/review/view.ts`
- `REASON_TEXT`에 `no_total: '가감점 표만 있음, 합계 배점 없음'`.

## 테스트
기존 기대값 수정
- `tests/extraction/rules.test.ts:41` → credibilityScore `{ value: null, status: 'needs_review', reason: 'no_total' }`, evidence는 가감점 표의 1열 라벨 셀.
- `tests/engine/extract-flow.test.ts:25` 같은 변경 + `notice.basic.projectPeriod` `{ value: '계약체결일로부터 2028.02.28.까지', status: 'verified', source.kind 'document' }`, `notice.evaluation.credibilityScore` `{ value: null, status: 'needs_review', raw: '가점 6항목, 감점 2항목' }`. managementScore 4, performanceScore 6 불변.

새 케이스(합성 픽스처, rules.test.ts 기존 헬퍼 사용)
1. 가감점 표 `[['구분','평가항목','배점'],['가점','A. 지방 소재 중소기업','0.5점\n(최대 0.5점)'],['감점','G. 경고조치','0.5점\n(최대 2.5점)']]` → extras.bonusTable `'가점 1항목, 감점 1항목'` verified, credibilityScore no_total, location `'표0 r1c0'`.
2. 1 + `[['구분','평가항목','배점'],['정량','대외신인도','4']]` → credibilityScore `4` verified.
3. 점수 칸 빈 자가진단표 `[['평가항목','증빙요약','점수'],['가점','',''],['감점','','']]` → bonusTable not_found, credibilityScore not_found.
4. `[['구분','평가항목','배점'],['정량','중소기업 가점을 부여하지 않는다','4']]` → bonusTable 후보 없음.
5. 두 문서가 다른 항목 수 → prefer_priority top 값, credibilityScore no_total, evidence는 우선순위 높은 문서.
6. `'나. 용역기간 : 계약체결일로부터 2028.02.28.까지'` → `'계약체결일로부터 2028.02.28.까지'`(띄어쓰기 유지).
7. `'1) 계약기간이 90일 이내인 경우 2) 납품대금이 1억원 이하인 경우'` → 없음.
8. `'(사업기간) 2026-2031'` → `'2026-2031'`.
9. `'전체 사업기간 중 총 2회'`, `'추정 사업기간'`, 표 셀 `'사업기간'` 단독, `'하자담보기간 : 2년'` → 없음.
10. `'□ 사업기간: 계약일로부터 12개월'` → `'계약일로부터 12개월'`.
11. 두 문서 다른 값 → `{ status: 'needs_review', reason: 'conflict' }`.
12. basic.projectPeriod missing + 문서 값 → verified, source document.
13. basic.projectPeriod가 html verified → 그대로, candidates 없음.
14. user_edited → 그대로.
15. 이전 document 값 있고 이번 추출에 없음 → needs_review, note '최근 추출에서 값이 확인되지 않음'.
16. evaluation 키들은 fillBasicFromDocs 전후 동일.
- 스키마: bonus-table 검증 통과, rowLabel 누락 오류, valueType 'text' 통과.
- UI: no_total 카드 reason 문구.
- 기존 inline 오염 테스트(`rules.test.ts` 218-222행 부근) 통과 유지.

## 단계
- I1: U1, U2, U3, U4, U6 + 테스트 1~11, 스키마, UI, rules.test.ts 기대값.
- I2: U5 + 테스트 12~16 + extract-flow 기대값.
- 리뷰: applyBonusTable, fillBasicFromDocs, window-regex text 경로를 code-reviewer.

## 하지 말 것
- credibility 동의어에 가점/감점/가감점 추가.
- 가점 최댓값 합산 등 숫자 생성.
- projectPeriod를 EXTRACTION_KEYS, EVALUATION_KEYS, 검토 카드에 추가.
- basic 보충에 mergeFields/mergeDocumentLayer 사용, HTML과 문서 사업기간 충돌 기록.
- bonus-table 라벨 부분 일치.
- 코드 주석, 화면 문구에 가운뎃점(·) 사용(JSON 동의어 원문 기호만 예외).
