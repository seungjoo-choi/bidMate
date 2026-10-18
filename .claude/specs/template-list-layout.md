# 메일 템플릿 목록형 양식과 문구 항목 (명세)

설계: Fable(2026-10-19). 결정 기록은 `.claude/specs/decisions.md`에 남긴다(S6).

## 목표

내장 기본 템플릿이 아래 양식으로 메일 본문을 만든다. 이를 위해 템플릿에 (a) 섹션 제목 옆 값, (b) 직접 입력 문구 항목(`{변수}` 섞어 쓰기 가능), (c) 항목별 굵게/밑줄, (d) 템플릿별 표형/목록형 선택을 추가한다. 기존 저장 템플릿은 그대로 읽히고 출력도 변하지 않는다(값 서식 변경은 예외, §3).

목표 양식(표본 값 기준, [B]=굵게, [BU]=굵게+밑줄, "N. 제목" 부분은 굵게):
```
1. 기관명 : 한국국제협력단
2. 사업명 : 필리핀 카라바오 ... PC 용역
3. 공고 정보
  1) 공고 게시일시 : 2026/09/11 16:47
  2) 입찰참가자격등록 : 2026/10/21 18:00까지
  3) 제안서 제출 : [BU]2026/10/15 10:00 ~ 2026/10/22 14:00
  4) 제안서 평가일자 : [BU]2026/11/05 14:00
  5) 사업금액 : [B]1,923,000,000 원(VAT 포함)
  6) 사업기간 : [B]~ 2028.02.28
  7) 평가방법 : 조달평가(온라인)
  8) 차등점수제 적용 여부 : 미적용
  9) 대외신인도 평가 : 경영상태(신용평가등급) 평가(4점), 대외신인도(2점)
  10) 실적점수 평가 : 5년 이내 국내외 유사사업 수행실적(6점) - 5억 원 이상인 사업에 한함
  11) 공동수급 여부 : 허용
  12) 예가방법 : 비예가
4. 제안부서
  1) 부서명 : 넥스트업사업본부
  2) 제안PM : 
5. 관련 자료
  1) 나라장터 공고 URL : https://...
  2) 첨부파일 목록 :
    - 공고문.hwp
```

## 1. 스키마 (`src/core/types/template.ts`)

```ts
export type TemplateLayout = 'table' | 'list';
export interface TemplateStyle { bold?: boolean; underline?: boolean }
export interface TemplateFieldItem { kind?: 'field'; fieldKey: TemplateFieldKey; label: string; visible: boolean; style?: TemplateStyle }
/** 고정 문구 또는 변수 합성 항목. text는 {변수} 허용 평문. */
export interface TemplateTextItem { kind: 'text'; id: string; label: string; text: string; visible: boolean; style?: TemplateStyle }
export type TemplateItem = TemplateFieldItem | TemplateTextItem;
/** title과 inlineValue는 {변수} 허용. inlineValue가 있으면 "N. 제목 : 값" 한 줄로 찍는다. */
export interface TemplateSection { id: string; title: string; inlineValue?: string; items: TemplateItem[] }
export interface Template { /* 기존 필드 */ layout: TemplateLayout; sections: TemplateSection[] }
```

- `kind` 생략 = field. normalize와 validate는 `kind`를 채워 넣지 않는다(생략으로 통일).
- `style`은 값에만 적용, 라벨에는 적용 안 함. bold/underline이 둘 다 false/없음이면 `style` 속성 자체를 생략한다.
- `layout`은 required. 저장 데이터에 없으면 normalize가 `'table'`.
- text 항목 `id`: `newId('txt')`(src/core/model/ids.ts) 또는 내장 템플릿은 고정 문자열.

## 2. 렌더 (`src/core/templates/render.ts renderMail`)

공통:
- 변수 치환은 기존 `substitute` 한 함수만 쓴다. 적용 대상 확대: `section.title`, `section.inlineValue`, 모든 항목 `label`, text 항목 `text`. `where`는 `section.id`.
- 섹션 렌더 조건: visible 항목 1개 이상, 또는 `inlineValue.trim() !== ''`. 아니면 생략하고 번호도 건너뛰지 않는다(기존 동작).
- 값 강조: `styleWrap(html, style)` = bold면 `<strong>…</strong>`, underline이면 `<u>…</u>`, 둘 다면 `<strong><u>…</u></strong>`. text 출력에는 표시 없음.
- text 항목 값 = `substitute(it.text, section.id, ctx)`를 `textToHtml`. 빈 문자열이어도 visible이면 줄을 찍는다.
- field 항목은 기존 `resolveValue`/`valueHtml`/unresolved 처리 그대로.
- 모든 문구는 이스케이프한다. 문구를 HTML로 해석하지 않는다.

