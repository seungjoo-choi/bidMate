# 공고정보 검토 탭(13줄) 구현 명세

설계 결정: `.claude/specs/decisions.md` "2026-10-20 공고정보 검토 탭(필수 12개 항목)". 화면 목업: 접힌 목록 + 결정 필요 행 자동 펼침(메인 보관).

단계: S1 코어(implementer) → S2 UI 모델과 탭 라벨(implementer) → S3 쓰기 경로(implementer) → S4 화면(메인) → S5 마무리(test-runner). 순차 진행. 다른 세션의 AI 비교 작업이 같은 파일을 수정 중일 수 있으니 수정 직전에 해당 구간을 다시 읽는다.

## 0. 목표
검토 탭이 사용자 필수 12개 항목 + 경영상태 배점을 13행(잎 16개)으로 검토한다. 탭 이름 "공고정보 검토". 스키마 변경, 마이그레이션, 메시지 프로토콜 변경, 서버 변경 없음.

## 1. 공통 제약(모든 단계)
- `ExtractionKey`/`EXTRACTION_KEYS`에 키 추가 금지.
- `FieldValue`/`ExtractedItem`에 필드 추가 금지("확인함"은 파생).
- `reviewCountOf`, `pendingKeys`, handoff 게이트, 사이드패널 개수는 바꾸지 않는다.
- not_run 잎은 확인 필요로 세지 않는다.
- `false`, `0`은 값이다(null/undefined만 값 없음).
- 입찰참가자격등록 시작값을 postedAt으로 채우지 않는다.
- 코드 주석, 화면 문구에 가운뎃점(·) 금지. 나열은 쉼표, 짝 개념은 슬래시.

## 2. S1 코어 행 정의와 상태 판정 (implementer)

### 2.1 신규 `src/core/extraction/review-rows.ts`
```ts
export type ReviewLeafKey =
  | 'postedAt' | 'registrationDeadline' | 'proposalPeriod' | 'proposalEvalAt' | 'budgetAmount' | 'projectPeriod'
  | 'evalMethod' | 'differentialScoring' | 'credibilityScore' | 'managementScore'
  | 'performanceScore' | 'performancePeriod' | 'performanceMinAmount' | 'performanceCondition'
  | 'jointVentureAllowed' | 'priceMethod';
export type ReviewRowKey = Exclude<ReviewLeafKey, 'performancePeriod' | 'performanceMinAmount' | 'performanceCondition'>;
export const REVIEW_ROWS: ReadonlyArray<{ key: ReviewRowKey; sub?: ReviewLeafKey[] }> = [
  { key: 'postedAt' }, { key: 'registrationDeadline' }, { key: 'proposalPeriod' }, { key: 'proposalEvalAt' },
  { key: 'budgetAmount' }, { key: 'projectPeriod' }, { key: 'evalMethod' }, { key: 'differentialScoring' },
  { key: 'credibilityScore' }, { key: 'managementScore' },
  { key: 'performanceScore', sub: ['performancePeriod', 'performanceMinAmount', 'performanceCondition'] },
  { key: 'jointVentureAllowed' }, { key: 'priceMethod' },
];
export const REVIEW_LEAF_KEYS: ReviewLeafKey[];           // REVIEW_ROWS 평탄화 16개, 같은 순서(행 key 다음에 sub)
export const REVIEW_LABEL: Record<ReviewLeafKey, string>; // 공고게시일시, 입찰참가자격등록 마감, 제안서 제출기간, 제안서 평가일자, 사업금액, 사업기간, 평가방법, 차등점수제, 대외신인도 배점, 경영상태 배점, 수행실적 배점, 실적 인정기간, 실적 인정금액, 실적 인정조건, 공동수급 여부, 예가방법
export const REVIEW_ROW_LABEL: Partial<Record<ReviewRowKey, string>> = { performanceScore: '실적점수 평가' };
export type ReviewValueKind = 'score' | 'period' | 'amount' | 'text' | 'bool' | 'datetime' | 'joint';
export const REVIEW_KIND: Record<ReviewLeafKey, ReviewValueKind>;
// postedAt/registrationDeadline/proposalEvalAt=datetime, budgetAmount=amount, jointVentureAllowed=joint,
// proposalPeriod/projectPeriod/evalMethod/priceMethod=text, 문서 7개는 ui/review/view.ts ITEM_KIND와 같음
export const isExtractionLeaf: (k: ReviewLeafKey) => k is ExtractionKey; // EXTRACTION_KEYS 포함 여부
export const NOT_RUN_TEXT = '이전 버전 결과, 다시 추출 필요'; // ui/review/view.ts에서 이동, view.ts는 re-export

export type LeafState = 'verified' | 'needs_review' | 'user_edited' | 'covered' | 'not_run';
export interface LeafJudgement { state: LeafState; reason?: string; value: unknown; editedOrigin?: 'ai' | 'confirm' }
export function leafReviewState(notice: Notice, x: Extraction | null, key: ReviewLeafKey): LeafJudgement;
export function rowStateOf(leaves: LeafState[]): LeafState;
export function pendingLeafKeys(notice: Notice, x: Extraction | null): ReviewLeafKey[];
export const noticeReviewCount: (n: Notice, x: Extraction | null) => number;
export function rowKeyOf(leaf: ReviewLeafKey): ReviewRowKey; // sub 잎은 performanceScore
```

