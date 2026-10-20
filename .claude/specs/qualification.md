# 자격 자동 판정 (qualification) 구현 명세

작성 2026-10-20. Fable 설계. 범위와 선택값은 `.claude/specs/prebid-features.md` 1절, 결정 근거는 `.claude/specs/decisions.md` "2026-10-20 입찰 전 기능 5종 방향". 이 문서만 보고 구현한다(대화 참조 없음).

## 목표
- 우리 회사 실적 목록을 저장 폴더 `config/performances.json`에 두고, 설정 화면에서 표로 편집하거나 고정 양식 엑셀로 가져온다.
- 공고 상세 개요 탭에 "참가 자격(실적)" 카드를 두고, 추출된 실적 인정기간, 인정금액, 인정조건과 실적 목록을 비교해 충족 / 미달 가능 / 확인 필요를 근거와 함께 보여 준다. 판정은 저장하지 않고 화면에서 계산한다.

## 확정 선택값 (바꾸지 않는다)
- 열 매핑 UI 없음. 고정 양식(아래 열 8개)을 설정 화면에서 내려받고, 사용자가 엑셀을 그 양식에 맞춘다. 가져오기 전 미리보기에서 잘못된 행을 표시하고 잘못된 행은 건너뛴다.
- 양식 열(순서 고정): 사업명(필수), 발주기관(필수), 계약금액(원, 필수, 실적증명서 계약금액 그대로, 부가세 포함), 착수일(필수), 완료일(필수, 진행 중이면 비움), 지분율(%)(선택, 비우면 100), 분야(선택), 비고(선택).
- 비교 금액 = 계약금액 × 지분율 ÷ 100(원 단위 반올림). 금액은 건당 비교. 완료일이 비어 있는 실적은 어떤 판정에도 세지 않고 "진행 중"으로만 표시한다.
- 기간 기준일 = 공고게시일(`basic.postedAt`). 실적은 완료일이 [기준일 − N년, 기준일] 안이면 기간 충족(날짜 단위 비교, 양끝 포함).
- 판정 문구는 "충족", "미달 가능", "확인 필요"(미달 확정 금지). 인정조건 원문이 있으면 항상 확인 필요. 인정기간 또는 인정금액이 충돌(conflict)이면 후보별로 여러 줄.
- 1차 범위 제외: 공고 목록 배지, "확인 필요"의 수동 확정 저장, 열 매핑, CSV, 가져오기 중복 검사, 착수일 기준 기간 판정, 지분율 무시 토글.

