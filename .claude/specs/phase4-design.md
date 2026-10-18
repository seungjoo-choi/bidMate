# Phase 4 설계: 첨부문서 파싱/평가정보 추출 (Fable, 2026-10-17)

근거 자료: `.claude/specs/phase4-research.md`(실측). "가정"이라고 표시한 항목은 구현할 때 실측 1회로 확정한다.

## 0. 결론 요약
| 질문 | 결정 |
|---|---|
| 실행 위치 | offscreen **메인 스레드**에서 순차로 파싱한다. 파일/페이지 사이마다 `await yieldToLoop()`(setTimeout 0)로 실행권을 양보한다. 자체 Worker는 두지 않고, pdfjs 전용 worker만 쓴다(확장 패키지에 포함). architecture.md §1의 "DocumentParser(Worker)"를 이 결정으로 대체한다. |
| 중간 표현 | `DocModel`을 쓴다. 문단/표 블록으로 이루어지고, 셀은 r/c/rowSpan/colSpan을 가지며 중첩 표를 허용한다. `Grid` 헬퍼를 둔다. 모든 블록에 `loc`를 붙이고, 렌더 텍스트 `source/text/*.txt`의 줄 번호를 근거로 남긴다. |
| 선별 | 파일명 정규식으로 `docKind`와 우선순위를 정한다. 쌍둥이(hwp/hwpx와 pdf)는 hwp(x)만 파싱한다. zip은 1~4급 엔트리만 풀고, 중첩은 1단계까지만 연다. |
| 규칙 | JSON 규칙(strategy 5종 + 동의어 사전)과 strict 결정기로 처리한다. 후보 값이 2종 이상이면 value를 null로 두고 candidates에 담는다. |
| 결과 모델 | `Extraction`을 평탄화한다(`items: Record<ExtractionKey, ExtractedItem>`, 키는 NoticeEvaluation과 같다). notice.evaluation에는 `mergeDocumentLayer`로 병합한다. |
| 잡 | collect 잡에 선택 step `extract`를 넣고, 단독 `extract` 잡도 둔다. 둘 다 같은 `runExtractStep`을 호출한다. |
| 검수 UI | 대시보드 `#/review/<noticeId>`에 둔다. 플로팅 패널/사이드패널/팝업에는 "확인 필요 N건 [검수]" 한 줄만 보인다. |
| 불가 지점 | 스캔 PDF, HWP 3.x, 암호/배포용 HWP는 탐지해서 상태로 표시한다. OCR과 로컬 보조 프로그램은 넣지 않는다. |

## 1. 파서
### 1.1 실행 위치 이유
- DOMParser는 Worker에서 쓸 수 없다. 반면 HWPX/DOCX/XLSX는 XML이라 DOMParser가 필요하다.
- 실측 비용이 작다: HWP 4.9MB가 21ms, PDF 25쪽이 0.23s였다.
- offscreen이 `job/abort`/`job/status`에 응답해야 하므로 파일/페이지/zip 엔트리 사이마다 yield한다.
- 어댑터는 순수 함수(bytes → DocModel)로 만들어, 나중에 Worker로 옮길 수 있게 한다.

### 1.2 의존성/번들/CSP
- **추가할 의존성**: `pdfjs-dist@^4`, `fflate`(zip), `cfb`(OLE).
- **쓰지 않을 의존성**: SheetJS `xlsx`, `hwp.js`(실측 실패).
- **pdfjs**
  - 확장과 테스트 모두 `pdfjs-dist/legacy/build/pdf.mjs`를 쓴다.
  - worker/cmaps/standard_fonts는 `scripts/copy-pdfjs-assets.mjs`로 루트 `public/pdfjs/`(WXT public 디렉터리, 실측)에 복사한다. 이 경로는 `.gitignore`에 넣고, `postinstall`을 `wxt prepare && node scripts/copy-pdfjs-assets.mjs`로 바꾼다.
  - 런타임 설정: `GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdfjs/pdf.worker.min.mjs')`
  - 문서 열기: `getDocument({ data, cMapUrl: getURL('pdfjs/cmaps/'), cMapPacked: true, standardFontDataUrl: getURL('pdfjs/standard_fonts/'), isEvalSupported: false, disableFontFace: true, useSystemFonts: false })`
  - `isEvalSupported:false`는 MV3 CSP 때문에 필수다.
  - 확장 페이지가 자기 자산을 읽는 것이므로 web_accessible_resources는 필요 없다.
- **HWP5 압축 해제**: `new DecompressionStream('deflate-raw')`
- **CP949 파일명**: `new TextDecoder('euc-kr')`

