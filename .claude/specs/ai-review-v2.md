# AI 재검토 v2 — 범용 프롬프트·문서 전달·정확도 검증 (Fable 설계, 2026-10-20 사용자 승인)

선행 명세: `.claude/specs/ai-review.md`(v1). 결정 기록: `decisions.md` "2026-10-20, AI 재검토 v2".

## 0. 배경 (실패 사례에서 확인한 사실)

공고 R26BK01723328-000(저장: `C:/Users/admin/Documents/bidmate/notices/2026/R26BK01723328-000_팔레스타인 재난·위기 대응 역량강화사업 PMC 용역/`, `source/text/`에 추출 텍스트, `ai/`에 실제 프롬프트·응답).
- 제안요청서 1968~1971줄 평가표: "(해당 사업규모* 대비) 국내외 유사사업 수행실적** 비율 / * 25억원" → 25억은 비율 평가의 분모.
- 2212줄 주석: "※ 해당 사업규모(지분금액 기준**) : △타당성조사/예비조사/기획조사 : 0.5억원 이상, △프로젝트 5억원 이상, △연수사업 0.2억원 이상, △정책연구사업 0.4억원 이상" → 실적 1건 인정 하한(유형별).
- AI 1차: 발췌 상한으로 2212줄 누락. 2차: 25억 선택 + 25,000,000 오환산. 3차: 잘못된 pitfall로 25억 선택(pitfall 제거됨).

| # | 사실 | 근거 |
|---|---|---|
| ① credibilityScore 정의가 제품 의미와 반대 | `prompt.ts` ITEM_DEFS는 "신용(신용평가등급) 항목 배점"이지만 규칙(synonyms.credibility=대외신인도·신인도, `cred.bonusTable`)·UI(`ui/review/view.ts` ITEM_LABEL='대외신인도 배점')는 신인도(가감점) 배점. 신용평가등급은 management 동의어 |
| ② 표 렌더링이 중첩표·여러 줄 셀에서 깨짐 | `render-text.ts`는 셀 안 표를 부모 셀 줄 뒤에 평면으로 쏟음. `excerpt.ts:renderLines`는 같은 r끼리만 ` \| `로 잇고 셀 안 줄바꿈 평문에서 행을 끊음. rs 라벨이 첫 행에만 붙어 아래 행이 라벨 없는 고아 행이 됨 |
| ③ 주석이 표에서 240줄 떨어짐 | 2212줄 주석은 평가표(1967)가 아니라 실적 서식 표 앞. 키워드 창 발췌는 이를 묶지 못함 |
| ④ 같은 용어의 두 역할 | "해당 사업규모"가 표에서는 분모, 주석에서는 하한 |
| ⑤ 단일 value 스키마 | 정답이 유형별 4개라 규칙(conflict)도 AI도 맞을 수 없음 |
| ⑥ AI에게 단위 환산을 시킴 | valueFormat "원 단위 정수". `coerceValue`(parse.ts)는 "25억원" 문자열을 이미 받음 |
| ⑦ 공통 규칙 "값이 여럿이면 평가기준표의 값" | 주석보다 표 셀 값을 고르게 밂 |
| ⑧ 규칙 엔진은 DocModel로 동작 | `[셀` 태그 소비자는 render-text·excerpt·verify 셋뿐. 텍스트 형식을 바꿔도 규칙 추출 영향 없음 |
| ⑨ 문서 크기 | 공고 1건 텍스트 합계 10만~24만자, 제안요청서 단독 6.6만~11만자 |

## 1. 핵심 결정