## 현재 코드 상태 (확인된 사실, 설계 근거)
- 추출 항목: `src/core/types/extraction.ts:7-30` ExtractionKey에 `performancePeriod`, `performanceMinAmount`, `performanceCondition`. `ExtractedItem { value, raw, status, reason, evidence, candidates?, userEdited? }`. 인정기간 규칙 `src/core/extraction/rules/default-rules.json:138-146` valueType `years` → 값은 `"N년"` 문자열(`src/core/extraction/strategies/window-regex.ts:10`). 인정금액 valueType amount → number. 인정조건 block-capture → 문자열.
- notice 평가 필드: `src/core/types/notice.ts:22-27` `evaluation.performancePeriod: FieldValue<string>`, `performanceMinAmount: FieldValue<number>`, `performanceCondition: FieldValue<string>`. 기준일 `basic.postedAt: FieldValue<ISODate>`(notice.ts:11).
- 검토 상태 판정 함수: `src/core/extraction/review-count.ts`의 `fieldReviewState(f, extraction, key)`(`src/ui/notice-detail/view.ts:29,57`에서 사용). 항목 라벨 `ITEM_LABEL`(`src/ui/review/view.ts`).
- 연수 파싱: `src/core/extraction/normalize.ts:36` `parseYears('5년')`, 금액 파싱 `parseKoreanAmount`(14행, "5억원", "500,000,000원", "1.5억원"). `src/core/model/amount.ts:2` `parseAmount`(콤마 숫자만).
- config 파일 전례: `src/engine/config/config-store.ts` `ConfigFile = 'recipients' | 'groups' | 'templates'`, `CONFIG_PATHS`, `CONFIG_LOCK = 'config'`, `loadList(store, file, normalize)`(없으면 빈 목록, 손상 CONFIG_CORRUPT, 버전>1 CONFIG_NEWER), `saveList`, `withConfigLock`, `repairConfig`. 사용 예 `src/engine/config/recipients-api.ts`(검증 err code INVALID_VALUE, NOT_FOUND, import 계획 적용 146-207행). `config/repair` 프로토콜 `src/messaging/protocol.ts:134` file 유니언이 문자열 리터럴로 중복 정의돼 있다.
- 메시지 릴레이: `src/background/router.ts:76-83` `EXTENSION_ONLY_TYPES`에 넣으면 SW가 확장 페이지 발신만 offscreen으로 중계한다. offscreen 리스너 `src/entrypoints/offscreen/main.ts:259-287`.
- 타입: `src/core/types/config-file.ts` `ConfigList<T>`, `ConfigWarnings`, `RecipientImportPlan/Summary` 패턴. id 생성 `newId(prefix)`(`src/core/model/ids.ts:18`).
- xlsx 읽기: `src/engine/parsers/xlsx.ts` `createXlsxParser(opts)`가 `DocParser`(`parse({ name, bytes, deadlineAt })` → `{ ok, doc: DocModel }`, `src/engine/parsers/types.ts:5-8`). 시트마다 `DocTable { cells: DocCell[] (r, c, text) }`. 셀 종류: 공유 문자열(t="s"), inlineStr, 그 외는 `<v>` 원문 텍스트(숫자, 날짜 일련번호, 소수 비율이 그대로 문자열로 옴. 날짜 서식 정보는 읽지 않음). 기본 `parseXml`은 `new DOMParser()`(`src/engine/parsers/xml-util.ts:6`)라 대시보드 페이지에서 그대로 쓸 수 있다. zip 해제는 `src/engine/parsers/zip.ts` `openZip`(fflate inflateSync). 셀 상한 20,000(`XLSX_MAX_CELLS`).
- xlsx 생성: fflate 0.8.3이 `zipSync`, `strToU8`를 제공한다. 외부 라이브러리 추가 없이 최소 OOXML(inlineStr 셀)로 .xlsx를 만들 수 있고, 위 파서가 inlineStr과 rels 경로를 읽으므로 자체 왕복 검증이 가능하다. 양식은 xlsx로 제공한다.
- 대시보드에 파일 선택(`<input type="file">`)과 다운로드(`Blob`, `URL.createObjectURL`) 코드는 아직 없다. 새로 만든다.
- 화면: 설정 `src/entrypoints/dashboard/SettingsPage.tsx` GROUPS(extra 그룹에 ai, company, notify), `SettingsSection` 유니언 `src/messaging/protocol.ts:45`, `settingsSectionOf`(`src/entrypoints/dashboard/route.ts:35-39`)의 허용 목록, `useSettingsStatus`(`src/entrypoints/dashboard/useSettingsStatus.ts`). 카드 패턴 `src/entrypoints/dashboard/CompanyCard.tsx`(Card, Field, inputClass, Button, FormActions, InlineAlert). 공통 컴포넌트 `src/ui/components/index.ts`(Button, Card, StatusBadge, Field, InlineAlert, Toast, ConfirmDialog, Select, EmptyState, FormActions).
- 개요 탭: `src/entrypoints/dashboard/notice/OverviewTab.tsx`(props notice, index, extraction. StatStrip → 일정 카드 → 2열 카드 → 넓은 카드). 뷰 함수 `src/ui/notice-detail/view.ts`(순수, React 금지). 금액 포맷 `formatAmountShort/Full/Comma`(`src/core/model/format.ts:6,18,77`), 날짜 `formatDate`(`src/ui/review/format.ts:20`).

## 불변 원칙
- 실적 목록 쓰기는 offscreen만, `withConfigLock`(CONFIG_LOCK 공용) 안에서. 읽기는 보정만 하고 쓰지 않는다.
- 판정은 순수 함수, 저장하지 않는다. 추출값을 바꾸거나 확정하지 않는다.
- "미달"을 단정하는 문구 금지. 인정조건 원문이 있으면 확인 필요.
- 엑셀 셀 값은 문자열로 받아 명시된 정규화 규칙으로만 해석한다. 해석 실패 행은 건너뛰고 이유를 보여 준다. 조용히 추측하지 않는다.
- 새 메시지, 새 설정 섹션은 추가만. Settings 타입 변경 없음.
- 가운뎃점(·) 금지.

## 데이터 모델

