# 대외신인도 평가 합성 항목·평가방법 원문·공동수급 방식 명세

작성 2026-10-20. Fable 설계, 사용자 결정: "대외신인도와 비슷한 개념(경영상태 등)은 대외신인도 평가로 본다", "평가방법은 사람 요약 대신 문서 실제 텍스트", 공동수급은 "허용(공동이행방식)" 형식.

## 정답 예 (KOICA 카라바오 R26BK01722175)
```
7) 평가방법 : 기술평가위원회 개최를 통한 온라인 소집평가 (조달청 나라장터 온라인 평가시스템 활용한 발표평가)
9) 대외신인도 평가 : 경영상태(신용평가등급) 평가(4점)
11) 공동수급 여부 : 허용(공동이행방식)
```
현재: 9) `…(4점), 대외신인도(확인 필요)`, 7) API 값, 11) `허용`.

## 결정
- D1 데이터 모델 `credibilityScore`/`managementScore` 분리 유지. 합치는 곳은 표시(메일 합성 항목)와 판정(검토 그룹)뿐. 서로 값 복사·not_found 변경 금지.
- D2 메일 가상 TemplateFieldKey `credibilityEval`. 조각: 경영상태 → `경영상태(신용평가등급) 평가(N점)`, 대외신인도 → `대외신인도(N점)`. 경영상태 먼저, `, `로 연결. 조각 0개면 `{text:'확인 필요', status:'missing', raw:null}`. 조각 needs_review면 조각 뒤 ` (확인 필요)`, 전체 status needs_review. no_total raw는 메일에 넣지 않음. value null(user_edited null 포함)은 조각 없음.
- D3 검토 그룹 `REVIEW_GROUPS = [['credibilityScore','managementScore']]`. 그룹의 다른 멤버가 충족(status verified 또는 userEdited 있음)이고 이 항목이 값 없음(reason not_found/no_total/no_documents)이면 covered → 확인 필요로 세지 않음. conflict/low_confidence는 그대로 셈. `computeStatus`와 `reviewCountOf`는 같은 술어 사용. `conflictCountOf` 변경 없음.
- D4 bonus-period-extract 구현(no_total, 사업기간 보충) 전부 유지.
- D5 평가방법 원문: notice 평가 필드 `evalMethodDoc: FieldValue<string>` 추가, extras 규칙 `eval.methodDoc`으로 추출, 사업기간과 같은 "문서 전용 필드 보충" 경로. 메일 `{평가방법}`은 가상 키 `evalMethodText`(문서 원문 우선, 없으면 `evalMethod` API 값). API 값은 `{공고정보평가방법}`(fieldKey evalMethod)로 남김. evalMethod에 문서값 덮어쓰기 금지, mergeDocumentLayer/mergeFields에 evalMethodDoc 태우지 않음.
- D6 공동수급: 메일에서만 `jointVentureText(fv)`. value true + raw → `허용(<방식>방식)`, 방식 = raw에서 선두 `(전자)`/`(수기)`와 공백 제거, 끝에 "방식" 없으면 붙임. 정규화 결과가 비었거나 `불허|단독` 포함이면 괄호 생략. false → `불허`. null+raw → `<raw> (확인 필요)`. needs_review면 ` (확인 필요)`. `formatJoint`(사이드패널 등 3곳)는 바꾸지 않음.
- D7 확장 지점: (a) 규칙·동의어 `default-rules.json` (b) 메일 합성 `src/core/templates/composites.ts` (c) `REVIEW_GROUPS` (d) `DOC_FILL_KEYS`. 기관명 if 금지.

## 작업
### A. 타입·레지스트리
1. `src/core/types/notice.ts` NoticeEvaluation에 `evalMethodDoc: FieldValue<string>;`.
2. `src/core/model/notice-fields.ts` EVALUATION_KEYS 끝에 `'evalMethodDoc'`. Notice schemaVersion 1 유지.
3. `src/core/types/template.ts` TemplateFieldKey에 `| 'credibilityEval' | 'evalMethodText'`.
4. `src/core/templates/variables.ts`: 기존 `v('평가방법','evalMethod',…)`를 `v('평가방법','evalMethodText','평가','text')`로 교체, `v('공고정보평가방법','evalMethod','평가','text')`, `v('대외신인도평가','credibilityEval','평가','text')`, `v('문서평가방식','evalMethodDoc','평가','text')` 추가. 기존 `대외신인도`·`경영상태` 변수 유지. 변수 이름에 괄호 금지(render.ts VAR_RE).
5. `src/core/templates/sample-notice.ts` evalMethodDoc 예: `ok('기술평가위원회 개최를 통한 온라인 소집평가')`.

