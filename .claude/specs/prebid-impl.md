# 입찰 전 기능 2·7·3 구현 명세

설계: fable-advisor 2026-10-22, 사용자 승인("설계대로 진행"). 결정 요약은 `decisions.md` "2026-10-22 · 입찰 전 기능 2·3·7 구현 설계". 범위·선택값 원문은 `prebid-features.md`.

사용자 확정값:
- 2: 신용평가 3종(기업신용·회사채·기업어음) 모두 받기 + 가점 예시 목록(`ATTRIBUTE_PRESETS`) + 직접 추가.
- 3: data.go.kr 개발계정 일일 1,000회 → `ORG_CALL_BUDGET = 200`(한도의 1/5) 유지, `ORG_YEARS = 3`.
- 원안과 다른 결정 2개 수용: 7 화면은 공고 상세 개요 탭 카드, 3 기관·분류 코드는 `Notice.codes?`(NoticeBasic 아님).

구현 순서: **2(S1~S4) → 7(S1~S2) → 3(S1 probe 도구 → 사용자 실측 → S2~S4) → 7 S3(기관 분포 연결)**.
같은 파일(`protocol.ts`, `router.ts`, `offscreen/main.ts`, `OverviewTab.tsx`, `notice.ts`, `openapi.ts`)을 고치는 단계는 순차로 위임한다.

공통: vitest는 반드시 `C:\workspace\bidMate`(대문자 C)에서 실행. 범위 밖 구조 변경이 필요하면 멈추고 보고. 보고는 한국어.

---

## 1. 기능 2. 예상 정량 점수

### 1.1 핵심 결정
| # | 결정 |
|---|---|
| D1 | 우리 점수는 항목별(경영상태, 대외신인도, 수행실적) 직접 입력. 배점은 `notice.evaluation.{managementScore,credibilityScore,performanceScore}`에서 읽고 등급·가점으로 자동 계산하지 않는다 |
| D2 | 신용평가등급은 3종 선택 맵 `company.credit?: Partial<Record<CreditKind, CreditGrade>>` |
| D3 | 가점 항목은 `company.attributes?: string[]` + 화면용 프리셋 상수(판정에 안 씀) |
| D4 | 저장은 `<folder>/estimate.json`, 쓰기는 offscreen 단일. `notice.json`/`index.json` 무변경 |
| D5 | 배점이 verified이고 값이 null(해당 없음)이면 입력칸 없이 "해당 없음" |
| D6 | 배점이 verified/userEdited가 아니어도 입력 허용, "배점 확인 필요" 표기, 합계는 입력된 항목만 |
| D7 | 등급·가점 항목은 카드에 참고 표시만 |

### 1.2 타입
`src/core/types/settings.ts:42` `company` 확장(추가만):
```ts
export type CreditKind = 'corporate' | 'bond' | 'cp';   // 기업신용평가 / 회사채 / 기업어음
export interface CreditGrade { grade: string /* 1~10자, 예 "BBB+", "A3" */; evaluatedAt?: string /* 'YYYY-MM-DD' */; agency?: string /* ≤30자 */ }
company: { bizNo: string; name?: string; credit?: Partial<Record<CreditKind, CreditGrade>>; attributes?: string[] /* 각 1~40자, 중복 제거, 최대 30개 */ };
```
`default-settings.ts` 기본값 `{ bizNo: '' }` 유지(`withDefaults`의 company 병합 그대로).

`src/core/types/estimate.ts`(신설):
```ts
export type EstimateKey = 'management' | 'credibility' | 'performance';
export const ESTIMATE_KEYS: EstimateKey[] = ['management', 'credibility', 'performance'];
export const ESTIMATE_FIELD: Record<EstimateKey, 'managementScore' | 'credibilityScore' | 'performanceScore'>;
export interface EstimateEntry { score: number; note?: string /* ≤200자 */; updatedAt: ISODate }
export interface EstimateFile { schemaVersion: 1; noticeId: string; items: Partial<Record<EstimateKey, EstimateEntry>>; updatedAt: ISODate }
```