### 타입 `src/core/types/performance.ts` (신설)
```ts
import type { ISODate } from './common';
export type DateOnly = string;   // 'YYYY-MM-DD'
export interface PerformanceRecord {
  id: string;                    // newId('perf')
  title: string;                 // 사업명 1~200자
  client: string;                // 발주기관 1~100자
  amount: number;                // 계약금액(원, 부가세 포함), 정수 1 이상 1e13 미만
  startAt: DateOnly;             // 착수일
  endAt?: DateOnly;              // 완료일. 없으면 진행 중
  share?: number;                // 지분율 % (1~100). 없으면 100
  category?: string;             // 분야 ≤ 50자
  note?: string;                 // 비고 ≤ 500자
  source: 'excel' | 'manual';
  updatedAt: ISODate;
}
export type PerformanceInput = Omit<PerformanceRecord, 'id' | 'updatedAt' | 'source'> & { id?: string; source?: PerformanceRecord['source'] };
export interface PerformancesSnapshot { items: PerformanceRecord[]; warnings: string[] }
export interface PerformanceImportPlan { mode: 'append' | 'replace'; add: PerformanceInput[] }
export interface PerformanceImportSummary { added: number; removed: number; skipped: Array<{ row: number; reason: string }> }
export type PerformanceImportResult = PerformancesSnapshot & { summary: PerformanceImportSummary };
/** 비교 금액 = round(amount × (share ?? 100) / 100) */
export function compareAmountOf(p: Pick<PerformanceRecord, 'amount' | 'share'>): number;
```
- `endAt`이 있으면 `endAt >= startAt`이어야 한다(문자열 비교로 충분, 형식이 고정이므로).

### config 파일
- `src/engine/config/config-store.ts`: `ConfigFile`에 `'performances'`, `CONFIG_PATHS.performances = 'config/performances.json'`. 파일 형식은 `ConfigList<PerformanceRecord>`(schemaVersion 1).
- `src/messaging/protocol.ts:134` `config/repair` payload file 유니언에 `'performances'` 추가. 설정 화면 손상 안내(`CONFIG_CORRUPT` path로 복구 대상을 고르는 기존 UI, Grep `config/repair` in `src/entrypoints/dashboard`)에 performances도 고를 수 있게 같은 패턴으로 한 줄 추가.

### 정규화 `src/core/performances/normalize.ts` (신설, 순수)
```ts
/** 저장 파일 항목 보정. 필수가 깨지면 null(건너뜀). 선택 필드는 틀리면 제거 */
export function normalizePerformance(raw: unknown, fileUpdatedAt: string): PerformanceRecord | null;
/** 입력 검증. 실패 시 { code: 'INVALID_VALUE', message } 형태의 Error를 던진다. 통과하면 정규화된 값 */
export function validatePerformanceInput(input: unknown): Omit<PerformanceRecord, 'id' | 'updatedAt' | 'source'>;
```
검증 규칙: title/client trim 후 길이, amount는 정수(`Number.isInteger`) 1 이상 1e13 미만, startAt/endAt은 `/^\d{4}-\d{2}-\d{2}$/`이면서 실제 달력 날짜(UTC Date 재구성으로 검사), endAt < startAt이면 오류(normalize는 null), share는 정수 1~100(없으면 키 생략), category/note trim, 빈 문자열은 키 생략.

### 엑셀 셀 해석 `src/core/performances/sheet.ts` (신설, 순수, 파서 비의존)
```ts
export const SHEET_COLUMNS = ['사업명', '발주기관', '계약금액', '착수일', '완료일', '지분율', '분야', '비고'] as const;
export const SHEET_REQUIRED = ['사업명', '발주기관', '계약금액', '착수일'] as const;
export type SheetColumn = (typeof SHEET_COLUMNS)[number];
/** 머리글 정규화: 공백 제거, 괄호와 괄호 안 제거("계약금액(원)" → "계약금액", "지분율(%)" → "지분율") */
export function headerKeyOf(text: string): string;
/** 날짜 셀. 허용: "2024-03-01", "2024.03.01", "2024/3/1", "2024. 3. 1.", "20240301", "2024-03-01 00:00:00"(시각은 버림), 엑셀 일련번호("45352", "45352.0", 20000~80000 범위 → 1899-12-30 + n일, UTC). 결과 'YYYY-MM-DD', 실패 null */
export function parseSheetDate(text: string): DateOnly | null;
/** 금액 셀. 허용: "1748181818", "1,748,181,818", "1748181818원", "1.748181818E9"(Number 해석), "17억 4,818만원"(parseKoreanAmount). 소수는 반올림. 1 미만이나 1e13 이상은 null */
export function parseSheetAmount(text: string): number | null;
/** 지분율 셀. 빈 문자열 → 100. "70", "70%", "70.0" → 70. 0 < n <= 1 이면 엑셀 퍼센트 서식(0.7 → 70, 1 → 100). 정수로 반올림, 1~100 밖은 null */
export function parseSheetShare(text: string): number | null;
export interface SheetRow { row: number /* 1-based 엑셀 행 번호 */; input?: PerformanceInput; error?: string /* "완료일: 날짜 형식 아님" */ }
export type SheetParse = { ok: true; rows: SheetRow[]; valid: number; invalid: number } | { ok: false; error: string /* 머리글 누락 등 */ };
/** 표 셀 → 행. 머리글은 첫 번째 "비어 있지 않은" 행(위 2행 안에서 찾음). 열은 머리글 이름으로 찾고 순서는 무시, 모르는 열은 무시. 필수 머리글이 없으면 ok:false(누락 열 이름 포함).
 *  머리글 아래 행 중 모든 칸이 빈 행은 건너뜀. 필수 칸 빈 값 → error "사업명: 비어 있음". 착수일 > 완료일 → error. 오류가 여러 개면 첫 번째만 */
export function rowsFromCells(cells: Array<{ r: number; c: number; text: string }>): SheetParse;
```
셀 텍스트는 trim 후 해석. `parseSheetDate`가 받은 일련번호 소수부(시각)는 버린다.