### 1.3 어댑터 인터페이스 (`src/engine/parsers/types.ts`)
```ts
export type DocFormat = 'hwp5' | 'hwpx' | 'pdf' | 'docx' | 'xlsx' | 'txt';
export type Container = 'zip';
export interface ParseInput { name: string; bytes: Uint8Array; signal?: AbortSignal; deadlineAt: number }
export type ParseFailReason = 'unsupported' | 'encrypted' | 'drm' | 'scanned' | 'corrupt' | 'timeout' | 'cancelled';
export type ParseResult = { ok: true; doc: DocModel } | { ok: false; reason: ParseFailReason; message: string };
export interface DocParser { id: string; format: DocFormat; parse(input: ParseInput): Promise<ParseResult> }
export interface ParserRegistry { detect(name: string, head: Uint8Array, bytes: Uint8Array): DocFormat | Container | 'hwp3' | 'unknown'; get(format: DocFormat): DocParser }
export interface PdfEnv { workerSrc?: string; cMapUrl: string; standardFontDataUrl: string }
export function createParserRegistry(env: { pdf: PdfEnv; parseXml?: (xml: string) => Document }): ParserRegistry;
```
- **`detect`는 매직 바이트로 판정**한다. 확장자는 보조 수단이다.
  - `D0 CF 11 E0`: CFB를 열어 `FileHeader` 시그니처가 "HWP Document File"이면 hwp5, 아니면 unknown이다.
  - `50 4B 03 04`: zip 컨테이너다. 안의 엔트리로 다시 가린다.
    - `mimetype`=application/hwp+zip이거나 `Contents/section0.xml`이 있으면 hwpx
    - `word/document.xml`이 있으면 docx
    - `xl/workbook.xml`이 있으면 xlsx(xlsm 포함)
    - 그 외는 zip
  - `%PDF`: pdf
  - "HWP Document File V3": hwp3
- **공통 규칙**: `deadlineAt`을 넘기면 `timeout`, signal이 abort되면 `cancelled`를 결과로 반환한다(throw 금지). 파싱 중 예외는 `corrupt`로 반환한다.

### 1.4 형식별
**HWP5 (`parsers/hwp5/{cfb,records,parser}.ts`)**: 검증 스크립트 `.../scratchpad/libtest/hwp5.cjs`를 확장한다.
- **FileHeader**: offset 36의 UINT32 속성을 읽는다. bit0은 압축, bit1은 암호(→ `encrypted`), bit2는 배포용(→ `drm`)이다.
- **본문 스트림**: `BodyText/Section{n}`을 숫자 순서로 읽는다. 압축된 경우 deflate-raw로 푼다. `BodyText`가 없으면 `corrupt`다.
- **레코드 헤더**: tag 10bit, level 10bit, size 12bit다. size가 0xFFF면 다음 UINT32가 실제 크기다. 쓰는 태그는 66 PARA_HEADER, 67 PARA_TEXT, 71 CTRL_HEADER, 72 LIST_HEADER, 77 TABLE이다.
- **셀 소속은 level 스택으로 판정한다**(레코드 순서로 판정하는 것은 금지).
  - CTRL_HEADER의 ctrlId가 `' lbt'`면 level L에서 표 컨텍스트를 push한다.
  - 직후 TABLE(77)의 offset 4(UINT16)가 행 수, 6(UINT16)이 열 수다.
  - level L+1의 LIST_HEADER가 셀이다. 열은 @8, 행은 @10, **colSpan은 @12, rowSpan은 @14**다(가정 — f3 표에서 r1c0 rowSpan 2, 세부기준표 r1c2 colSpan 2가 나와야 맞다).
  - 더 깊은 level의 PARA_TEXT는 현재 셀에 속한다.
  - 같은 level 이하의 LIST_HEADER/CTRL_HEADER/PARA_HEADER가 나오면 셀을 닫는다.
  - 가장 가까운 열린 컨트롤이 tbl일 때만 셀로 취급한다. gso/머리말/각주의 LIST_HEADER는 일반 문단으로 흘린다.
- **표 안의 표**: 셀 안에 tbl 컨트롤이 있으면 셀의 `blocks`에 DocTable로 넣는다.
- **PARA_TEXT** (UTF-16LE):
  - 코드 {1,2,3,11,12,14,15,16,17,18,21,22,23}은 현재 문자를 포함해 16바이트를 건너뛴다.
  - 9는 16바이트를 건너뛰고 탭('\t')을 넣는다.
  - 10과 13은 줄바꿈이다.
  - (리뷰 정정) 4/5/6/7/8/19/20은 inline 컨트롤로 9와 같이 16바이트를 건너뛴다(9만 탭 출력). 30/31(묶음/고정폭 빈칸)은 공백. 그 밖의 32 미만(0, 24~29)은 1 WCHAR를 건너뛴다.
  - 표는 해당 문단 뒤에 블록으로 배치한다.

**PDF (`parsers/pdf.ts`)**
- **줄 구성**: 페이지마다 `getTextContent()`를 호출한다. 텍스트 아이템을 y좌표(transform[5], 허용오차 0.5×높이)로 묶어 줄을 만들고, 줄 안에서는 x좌표로 정렬한다.
- **공백 복원**: 같은 줄에서 간격이 0.3×높이보다 크면 공백을 넣는다. `\u0000`은 제거한다.
- **블록**: 줄 하나가 DocParagraph(`loc.page`)다. 표 구조는 복원하지 않는다.
- **판정**: 페이지당 비공백 문자 수가 20 미만이면 `scanned`다. 일부 페이지만 비어 있으면 warnings에 남긴다. `PasswordException`은 `encrypted`, `InvalidPDFException`은 `corrupt`다.
- **취소**: abort되면 `loadingTask.destroy()`를 호출한다. 페이지 사이마다 yield하고 signal과 deadline을 확인한다.
- **테스트**: PdfEnv에 node_modules 경로를 주입한다(`pdftext.mjs`와 같은 방식).