`src/core/types/company.ts`(신설, 상수만):
```ts
export const CREDIT_KIND_LABEL: Record<CreditKind, string> = { corporate: '기업신용평가등급', bond: '회사채등급', cp: '기업어음등급' };
export const ATTRIBUTE_PRESETS = ['중소기업', '소기업', '여성기업', '장애인기업', '사회적기업', '벤처기업', '이노비즈', '메인비즈', '청년고용우수', '고용우수기업', '가족친화인증', 'ISO 9001', 'ISO 27001', 'SW 품질인증(GS)', '녹색인증', '기술혁신형 중소기업'] as const;
```

### 1.3 순수 함수 `src/core/estimate/estimate.ts`(신설)
```ts
export type MaxState = 'known' | 'review' | 'not_applicable' | 'missing';
export interface EstimateRow {
  key: EstimateKey; label: string;                // '경영상태' | '대외신인도' | '수행실적'
  max: number | null; maxState: MaxState;
  score: number | null; note: string | null;
  evidence: { file: string; location: string; text: string } | null;   // extraction.items[field].evidence
  hint: string | null;   // 경영상태: credit 요약 "기업신용평가등급 BBB+ (2026-03-01)"(있는 종류만, 쉼표). 대외신인도: attributes 쉼표 나열. 수행실적: null
  overMax: boolean;      // score > max (max known)
}
export interface EstimateSummary { rows: EstimateRow[]; filled: number; applicable: number; total: number | null; maxTotal: number | null; allKnown: boolean }
export function estimateRows(notice: Notice, extraction: Extraction | null, file: EstimateFile | null, company: Settings['company']): EstimateSummary;
export function validateScore(score: unknown, max: number | null): number;   // 유한수, ≥0, 소수 2자리 반올림, max 있으면 ≤max. 실패 시 code 'INVALID_VALUE' Error
export function normalizeEstimate(raw: unknown, noticeId: string): EstimateFile;   // 손상 시 빈 파일
```
규칙:
- maxState: userEdited가 있으면 그 값(null이면 not_applicable, 숫자면 known). 아니면 status 'verified' && number → known / 'verified' && null → not_applicable / number인데 verified 아님 → review / 그 외 missing. extraction이 있으면 `extraction.items[field]`의 userEdited 우선, 없으면 `notice.evaluation[field]`(기존 `fieldReviewState`와 같은 우선순위).
- total = 입력 score 합(소수 2자리), 0건이면 null. maxTotal = known max 합, 0건이면 null. allKnown = not_applicable 아닌 항목이 모두 known. applicable = not_applicable 아닌 항목 수.

### 1.4 엔진·프로토콜
`src/engine/estimate/estimate-store.ts`(신설):
```ts
export const estimatePath = (folder: string) => `${folder}/estimate.json`;
export async function getEstimate(store: IFileStore, noticeId: string): Promise<EstimateFile | null>;   // index에서 folder, 없으면 null. 파일 없음 null, 손상은 빈 파일로 보정(쓰지 않음)
export async function saveEstimate(store: IFileStore, p: { noticeId: string; key: EstimateKey; score: number | null; note?: string; max: number | null }, opts: { isBusy: (id: string) => boolean }): Promise<EstimateFile>;
```
- 공고 없음 `NOT_FOUND`, busy면 `editNoticeField`(notice-api.ts)와 같은 에러 코드(Grep으로 확인).
- `store.withLock(estimatePath(folder), …)` 안에서 read-modify-write. `score === null`이면 항목 삭제. `validateScore(score, max)`.
- `readJson/writeJson`(`src/engine/file-store/json-store.ts`).

`src/messaging/protocol.ts`:
```ts
| { type: 'estimate/get'; payload: { noticeId: string }; response: EstimateFile | null }
| { type: 'estimate/save'; payload: { noticeId: string; key: EstimateKey; score: number | null; note?: string; max: number | null }; response: EstimateFile }
```
`src/background/router.ts` `EXTENSION_ONLY_TYPES`에 2개. `src/entrypoints/offscreen/main.ts`에 `listen('estimate/get')`, `listen('estimate/save', (p) => saveEstimate(fileStore, p, { isBusy: <기존 공고 busy 판정> }))`.