| 결정 | 이유 | 기각 대안 |
|---|---|---|
| D1. 항목 정의를 "개념 + 역할 식별법 + 혼동 개념(이것은 아님)" 3부 구조로. 특정 문구·숫자 금지, 예시는 가상 표시 | ①④⑦은 정의 부재에서 옴. 역할(분모/하한/점수/한도)로 고르게 하면 용어 재사용에 강함 | 공고별 pitfall 누적(과적합) |
| D2. 금액·기간 값은 원문 표기 문자열로 받고 코드가 환산 | ⑥ 제거 | 환산 지시 강화 + 10^k 보정(증상 치료, 안전망으로만 유지) |
| D3. 출력에 `variants[{condition,value,quote}]` 추가. Extraction 스키마 불변, AiSuggestion에만 추가 | ⑤. ai-review.json에 국한, 마이그레이션 0 | ExtractedItem.value 배열화 |
| D4. API 모드 = 전체 텍스트(우선순위순, 총 40만자 상한, 초과 시 섹션 발췌 폴백). 수동 모드 = 섹션 발췌 + 주석 결속 + 참조어 추적 | 발췌가 1차 실패 원인. 정확도 우선. 수동은 30k 한계 | 2단계(비용·지연 2배, 수동은 붙여넣기 2회), 파일 업로드(인용 대조 불가) |
| D5. 표 렌더링 "행 자기완결형": rs 라벨 반복, 셀 안 줄바꿈 ` / `, 중첩표 태그. verify는 렌더 줄→원문 줄 맵으로 대조 | ② 제거 | 렌더링 유지 + AI에게 복원 요구 |
| D6. 규칙 후보는 계속 숨김. 코드가 사후 비교해 배지. 후보 동봉은 하네스 A/B 후 결정 | 앵커링은 실측 없이 못 뒤집음 | 후보 동봉 판정, 불일치 재질의 |
| D7. 정답표 + 오프라인 회귀(커버리지·리플레이·린트) + 온라인 평가 스크립트. 프롬프트 변경은 평가 통과가 채택 조건 | "이 공고만 맞게" 사이클 차단 | 수동 확인 |

## 2. 범용 프롬프트 (PROMPT_VERSION 2.0.0)

### 2.1 SYSTEM
```
당신은 공공입찰 첨부문서에서 정량평가 기준을 찾는 검토자입니다.
[근거]
- 아래 문서에 적힌 내용만 근거로 삼습니다. 추정·계산·외부 지식·일반 관행은 쓰지 않습니다.
- 금액·기간·점수는 문서에 적힌 표기 그대로 씁니다(예: "3.7억원", "7년"). 단위 환산·합산·반올림을 하지 않습니다.
[표와 주석]
- 표 셀의 *, **, ※, 주1) 같은 기호는 같은 기호로 시작하는 줄에 정의가 있습니다. 그 줄은 표 바로 아래에도, 같은 문서의 서식·별지 쪽에 멀리 떨어져 있을 수도 있습니다. 표 안 값과 그 주석은 한 몸으로 읽습니다.
- 같은 용어라도 역할이 다를 수 있습니다. 각 항목의 "정의"에 적힌 역할(배점, 하한, 분모, 기간 등)에 맞는 값만 고릅니다. 표 안에 있다는 이유로 고르지 않습니다.
[여러 값]
- 조건(사업 유형, 참가 형태, 공동수급 등)에 따라 값이 다르면 variants에 조건별로 모두 적고, value에는 조건 없이 공통으로 적용되는 값이 있을 때만 그 값을, 없으면 null을 둡니다.
- 문서 간에 같은 개념의 값이 다르면 우선순위: 질의답변·정정공고 > 평가기준(별표·서식) > 입찰공고문 > 제안요청서 본문 > 참고자료. 채택하지 않은 값과 출처는 note에 적습니다.
- 질의답변에서 찾은 값은 note에 "질의답변"이라고 적습니다.
- 문서에 없으면 value null, quote "". "없다"도 답입니다. 비슷한 항목으로 대신 채우지 않습니다.
[인용]
- quote는 문서의 글자 그대로. 한 줄 또는 표의 한 행, 300자 이내. 줄이 짧으면 바로 위 항목명 줄까지 이어 최대 3줄. 줄 앞 기호도 그대로.
- file은 머리글 "=== 파일: … ===" 이름 그대로, page는 [p N]의 N(없으면 null).
[형식] 요청 항목 외 key 금지, JSON 외 텍스트 금지, schema·runId는 요청 값 그대로.
```
삭제: "값이 여럿이면 평가기준표의 값을 value에". S2에서는 variants가 아직 없으므로 [여러 값] 첫 줄은 "value null + note에 조건별 값 전부"로 쓴다(S3에서 variants로 교체).