**HWPX (`parsers/hwpx.ts`)**
- fflate로 `Contents/section*.xml`을 꺼내 `parseXml`로 읽는다.
- 요소는 `localName`으로 찾는다: `p`, `t`, `tbl`(rowCnt/colCnt), `tr`, `tc`, `cellAddr`(colAddr, rowAddr), `cellSpan`(colSpan, rowSpan).
- Grid 생성 코드는 HWP5와 공유한다.

**DOCX (`parsers/docx.ts`)**
- `w:p`는 문단, `w:tbl/w:tr/w:tc`는 표다.
- `w:gridSpan@w:val`이 colSpan이다.
- `w:vMerge`(restart/continue)로 rowSpan을 계산하고, continue 셀은 위쪽 restart 셀에 합친다.
- 셀 안의 중첩 `w:tbl`은 재귀로 처리한다.

**XLSX/XLSM (`parsers/xlsx.ts`)**
- 읽는 순서: workbook → rels → `xl/worksheets/sheetN.xml`. 공유 문자열은 sharedStrings의 `si` 안 모든 `t`를 연결한다.
- 셀 주소 `c@r`은 r/c로 바꾸고, `@t`가 `s`면 sharedStrings, `inlineStr`이면 인라인 값을 쓴다.
- `mergeCells`로 span을 계산한다.
- 시트 하나가 DocTable 하나(`loc.sheet`)다. 시트당 셀 2만 개를 넘으면 warnings에 남긴다.

**TXT**: `TextDecoder('utf-8',{fatal:true})`로 읽고, 실패하면 euc-kr로 다시 읽는다.

**ZIP (`parsers/zip.ts`)**
```ts
export interface ZipEntryInfo { path: string; size: number; isDir: boolean }
export function listZip(bytes: Uint8Array): ZipEntryInfo[];         // 중앙 디렉터리만 읽음, inflate 없음
export function readZipEntry(bytes: Uint8Array, path: string): Uint8Array;
```
- **파일명 디코딩**(가정): fflate는 UTF-8 플래그가 없는 이름을 latin1로 돌려준다. 문자코드가 모두 256 미만이고 128 이상인 문자가 섞여 있으면 바이트로 되돌려 euc-kr로 재디코딩한다. CP949 zip 픽스처로 검증하고, 이 가정이 틀리면 `@zip.js/zip.js`로 교체한다(인터페이스는 동일).
- **상한**: 엔트리 200개, 중첩 1단계, 전개 총량 200MB.

### 1.5 대용량/타임아웃/취소
- **기본값**: `settings.extraction = { budgetMs: 90000, fileTimeoutMs: 20000, maxParseMB: 50 }`. 기존 settings.json에 이 항목이 없으면 기본값으로 채운다.
- **크기 초과**: `maxParseMB`를 넘는 파일은 `skipped/too_large`로 둔다.
- **예산 소진**: 남은 파일은 `skipped/budget`으로 둔다.
- **취소**: 잡 signal을 모든 어댑터에 전달한다. 취소되면 step은 `cancelled`가 되고, 그때까지의 notice.json은 저장한다.

## 2. 중간 표현 (`src/core/doc/model.ts`, `grid.ts`, `render-text.ts`)
```ts
export interface DocLoc { page?: number; sheet?: string; section?: number | string; block: number; line?: number }
export interface DocParagraph { kind: 'p'; text: string; loc: DocLoc }
export interface DocCell { r: number; c: number; rowSpan: number; colSpan: number; text: string; blocks: DocBlock[]; loc: DocLoc }
export interface DocTable { kind: 'table'; index: number; rows: number; cols: number; cells: DocCell[]; caption?: string /* 직전 문단 ≤80자 */; loc: DocLoc }
export type DocBlock = DocParagraph | DocTable;
export interface DocModel { format: DocFormat; blocks: DocBlock[]; pages?: number; warnings: string[]; stats: { chars: number; tables: number; ms: number } }
export class Grid {
  constructor(t: DocTable);
  at(r: number, c: number): DocCell | undefined;   // 병합 영역이면 소유 셀
  ownCells(r: number): DocCell[];                   // 그 행에서 시작하는 셀만, c 오름차순
  headerRow(): { r: number; cells: DocCell[] };     // 0행. 0행이 colSpan=cols 단일 셀이면 1행
  rowText(r: number): string;                       // ' | ' 결합
}
export function allTables(doc: DocModel): DocTable[];   // 중첩 포함
export function renderText(doc: DocModel): string;      // 문단=줄, 표=`[표 k]`, 셀=`[셀 r c]`(+` rs2`/` cs2`), PDF=`[p N]`. 각 블록 loc.line을 채운다
```
- 렌더 결과는 `notices/<folder>/source/text/<index>_<savedName>.txt`에 저장한다. zip 엔트리는 `<index>_<zipName>__<sanitize(inner)>.txt`이고, 파일당 2MB를 넘으면 잘라 내고 warning을 남긴다.

## 3. 선별 (`src/core/extraction/classify.ts`)
```ts
export type DocKind = 'eval_criteria' | 'notice' | 'rfp' | 'qna' | 'other' | 'form' | 'reference';
export interface Classified { kind: DocKind; priority: number /* 1..5, 0=파싱 안 함 */ }
export function classifyName(name: string): Classified;
export function planFiles(attachments: Attachment[]): Array<{ attachment: Attachment; classified: Classified; action: 'parse' | 'skip'; skipReason?: 'excluded' | 'duplicate' | 'not_saved' | 'unsupported_ext' }>;
```
**분류 규칙**(위에서부터 먼저 맞는 것을 쓴다):