### 1.5 화면
설정 `src/entrypoints/dashboard/CompanyCard.tsx`(같은 카드, 회사명 아래 구분선):
- "신용평가등급" 소제목, 3행(CREDIT_KIND_LABEL 순): 등급(text, placeholder "BBB+") / 평가일(date, 선택) / 평가기관(text, 선택). 세 칸 다 비면 그 kind 키 제거.
- "신인도 가점 해당 항목" 소제목. 프리셋 칩 토글(선택 칩 primary 테두리) + 직접 추가 input([추가], Enter). 최대 30개.
- 저장 버튼 기존 1개. 검증 오류 InlineAlert.
- 카드 description: "평가 점수 분석의 우리 회사 기준과, 공고 상세의 예상 정량 점수 참고 정보에 씁니다."

공고 상세 `src/entrypoints/dashboard/notice/EstimateCard.tsx`(신설), `OverviewTab.tsx` QualificationCard 바로 아래 `{kindOf(notice.ref) !== 'prespec' && <EstimateCard notice={notice} extraction={extraction} />}`.
- 진입 시 `estimate/get` 1회, `useSettings()`로 company. 실패 시 "예상 점수를 읽지 못했습니다".
- title "예상 정량 점수", description "정량평가 배점(추출값)에 우리 점수를 직접 적어 합계를 봅니다. 점수는 공고 문서의 등급표와 대조해 적으세요."
- 머리 오른쪽 StatusBadge `총 {total} / {maxTotal}점`(total null이면 idle "미입력"). allKnown false면 warn "배점 확인 필요".
- 표: 항목 / 배점(review면 "(확인 필요)", missing "—", not_applicable "해당 없음") / 우리 점수(number step 0.01, not_applicable이면 없음) / 참고(hint; 경영상태 등급 없으면 "설정에서 등급 입력" 링크 `#/settings?section=company`) / 근거([근거 보기] 토글 → file·location·text 인용, 없으면 "—").
- blur 또는 Enter에 `estimate/save`. 비우면 null. overMax면 text-danger "배점 {max}점을 넘습니다". 메모는 행 접힘(선택).
- 하단 "배점 출처: 공고정보 검토 탭" 링크 `#/notices/<id>/review`.