### B. 새 파일 `src/core/templates/composites.ts`
```ts
export type CompositeKey = 'credibilityEval' | 'evalMethodText';
export const COMPOSITE_KEYS: readonly CompositeKey[];
export function resolveComposite(notice: Notice, key: CompositeKey): ResolvedValue; // D2, D5
export function jointVentureText(fv: FieldValue<unknown> | undefined): ResolvedValue; // D6
```
순수 함수. evalMethodText: evalMethodDoc 문자열이면 그것(needs_review면 ` (확인 필요)`), 없으면 values.ts의 evalMethod text 결과와 동일.

### C. `src/core/templates/values.ts`
resolveValue switch에 `credibilityEval`/`evalMethodText` → resolveComposite, `jointVentureAllowed` → jointVentureText (default 분기 앞).

### D. `src/core/templates/default-template.ts`
- `field('evalMethod','평가방법')` → `field('evalMethodText','평가방법')`.
- text 항목 `txt_cred` → `field('credibilityEval','대외신인도 평가')`(스타일 유지).
- 저장 템플릿 자동 승격(template normalize 모듈, `tests/core/template-normalize.test.ts`가 가리키는 곳): 로드 시 (i) `kind:'text' && id==='txt_cred' && text==='경영상태(신용평가등급) 평가({경영상태}), 대외신인도({대외신인도})'` 완전 일치면 credibilityEval field로(스타일 유지), (ii) `fieldKey==='evalMethod' && label==='평가방법'`이면 evalMethodText로. 문구를 고친 항목은 유지. 메모리 보정만.

### E. `src/core/extraction/rules/default-rules.json`
version `"1.3.0"`. 규칙 추가:
```json
{ "id": "eval.methodDoc", "target": "extras.evalMethodDoc", "strategy": "window-regex", "weight": 1, "blocksAfter": 0, "valueType": "text", "conflictPolicy": "prefer_priority",
  "anchor": "^[^가-힣]{0,8}(?:기술)?평가(?:방식|방법)[:)]",
  "pattern": "^[^가-힣]{0,8}(?:기술)?평가(?:방식|방법)[:)]+(?!(?:제안요청서|공고문|붙임|별첨|별지|「))(?<v>(?=[^:]{0,60}(?:평가|심사|발표|서면|온라인|소집|PT|협상|제안서))[^:]{4,160})" }
```
(compact 텍스트 기준. 기존 window-regex text 경로가 원문 띄어쓰기 복원.) 공고문 쪽 오탐으로 conflict가 나면 그 문장 유형을 negative lookahead에 추가.

### F. `src/engine/extraction/extract-step.ts`
- `export const DOC_FILL_KEYS = ['projectPeriod','evalMethodDoc'] as const;`
- `basicFieldsOf` → `docOnlyFieldsOf(extras, fetchedAt): FieldMap`(DOC_FILL_KEYS 순회, no_total 제외 유지).
- `fillBasicFromDocs` → `fillDocOnlyFields(notice, fields)`: DOC_FILL_KEYS 순회, `getField`/`setFields` 사용. 기존 규칙(user_edited 건너뜀 / 비문서 값 있으면 건너뜀 / 있으면 대입 / 이전 문서값 있고 지금 없음 → needs_review '최근 추출에서 값이 확인되지 않음') 유지.
- 324-326행 evalOnly 루프에서 DOC_FILL_KEYS 키 제외.
- 327행 호출 교체.