| 순서 | 파일명 정규식 | 종류 | 우선순위 |
|---|---|---|---|
| 1 | `/양식\|서식\|내역서\|투찰/` | form | 0 |

| 3 | `/평가\s*기준\|배점\|정량\s*평가\|평가\s*표\|평가\s*항목/` | eval_criteria | 1 |
| 4 | `/입찰\s*공고\|공고문\|공고서/` | notice | 2 |
| 5 | `/제안\s*요청\|RFP\|과업\s*(내용\|지시\|설명)서\|사업\s*설명서/i` | rfp | 3 |
| 6 | `/질의\|답변\|Q&A\|FAQ/i` | qna | 4 |
| ※ | 최종 순서(메인, 리뷰 반영) | form → `/정정\s*공고/` notice → qna → reference → eval → notice → rfp | '제안요청서 질의 답변'/'(참고) 질의답변'은 qna, '정정공고문(질의회신 반영)'은 notice |
| 7 | (그 외) | other | 5 |

**처리 규칙**
- **확장자**: hwp/hwpx/pdf/docx/xlsx/xlsm/txt/zip이 아니면 `unsupported_ext`로 표시하고 목록에만 남긴다.
- **other(5)**: 파싱한다. 예산이 모자라면 우선순위가 낮은 파일부터 잘린다.
- **form/reference**: 파싱하지 않는다. 이 공고의 f4/f5/f7이 여기에 해당한다.
- **쌍둥이**: 확장자를 뺀 이름(공백/괄호 정규화)이 같은 hwp/hwpx와 pdf가 함께 있으면 pdf는 `skipped/duplicate`로 둔다. hwp 파싱이 실패하면 그때 pdf로 폴백한다.
- **zip**: form/reference로 분류되지 않은 zip만 `listZip`으로 연다. 엔트리도 같은 규칙으로 분류해 1~4급만 풀고, other는 풀지 않는다. 중첩 zip은 1단계까지만 열고, 풀어낸 엔트리는 `ExtractionFile.innerPath`에 기록한다.
- **docKind 기록**: `Attachment.docKind`를 DocKind로 확장하고, 추출 step에서 값을 채워 저장한다.

## 4. 규칙 엔진 (`src/core/extraction/`)
### 4.1 정규화 (`normalize.ts`)
- `compact(s)`는 다음 순서로 처리한다: NFC 정규화 → `\u0000`/zero-width 문자 제거 → `：`를 `:`로 바꿈 → **모든 공백 제거**. 규칙 정규식은 compact된 텍스트를 대상으로 작성한다.
- evidence에는 항상 원문을 저장한다. compact된 텍스트는 저장하지 않는다.
- 숫자 해석 함수:
  - `parseKoreanAmount`: '5억원', '5억 5천만원', '500,000,000원', '3천만원'을 원 단위 숫자로 바꾼다.
  - `parseYears('5년')`는 5를 돌려준다.

### 4.2 규칙 파일 (`rules/schema.ts`, `rules/default-rules.json`, `rules/load.ts`)
```ts
export interface RuleSet { version: string; synonyms: Record<string, string[]>; rules: Rule[] }
type Base = { id: string; target: ExtractionKey | `extras.${string}`; docKinds?: DocKind[]; weight?: number; conflictPolicy?: 'strict' | 'prefer_priority' }
export type Rule = Base & (
  | { strategy: 'table-score'; label: string; scoreHeader: string; excludeLabel?: string }
  | { strategy: 'inline-score'; label: string; maxGap: number }
  | { strategy: 'keyword-enum'; pattern: string; map: Record<string, boolean | string> }
  | { strategy: 'window-regex'; anchor: string; pattern: string; blocksAfter: number; valueType: 'amount' | 'years' | 'number' | 'string' }
  | { strategy: 'block-capture'; anchor: string; stopAt: string; maxBlocks: number; maxChars: number }
);
```
**동의어 사전**

| 키 | 동의어 |
|---|---|
| credibility | 대외신인도, 신인도, 경영상태, 신용평가등급, 신용평가, 신용도 |
| performance | 수행실적, 실적평가, 유사사업, 유사용역, 사업수행실적, 실적 |
| scoreHeader | 배점, 배점한도, 점수 (`평점`은 넣지 않는다) |
| perfAnchor | 유사사업, 실적인정, 수행실적, 실적 |

**기본 규칙**

| # | 규칙 id | strategy | 대상 | 핵심 내용 |
|---|---|---|---|---|
| 1 | `cred.table` | table-score | credibilityScore | label=credibility |
| 2 | `perf.table` | table-score | performanceScore | label=performance |
| 3 | `cred.inline` / `perf.inline` | inline-score | 위와 같음 | compact 텍스트에서 `{{label}}[^0-9]{0,20}?(\d+(?:\.\d+)?)점`. weight가 낮다 |
| 4 | `diff.enum` | keyword-enum | differentialScoring | 아래 참고 |
| 5 | `perf.period` | window-regex | performancePeriod | anchor=perfAnchor, blocksAfter 3, years |
| 6 | `perf.amount` | window-regex | performanceMinAmount | amount |
| 7 | `perf.condition` | block-capture | performanceCondition | maxBlocks 6, maxChars 600, prefer_priority |