table 레이아웃(기존 출력 보존):
- HTML `<h3>N. 제목</h3>`(inlineValue 있으면 `<h3>N. 제목 : 값</h3>`) + 기존 table. text 항목도 `<tr><th>라벨</th><td>값</td></tr>`.
- text 출력: `N. 제목`(또는 `N. 제목 : 값`), 항목 `- 라벨: 값`, 섹션 사이 빈 줄. 기존 형식 변경 금지.

list 레이아웃(신규):
- HTML 섹션 = `<div style="margin:0 0 8px 0;">` 안에 줄마다 `<div>`:
  - 제목 줄 `<div><strong>N. 제목</strong></div>`, inlineValue 있으면 `<div><strong>N. 제목</strong> : 값</div>`(값에 스타일 없음).
  - 항목 줄 `<div style="padding-left:1.5em;">i) 라벨 : 값HTML</div>`. 라벨이 빈 문자열이면 `i) 값HTML`. `i`는 visible 항목 기준 1부터.
  - attachmentList(값 있음): `<div style="padding-left:1.5em;">i) 라벨 :<ul style="margin:0;padding-left:18px;">…</ul></div>`.
- text 출력:
  - `N. 제목` 또는 `N. 제목 : 값`
  - `  i) 라벨 : 값`(앞 공백 2칸, 구분자 공백 콜론 공백). 라벨 비면 `  i) 값`. attachmentList는 `  i) 라벨 :` 뒤 줄마다 `    - 파일명`.
  - list 섹션들은 빈 줄 없이 이어서 하나의 블록으로 textParts에 넣는다. 인사말/맺음말과는 기존대로 빈 줄.
- 불변 조건: 각 줄 HTML의 innerText가 text의 같은 줄(앞 공백 제외)과 문자 단위로 같아야 한다. 태그 안팎에 개행/들여쓰기 공백을 넣지 않는다. 근거: `src/engine/jobs/compose-job.ts` `firstSectionLabel`이 text 첫 "1. " 줄을 웹메일 본문 innerText에서 찾는다.

## 3. 메일 값 서식 (`format.ts`, `values.ts`, `variables.ts`)

- `src/core/model/format.ts`에 새 함수만 추가, 기존 함수 출력 변경 금지(검수 UI가 사용):
  - `formatDateTimeSlash(iso)`: 로컬 시각 `YYYY/MM/DD HH:mm`(초 없음), 해석 불가면 `''`.
  - `formatDateSlash(iso)`: `YYYY/MM/DD`, 해석 불가면 `''`.
  - `formatAmountComma(n)`: `1,923,000,000 원`, 유효하지 않으면 `'—'`.
- `src/core/templates/variables.ts`: `VariableKind`에 `'amount_short'` 추가, `실적인정금액`(performanceMinAmount)만 이 kind.
- `src/core/templates/values.ts formatByKind`: `amount → formatAmountComma`, `amount_short → formatAmountShort`(`'—'`면 `''`), `datetime → formatDateTimeSlash(value) || value.trim()`, `date → formatDateSlash(value) || value.trim()`. `collectedAt` 분기도 `formatDateTimeSlash`.
- `src/core/templates/sample-notice.ts`: `proposalPeriod: ok('2026/10/23 10:00 ~ 2026/10/27 14:00')`.

## 4. 정규화와 저장 검증