### xlsx 입출력 `src/engine/performances/xlsx-io.ts` (신설)
```ts
/** 빈 양식 xlsx(머리글 1행 + 예시 1행). 예시 행: "OO시스템 구축", "OO공단", 350000000, "2024-03-01", "2024-12-31", 100, "정보시스템", "예시 행입니다. 지우고 쓰세요" */
export function buildTemplateXlsx(): Uint8Array;
/** 파일 바이트 → 첫 시트 셀 → rowsFromCells. 파서 실패나 시트 없음은 ok:false 메시지 */
export async function parsePerformanceXlsx(bytes: Uint8Array, opts?: { parseXml?: ParseXml }): Promise<SheetParse>;
```
- `buildTemplateXlsx`: fflate `zipSync`/`strToU8`로 엔트리 5개. `[Content_Types].xml`(Default rels, xml / Override `/xl/workbook.xml` sheet.main+xml, `/xl/worksheets/sheet1.xml` worksheet+xml), `_rels/.rels`(officeDocument → xl/workbook.xml), `xl/workbook.xml`(`<sheets><sheet name="실적" sheetId="1" r:id="rId1"/></sheets>`), `xl/_rels/workbook.xml.rels`(rId1 → worksheets/sheet1.xml), `xl/worksheets/sheet1.xml`(`<cols>`로 열 너비 지정 선택, `<sheetData>`에 행 2개, 문자열은 `t="inlineStr"><is><t>…</t></is>`, 숫자는 `<v>`). sharedStrings, styles 없음. XML 특수문자 이스케이프. zip 옵션 `{ level: 6 }`. 날짜는 문자열 "2024-03-01"로 넣는다.
- `parsePerformanceXlsx`: `createXlsxParser({ parseXml })`로 `parse({ name: 'import.xlsx', bytes, deadlineAt: Date.now() + 20_000 })`. `doc.blocks`에서 첫 `kind === 'table'` 블록의 `cells`를 `rowsFromCells`에 넘긴다. 파서 실패면 `{ ok: false, error: message }`.

### 판정 `src/core/qualification/judge.ts` (신설, 순수)
```ts
export type CriterionState = 'known' | 'unknown';   // known = verified 또는 userEdited 값 있음
export interface Criterion<T> { value: T | null; state: CriterionState; status: ExtractionStatus | FieldValue<unknown>['status']; note?: string /* "문서에서 찾지 못함", "문서 간 값이 다름" */ }
export interface Criteria {
  postedAt: DateOnly | null;
  periods: Array<Criterion<number>>;    // 연수. 충돌이면 후보별 1개씩(최대 4), 아니면 1개
  amounts: Array<Criterion<number>>;    // 원. 같은 규칙
  condition: { text: string | null; present: boolean };
}
/** extraction이 있으면 items에서, 없으면 notice.evaluation에서 만든다. userEdited 값 우선. 충돌(reason 'conflict')이고 candidates가 2개 이상이면 후보별로 unknown 상태 Criterion. '3년' 같은 문자열은 parseYears, 숫자는 그대로. 해석 실패는 value null + unknown */
export function criteriaOf(notice: Notice, extraction: Extraction | null): Criteria;

export type Verdict = 'met' | 'possibly_short' | 'review' | 'no_data';
export interface MatchedPerformance { p: PerformanceRecord; compareAmount: number; periodOk: boolean | null; amountOk: boolean | null }
export interface JudgeLine {
  period: Criterion<number> | null; amount: Criterion<number> | null;
  matched: MatchedPerformance[];   // periodOk !== false && amountOk !== false 인 완료 실적, compareAmount 내림차순
  verdict: Verdict;
  reasons: string[];               // 화면 근거 줄(아래 문구 규칙)
}
export interface Judgement { verdict: Verdict; lines: JudgeLine[]; inProgress: number; conditionText: string | null; total: number }
export function judge(criteria: Criteria, performances: PerformanceRecord[]): Judgement;
```
규칙:
- `total = performances.length`, `inProgress = endAt 없는 수`. total 0 → verdict `no_data`, lines [].
- 줄 = periods × amounts 조합(둘 중 하나가 비면 null로 채움). 최대 6줄, 넘으면 앞 6개.
- 줄의 실적 판정(완료 실적만): periodOk = period.value가 있으면 `endAt ∈ [postedAt − N년, postedAt]`(postedAt 없으면 null), 없으면 null. amountOk = amount.value 있으면 `compareAmountOf(p) >= amount.value`, 없으면 null. matched = periodOk !== false && amountOk !== false.
- 줄 verdict: criteria.condition.present → `review`. period 또는 amount 중 하나라도 `state === 'unknown'`(값이 있어도 needs_review면 unknown)이거나 postedAt null → `review`. 둘 다 null(기준 자체가 없음) → `review`. known이고 matched ≥ 1 → `met`. known이고 0 → `possibly_short`.
- 전체 verdict: 어느 줄이든 `met`이면 `met`(단 condition.present면 `review`), 아니면 모두 `possibly_short`면 `possibly_short`, 그 외 `review`.
- reasons 문구(줄마다, 순서대로):
  - 기간: `인정기간 ${N}년: 기준일 ${postedAt} 기준 ${from} 이후 완료 실적 ${k}건` / value null이면 `인정기간: 확인 필요 (${note})` / postedAt null이면 `공고게시일이 없어 기간을 판정할 수 없음`
  - 금액: `인정금액 ${formatAmountShort(min)} 이상: 비교 금액(계약금액 × 지분율) 충족 ${k}건` / null이면 `인정금액: 확인 필요 (${note})`
  - 조건: present면 `인정조건 원문이 있어 사람이 확인해야 합니다`
  - 상태가 unknown인데 값이 있으면 문구 끝에 ` (추출값 확인 필요)`.