규칙별 정규식:
- **`diff.enum`**: `차등점수제[^가-힣]{0,6}?(?<v>미적용|적용하지않|적용안함|비적용|적용)`. 매핑은 미적용/적용하지않/적용안함/비적용 → false, 적용 → true다. 교대(|) 순서가 곧 우선순위다.
- **`perf.period`**: `(최근|입찰공고일기준|공고일(전일)?기준)?(?<v>\d{1,2})년(이내|간)`. value는 `"5년"`, raw는 매칭된 원문이다.
- **`perf.amount`**: `(?<v>\d+(?:[.,]\d+)?(?:억|천만|백만|만)?원)이상`. "15억원"처럼 뒤에 "이상"이 없으면 제외된다.
- **`perf.condition`**
  - anchor: `^※?유사사업[:：]|실적인정(대상|범위|기준)|유사사업(이란|의범위|정의)`
  - stopAt: `^※|^[가-힣]\.|^\d+\.|^□|^○` (앵커 블록 자신은 제외)

**로더**: 번들 기본 규칙에 루트 `config/extraction-rules.json`을 id 기준으로 덮어쓰거나 추가한다. 파일이 없으면 무시한다.


### 4.2-a 리뷰 반영 정규식 (메인 확정, 2026-10-17 — 아래가 위 원안을 대체)
- `diff.enum` (첫 매치 채택, 라벨 바로 뒤만, 서식 문구 `(적용/미적용)`만 있으면 후보 아님):
  `차등점수제(?:적용(?:여부|유무))?(?:\((?:미?적용)[/／](?:미?적용)\))?[^가-힣]{0,6}(?<v>미적용|적용하지않|적용안함|비적용|적용제외|해당없|적용)(?![/／])` — map: 적용만 true, 나머지 false
- `perf.amount`: `(?<![\d.조억만천백])(?<!\d,)(?<v>(?:\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?:조|억|천만|백만|만|천)?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:천만|백만|만|천))*원)이상`
- `perf.period`: `(최근|입찰공고일기준|공고일(전일)?기준)?(?<!\d)(?<v>\d{1,2})년(이내|간)`, perfAnchor 동의어에서 단독 '실적' 제거
- `perf.condition` anchor: `^※?유사사업[:：]|실적인정(대상|범위|기준)|유사사업(이란|의범위|(의)?정의(?!에|와|가|를|로|하))`. block-capture는 모든 앵커, 직전 캡처 범위 안 앵커는 건너뜀, 본문 없는 캡처는 버림
- table-score 라벨: 점수 열 왼쪽 + ownCells + compact 40자 이하, 행 루프는 Grid.rows. 점수 셀 `^(\d+(?:\.\d+)?)점?(?:\(.{0,10}\)|만점)?$`
- 실측 사례: `tests/extraction/regex-cases.test.ts`
- 알려진 한계: 짧은 설명 셀(≤40자)에 라벨 단어가 있으면 후보가 됨(strict라 conflict로 드러남). 사용자 패턴 중첩 수량자 휴리스틱은 완전한 ReDoS 방어가 아님(로컬 설정이라 위협은 사용자 본인).

### 4.3 table-score
1. `allTables`로 모든 표를 돌며 표마다 Grid를 만든다.
2. `headerRow()`에서 scoreHeader 동의어와 맞는 열 `sc`를 찾는다. 없으면 그 표는 건너뛴다.
3. 헤더 다음 행부터, 그 행에서 시작하는 셀(`ownCells(r)`) 중 sc 열이 아닌 셀의 텍스트가 label 동의어와 맞는지 본다.
4. 맞으면 `grid.at(r, sc)`의 compact 텍스트가 `^(\d+(?:\.\d+)?)점?$`일 때 후보로 삼는다.
5. 근거: location은 `표{index} r{r}c{sc}`, evidence는 점수 셀 원문, context는 `rowText(r)`다.

**ownCells를 쓰는 이유**: 병합 영역의 소유 셀(예: "정량평가(10점)")을 라벨 후보로 쓰면 그 텍스트가 모든 행에 붙는다. 헤더 행은 데이터로 쓰지 않는다.

### 4.4 결정기 (`decide.ts`)
```ts
export interface Candidate { target: string; value: unknown; raw?: string; evidence: EvidenceRef; priority: number; weight: number; docKind: DocKind }
export function decide(cands: Candidate[], rules: RuleSet): { items: Record<ExtractionKey, ExtractedItem<unknown>>; extras: Record<string, ExtractedItem<unknown>> }
```
**값 비교 키**: number/boolean은 값 그대로, years/amount는 정규화한 값, string은 compact한 앞 40자를 쓴다.

**판정 규칙**

| 상황 | 결과 |
|---|---|
| 후보 0개 | `{value:null, status:'needs_review', reason:'not_found'}` |
| 값이 1종 | `verified`. evidence는 정렬(문서 priority 오름차순 → weight 내림차순 → 등장순)한 첫 후보, 나머지는 candidates |
| 값이 2종 이상, strict | `{value:null, status:'needs_review', reason:'conflict', candidates}` |
| 값이 2종 이상, prefer_priority | value는 최우선 후보, `status:'needs_review'`, `reason:'conflict'` |
| 유일한 후보가 qna 문서 | `needs_review/low_confidence` |