`src/core/templates/normalize.ts normalizeTemplate`(읽기, 관대, 쓰지 않음):
- `layout`: `r.layout === 'list' ? 'list' : 'table'`.
- `inlineValue`: 비어 있지 않은 문자열일 때만 설정.
- 항목 `kind`가 undefined 또는 `'field'` → 기존 fieldKey 검사(kind 속성은 결과에 넣지 않음). `'text'` → `{kind:'text', id: 문자열이면 그대로 아니면 newId('txt'), label: 문자열 또는 '', text: 문자열 또는 '', visible: boolean 아니면 true, style}`. 그 외 kind → warning `템플릿 "<이름>": 알 수 없는 항목 종류 "<kind>"을 제거했습니다`로 제거.
- `export function normalizeStyle(x: unknown): TemplateStyle | undefined`: 객체이고 `bold === true` 또는 `underline === true`일 때만 true인 키만 담아 반환, 아니면 undefined. field/text 항목 모두 적용.

`src/engine/config/templates-api.ts validateInput`(저장, 엄격, 기존 INVALID_VALUE 오류 방식):
- `layout`이 `'table'|'list'`가 아니면 거부.
- `inlineValue`가 있는데 문자열이 아니면 거부, 빈 문자열은 생략.
- 항목 kind 없음/`'field'` → 기존 검사. `'text'` → label, text 문자열, visible boolean 아니면 거부. id가 문자열 아니거나 비면 `newId('txt')`. 그 외 kind 거부.
- `style`이 있으면 객체이고 bold/underline이 undefined 또는 boolean이어야 함. 저장값은 `normalizeStyle` 결과.
- 반환과 `saveTemplate`의 저장 객체에 `layout` 포함.

## 5. 내장 기본 템플릿 (`src/core/templates/default-template.ts builtinDefaultTemplate`)

- `layout: 'list'`, subject/greeting/closing 기존 유지.
- 섹션(순서대로):
  - `sec_org` 제목 `기관명`, inlineValue `{발주기관}`, items `[]`
  - `sec_title` 제목 `사업명`, inlineValue `{공고명}`, items `[]`
  - `sec_info` 제목 `공고 정보`:
    1. field `postedAt` "공고 게시일시"
    2. text `txt_reg` "입찰참가자격등록" `{참가자격등록마감}까지`
    3. field `proposalPeriod` "제안서 제출" style `{bold:true, underline:true}`
    4. field `proposalEvalAt` "제안서 평가일자" style `{bold:true, underline:true}`
    5. text `txt_budget` "사업금액" `{사업금액}(VAT 포함)` style `{bold:true}`
    6. field `projectPeriod` "사업기간" style `{bold:true}`
    7. field `evalMethod` "평가방법"
    8. field `differentialScoring` "차등점수제 적용 여부"
    9. text `txt_cred` "대외신인도 평가" `경영상태(신용평가등급) 평가({경영상태}), 대외신인도({대외신인도})`
    10. text `txt_perf` "실적점수 평가" `{실적인정기간} 이내 국내외 유사사업 수행실적({실적평가}) - {실적인정금액} 이상인 사업에 한함`
    11. field `jointVentureAllowed` "공동수급 여부"
    12. field `priceMethod` "예가방법"
  - `sec_dept` 제목 `제안부서`: text `txt_dept` "부서명" `넥스트업사업본부` / text `txt_pm` "제안PM" `''`
  - `sec_links` 제목 `관련 자료`: field `sourceUrl` "나라장터 공고 URL" / field `attachmentList` "첨부파일 목록"
- 저장된 `tpl_default`는 읽기 경로에서 교체/보정 저장하지 않는다.

## 6. 편집 UI

- `src/entrypoints/dashboard/templates/SectionEditor.tsx`:
  - 섹션 제목 아래 input "제목 옆 값"(aria-label `섹션 N 제목 옆 값`, placeholder `비우면 제목만 표시, {변수} 가능`). 기존 입력들처럼 포커스 추적(변수 팔레트 삽입 대상). 빈 문자열이면 `inlineValue` 속성 제거.
  - 항목 행 key: `it.kind === 'text' ? it.id : it.fieldKey`.
  - field 행: 기존 + 굵게/밑줄 토글(aria-label `굵게`, `밑줄`). 둘 다 꺼지면 `style` 제거.
  - text 행: visible 체크, 라벨 input, 문구 input(placeholder `직접 입력 또는 {변수}`, 포커스 추적), 굵게/밑줄 토글, 위/아래/삭제. 변수명 칸에는 `문구`로 표시.
  - 추가 영역: 기존 "항목 추가" 옆에 "문구 추가" 버튼 → `{kind:'text', id: newId('txt'), label:'새 항목', text:'', visible:true}`.