### 2.2 ItemDef 구조
```ts
interface ItemDef {
  name: string;
  concept: string;        // 무엇인가(역할 포함)
  howToSpot: string[];    // 식별법(형태·위치·표현 유형, 숫자 없음)
  notThis: string[];      // 혼동 개념과 왜 아닌지
  valueFormat: string;
  multi?: string;         // 조건별 다중값 지침
}
```
렌더 순서: 정의 → 식별 → 이것은 아님 → 값 형식 → 다중값. "힌트/주의" 나열식 폐지.

### 2.3 7개 항목 정의
- **credibilityScore (대외신인도 배점)** — 정의: 정량평가의 "신인도/대외신인도" 항목(제재·표창·고용·사회적기업 등 가점·감점 성격 항목 묶음)의 만점 또는 합계 한도. 식별: 평가항목표의 신인도 행 배점 칸, 가감점 표의 "최대 N점" 한도. 아님: 신용평가등급·경영상태(→managementScore), 개별 가점·감점 점수, 감점 수치, 0점. 가감점 표만 있고 합계 한도가 없으면 null + note "가감점 항목만 있고 합계 배점 없음".
- **managementScore (경영상태 배점)** — 정의: 입찰자의 재무·신용 상태(신용평가등급, 재무비율 등)를 평가하는 항목의 만점. 식별: 평가항목표의 경영상태 또는 신용평가등급 행 배점 칸. 하위 항목이 여럿이면 부문 소계(사용자 승인). 아님: 등급별 평점표의 개별 점수(환산표), 신인도, 입찰참가제한·제재, 수행실적과 묶인 합산 행(분리 불가면 null + note).
- **performanceScore (수행실적 배점)** — 정의: 입찰 회사(공동수급체)의 유사사업 수행실적 항목의 만점. 식별: 평가항목표의 수행실적 행 배점 칸. 아님: 투입인력·핵심인력 경력·실적 점수, 실적 구간별 점수(구간 최고점이 배점과 같아도 배점 칸 인용), 소계, 묶음 문장.
- **performancePeriod (실적 인정기간)** — 정의: 실적의 수행(완료) 시점이 공고일·입찰일 기준 얼마 이내여야 인정되는가. 식별: "최근 N년", "공고일 기준 N년 이내", "이행완료일이 N년 이내" 같은 표현이 실적 인정·작성 조건 문맥에 있음. 아님: 창업기업 예외 기간, 본 사업 과업·계약 기간, 인력 경력 연수, 증빙서류 유효기간. 값: 원문 표기 string. 다중값: 실적 종류별 기간이 다르면 조건별.
- **performanceMinAmount (실적 인정금액)** — 정의: 실적 1건이 유사사업 실적으로 인정되기 위한 하한 금액(계약금액·지분금액·건당 기준). 식별: "N 이상인 사업/실적만 인정", "건당 N 이상", 유형별 하한 나열. 아님: (a) 비율 평가의 기준·분모("…규모 N 대비 실적 비율"의 N, note에 "비율 기준금액 N" 기재 가능), (b) 금액 구간별 점수표, (c) 추정가격·기초금액·사업예산, (d) 실적 합계 요건(합계 N 이상은 1건 하한 아님 → note). 값: 원문 표기 string. 다중값: 유형·종류별 하한이 다르면 전부, 공통 하한 없으면 value null. 금액 요건 없는 공고는 null. (해석 "※ 해당 사업규모 … 이상" = 1건 하한은 사용자 승인)
- **performanceCondition (실적 인정 조건)** — 정의: 유사사업의 정의와 인정·불인정 범위를 서술한 원문. 식별: "유사사업 :", "실적 인정 범위", "유사사업이란" 아래 정의 문단(+직결된 ※ 주석). 아님: 증빙 방법·작성 요령·제출 서류 안내, 평가 방식 설명, 서식 열 이름. 값: 원문 그대로 2000자 이내, 정의 문단부터 연속 구간. 요약·재배열 금지.
- **differentialScoring (차등점수제 적용 여부)** — 정의: 기술(정성)평가 점수에 차등점수제를 적용하는지. true는 "적용한다/적용함/차등점수제(적용)" 명시, false는 "미적용/적용하지 않음/해당 없음" 명시. 아님: "차등점수제를 적용한 경우에는…" 조건문·일반 규정 인용, 가격점수 차등, 동점 처리. 명시 없으면 null(false 추정 금지).