**전체 `Extraction.status`**
- `unsupported`: 파싱된 파일이 0개이고 unsupported/scanned/encrypted만 있을 때
- `failed`: 파싱된 파일이 0개이고 오류만 있을 때
- `verified`: 6개 항목이 모두 verified 또는 userEdited일 때
- `needs_review`: 그 밖의 경우

## 5. 결과 모델
### 5.1 `src/core/types/extraction.ts` 전면 교체
extraction.json을 쓰는 코드가 아직 없으므로 데이터 이행은 필요 없다.
```ts
export type ExtractionStatus = 'verified' | 'needs_review' | 'unsupported' | 'failed' | 'not_run';
export type ExtractionKey = 'credibilityScore' | 'performanceScore' | 'performancePeriod' | 'performanceMinAmount' | 'performanceCondition' | 'differentialScoring';
export const EXTRACTION_KEYS: ExtractionKey[];
export interface EvidenceRef { attachmentId: string; sourceFile: string; page?: number; sheet?: string; location: string; line?: number; evidence: string /* ≤300자 원문 */; context?: string /* ≤400자 */; ruleId: string; docKind: DocKind }
export interface ExtractedItem<T> { value: T | null; raw?: string; status: ExtractionStatus; reason?: 'not_found' | 'conflict' | 'low_confidence' | 'no_documents'; evidence?: EvidenceRef; candidates?: Array<{ value: T; raw?: string; evidence: EvidenceRef }>; userEdited?: { value: T | null; editedAt: ISODate; note?: string } }
export type ExtractionFileStatus = 'parsed' | 'unsupported' | 'encrypted' | 'drm' | 'scanned' | 'corrupt' | 'failed' | 'timeout' | 'skipped' | 'cancelled';
export interface ExtractionFile { attachmentId: string; name: string; innerPath?: string; docKind: DocKind; priority: number; format?: DocFormat | 'zip' | 'hwp3' | 'unknown'; status: ExtractionFileStatus; skipReason?: 'excluded' | 'duplicate' | 'budget' | 'too_large' | 'not_saved' | 'unsupported_ext'; pages?: number; chars?: number; tables?: number; ms?: number; textPath?: string; error?: string }
export interface Extraction { schemaVersion: 1; noticeId: string; jobId: string; extractedAt: ISODate; rulesVersion: string; status: ExtractionStatus; items: Record<ExtractionKey, ExtractedItem<unknown>>; extras: Record<string, ExtractedItem<unknown>>; files: ExtractionFile[]; warnings: string[] }
```

### 5.2 `merge.ts`에 `mergeDocumentLayer` 추가 (기존 `mergeFields`는 수정 금지)
```ts
export function mergeDocumentLayer(existing: Notice, docFields: FieldMap): FieldMap {
  const retained: FieldMap = {};
  for (const key of EVALUATION_KEYS) {
    const prev = getField(existing, key);
    if (prev && prev.status !== 'user_edited' && prev.source && prev.source.kind !== 'document') retained[key] = prev;
  }
  return mergeFields(existing, [{ kinds: [], fields: retained }, { kinds: ['document'], fields: docFields }]);
}
```
**document 레이어만 넣어 `mergeFields`를 호출하면 안 되는 이유**: html 값을 조용히 덮어쓴다. 기존 값을 `kinds: []`인 앞 레이어로 보존해야 한다.

**docFields를 만드는 규칙**

| 추출 상태 | docFields 값 |
|---|---|
| verified | `{value, raw, status:'verified', source:{kind:'document', ref:`${attachmentId}#${location}`, evidence, page, fetchedAt}}` |
| needs_review(conflict) | `{value:null, status:'needs_review', note:'문서 간 값이 서로 다름', candidates}` |
| not_found | 키를 넣지 않는다 |

**값 형식**: performancePeriod는 `"5년"`, performanceMinAmount는 원 단위 숫자, performanceCondition은 원문 문자열이다.

### 5.3 저장
- 저장 대상: `notices/<folder>/extraction.json`(락 안에서 쓰기)과 `source/text/*.txt`
- 쓰기 순서: text → extraction.json → notice.json → index.json. `IndexEntry.extractionStatus`에는 `Extraction.status`를 넣는다.

## 6. 잡 통합
- **collect 잡**: `COLLECT_STEPS = ['fetch_basic', 'download_attachments', 'extract', 'fetch_html']`(`job-coordinator.ts:14`). `extract`는 선택 step이다. 실패하면 잡은 `partial`이 되고, `notice.collect.errors`에 `{code:'EXTRACT_FAILED', step:'extract', retryable:true}`를 남긴다. 재시도는 extract step부터 다시 시작한다.
- **단독 extract 잡**
  - `newJob`이 잡 type별 step 목록을 쓰도록 바꾼다(`EXTRACT_STEPS = ['extract']`).
  - `JobRequest {type:'extract', noticeId}`는 확장 페이지가 보낸 요청만 허용한다.
  - offscreen은 type에 따라 `runCollectJob`과 `runExtractJob`으로 분기한다.