## 프로토콜 (`src/messaging/protocol.ts`)
```ts
| { type: 'performances/list'; payload: void; response: PerformancesSnapshot }
| { type: 'performances/save'; payload: { performance: PerformanceInput }; response: PerformancesSnapshot }
| { type: 'performances/delete'; payload: { id: string }; response: PerformancesSnapshot }
| { type: 'performances/import'; payload: { plan: PerformanceImportPlan }; response: PerformanceImportResult }
```
- `src/background/router.ts` `EXTENSION_ONLY_TYPES`에 4개 추가(기본 릴레이).
- `SettingsSection`에 `'performances'` 추가, `route.ts` `settingsSectionOf` 허용 목록에도 추가.

## 엔진 `src/engine/config/performances-api.ts` (신설)
```ts
export async function listPerformances(store: IFileStore, opts?: ConfigOpts): Promise<PerformancesSnapshot>;
export function savePerformance(store: IFileStore, input: PerformanceInput, opts?: ConfigOpts): Promise<PerformancesSnapshot>;   // id 있으면 수정(없으면 NOT_FOUND), 없으면 추가(source 'manual')
export function deletePerformance(store: IFileStore, id: string, opts?: ConfigOpts): Promise<PerformancesSnapshot>;               // 없으면 NOT_FOUND
export function importPerformances(store: IFileStore, plan: PerformanceImportPlan, opts?: ConfigOpts): Promise<PerformanceImportResult>;
```
- `loadList(store, 'performances', (raw, at) => ({ item: normalizePerformance(raw, at), warnings: [] }))`, 건너뛴 수가 있으면 warnings에 `형식이 맞지 않는 실적 N건을 건너뛰었습니다`.
- 정렬: 저장 시 endAt 내림차순(없는 것 맨 위), 같으면 startAt 내림차순.
- import: `mode === 'replace'`면 기존 전부 제거(removed = 기존 수), `append`면 유지. `add`는 각 행을 `validatePerformanceInput`으로 검증, 실패는 `skipped.push({ row: i + 1, reason })`. source 'excel'. 중복 검사 없음. 변경 없으면 저장하지 않는다.
- offscreen `src/entrypoints/offscreen/main.ts`에 listen 4개(recipients 줄 옆).

## 화면