### 2.4 예시 정책
- 예시는 형식 안내용, 모두 "(가상 예)" 표시, 값 선택 기준을 숫자로 가르치지 않음.
- 예시 숫자는 `PROMPT_EXAMPLE_TOKENS` 상수에만. 린트 테스트가 SYSTEM_PROMPT·ITEM_DEFS의 모든 숫자가 이 목록 안인지, 금지 어구(실제 공고 고유 문구: "사업규모", "KOICA" 등) 미포함인지 검사.

## 3. 문서 전달
### 3.1 API 모드: 전체 텍스트
- 파일 priority순 전문, 총 `API_FULLTEXT_MAX_CHARS = 400_000` 초과 시만 3.2로 폴백. docKind form/reference 포함.
- 설정 "전문 전송 / 발췌 전송" 토글, 기본 전문(사용자 승인). 일괄 실행은 토큰 예상치 표시(run.excerptChars 재사용).
- 하네스에서 전문 정답률이 발췌보다 낮으면 2단계 재검토.
### 3.2 수동 모드(30k): 섹션 발췌 v2 (키워드 창은 폴백 유지)
1. 섹션 경계: `□ ○ 가. 1. 제N조 [별표 N] [별지 N]` 등 머리 기호 줄을 섹션 시작으로, 적중 구간을 소속 섹션 전체(상한 6,000자)로. 표는 끝까지.
2. 주석 결속: 표 끝 뒤 `※ * ** *** 주N)` 줄은 표 구간에 포함. 평가표 셀에 `*`·`**`가 붙은 어구가 있으면 그 기호로 시작하는 줄을 같은 파일 전체에서 찾아 추가.
3. 참조어 추적: 배점 열이 있는 표 셀에서 기호가 붙은 명사구를 compact해 같은 파일 전체에서 그 어구가 든 줄의 창[-2,+8] 추가.
- 상한 초과 시: 관련도 점수 유지, 배점 열 표 구간과 결속 주석은 마지막에 뺌.
### 3.3 표 렌더링 v2 (`src/core/doc/render-table.ts` 신설, excerpt·verify 공용)
- 입력 원문 줄 배열 → `{ lines: string[]; map: Array<{from:number; to:number}> }`.
- rsN 셀은 r+1..r+N-1 행 앞에 같은 텍스트 반복. csN 그대로. 셀 안 여러 줄은 ` / `.
- 중첩표: render-text.ts가 깊이≥1 셀에만 자기 표 번호 태그 `[셀 2 1 t39]`. 렌더러는 t가 다르면 다른 표로 묶고 `[표 39: 표 38 "…" 셀 안]` 머리글. 깊이 0은 형식 불변(기존 추출 텍스트 호환). 기존 공고는 재추출해야 개선.
- verify: 원문에서 먼저 찾고, 실패하면 렌더 줄에서 찾아 map으로 원문 줄 범위 복원(line·page·evidence는 원문 기준).

## 4. 규칙 후보와 AI
- 프롬프트에는 후보 계속 숨김.
- 사후 비교: `AiSuggestion.ruleRelation: 'in_candidates' | 'differs_from_candidates' | 'no_candidates'`, UI 배지. 후보 집합은 `extraction.items[key].candidates[].value`(+value).
- 후보 동봉 판정은 하네스로 conflict 항목만 A/B. 채택 조건: conflict 정답률 상승 + non-conflict 회귀 없음.
- 규칙 보완: 한 줄에서 조건 구분자(△, ①, / 등)와 함께 금액 후보 2개 이상이면 reason 'conflict' 대신 'multi'("조건별로 값이 다름"). REASON_TEXT·타입만.