### 1.6 단계
- **S1 코어**: `types/estimate.ts`, `types/company.ts`, `core/estimate/estimate.ts`, `types/settings.ts` 확장. 테스트 `tests/core/estimate.test.ts`: maxState 4종+userEdited 우선 / total·maxTotal·applicable·allKnown, 0건 total null / validateScore(음수, 소수 3자리 반올림, max 초과, NaN) / hint 형식 / normalizeEstimate 손상→빈 파일.
- **S2 엔진**: estimate-store, protocol 2개, router, offscreen. 테스트 `tests/engine/estimate-store.test.ts`(기존 메모리 store 패턴): get 없음 null, 추가/수정/null 삭제, NOT_FOUND, busy 거부, 손상 읽기 빈 파일(쓰지 않음). router 테스트에 estimate/* 1건.
- **S3 설정 화면**: CompanyCard.
- **S4 카드**: EstimateCard, OverviewTab.
- 완료: tsc, 테스트 통과. 수동(사용자): 3항목 입력→합계→새로고침 유지→estimate.json 생성, 해당 없음 공고에서 행 "해당 없음".

### 1.7 하지 말 것
- 등급·가점으로 점수 계산·기본값(0 포함) 채우기 금지.
- notice.json·index.json·extraction.json에 점수 쓰기, userEdited 생성 금지.
- 배점 "확인 필요"여도 입력 차단 금지.
- 기능 1 "참가 자격(실적)"과 performanceScore는 별개. 값 공유 금지.
- not_applicable은 `status === 'verified' && value === null`로 판정.

---

## 2. 기능 7. 투찰가 시뮬레이터

### 2.1 핵심 결정
| # | 결정 |
|---|---|
| D1 | 순수 함수 `src/core/pricing/simulate.ts`, 저장 없음. 가격점수 = 배점 × 최저투찰가 ÷ 투찰가(`analyze.ts` `verifyPriceFormula`와 같은 식) |
| D2 | 화면은 공고 상세 개요 탭 카드(EstimateCard 아래, 입찰공고만) |
| D3 | `NoticeEvaluation.priceEvalRate: FieldValue<number>`(API `bidPrceEvlRt`), `EVALUATION_KEYS`에 추가. 옛 공고는 `priceEvalRateOf(notice)`가 evalMethod 문자열에서 보정 |
| D4 | 우리 투찰률 80~100% 0.5% 간격 표 + 임의 투찰률 1개 + 기술 격차 만회 투찰률 역산 |
| D5 | 경쟁 최저 투찰률 기본 88, 기능 3 완료 후 기관 분포 중앙값으로 대체(출처 표기) |
| D6 | 낙찰하한율 입력 시 미만 행은 `excluded: true`로 흐리게 + 경고(행 제거 안 함) |
| D7 | "가정" 블록과 평가 이력 공식 검증 비율 |

### 2.2 순수 함수 `src/core/pricing/simulate.ts`(신설)
```ts
export interface SimInput { priceWeight: number; base: number; rivalRate: number; lowerLimitRate?: number; ourRate?: number; techGap?: number /* 우리 − 경쟁 */ }
export interface SimRow { rate: number; amount: number; ourScore: number; rivalScore: number; diff: number; excluded: boolean; isRival: boolean }
export interface SimResult {
  rows: SimRow[];      // 80, 80.5, …, 100 + rivalRate 행(없으면 삽입), 오름차순
  custom: SimRow | null;
  pricePerCut: number; // priceWeight/100
  breakEven: { rate: number | null; amount: number | null; excluded: boolean; impossible: boolean; note?: string } | null;   // techGap 없으면 null
  warnings: string[];
}
export function simulate(i: SimInput): SimResult;
export function priceEvalRateOf(n: Notice): { value: number; source: 'api' | 'evalMethod' } | null;   // evaluation.priceEvalRate.value → evalMethod raw/value에서 /가격\s*(\d+(?:\.\d+)?)/ → null
export function defaultBaseOf(n: Notice): number | null;   // estimatedPrice.value(number)만. budgetAmount 사용 금지
export function formulaVerification(records: EvalRecord[]): { ok: number; total: number };   // total = official 있는 건수, ok = verifyPriceFormula(rec).ok
```
계산(q = 소수 4자리 반올림, analyze.ts `q`와 같은 방식). 우리 r, 경쟁 L, 배점 W:
- r ≥ L: ourScore = q(W×L/r), rivalScore = W. r < L: ourScore = W, rivalScore = q(W×r/L). diff = q(our − rival).
- amount = round(base × r / 100). excluded = lowerLimitRate 있고 r < lowerLimitRate.
- breakEven(G = techGap):
  - G ≥ 0(기술 우세, 가격에서 G까지 져도 됨): r = L×W/(W−G). G ≥ W면 `rate: null, impossible: false, note: '어떤 투찰률도 우세'`.
  - G < 0(기술 열세, 가격에서 |G| 이겨야 함): r = L×(W+G)/W. |G| ≥ W 또는 r ≤ 0이면 `impossible: true`.
  - rate가 있으면 amount·excluded 계산.
- warnings: priceWeight ≤ 0, base ≤ 0, rivalRate ∉ (0, 200] → 빈 rows + 경고. lowerLimitRate > rivalRate → "경쟁 최저 투찰률이 낙찰하한율보다 낮습니다. 분포 값을 확인하세요".

notice 변경: `src/core/types/notice.ts` `NoticeEvaluation`에 `priceEvalRate: FieldValue<number>`, `src/core/model/notice-fields.ts` `EVALUATION_KEYS`에 `'priceEvalRate'`, `src/adapters/g2b/openapi.ts` 평가방법 매핑 블록에 `set('priceEvalRate', num('bidPrceEvlRt'))`. 리뷰·라벨 맵에 키별 라벨이 필수인 곳(타입 오류로 드러남)은 '가격 배점'으로 채운다. 검토 행(13행)에는 추가하지 않는다.

### 2.3 화면 `src/entrypoints/dashboard/notice/PriceSimulatorCard.tsx`(신설)
`OverviewTab.tsx` EstimateCard 아래, 입찰공고만. 진입 시 `eval/get-many`(payload `{}`) 1회(실패 시 검증 비율 "확인 불가").
- title "투찰가 시뮬레이터", description "가격점수 공식(최저가 비례)에 따라 투찰률별 가격점수 차이를 계산합니다. 저장하지 않습니다."
- 입력(Field 가로 4개): 가격 배점(기본 priceEvalRateOf, 출처 "공고정보"/"평가방법 문자열에서 보정", 없으면 비움+경고 "가격 배점을 입력하세요") / 분모 금액(기본 추정가격, 편집 가능, 출처 표기) / 경쟁 최저 투찰률 %(기본 88, 출처 "기본값") / 낙찰하한율 %(선택).
- 역산: "기술점수 격차(우리 − 경쟁)" → "격차 −3.0점을 만회하려면 투찰률 {rate}% ({amount}) 이하" / impossible "가격으로 만회할 수 없는 격차입니다(가격 배점 {W}점)" / note 그대로 / excluded면 warn "낙찰하한율 미만입니다". G ≥ 0이면 "격차 +G점이면 투찰률 {rate}% ({amount})까지 올려도 동점".
- 표: 투찰률 / 투찰가 / 우리 가격점수 / 경쟁 가격점수 / 차이(양수 primary, 음수 warn). rivalRate 행 굵게+"경쟁 최저" 배지. excluded 행 text-faint+"하한 미만". 기본 접힘(rival 행 ±5행), [표 펼치기] 토글.
- "가정" 블록(bg-sunken): 1) 가격점수 = 배점 × 최저투찰가 ÷ 투찰가, 최저가 이하는 만점 2) 경쟁사는 최저 투찰률에 투찰한다고 가정 3) 분모는 {출처} 4) "이 공식은 저장된 평가 이력 {total}건 중 {ok}건에서 확인됨"(total 0이면 "검증할 평가 이력이 없습니다") 5) 투찰가 1% = {pricePerCut}점.
- 포맷은 `src/ui/notice-detail/price-sim-view.ts`(순수): 점수 2자리, 차이 부호, 출처 문구, 접힘 범위.

### 2.4 단계
- **S1 코어**: simulate.ts, notice 타입/키/openapi 매핑. 테스트 `tests/core/price-simulate.test.ts`: W=10, L=88 → r=88: 10/10/0, r=100: 8.8/10/−1.2, r=80: 10/9.0909/+0.9091 / amount 반올림 / lowerLimit 85면 80~84.5 excluded / breakEven G=−1.2 → 77.44, G=+1.2 → 100(=88×10/8.8), G=10 → rate null note, G=−10 → impossible / priceEvalRateOf(API 우선, "협상에의한계약 (기술 90 : 가격 10)" → 10, 둘 다 없음 null) / defaultBaseOf / formulaVerification(official 없는 레코드 total 제외) / openapi mapApiItem priceEvalRate 10 확인 1건.
- **S2 화면**: PriceSimulatorCard, price-sim-view, OverviewTab. 테스트 `tests/ui/price-sim-view.test.ts`(포맷, 접힘 범위).
- **S3(기능 3 완료 후)**: `org/get` 결과의 `orgLowestRate`로 기본값 대체, 출처 "기관 이력 N건 중앙값". PriceSimulatorCard만 변경.

### 2.5 하지 말 것
- 분모 기본에 budgetAmount(부가세 포함) 사용 금지.
- 입력값 저장 금지(localStorage 포함).
- 공식 미검증 기관이 있어도 계산은 보여 주고 "가정" 숫자로만 알린다.
- 공고에는 `priceWeightOf(EvalRecord)` 대신 `priceEvalRateOf(notice)`.
- 낙찰하한율(`sucsfbidLwltRate`) 자동 채움은 범위 밖.

---

## 3. 기능 3. 기관 이력과 예상 경쟁사

### 3.1 S0 probe 판단: 실측 필요
저장소에 기관 코드로 기간 검색하는 오퍼레이션·기간 상한·낙찰 목록 낙찰률 필드 근거가 없다. 확정된 것은 공고 응답의 `dminsttCd`, `ntceInsttCd`, `pubPrcrmntClsfcNo`, `bidPrceEvlRt`, `presmptPrce`(fixture `tests/fixtures/g2b-servc-R26BK01722175.json`).
추정값(상수로만 두고 probe 도구에서 덮어쓰기 가능): 공고 `BidPublicInfoService/getBidPblancListInfo{Kind}PPSSrch`, 낙찰 `ScsbidInfoService/getScsbidListSttus{Kind}PPSSrch`, `inqryDiv=1`, `inqryBgnDt`/`inqryEndDt`(`YYYYMMDDHHMM`), `dminsttCd`, 기간 상한 1개월. 한도 초과는 `returnReasonCode 22` / `LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR`로 추정.
낙찰률 필드 유무는 기존 진단 `result/probe`(ResultProbeTool)의 keys로 먼저 확인할 수 있다.

### 3.2 핵심 결정
| # | 결정 |
|---|---|
| D1 | 기준 수요기관 `dminsttCd`, 3년, 수동 [기관 이력 가져오기], 캐시 `orgs/<기관코드>.json` |
| D2 | 2단계 수집: A) 기관 기간 검색 공고 목록 + 낙찰 목록, B) 공고별 개찰결과(기존 `fetchOpening`)로 참여 업체. B는 남은 예산 안에서 최신 공고부터, 화면에서 선택 |
| D3 | 코드는 `Notice.codes?: NoticeCodes`(최상위 선택 필드, FieldValue 아님). 옛 공고는 `<folder>/source/api-<operation>.json`에서 보정 |
| D4 | 수집 오퍼레이션 종류(Servc/Thng/Cnstwk/Frgcpt)는 그 공고가 조회된 오퍼레이션을 따른다. 파일에 kind별 섹션 |
| D5 | 정정공고는 같은 noticeNo 최대 round만. 조인 키 noticeNo+round |
| D6 | 낙찰률 = `sucsfbidRate` 있으면 그 값, 없으면 낙찰금액÷추정가격×100, 둘 다 없으면 null. 출처 기록 |
| D7 | 한도 초과·오류 시 그때까지 모은 것을 `truncated: true`로 저장 + 경고 |
| D8 | 평가분석 연결 `competitorStrengths(records, ourBizNo, bizNos)` = `cumulative()` competitors를 기관 이력 업체로 필터 + 최근 공고 id. 항목별 강점은 보류 |
| D9 | 우리 전적은 B 참여 업체 행의 우리 bizNo 순위로(1위=낙찰), B 없으면 `IndexEntry.result`로 보충 |
| D10 | `parseResponse`에 한도 초과 → code `G2B_RATE_LIMIT` 분기(가산적), 실패 기록 `G2B_FLOWS`에 `'org'` 추가 |

### 3.3 타입 `src/core/types/org.ts`(신설)
```ts
export type OpKind = 'Servc' | 'Thng' | 'Cnstwk' | 'Frgcpt';
export interface NoticeCodes { demandOrgCode?: string; orderingOrgCode?: string; clsfcNo?: string; opKind?: OpKind }
export interface OrgBidder { bizNo: string; name?: string; rank: number | null; amount: number | null }
export interface OrgNotice {
  noticeNo: string; round: string; title: string; postedAt: ISODate | null; openingAt: ISODate | null;
  estimatedPrice: number | null; awardMethod: string | null; clsfcNo: string | null;
  winner: { bizNo: string; name: string | null; amount: number | null; rate: number | null; rateSource: 'api' | 'derived' | null } | null;
  participantCount: number | null;
  bidders: OrgBidder[] | null;   // null = B 미수집
}
export interface OrgHistoryKind { opKind: OpKind; fetchedAt: ISODate; range: { from: string; to: string }; notices: OrgNotice[]; truncated: boolean; calls: number; warnings: string[]; biddersFetched: number }
export interface OrgHistoryFile { schemaVersion: 1; orgCode: string; orgName: string; updatedAt: ISODate; kinds: Partial<Record<OpKind, OrgHistoryKind>> }
export const ORG_YEARS = 3;
export const ORG_NOTICE_CAP = 150;
export const ORG_CALL_BUDGET = 200;
```
`Notice`에 `codes?: NoticeCodes`. `openapi.ts`에 `codesOf(item, operation): NoticeCodes`. 수집 경로(collect-job의 `mapApiItem(` 호출 부근)에서 `notice.codes = codesOf(item, operation)`.

### 3.4 어댑터 `src/adapters/g2b/org-api.ts`(신설)
```ts
export const ORG_OPS = { noticeSearch: 'getBidPblancListInfo{Kind}PPSSrch', awardSearch: 'getScsbidListSttus{Kind}PPSSrch' } as const;
export const ORG_PARAMS = { inqryDiv: '1', begin: 'inqryBgnDt', end: 'inqryEndDt', org: 'dminsttCd', dateFormat: 'YYYYMMDDHHMM', windowDays: 30 } as const;
export const ORG_FIELDS = { rate: 'sucsfbidRate', estimatedPrice: 'presmptPrce', participants: 'prtcptCnum' } as const;
export function searchNotices(orgCode, kind, from, to, ctx): Promise<{ ok: true; items: ApiItem[]; calls: number } | { ok: false; error: JobError; calls: number }>;   // windowDays 창 순회, numOfRows 100 + totalCount 페이징
export function searchAwards(/* 같은 시그니처 */);
export function probeOrg(p: { orgCode: string; kind: OpKind; from: string; to: string; noticeOp?: string; awardOp?: string }, ctx): Promise<OrgProbeResult>;   // 1창만, keys/sample 3건/count/ms/error, op 이름 덮어쓰기 가능
```
`fetchJsonOp` 재사용.

### 3.5 순수 함수 `src/core/org/history.ts`, `summary.ts`, `src/core/evaluation/competitors.ts`(신설)
```ts
export function mergeOrgNotices(noticeItems: ApiItem[], awardItems: ApiItem[], openings: Map<string, OpeningRow[]>): OrgNotice[];   // 정정 최대 round, 낙찰 조인, D6, postedAt 내림차순, ORG_NOTICE_CAP
export interface WinnerRank { bizNo: string; name: string | null; wins: number; amount: number; lastAt: ISODate | null }
export interface FrequentBidder { bizNo: string; name: string | null; met: number; wins: number; ourWins: number | null; ourLosses: number | null }
export interface RateBucket { label: string; from: number; to: number | null; count: number }   // <80, 80~85, 85~90, 90~95, 95~100, 100 이상 (from 이상 to 미만)
export interface OrgSummary { noticeCount: number; awarded: number; withBidders: number; winners: WinnerRank[]; frequent: FrequentBidder[]; ourRecord: { met: number; wins: number; losses: number; source: 'bidders' | 'results' | 'none' }; rates: RateBucket[]; medianRate: number | null; lowestRate: { median: number; samples: number } | null }
export function orgSummary(k: OrgHistoryKind, ourBizNo: string | null, results: IndexEntry[]): OrgSummary;
export function orgLowestRate(k: OrgHistoryKind): { median: number; samples: number } | null;   // 공고별 min(bidders.amount)/estimatedPrice(없으면 winner rate)의 중앙값
export function competitorStrengths(records: EvalRecord[], ourBizNo: string | null, bizNos: string[]): Array<CompetitorRecord & { recentNoticeIds: string[] }>;   // analyze.ts 무변경
```

### 3.6 엔진·프로토콜·SW
- `src/engine/org/org-store.ts`: `orgPath(code) = orgs/<sanitizeSegment(code)>.json`, `getOrg`, `saveOrgKind`(락, kinds[opKind] 교체).
- `src/engine/org/org-fetch.ts` `fetchOrgHistory(store, { noticeId, serviceKey, withBidders }, deps)`: ① notice.codes, 없으면 `source/api-getBidPblancListInfo*.json`에서 codesOf 보정(notice.json은 쓰지 않음), 없으면 `ORG_CODE_MISSING` ② A: searchNotices+searchAwards, 누적 calls > ORG_CALL_BUDGET이면 중단 truncated ③ B: 남은 예산만큼 최신부터 `fetchOpening` ④ mergeOrgNotices → saveOrgKind. RATE_LIMIT은 truncated+warning+실패 기록(flow 'org').
- protocol:
```ts
| { type: 'org/get'; payload: { orgCode: string }; response: OrgHistoryFile | null }
| { type: 'org/fetch'; payload: { noticeId: string; withBidders: boolean }; response: OrgHistoryFile }   // 확장→SW(키 주입), 타임아웃 300_000
| { type: 'org/fetch-run'; payload: { noticeId: string; withBidders: boolean; serviceKey: string }; response: OrgHistoryFile }   // SW→offscreen
| { type: 'org/probe'; payload: { orgCode: string; kind: OpKind; from: string; to: string; noticeOp?: string; awardOp?: string }; response: OrgProbeResult }
```
- SW `src/background/org-relay.ts`(신설, `result-scheduler.ts`의 probe 중계와 같은 패턴: assertExtensionSender, secrets 키, 없으면 G2B_KEY_MISSING, offscreen 호출 동시 1개).

### 3.7 화면
- `route.ts` `NOTICE_TABS`에 `'org'`, `ui/notice-detail/view.ts` `detailTabs`에 입찰공고만 `{ id: 'org', label: '기관 이력' }`(review 앞), prespec이면 overview로. `NoticeDetailPage.tsx`에 `OrgHistoryTab`.
- `OrgHistoryTab.tsx`: codes 없으면 안내 "기관 코드가 없는 공고입니다. 다시 수집하거나 가져오기를 누르면 원본에서 찾습니다" → `org/get`. 머리: 기관명, 코드, kind, fetchedAt, 공고 N건(참여업체 M건), truncated면 warn. 버튼 [기관 이력 가져오기](예상 호출 `창 수 × 2`) [참여 업체까지](예상 `+min(공고수, 남은 예산)`).
- 블록: 1) 낙찰 업체 순위 2) 자주 참여한 업체(B 있을 때, competitorStrengths 전적, `#/evaluations` 링크) 3) 낙찰률 분포(ResultBars 방식 막대 6칸, 중앙값) 4) 공고 목록(최근 20건+더 보기).
- 뷰 모델 `src/ui/notice-detail/org-view.ts`(순수).
- 진단 `OrgProbeTool.tsx`: 기관코드(기본 Z004560), kind, from/to(기본 최근 1개월), 오퍼레이션 이름 2개 → 단계별 ok/count/keys/sample/ms/error. DiagnosticsPanel에 등록.

### 3.8 단계
- **S1 probe 도구**: org-api.ts(상수+probeOrg), types/org.ts, protocol `org/probe`, org-relay probe, OrgProbeTool, parseResponse G2B_RATE_LIMIT 분기 + openapi 테스트 1건.
- **(사용자 실측)**: Z004560으로 1개월·3개월 창 시험 → 오퍼레이션 존재, 기간 상한 오류 문구, 낙찰 목록 keys의 sucsfbidRate·presmptPrce 유무, ms를 decisions.md에 기록. 실패 시 오퍼레이션 이름만 바꿔 재시험.
- **S2 코어**(실측 반영 후): codesOf, Notice.codes, collect-job 1줄, history.ts, summary.ts, competitors.ts + 테스트(org-history, org-summary, competitors, codesOf).
- **S3 엔진/SW**: searchNotices/searchAwards, org-store, org-fetch, protocol 나머지, router, offscreen, org-relay fetch, G2B_FLOWS 'org' + 테스트(org-api 창 개수·페이징·예산 중단·RATE_LIMIT, org-fetch 보정·호출 수·truncated·kind 보존).
- **S4 화면**: 탭, OrgHistoryTab, org-view + `tests/ui/org-view.test.ts`.
- **S5**: 7 S3.

### 3.9 하지 말 것
- 자동 주기 조회·수집 잡 끼워 넣기 금지(수동 버튼만).
- `orgs/` 쓰기는 offscreen만.
- 업체 담당자 이름·전화 등 정의되지 않은 키 저장 금지(허용 목록 복사).
- 조달청 대행 공고는 `ntceInsttCd`가 조달청이므로 반드시 `dminsttCd`.
- 기간 검색 `inqryDiv` 의미는 실측 전 단정 금지.
- 기간 상한 1개월이면 3년 = 최소 72회 + 페이징. 예산이 부족하면 `ORG_YEARS` 축소를 사용자에게 제시.