### 설정 > 실적 목록 `src/entrypoints/dashboard/PerformancesCard.tsx` (신설)
- `SettingsPage.tsx` GROUPS의 extra 그룹, company 바로 뒤에 `{ id: 'performances', label: '실적 목록', Icon: ClipboardList, card: () => <PerformancesCard /> }`(lucide `ClipboardList`).
- `useSettingsStatus`: `performances/list` 1회 조회(실패 무시) → 건수 N>0이면 `{ tone: 'ok', text: `${N}건` }`, 0이면 `{ tone: 'idle', text: '선택' }`.
- Card title "실적 목록", description "공고의 실적 인정기간과 인정금액을 우리 실적과 비교하는 데 씁니다. 계약금액은 실적증명서의 계약금액(부가세 포함) 그대로 적습니다."
- 상단 버튼 줄(FormActions 왼쪽 정렬): [빈 양식 내려받기](variant secondary, icon Download) [엑셀 가져오기](variant secondary, icon Upload) [실적 추가](icon Plus). 오른쪽에 "총 N건, 진행 중 M건" text-muted.
- 표(열): 사업명 / 발주기관 / 계약금액(formatAmountComma, 오른쪽 정렬, font-mono) / 지분율(없으면 "100%") / 비교 금액(formatAmountShort) / 착수일 / 완료일(없으면 StatusBadge idle "진행 중") / 분야 / 출처(엑셀, 직접) / [수정] [삭제]. 0건이면 `EmptyState title="등록된 실적이 없습니다" hint="빈 양식을 내려받아 채운 뒤 엑셀 가져오기를 누르거나, 실적 추가로 직접 입력하세요."`.
- 실적 추가/수정 폼: 표 아래 같은 카드 내부 접힘 영역(border-t). Field: 사업명(text), 발주기관(text), 계약금액(text, 콤마 허용, `parseSheetAmount`로 해석, 해석 결과를 입력칸 아래 formatAmountFull로 미리 보여 줌), 착수일(input type=date), 완료일(input type=date, 비우면 진행 중), 지분율(number 1~100, placeholder 100), 분야, 비고(textarea). [저장] [취소]. 검증 오류는 InlineAlert error로 서버 메시지 그대로.
- 삭제: `ConfirmDialog` "이 실적을 삭제할까요? 되돌릴 수 없습니다." → `performances/delete`.
- 빈 양식 내려받기: `buildTemplateXlsx()` → `new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })` → `URL.createObjectURL` → 임시 `<a download="bidmate-실적양식.xlsx">` 클릭 → `revokeObjectURL`.
- 엑셀 가져오기: 숨긴 `<input type="file" accept=".xlsx">` → `file.arrayBuffer()` → `parsePerformanceXlsx(new Uint8Array(buf))` → 미리보기 상태로 전환.
  - 미리보기(같은 카드 안, 표 자리를 대체): 머리글 "가져오기 미리보기: 정상 N행, 오류 M행". 표 열: 행 번호 / 상태(StatusBadge ok "정상" 또는 error "오류") / 사업명 / 발주기관 / 계약금액 / 착수일 / 완료일 / 지분율 / 오류 내용(오류 행만, text-danger). 오류 행은 배경 흐리게(bg-sunken). 20행 넘으면 "행 더 보기"로 20행씩.
  - 방식 라디오: "기존 목록에 추가"(기본) / "기존 목록을 비우고 교체". 교체 선택 시 InlineAlert warn "기존 실적 N건이 삭제됩니다."
  - [N행 가져오기](정상 0행이면 비활성) [취소]. 결과: InlineAlert ok "실적 N건을 가져왔습니다. 건너뛴 행 M." 뒤 목록으로 복귀.
  - 파일 수준 오류(ok:false): InlineAlert error `파일을 읽지 못했습니다: ${error}` + "빈 양식을 내려받아 같은 머리글로 저장하세요."
- 손상(CONFIG_CORRUPT, path config/performances.json): 기존 수신자 화면의 복구 안내 컴포넌트를 재사용해 [백업 후 초기화] 버튼(`config/repair` file 'performances').

### 공고 상세 개요 탭 카드 `src/entrypoints/dashboard/notice/QualificationCard.tsx` (신설)
- `OverviewTab.tsx`에서 사전규격이 아닐 때 "일정" 카드 바로 아래, 2열 카드 그룹 위에 전체 폭으로 배치. 데이터: `performances/list`를 탭 진입 시 1회 조회(실패 시 카드에 "실적 목록을 읽지 못했습니다" 한 줄, 판정 생략). `criteriaOf(notice, extraction)` → `judge(criteria, items)`.
- 뷰 모델 `src/ui/notice-detail/qualification-view.ts`(순수):
  ```ts
  export interface QualificationView { badge: { text: string; status: BadgeStatus }; headline: string; lines: Array<{ title: string; reasons: string[]; matched: Array<{ title: string; client: string; compareAmount: string; endAt: string }>; more: number }>; footnotes: string[]; settingsHref: string }
  export function qualificationView(j: Judgement, criteria: Criteria): QualificationView;
  ```
  - badge: met → ok "충족", possibly_short → warn "미달 가능", review → warn "확인 필요", no_data → idle "실적 없음".
  - headline: met "인정기간과 인정금액을 충족하는 실적이 있습니다" / possibly_short "조건에 맞는 실적을 찾지 못했습니다. 실적 목록과 추출값을 확인하세요" / review "자동으로 판정할 수 없는 항목이 있습니다" / no_data "실적 목록이 비어 있습니다".
  - 줄 제목: 줄이 1개면 빈 문자열, 여러 개면 `후보 ${i+1}: 인정기간 ${N}년, 인정금액 ${formatAmountShort}`(없는 쪽은 "없음").
  - matched 표: 최대 5건(compareAmount 내림차순), 열 사업명 / 발주기관 / 비교 금액 / 완료일. 5건 넘으면 more = K, 화면에 "외 K건".
  - footnotes: inProgress > 0 → `진행 중 실적 ${n}건은 판정에서 제외했습니다`; condition 있으면 `인정조건 원문: ${text 200자}`(검토 탭 링크 `#/notices/<id>/review`).
  - settingsHref `#/settings?section=performances`("실적 목록 관리" 링크, 카드 머리글 오른쪽).