- **공통 코어** `src/engine/extraction/extract-step.ts`:
```ts
export interface ExtractDeps { store: IFileStore; parsers: ParserRegistry; rules: RuleSet; emit(p: JobProgress): void; signal?: AbortSignal; now?: () => Date; settings: Settings['extraction']; readFile(path: string): Promise<Uint8Array> }
export interface ExtractStepOutcome { status: 'done' | 'failed' | 'cancelled'; extraction?: Extraction; error?: JobError }
export async function runExtractStep(job: Job, notice: Notice, prior: Extraction | null, deps: ExtractDeps): Promise<ExtractStepOutcome>;
```
  - 처리 순서:
    1. planFiles
    2. readFile
    3. detect
    4. parse(쌍둥이 폴백 포함)
    5. renderText 저장
    6. 규칙 실행
    7. decide
    8. prior의 `userEdited` 이식(새로 나온 자동 결과는 candidates에 넣음)
    9. `mergeDocumentLayer`
    10. notice.evaluation 반영
  - 진행 라벨: 진행 중에는 `평가정보 추출 중 (i/n), ${name}`, 끝나면 `평가정보 추출 완료, 확인 필요 N건`
- **저장소 확장**
  - `IFileStore.readBytes(path): Promise<Uint8Array>`: FSA 구현과 MemoryStore 구현에 모두 추가한다. 첨부 bytes는 메시지로 보내지 않는다.
  - `NoticeStore`: `loadExtraction(noticeId)`와 `saveExtraction(n, x)`(extraction.json 쓰기 → `saveNotice(n, undefined, {extractionStatus})`)를 추가하고, `entryOf`에 extractionStatus 인자를 넣는다.
- **결과 타입**: `CollectResult.extraction?: { status: ExtractionStatus; reviewCount: number }`, `ExtractResult = { noticeId; folder; extraction }`.
- **사용자 수정 보존**: notice 필드는 `user_edited` 상태로 mergeFields가 보존하고, extraction item은 `userEdited`를 이식해 보존한다.

### 6.1 메시지 (protocol.ts, router 릴레이, 확장 페이지 발신만 허용)
```ts
| { type: 'notice/list'; payload: void; response: IndexEntry[] }
| { type: 'notice/get'; payload: { noticeId: string }; response: { notice: Notice; extraction: Extraction | null } | null }
| { type: 'extraction/edit'; payload: { noticeId: string; key: ExtractionKey; value: unknown | null; note?: string }; response: { notice: Notice; extraction: Extraction } }
| { type: 'extraction/text'; payload: { noticeId: string; textPath: string }; response: { text: string } }
```
- **`extraction/edit`**
  - value가 있으면 item.userEdited를 넣고, notice 필드를 `{value, status:'user_edited', source:{kind:'user', ref:'dashboard', fetchedAt}}`로 바꾼다.
  - value가 null이면 수정을 해제하고 자동 결과로 되돌린다.
  - 둘 다 끝나면 전체 status를 다시 계산한다.
- **`extraction/text`**: 경로가 `<folder>/source/text/` 아래인지 검증하고, 2MB를 상한으로 둔다.
- **`ui/open`**: payload를 `{ page: 'settings' | 'grant' | 'review'; noticeId?: string }`로 바꾼다.

## 7. 검수 UI (대시보드 `#/review/<noticeId>`, `NoticesPage.tsx`, `ReviewPage.tsx`)
1. **공고 목록**(`notice/list`): 제목, 공고번호, 수집 상태, 추출 상태 배지를 보여 준다. 행을 누르면 검수 화면으로 간다.
2. **항목 6행**: 각 행에 다음을 보여 준다.
   - 라벨과 값 입력(number, "N년", 금액(억 단위 도우미), boolean, textarea)
   - 상태 배지
   - reason 문구: "문서에서 찾지 못함" / "문서 간 값 다름" / "질의답변에만 있음"
   - 근거: 파일/위치/페이지, evidence, context
   - 후보 라디오와 "이 값으로 확정" 버튼
   - [전체 텍스트 보기] 드로어(line 위치로 스크롤)
3. **파일 표**: 이름, 종류, 상태, 페이지, 소요 시간, 오류, 건너뛴 이유를 보여 준다.
4. **액션**: [다시 추출], [폴더 경로 복사]

"원본 파일 열기"는 추출 텍스트 전문 보기와 경로 복사로 대신한다(`file://`은 기본적으로 열 수 없다). 플로팅 패널/사이드패널/팝업에는 "평가정보: 확인 필요 N건 [검수]" 한 줄만 보인다.

## 8. 불가/불확실 지점
| 지점 | 처리 | 재검토 기준 |
|---|---|---|
| 스캔 PDF | `scanned` + needs_review | 스캔 공고가 10건 중 2건 이상이면 OCR 재검토 |
| HWP 3.x | `unsupported` | 누적되면 로컬 보조 프로그램 검토 |
| 암호/배포용 HWP | `encrypted`/`drm` | 우회하지 않는다 |
| 병합 셀 span 오프셋 | 가정(@12/@14) | P4-1에서 f3로 실측 |
| 이미지로 된 표 | not_found + 파일별 tables=0 | — |
| PDF 표 | 복원하지 않음, inline-score로만 추출 | — |
| fflate 파일명 디코딩 | 가정 | P4-0 테스트로 확인 |
| html differentialScoring | `html-parse.ts:33`이 boolean을 해석하지 않음(raw만 남김) | 별도 작은 작업으로 분리 |

## 9. 단계와 검증 기준
**픽스처**: `tests/fixtures/docs/R26BK01722175/`에 f1(입찰공고문.hwp), f2(.pdf), f3(제안요청서.hwp), f6(질의답변.hwp)을 둔다. HWPX/DOCX/XLSX와 CP949 zip 픽스처는 테스트 안에서 fflate로 생성한다.