### G. `src/core/extraction/review-count.ts`, `decide.ts`
```ts
export const REVIEW_GROUPS: ExtractionKey[][] = [['credibilityScore','managementScore']];
export function coveredByGroup(items, key): boolean;
export function pendingKeys(items): ExtractionKey[]; // needs_review && !userEdited && !coveredByGroup
```
`reviewCountOf = pendingKeys(items).length`. `computeStatus`(decide.ts)는 `EXTRACTION_KEYS.every(k => satisfied(items[k]) || coveredByGroup(items,k))`. 순환 import 없게.

### H. `src/ui/review/view.ts` + 렌더 컴포넌트(Grep `CardBadge`)
- CardBadge `'covered'`. `buildCard(key, item, items)`: covered면 badge 'covered', reason `문서에 없음 (${ITEM_LABEL[충족 멤버]}로 충족)`.
- 정렬 needs_review → covered → 나머지. summarize: covered 별도 카운트, needsReview 제외.
- 뱃지 "충족", verified와 같은 계열의 회색 톤(기존 뱃지 컴포넌트 재사용).

### I. `src/ui/notice-detail/view.ts:110` 부근
`row('평가방식', e.evalMethod, …)` 아래 `row('평가방식(문서 원문)', e.evalMethodDoc, text, { pre: true })`(기존 row 시그니처에 맞춤).

### J. `.claude/specs/decisions.md`
끝에 "2026-10-20 대외신인도 평가 합성 항목과 검토 그룹" 절(D1~D7 표, 기각 대안: 한 항목 병합, 값 복사, 템플릿 조건 문법, evalMethod 덮어쓰기, formatJoint 변경, 기관명 분기 코드). 2026-10-17 "경영상태 항목 분리" 절의 "한쪽만 있는 공고는…" 줄 뒤에 "(2026-10-20 보완: not_found는 유지하되 그룹의 다른 항목이 충족이면 확인 필요로 세지 않는다)".

## 테스트
- `tests/core/render-template.test.ts`: (1) mgmt 4 verified + cred missing → `경영상태(신용평가등급) 평가(4점)` ok (2) cred 5만 → `대외신인도(5점)` (3) 둘 다 → `경영상태(신용평가등급) 평가(4점), 대외신인도(5점)` (4) mgmt needs_review 4 → `… (확인 필요)` needs_review (5) 둘 다 없음 → `확인 필요` missing (6) joint true raw `(전자)공동이행` → `허용(공동이행방식)`, `(전자)주계약자관리` → `허용(주계약자관리방식)`, false → `불허`, null raw `기타` → `기타 (확인 필요)` (7) evalMethodDoc verified → 원문, missing → API 값 (8) `{공고정보평가방법}`은 API 값.
- `tests/core/template-normalize.test.ts`: 옛 txt_cred 일치 → 승격, 수정된 문구 유지, evalMethod+'평가방법' → evalMethodText.
- `tests/extraction/rules.test.ts`: KOICA 픽스처 extras.evalMethodDoc = `기술평가위원회 개최를 통한 온라인 소집평가 (조달청 나라장터 온라인 평가시스템 활용한 발표평가)`; `'1) 평가방식 : 서면평가'` → `서면평가`; `'정량평가방법 : 배점표에 따름'` → 없음; `'평가방법 : 제안요청서 참조'` → 없음.
- `tests/engine/extract-flow.test.ts`: evalMethodDoc verified(source document); KOICA에서 reviewCountOf가 credibility를 세지 않음; 다른 항목 모두 verified면 status 'verified'; conflictCountOf 불변; 재추출에서 evalMethodDoc 미검출 → needs_review '최근 추출에서 값이 확인되지 않음'; mergeDocumentLayer 뒤 evalMethodDoc이 evalOnly로 덮이지 않음.
- review-count/decide 테스트: 한쪽 verified+not_found → 0건 / 한쪽 userEdited+no_total → 0건 / 둘 다 not_found → 2건 / 한쪽 verified+다른 쪽 conflict → 1건.
- `tests/ui/view.test.ts`: covered 카드 badge·reason·정렬·summarize.

## 완료 조건
`cd C:/workspace/bidMate && npx tsc --noEmit`, `npm test` 전체 통과(반드시 대문자 C: 경로).

## 보고 (한국어)
변경 파일:줄범위, 명세와 다른 점과 이유, 테스트 결과(개수), 의심 사항.