- Card title "참가 자격(실적)" description "공고의 실적 인정기준과 우리 실적 목록을 비교한 참고 판정입니다. 최종 판단은 공고문과 실적증명서로 확인하세요."

## 단계

### S1 코어 (타입, 정규화, 시트 해석, 판정)
대상: `src/core/types/performance.ts`, `src/core/performances/normalize.ts`, `src/core/performances/sheet.ts`, `src/core/qualification/judge.ts`(모두 신설).
완료 조건: `npx tsc --noEmit`, 테스트:
- `tests/core/performance-normalize.test.ts`: normalizePerformance(필수 깨지면 null, share 범위 밖 제거, endAt < startAt이면 null), validatePerformanceInput(amount 소수 INVALID_VALUE, 1e13 INVALID_VALUE, 날짜 2024-02-30 INVALID_VALUE, share 0 INVALID_VALUE, 빈 category 키 생략), compareAmountOf(350,000,000 × 70% = 245,000,000, share 없음 = 원금).
- `tests/core/performance-sheet.test.ts`:
  1. headerKeyOf: "계약금액(원)" → "계약금액", "지분율 (%)" → "지분율", " 사업명 " → "사업명".
  2. parseSheetDate: "2024-03-01", "2024.03.01", "2024/3/1", "2024. 3. 1.", "20240301", "2024-03-01 00:00:00" 모두 '2024-03-01'. "45352" → '2024-03-01'(1899-12-30 + 45352일). "45352.5" → 같은 날. "2024-13-01", "abc", "1000", "99999" → null.
  3. parseSheetAmount: "1,748,181,818" / "1748181818원" / "1.748181818E9" / "17억 4,818만 1,818원" → 1748181818. "0", "-5", "1e13" → null. "3.5억" → 350000000.
  4. parseSheetShare: "" → 100, "70" → 70, "70%" → 70, "0.7" → 70, "1" → 100, "0" → null, "150" → null, "70.4" → 70.
  5. rowsFromCells: 머리글 순서 섞임과 모르는 열 허용, 필수 머리글 없으면 ok:false에 누락 열 이름 포함, 완전 빈 행 건너뜀, 필수 빈 칸 오류 문구 "사업명: 비어 있음", 착수일 > 완료일 오류, 완료일 빈 행은 input.endAt 없음(정상), 머리글이 2행에 있는 파일, 행 번호가 엑셀 기준 1-based.
- `tests/core/qualification-judge.test.ts`:
  1. criteriaOf: extraction verified '3년'/500000000 → known 1개씩. userEdited 우선. conflict + candidates 2개 → unknown 2개. not_found → value null unknown note. extraction null이면 notice 필드로. '최근 3년간' 문자열도 3.
  2. judge: postedAt 2026-09-11, 3년, 5억. endAt 2023-09-11(경계 포함) 7억 → met. endAt 2023-09-10 → 기간 탈락. 지분 70%로 비교 금액 4.9억 → 금액 탈락 → possibly_short. 진행 중 실적만 있음 → possibly_short + inProgress 1. 조건 원문 있음 → review(matched는 그대로 채움). period unknown → review. postedAt null → review. total 0 → no_data. 충돌 2후보 → lines 2개, 한 줄 met이면 전체 met. matched 정렬 내림차순. reasons 문구 고정 문자열 검사.