- **P4-0 기반**
  - 구현 범위: 의존성, pdfjs 자산 스크립트, `core/doc/*`, normalize, classify, zip, readBytes, 타입 교체(§5.1), Settings.extraction
  - 검증 기준:
    - classify가 7개 파일명을 기대한 종류로 분류하고 쌍둥이를 판정함
    - parseKoreanAmount 6개 케이스
    - CP949 zip 파일명 복원
    - Grid와 renderText 단위 테스트(병합 셀 포함)
    - typecheck 통과
- **P4-1 HWP5 + PDF**
  - f3 정량평가 표(헤더 [구분|평가부문|평가항목|배점]): rows 3, cols 4, `at(1,0).rowSpan===2`, `at(1,3).text==='4'`, `at(2,3).text==='6'`
  - f3 세부기준표 r1c2: 중첩 표 1개, colSpan 2
  - f1 문단에 "차등점수제 : 미적용"이 있음
  - f6은 43줄 안팎
  - f2: compact 텍스트에 "차등점수제:미적용"이 있고, 25쪽이며, 스캔으로 판정되지 않음
  - 파일마다 2초 미만
  - 합성 빈 PDF는 scanned, 암호 비트를 켠 HWP는 encrypted
  - renderText 줄 수가 연구 f3.txt 대비 ±5% 이내
- **P4-2 HWPX/DOCX/XLSX**(P4-1과 병렬 가능): 합성 픽스처로 표/span/중첩/sharedStrings/mergeCells를 검증한다. 테스트 파일에 `// @vitest-environment jsdom`을 붙인다.
- **P4-3 규칙 엔진**: 이 공고에서 기대하는 값

  | 항목 | 기대값 |
  |---|---|
  | credibilityScore | 4 verified (evidence 표 r1c3, candidates에 세부기준표 4) |
  | performanceScore | 6 verified |
  | performancePeriod | "5년" (raw "입찰공고일 기준 5년 이내") |
  | performanceMinAmount | 500000000 |
  | performanceCondition | "※ 유사사업 :"으로 시작하고, "(단, 유사사업이라고 하더라도"를 포함하며, "작성 및 증빙방법" 앞에서 끝남 |
  | differentialScoring | false verified (f1) |

  추가로 확인할 것:
  - f6을 포함했을 때 condition이 충돌로 needs_review가 되는지(둘 다 허용하고 결과를 보고)
  - 합성 충돌 케이스(4 vs 5)에서 value null, conflict, candidates 2개
  - qna 문서에만 값이 있으면 low_confidence
  - 규칙 JSON에 `extras.techRatio`(window-regex `기술능력평가(?<v>\d+)%`)만 추가해도 extras에 값이 생김
- **P4-4 잡 통합**(fake parser 주입)
  - 완료 시 extraction.json과 source/text가 생기고, evaluation 6개 필드의 출처가 document이며, index의 extractionStatus가 갱신됨
  - 파서가 실패하면 잡은 partial + EXTRACT_FAILED가 되고, 재시도하면 extract만 다시 실행됨
  - html 값과 다르면 needs_review, 같으면 verified 유지
  - user_edited와 userEdited가 재추출 뒤에도 보존됨
  - 파싱 중 abort되면 cancelled이고 notice.json은 저장됨
  - 예산이 소진되면 skipped/budget
  - 수동 확인: 실제 Chrome에서 "평가정보 추출 중 (i/4)"가 보이고, 전체가 30초 안에 끝나며, 기대값이 나옴
- **P4-5 검수 UI**: 수동으로 확인한다.
  - 목록에서 검수 화면으로 들어가진다
  - 후보 확정/값 수정이 반영된다
  - 다시 추출해도 수정값이 유지된다
  - 텍스트 드로어가 해당 line으로 스크롤된다

## 10. 금지
- SW나 offscreen에서 Worker를 만들지 않는다(pdfjs worker만 예외).
- CDN이나 blob 스크립트를 쓰지 않는다. `isEvalSupported:true`, SheetJS, hwp.js도 쓰지 않는다.
- 표 해석:
  - 셀 소속을 레코드 순서로 판정하지 않는다.
  - 헤더 행을 데이터로 쓰지 않는다.
  - 병합 영역의 소유 셀을 라벨로 쓰지 않는다.
- 후보와 값:
  - 라벨 없이 문서 전체에서 "N점"을 긁지 않는다.
  - scoreHeader에 `평점`을 넣지 않는다.
  - 값이 2종이면 value를 채우지 않는다.
  - qna 문서에만 있는 값을 verified로 두지 않는다.
- 근거:
  - evidence에 compact 텍스트를 저장하지 않는다.
  - 근거 없이 verified로 두지 않는다.
- 병합과 재추출:
  - document 레이어 단독으로 mergeFields를 호출하지 않는다.
  - 재추출할 때 userEdited를 잃지 않는다.
- 파일 처리:
  - 첨부 bytes를 메시지로 보내지 않는다.
  - form/reference 파일과 2단계 이상 중첩된 zip은 파싱하지 않는다.
  - PDF 쌍둥이를 함께 파싱하지 않는다.
- extract step이 실패해도 잡을 failed로 만들지 않는다(partial).