### 2.2 `leafReviewState` 규칙(위에서 아래로 첫 일치)
1. 문서 잎이고 `x?.items[key]`가 있으면 기존 `itemReviewState(x.items, key)`(src/core/extraction/review-count.ts:31) 결과를 쓴다. value = `item.userEdited?.value ?? item.value`. 상태가 not_run이면 reason `NOT_RUN_TEXT`. 이 경우 notice.evaluation은 보지 않는다.
2. 문서 잎이고 `x`가 null이면: `notice.evaluation[key].status === 'user_edited'`면 user_edited(value는 그 값), 아니면 not_run, reason `'문서 분석 전'`.
3. 공고 잎: `f = getField(notice, key)`(src/core/model/notice-fields.ts:30), `fieldReviewState(f, x, key)`(review-count.ts:41) 결과 매핑. user_edited→user_edited, verified→verified, covered→covered, needs_review→needs_review(reason = `f.note ?? '출처별 값이 서로 다름'`), missing→needs_review(reason `'공고정보에 값 없음'`, value null). f가 undefined면 missing과 같게.
4. editedOrigin(state가 user_edited일 때만): 문서 잎은 `userEdited.origin?.kind === 'ai'`면 `'ai'`. 그 외 저장값 == 자동값이면 `'confirm'`. 자동값: 문서 잎 = `item.value`, 공고 잎 = `f.userEdit?.before?.value`(없으면 confirm 아님). 비교는 `src/core/model/merge.ts`의 `sameKey`를 export해서 재사용(동작 불변, 복제 금지).

### 2.3 `rowStateOf`
우선순위 needs_review > not_run > user_edited > covered > verified. 하나라도 있으면 그 상태.

### 2.4 `pendingLeafKeys`
state === 'needs_review'인 잎, REVIEW_LEAF_KEYS 순서.

### 2.5 테스트 신규 `tests/core/review-rows.test.ts`
1. REVIEW_LEAF_KEYS 16개, 순서, 전부 `isEditableKey`(src/core/model/field-edit.ts:17) 통과.
2. 공고 잎: verified→verified / missing→needs_review reason '공고정보에 값 없음' / needs_review+note→reason이 note / user_edited(before 같은 값)→editedOrigin 'confirm' / user_edited(before 다른 값)→editedOrigin 없음.
3. 문서 잎: extraction 있을 때 itemReviewState와 같은 상태 / userEdited.origin.kind 'ai'→'ai' / userEdited.value == item.value→'confirm' / extraction null + notice.evaluation user_edited→user_edited / 그 외 null→not_run reason '문서 분석 전'.
4. rowStateOf 우선순위 5가지.
5. 불변식: extraction이 있으면 `pendingLeafKeys(n,x).filter(isExtractionLeaf)`가 `pendingKeys(x.items)`와 같다(여러 상태 조합).
6. covered(대외신인도/경영상태)는 pending에 안 들어감.
7. jointVentureAllowed false, budgetAmount 0 verified는 값 있음으로 verified.