## 5. 조건별 다중 값
- AI 출력 `bidmate-ai-review/2`: item에 `variants: Array<{condition; value; quote}>` 필수(빈 배열 허용), 최대 8. 금액·기간 value 타입 `['string','null']`.
- 저장(AiSuggestion, ai-review.json schemaVersion 1 유지, 옵션 필드):
  ```ts
  variants?: Array<{ condition: string; value: unknown; quote: string; file?: string; page?: number|null; evidence?: EvidenceRef; valueInQuote: boolean }>;
  verdict: 'match' | 'differs' | 'new' | 'none' | 'multi'; // multi = value null + 검증 통과 variants ≥ 1
  ruleRelation?: 'in_candidates' | 'differs_from_candidates' | 'no_candidates';
  ```
  variant 검증은 본 항목과 같은 규칙. 실패 variant는 rejected에 `key: '<key>#<i>'`.
- Extraction 스키마 불변. `applySuggestion`에 `variantIndex?`: 선택 variant 값을 userEdited.value로, note는 `"[조건] " + 메모`.
- 화면: verdict 'multi'면 "조건별로 다름" 배지 + variants 표(조건/값/인용/[이 값 적용]). 요약은 "조건별 N개". `suggestionActions`는 value null이어도 variants 있으면 apply.
- 하위호환: 구 run 그대로 렌더. 파서는 run.promptVersion에 맞는 schema 태그 허용 목록.

## 6. 정확도 검증
### 6.1 정답표 `tests/fixtures/ai-eval/<noticeId>.json`
```ts
{ noticeId, title, textDir: string, items: Record<ExtractionKey, {
  expected: unknown | null; variants?: Array<{condition:string; value:unknown}>;
  evidenceLines: Array<{file:string; line:number}>;
  ambiguous?: string;  // 사람이 봐도 갈리는 경우(채점 제외)
}> }
```
- 사람(사용자) 확인 필수. 공고 5건(`C:/Users/admin/Documents/bidmate/notices/2026/`) + `tests/fixtures/docs/R26BK01722175`. 텍스트는 `tests/fixtures/ai-eval/text/<noticeId>/`에 복사.
### 6.2 오프라인(vitest)
1. 발췌 커버리지: 공고·모드(api/manual)별 발췌(또는 전문)에 evidenceLines 줄 텍스트가 모두 포함되는지.
2. 응답 리플레이: `tests/fixtures/ai-eval/responses/<noticeId>/<promptVersion>-<n>.txt`를 parse→verify에 넣어 expected 일치.
3. 프롬프트 린트(2.4).
4. 렌더링 단위 테스트(S4).
### 6.3 온라인 `scripts/ai-eval.ts`(Node, `GEMINI_API_KEY`)
- buildPrompt + 공급자 호출(engine/ai 재사용) + parse + verify 직접 호출, 저장 스토어 의존 금지.
- 입력: 정답표, provider/model, 모드(fulltext/excerpt), 반복 N(기본 3). 출력: 공고×항목 표(규칙/AI/정답/판정/토큰·시간) + 항목별 정답률 → `tests/fixtures/ai-eval/results/<promptVersion>-<model>-<date>.json`(응답은 리플레이 입력).
- 판정: `decide.valueKey`, variants는 집합 비교(조건 문자열 포함 관계), ambiguous 제외.
### 6.4 채택 기준
- 오프라인 전부 통과, 온라인 N=3 다수결로 항목별 정답률이 이전 이상(어느 항목도 1건 초과 하락 없음), 총 오답 감소. 공고 고유 어구 변경은 린트 거부. 통과 시 PROMPT_VERSION 올리고 결과 커밋.