- `src/entrypoints/dashboard/TemplateEditor.tsx`: 기본 정보 카드에 "본문 형식" select(`table`=표, `list`=번호 목록). `snapshotOf`, `save()`에 layout 포함. `usedKeys`는 field 항목만(`it.kind !== 'text'`).
- `src/entrypoints/dashboard/TemplatesPage.tsx`: `create()`에 `layout: base.layout` 전달. 헤더 액션에 "기본 양식으로 새로 만들기" 버튼 → `create(builtinDefaultTemplate(new Date()), '기본 템플릿 (새 양식)')`(새 id로 저장).
- `src/entrypoints/dashboard/templates/VariablePalette.tsx` 안내문에 "제목 옆 값, 문구"를 삽입 대상으로 추가.
- 화면 문구에 가운뎃점 문자 사용 금지.

## 7. 테스트 항목

`tests/core/render-template.test.ts`:
- 기존 `tpl()` 헬퍼에 `layout: 'table'`. '값 포맷' 기대값 갱신(`- 금액: 500,000,000 원`, `- 마감: 2026/10/22 14:00` 형식). 기존 table 테스트는 그 외 그대로 통과.
- 새 케이스: performanceMinAmount 250,000,000 → `2억 5,000만 원`; collectedAt 슬래시 표기.
- list: inlineValue 섹션 text 첫 줄 `1. 기관명 : 한국정보기관`, html에 `<strong>1. 기관명</strong> : 한국정보기관`.
- list: 항목 `  1) 라벨 : 값`, 숨김 항목은 번호에서 빠짐, 라벨 빈 항목은 `  1) 값`.
- text 항목 합성 `{참가자격등록마감}까지` → `2026/10/20 17:00까지`; 값 missing이면 `확인 필요까지`, unresolved에 `{name:'참가자격등록마감', where:<섹션id>, status:'missing'}`.
- 고정 문구는 그대로, unresolved/unknownVars 비어 있음. 빈 문구는 `  1) 부서명 : ` 줄 존재.
- 스타일: bold+underline → `<strong><u>값</u></strong>`, bold만 → `<strong>값</strong>`, text 출력엔 태그 없음, table 레이아웃 td 안에도 적용.
- 섹션 생략: 항목 0개+inlineValue 없음 → 생략, 항목 0개+inlineValue 있음 → 렌더, 전부 숨김+inlineValue 없음 → 생략.
- title/label/inlineValue/text 이스케이프(`<b>`가 `&lt;b&gt;`).
- list attachmentList: `  N) 첨부 :` 다음 줄 `    - 공고문.hwp`.
- list 섹션 사이 빈 줄 없음, 인사말과 첫 섹션 사이는 빈 줄.
- 기본 템플릿 + 표본 공고: unknownVars 없음, text 첫 줄 `1. 기관명 : 한국정보기관`, `  5) 사업금액 : 500,000,000 원(VAT 포함)`, `  10) 실적점수 평가 : 3년 이내 국내외 유사사업 수행실적(10점 (확인 필요)) - 2억 5,000만 원 이상인 사업에 한함`, `4. 제안부서` 다음 `  1) 부서명 : 넥스트업사업본부`, `  2) 제안PM : `.

`tests/engine/templates-api.test.ts`:
- `input()` 픽스처에 `layout: 'table'`.
- `layout: 'grid'` → INVALID_VALUE.
- text 항목 저장 후 재로드 시 kind/text/style 유지.
- text 항목 text 누락 → INVALID_VALUE. `kind: 'html'` → INVALID_VALUE.
- `style: {bold:false, underline:false}` 저장 후 로드하면 style 없음.
- 옛 형식(kind 없음, layout 없음) 파일 → `layout: 'table'`, 항목 그대로, warnings 없음.
- 알 수 없는 kind가 든 파일 → 그 항목 제거 + warning 1개.

## 8. 하지 말 것

- table 레이아웃 text 형식, format.ts 기존 함수 출력, VARIABLE_BY_KEY 중복 등록, text 항목용 별도 치환 정규식, `style` false 저장, 저장된 `tpl_default` 자동 교체.

## 알려진 차이(의도)

- `허용(공동이행방식)`은 `허용`만 나온다(공동이행방식은 추출하지 않음).