## 3. S2 UI 뷰 모델과 탭 라벨 (implementer)

### 3.1 신규 `src/ui/review/rows.ts`
```ts
export interface ReviewLeaf {
  key: ReviewLeafKey; label: string; kind: ReviewValueKind; origin: 'document' | 'notice';
  state: LeafState; reason?: string; editedOrigin?: 'ai' | 'confirm'; note?: string;
  value: unknown; valueText: string; raw?: string; autoValueText?: string; // autoValueText: user_edited이고 자동값과 다를 때만
  sourceKind: 'api' | 'html' | 'document' | 'user' | 'derived' | 'none'; sourceText: string;
  evidence?: EvidenceRef; evidenceText?: string; // 문서 잎 EvidenceRef, 공고 잎 source.evidence 문자열
  candidates: CandidateModel[];                  // 2개 이상일 때만 채움
  ai?: AiCardInfo; aiOthers?: AiCardInfo[];      // 문서 잎만(AI 비교 작업이 CardModel에 추가한 필드가 있으면 같이 옮김)
  confirmable: boolean; // state==='needs_review' && value!=null && candidates.length<2
  aiFindable: boolean;  // origin==='document' && state==='needs_review'
}
export interface ReviewRow { key: ReviewRowKey; label: string; state: LeafState; pendingCount: number; head: ReviewLeaf; sub: ReviewLeaf[] }
export function buildReviewRows(notice: Notice, x: Extraction | null, ai?: Partial<Record<ExtractionKey, AiCardInfo>>, others?: Partial<Record<ExtractionKey, AiCardInfo[]>>): ReviewRow[];
export interface RowSummary { total: number; pending: number; done: number; edited: number; notRun: number } // 잎 기준. total 16, done = verified+covered+user_edited
export function summarizeRows(rows: ReviewRow[]): RowSummary;
export function formatLeafValue(kind: ReviewValueKind, value: unknown): string;
export function autoOpen(row: ReviewRow): boolean;
export function nextPendingRowKey(rows: ReviewRow[], after?: ReviewRowKey): ReviewRowKey | null;
```
- 상태와 value는 `leafReviewState`에서 받는다.
- 문서 잎(x 있음)은 기존 `buildCard`(src/ui/review/view.ts:60)를 호출해 CardModel의 evidence, candidates, note, ai 등을 ReviewLeaf로 옮긴다. x가 없으면 evidence 없음, candidates 빈 배열.
- 공고 잎 candidates: `FieldValue.candidates`가 2개 이상이면 `{ value, valueText: formatLeafValue(kind, value), sourceText: 출처 문구, evidence: undefined }`로 변환. CandidateModel의 evidence를 optional로 넓히고, 사용처(ItemCard의 "전체 텍스트에서 보기")는 evidence 있을 때만 보이게 한다.
- `formatLeafValue`: null/undefined만 '—'. datetime→기존 날짜시간 포맷 함수(src/ui 쪽 기존 것 재사용, 없으면 notice-detail/view.ts에서 쓰는 것), amount→`formatAmountFull`, joint→true '허용' / false '불허'(raw 있으면 뒤에 괄호로), 문서 7개 kind는 기존 `formatItemValue` 규칙.
- `sourceText`: 문서 잎 = `evidenceMeta(evidence)` 또는 값 없으면 '찾지 못함'. 공고 잎 = source.kind 기준 api/derived '나라장터 공고정보', html '나라장터 상세화면', document `문서, ${source.ref}`(ref 없으면 '문서'), user는 editedOrigin confirm이면 '확인함' 아니면 '직접 수정', 출처 없음 '—'.
- `autoValueText`: user_edited이고 editedOrigin이 confirm이 아니며 자동값이 있으면 그 포맷 문자열.
- `autoOpen`: row.state가 needs_review이거나, head/sub 중 ai.suggestion.verdict가 differs/new/multi이고 appliedAt/dismissedAt 둘 다 없으면 true.
- `nextPendingRowKey`: pendingCount>0인 행을 REVIEW_ROWS 순으로, after 다음부터 순환. 없으면 null.
- `pendingCount`: 행에 속한 잎 중 needs_review 수.