### S2 엔진, 프로토콜, xlsx 입출력
대상: `src/engine/config/config-store.ts`, `src/engine/config/performances-api.ts`(신설), `src/engine/performances/xlsx-io.ts`(신설), `src/messaging/protocol.ts`, `src/background/router.ts`, `src/entrypoints/offscreen/main.ts`, `src/entrypoints/dashboard/route.ts`.
완료 조건:
- `tests/engine/performances-api.test.ts`(recipients-api.test.ts의 메모리 store 패턴): save 추가(id, source manual, updatedAt), id 수정, 없는 id NOT_FOUND, delete, import append/replace(removed 수), skipped 행 번호와 이유, 변경 없으면 파일 미기록, 손상 파일 CONFIG_CORRUPT path, 정렬.
- `tests/engine/performances-xlsx.test.ts`: `buildTemplateXlsx()` 결과를 `parsePerformanceXlsx`로 다시 읽으면 ok이고 머리글 8개와 예시 행 1개가 input으로 해석된다(왕복). 기존 xlsx 파서 테스트가 쓰는 parseXml(Grep `createXlsxParser` in tests)을 같은 방식으로 주입한다. 빈 바이트 → ok:false.
- `tests/background/router.test.ts`에 performances/* 가 extension-only로 중계되는지 1건(기존 패턴 복제).

### S3 설정 화면
대상: `src/entrypoints/dashboard/PerformancesCard.tsx`(신설), `SettingsPage.tsx`, `useSettingsStatus.ts`, 손상 복구 안내 컴포넌트.
완료 조건: `npx tsc --noEmit`. 수동: 양식 내려받기 → Excel에서 열림 → 행 3개 입력(하나는 완료일 비움, 하나는 금액 오타) → 가져오기 미리보기에 정상 2, 오류 1 → 가져오기 → 표에 2건, 진행 중 1건 표시 → 수정/삭제 동작 → `config/performances.json` 생성 확인.

### S4 개요 탭 카드
대상: `src/ui/notice-detail/qualification-view.ts`(신설), `src/entrypoints/dashboard/notice/QualificationCard.tsx`(신설), `OverviewTab.tsx`.
완료 조건: `tests/ui/qualification-view.test.ts`(badge 4종, headline, 후보 제목, matched 5건 제한과 more, footnotes 2종). `npx tsc --noEmit`. 수동: 인정기간/금액이 추출된 공고에서 실적 금액을 바꿔 카드가 충족/미달 가능으로 갈리는지 확인. 실적 0건 → "실적 없음" + 설정 링크.

## 하지 말 것
- 열 매핑 UI, 머리글 추측 매칭(동의어). 머리글 이름은 양식 그대로만(괄호 제거와 공백 제거만 허용).
- 판정 결과를 notice.json, index.json, 어떤 파일에도 저장.
- "미달", "자격 없음" 같은 단정 문구. 카드가 공고를 숨기거나 흐리게 처리.
- 인정조건 텍스트를 규칙으로 해석해 판정에 반영.
- 추출값(items, notice.evaluation) 변경, userEdited 생성.
- SW에서 파일 읽기, 대시보드에서 config 파일 직접 쓰기.
- xlsx 생성에 외부 라이브러리 추가(fflate만). 양식의 날짜를 엑셀 일련번호로 쓰기.
- 지분율 100 초과 허용, 금액 소수 저장.
- 가운뎃점(·) 사용.

## 흔한 오해
- 엑셀이 날짜 칸을 날짜 서식으로 저장하면 `<v>`에 "45352" 같은 일련번호가 온다. 파서는 서식을 읽지 않으므로 `parseSheetDate`가 숫자 범위(20000~80000)로 판별한다.
- 엑셀 퍼센트 서식 칸은 "0.7"로 온다. `parseSheetShare`의 0 < n <= 1 분기가 그 경우다. "1"은 100%다.
- 큰 금액이 "1.748181818E9"로 올 수 있다. 콤마 제거 뒤 `Number()`로 해석한다.
- 공유 문자열 테이블이 없는 xlsx(우리 양식)도 파서가 읽는다(`xlsx.ts:53-59`).
- `performancePeriod` 값은 "3년" 문자열이다. `parseYears`로 바꾼다. userEdited 값은 "5년" 또는 5일 수 있으니 둘 다 받는다.
- 인정금액이 "사업규모 대비 비율"인 기관은 금액이 not_found다. 그때 확인 필요가 정상이다.
- 실적 3항목은 `fieldReviewState`의 'covered'에 해당하지 않는다. status와 userEdited만 본다.
- 기간 경계: 기준일 2026-09-11, 3년이면 2023-09-11 완료도 포함(양끝 포함). 날짜 문자열 비교로 충분하다.

## 보고 형식
결론, 변경 파일 경로(줄 범위), 테스트 결과, 명세와 다르게 한 점과 이유, 실패 항목. 한국어, 가운뎃점(·) 사용 금지.