## 7. 단계와 완료 조건
| 단계 | 내용 | 완료 조건 |
|---|---|---|
| S1 하네스 | 정답표 6건(사용자 확인), 커버리지 테스트, 프롬프트 린트, `scripts/ai-eval.ts`(Gemini) | v1.1.0 기준선 수치 저장, 커버리지 실패 공고 목록 확보 |
| S2 프롬프트 v2(텍스트만) | SYSTEM·ItemDef·7개 정의·예시 정책·D2(금액 string) — variants 없음(조건별이면 null+note) | 린트 통과, 정답률 ≥ 기선, R26BK01723328 performanceMinAmount가 25억을 고르지 않음 |
| S3 variants | 스키마 v2, parse/verify/AiSuggestion/apply(variantIndex)/UI/요약, ruleRelation 배지, 규칙 reason 'multi' | 리플레이로 variants 4개 검증, UI 개별 적용, 구 run 무회귀 |
| S4 렌더링 v2 | render-table.ts, render-text 중첩 태그, verify 맵 대조(한 묶음) | 렌더 단위 테스트, 중첩표 공고 재추출 후 경영상태 행과 배점이 한 행 |
| S5 전달 방식 | API 전문(+토글, 일괄 예상치), 수동 섹션 발췌 v2 | 커버리지 전 공고 통과(api·manual), 정답률 전문 ≥ 발췌 |
| S6 (선택) | 후보 동봉 A/B, 2단계 검토 | 4절 채택 조건 |

## 8. 파일 단위 작업
- **S1**: `tests/fixtures/ai-eval/*.json`, `tests/fixtures/ai-eval/text/<noticeId>/*.txt`, `tests/core/ai-eval-coverage.test.ts`, `tests/core/ai-prompt-lint.test.ts`, `scripts/ai-eval.ts`.
- **S2**: `src/core/ai/prompt.ts`(ItemDef·SYSTEM_PROMPT·`PROMPT_EXAMPLE_TOKENS`·`KIND_OF.performanceMinAmount='string'`·PROMPT_VERSION '2.0.0'), `src/core/ai/parse.ts`(coerceValue가 "25억원"·"500,000,000원" 모두 통과 확인), `src/core/ai/verify.ts`(10^k 보정 유지), `tests/core/ai-prompt.test.ts`.
- **S3**: `src/core/types/ai.ts`, `src/engine/ai/providers/schema.ts`, `src/core/ai/parse.ts`, `src/core/ai/verify.ts`(ctx.candidates), `src/engine/ai/ai-review-api.ts`, `src/background/router.ts`·offscreen, `src/ui/review/ai-view.ts`, `src/core/ai/summary.ts`, `src/entrypoints/dashboard/review/AiSuggestionBlock.tsx`, REASON_TEXT.
- **S4**: `src/core/doc/render-table.ts`, `src/core/doc/render-text.ts`, `src/core/ai/excerpt.ts`, `src/core/ai/verify.ts`.
- **S5**: `src/core/ai/constants.ts`, `src/core/ai/excerpt.ts`(`buildFullText`, 발췌 v2), `src/engine/ai/ai-review-api.ts`, 설정 타입·SettingsPage·일괄 예상치.

## 9. 금지
- 특정 공고 문구·숫자를 프롬프트에 넣지 않음(린트).
- AI에게 환산·합산을 시키지 않음.
- "표 안 값 우선" 같은 위치 규칙 재도입 금지. 우선순위는 문서 종류 간에만.
- Extraction 스키마(schemaVersion 2) 변경 금지.
- 하네스 없이 프롬프트 변경 금지(S1 선행). 한 공고 기준 채택 금지.
- S4는 render와 verify를 한 묶음으로. 중첩 태그는 깊이≥1에만.
- 후보 동봉은 A/B 결과 없이 금지.

## 10. 확인된 가정
- managementScore 하위 항목이 여럿이면 부문 소계 — 사용자 승인.
- "※ 해당 사업규모 … 이상" = 실적 1건 하한 — 사용자 승인. 정답표에는 ambiguous 주석 + variants 정답.
- API 기본 전문 전송(비용 증가) — 사용자 승인. 토큰 비율·비용은 실측 전 추정.
- Gemini responseJsonSchema의 중첩 배열 object 지원은 S3에서 1회 실측.