### 3.2 `src/ui/review/view.ts`
- `ITEM_LABEL`은 REVIEW_LABEL에서 문서 7개를 뽑아 정의(값 동일).
- `NOT_RUN_TEXT`는 review-rows.ts에서 re-export.
- `buildCards`, `summarize`, `rankOf`는 사용처를 rows.ts로 바꾼 뒤 삭제. 사용처가 검토 탭 밖에도 있으면 삭제하지 말고 보고.

### 3.3 `src/ui/notice-detail/view.ts`
- 검토 탭 항목(`detailTabs`, 현재 296~297행 부근): `{ id: 'review', label: '공고정보 검토', count: noticeReviewCount(notice, extraction) }`. extraction이 null이어도 count 계산.
- description 문구(118행 부근)의 "평가정보 검토 탭" → "공고정보 검토 탭".

### 3.4 테스트
- 신규 `tests/ui/review-rows.test.ts`: 행 13개, 잎 16개 순서 / 묶음 행 sub 3개와 pendingCount / confirmable, aiFindable 표 / formatLeafValue의 false, 0, null / autoOpen(needs_review, AI differs 미처리, AI 처리됨) / nextPendingRowKey 순환과 null / 공고 필드 candidates 변환 / sourceText 출처별.
- `tests/ui/view.test.ts`, `tests/ui/notice-detail-view.test.ts`: summarize, 라벨, count 기대값 갱신.

## 4. S3 쓰기 경로 (implementer, S2 뒤)
- `src/entrypoints/dashboard/notice/NoticeDetailPage.tsx`의 `edit`(현재 `extraction/edit` 호출, 71~80행 부근): `edit(key: ReviewLeafKey, value: unknown | null, note?: string, raw?: string)` → `send('notice/field-edit', { noticeId, key, value, ...(raw ? { raw } : {}), ...(note ? { note } : {}) })`. 응답 `{ notice, extraction }`을 기존 setData 방식대로 반영. 오류는 기존처럼 `{ code, message }`로 반환.
- `ReviewTab`의 `onEdit` prop 타입을 같은 시그니처로 바꾸고 ItemCard 호출부를 맞춘다(화면 구조는 S4에서 바꾸니 타입만).
- `extraction/edit` 메시지와 라우터 등록은 지우지 않는다.
- 서버 변경 없음. `tests/engine/notice-field-edit.test.ts` 통과 확인만.

## 5. S4 화면 (메인 직접)
- ReviewTab: extraction null 빈 화면 제거, 항상 13행. 상단 요약 = summarizeRows + [확인 필요 항목으로 이동] + (extraction null이면) [평가정보 분석] + AI 메뉴(힌트 "문서 항목 확인 필요 N개"/"문서 항목 7개 전체").
- 행 열림: `Record<ReviewRowKey, boolean>` 오버라이드, 유효값 `override[key] ?? autoOpen(row)`. 행이 pending에서 벗어나면 오버라이드 삭제.
- 행 DOM id `review-row-<key>`.
- 잎 결정 줄: needs_review+값+후보<2 → [직접 수정][AI로 찾기(문서)] … [「값」이 맞음] / 후보≥2 → 비교 칸 + [「값」으로 확정] / 값 없음 → [직접 입력][AI로 찾기(문서)] / AI differs/new/multi 미처리 → 지금 값 vs AI 두 칸 + [AI 제안 무시][「값」으로 확정] / verified, covered → [직접 수정] / user_edited → [자동 결과로 되돌리기][직접 수정] / not_run → 안내 한 줄.
- Editor는 `inputKindOf` + `parseFieldInput`(src/core/model/field-edit.ts:27, 100) 사용.
- 묶음 행: 잎 4개 패널 세로, 잎마다 결정 줄. 행 단위 확정 없음.

## 6. S5 마무리
- test-runner: `tsc --noEmit`, `tests/core`, `tests/ui`, `tests/engine/notice-field-edit.test.ts`, `tests/engine/ai-*`. 이후 `npm run build`.
- 완료 후 이 문서를 `specs/done/`으로 이동 제안.

## 7. 보고 형식(implementer)
결론, 변경 파일과 줄 범위, 테스트 결과, 명세와 다르게 한 점과 이유, 실패 항목. 한국어. 가운뎃점 금지.
