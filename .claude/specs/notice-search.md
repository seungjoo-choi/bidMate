# 공고 단위 통합검색 설계 (1단계 로컬 키워드 검색 + 2단계 AI 질문)

- 작성: 2026-10-21, 설계 fable-advisor, 정리 메인
- 상태: S0 구현 완료(2026-10-22). 사용자 확인: 진입점은 대시보드만, 상세 전문은 AI 재검토 입력에 포함(1.5절), 나머지(1·4·5·6)는 설계안대로.
- 결정 기록: `.claude/specs/decisions.md` "2026-10-21 · 공고 통합검색 (Fable)" 절

## 요구사항 (사용자 확정)

- 공고 하나에 대한 정보가 나라장터 상세·제안요청서·입찰공고문 등에 흩어져 있다. 이를 통틀어 찾는 통합검색을 만든다.
- 범위는 1단계(로컬 키워드 통합검색)와 2단계(AI 질문형 검색) 모두. 여러 공고를 가로지르는 검색은 범위 밖이다.
- 진입점: 공고가 보이는 화면 어디서든 그 공고의 통합검색을 열 수 있어야 한다.
- 나라장터 상세 페이지 전문을 이번에 같이 텍스트로 저장해 검색 대상에 넣는다. 이미 수집한 공고는 재수집해야 반영된다.

## 착수 전 사용자 확인 필요 (9절 요약)

S2·S4 UI 작업 전에 한 메시지로 묶어 물어본다. 1, 4, 5, 6은 설계안대로 가정해도 된다.

1. 단축키를 `Ctrl+Shift+F`와 `/`(입력 중이 아닐 때)로 해도 되는지
2. 사이드패널·나라장터 플로팅 패널에도 "통합검색 열기" 링크를 둘지 (설계는 대시보드만)
3. ~~상세 전문을 AI 재검토 입력에도 넣을지~~ → 2026-10-22 사용자 결정: 포함(1.5절)
4. FilesTab에 "나라장터 상세화면" 가상 행을 보일지 (설계는 표시)
5. 질문 이력 30건과 prompt/response txt를 저장할지 (설계는 저장)
6. 질문 컨텍스트 상한 40k자와 "전문 재질문" 상한 25만 자를 쓸지, 설정 `ai.sendFullText`를 따를지
7. NoticesPage 행 버튼을 hover 아이콘으로 할지 상시 노출로 할지 (메인 디자인 판단)

---

## 0. 핵심 결정 10개

| # | 결정 | 이유 |
|---|---|---|
| D1 | 상세화면 전문은 content script가 DOM→`DocModel`→`renderText`로 만들어 `HtmlFields.pageText`에 실어 보낸다. collect-job이 이를 `<folder>/source/text/[상세] 나라장터 상세화면.txt`로 저장한다. `Notice.detailText?` 선택 필드를 추가한다(schemaVersion 1 유지, 마이그레이션 없음). | 첨부 txt와 같은 render-text 형식이면 TextDrawer·evidenceSpan·locateQuote·excerpt를 고치지 않고 그대로 쓸 수 있다. `source/text/` 경로 검증(`readExtractionText`, `readFileText`)도 통과한다. |
| D2 | 검색 코퍼스는 ①공고정보 항목값(가상 문서) ②상세 전문 ③첨부 파싱 txt(`extraction.files` 중 parsed) 셋이다. 새 메시지 `notice/texts`로 한 번에 받아 대시보드 메모리에 둔다. 인덱스 파일은 만들지 않는다. | 공고 하나의 코퍼스는 수십만~수백만 자다. 줄별 정규화를 1회 하고 `indexOf`로 찾으면 키 입력마다 수 ms면 된다. 인덱스를 저장하면 stale 관리 비용만 늘어난다. |
| D3 | 정규화 규칙은 기존 `compact`(공백·zero-width 제거, NFC, `：`→`:`)에 소문자 변환, 태그(`[셀 …]`,`[표 k]`,`[p N]`) 제거, `\|` 제거를 더한 것이다. verify.ts `normalizeForMatch`와 같은 계열이다. 정규화한 문자에서 원문 (줄, 열)로 돌아가는 역매핑 배열을 함께 만들어 강조에 쓴다. | 띄어쓰기를 무시하고 찾는 것이 핵심 요구다. AI 인용 대조와 같은 정규화를 써야 2단계 근거 위치 계산과 결과가 일치한다. |
| D4 | 결과 단위는 "유닛"이다. 유닛은 표 밖 줄 1개, 또는 표 행 1개(같은 r의 셀 줄과 이어진 줄)다. 질의는 공백으로 나눈 항의 AND이고, `"…"`는 구문이다. 정렬은 출처 그룹 순(항목값 → 상세 → 첨부 priority 순)이고, 그룹 안에서는 문서 순서를 따른다. 관련도 점수는 쓰지 않는다. | 사용자는 문서를 순서대로 훑는다. 성격이 다른 문서끼리 점수로 섞으면 혼란만 준다. 점수는 2단계 후보 선정에만 쓴다(`core/search/score.ts`). |
| D5 | `buildTextBlocks`/`displayLine`을 `src/core/doc/text-blocks.ts`로 옮긴다. `ui/review/text-view.ts`는 이를 re-export하고 `evidenceSpan`은 그대로 둔다. | core는 ui를 import할 수 없는데, 유닛 분해에 표 행 분해가 필요하다. 호출부는 바뀌지 않는다. |
| D6 | UI는 전역 `NoticeSearchProvider` 1개(App.tsx)와 오른쪽 슬라이드 패널이다. 진입점은 상세 헤더 아이콘 버튼, 목록 행 버튼, 메일준비/평가상세/RFP 공고 슬롯 버튼, TextDrawer 안 "모든 문서에서 검색" 링크다. 단축키(`Ctrl+Shift+F`, 입력 중이 아닐 때 `/`)는 "현재 공고"가 등록된 화면에서만 동작한다. | 공고 id만으로 어디서든 열려야 하므로 패널이 데이터를 직접 읽고 TextDrawer까지 품는다. 모달 라우트가 아닌 오버레이라서 보던 화면을 떠나지 않는다. |
| D7 | 결과를 누르면 기존 `TextDrawer`를 `{textPath, line, query}`로 연다(패널 위에 겹침). 항목값 결과는 값 자체를 결과에 보여주고 "개요/검토 탭에서 보기" 링크만 단다. | TextDrawer에 줄 이동, 검색어 강조, 근거 구간 강조가 이미 있다. 개요 탭에는 행 앵커가 없으므로 v1에서는 만들지 않는다. |
| D8 | 2단계 흐름: 로컬 점수(항 적중 + 문자 bigram 겹침)로 후보 유닛을 고른다 → 창을 넓힌다(excerpt와 같은 규칙: ±줄, 표는 행 끝까지, 주석 결속) → 총 40k자 컨텍스트에 항목값 문서를 더해 보낸다 → JSON 스키마로 답을 받는다(answer, citations[], conflicts[], coverage) → `locateQuote`로 인용 위치를 검증한다. 검증에 실패해도 답은 보이고 "원문에서 못 찾음"으로 표시한다. coverage가 partial/not_found면 "전문으로 다시 질문" 버튼을 보인다(상한 `API_FULLTEXT_MAX_CHARS`). | 질문은 대화형이라 매번 전문을 보내면 느리고 비싸다. AI 재검토에서 1차 실패 원인이 발췌 누락이었다(decisions 561행). 그 교훈은 "전문 재질문" 탈출구로 흡수한다. |
| D9 | AI 실행 경로는 기존 `AiRunner`/`ai-review.json`과 분리한다. 대시보드→SW `search/ask`(키 주입), SW→offscreen `search/ask-exec`로 요청/응답한다(타임아웃 150초). offscreen의 `AskRunner`는 공고당 1개이고 AbortController를 쓴다. 결과는 `<folder>/search/asks.json`(최대 30건)과 `search/<askId>-{prompt,response}.txt`에 저장한다. | RFP D10과 같은 이유다. 재검토 파이프라인은 AiKey 색인·verdict·apply에 묶여 있어 자유 질문에 맞지 않는다. 90~120초 요청/응답은 `eval/collect`, `rfp/upload`에 전례가 있다. |
| D10 | API 방식 전용이다. 설정 mode가 manual이어도 키가 있으면 "이번만 API"로 실행하고, 키가 없으면 설정으로 안내한다. 반자동 붙여넣기는 범위 밖이다. | 질문과 응답이 자주 오가서 붙여넣기 UX가 성립하지 않는다. |

---

## 1. 코퍼스 구성

### 1.1 상세 전문 (신규)

- **생성 위치**: 나라장터 탭 content script에서 만든다. 대상은 두 곳이다.
  - `g2b.content.ts`의 `g2b/read-html` 핸들러
  - `PanelController.collect()`의 `job/start` 동봉 부분

  두 곳 모두 `readHtmlFields` 호출 지점 바로 옆에서 `readPageText(document, { isVisible: defaultIsVisible })`를 호출해 결과를 `html.pageText`에 넣는다.
- **형식**: `renderText(DocModel)` 결과 문자열이다(첨부 txt와 같음). DOM 변환 규칙은 `src/adapters/g2b/detail-text.ts`(순수 DOM 함수)에 둔다.
  - 루트는 `#mf_wfm_container_mainWframe`이다. 없으면 `undefined`를 돌려준다(필드 없음).
  - `table` 요소 → `DocTable`.
    - `tr` 순서로 `th/td`를 읽는다. 셀 텍스트는 기존 `cellValue` 규칙을 따른다(안에 input이 있으면 value, 없으면 textContent 공백 정규화). rowSpan/colSpan은 유지한다.
    - 표 안의 중첩 표는 셀 `blocks`로 넣지 않고 셀 텍스트로 평탄화한다(1단계 단순화. render-text의 중첩 emit은 쓰지 않는다).
    - 그리드의 `_head_table`/`_body_table`은 별개의 표 두 개로 그대로 둔다. 병합을 시도하지 않는다.
  - 표 밖 텍스트 → `DocParagraph`.
    - 가장 가까운 블록 조상(div/p/li/h1~h6/label/dt/dd/section) 단위로 한 문단을 만든다. 텍스트 노드와 `input[title]`/`textarea` value를 이어 붙이고, 빈 문단은 생략한다.
    - `button`, `script`, `style`, `[aria-hidden="true"]`, `isVisible`이 false인 요소는 건너뛴다.
    - 같은 텍스트 노드가 두 번 들어가지 않도록 "이미 소비한 노드" Set으로 막는다.
  - 상한은 300,000자다(상수 `DETAIL_TEXT_MAX_CHARS`, `src/core/search/constants.ts`). 넘으면 뒤를 자르고 `pageTextTruncated: true`로 표시한다.
  - 입찰공고번호 input이 없는 문서(상세가 아닌 화면)에서는 호출하지 않는다. `detectDetail` 뒤에서만 호출한다.
- **전송**: `HtmlFields`에 선택 필드 `pageText?: string; pageTextTruncated?: boolean`를 추가한다. 확인한 사실은 다음과 같다.
  - `Job`(storage.session ledger)에는 html이 저장되지 않고 `JobRunPayload.html`로만 offscreen에 전달된다(`job-coordinator.ts:413-414`, `Job` 타입에 html 없음).
  - `detail-reader.ts:135-139`의 안정 판정은 `JSON.stringify(r.html.fields)`만 비교한다. 따라서 pageText가 있어도 영향이 없다.
- **저장**: `collect-job.ts`에 헬퍼 `persistPageText(ns, store, notice, html, nowIso)`를 둔다.
  - 경로는 `${notice.folder}/source/text/[상세] 나라장터 상세화면.txt`다. 이름은 고정이고 덮어쓴다.
    - extract-step 파일명은 `${index}_…` 형태라 충돌하지 않는다.
    - extract는 `source/text`를 지우지 않는다(`remove` 호출 없음 확인). 재추출해도 이 파일은 남는다.
  - `capText`(2MB)를 적용한 뒤 `store.writeText`로 쓴다. 성공하면 `notice.detailText = { textPath, capturedAt: html.capturedAt, chars, truncated? }`를 설정하고 `ns.saveNotice(notice)`를 호출한다.
  - 호출 지점은 두 곳이다. 재시도 경로(169~172행, html 병합 직후)와 신규 경로(224행 `saveNotice` 직후)다.
  - 실패하면 `warnings`/step note에만 남기고 잡 상태는 바꾸지 않는다.
- **Notice 타입**: `detailText?: { textPath: string; capturedAt: ISODate; chars: number; truncated?: boolean }`를 추가한다. `fillMissingFields`는 건드리지 않는다(없으면 없는 대로 둔다).
- **기존 공고**: 마이그레이션하지 않는다. 패널에 "상세화면 전문이 없습니다. 이 공고를 다시 수집하면 포함됩니다"라고 안내한다.
  - 이유: 전문은 렌더된 DOM에서만 얻을 수 있다. 백필하려면 공고마다 탭을 열어야 해서 비용이 크다. 필요한 공고만 사용자가 재수집한다.
- **표시**: `FilesTab` 첫 행에 "나라장터 상세화면" 가상 행을 둔다(종류 "상세화면", 상태 "저장됨", 클릭하면 TextDrawer). `notice.detailText`가 있을 때만 보인다.
- AI 재검토(`prepareRun`)의 입력에 **포함한다**(2026-10-22 사용자 결정). 설계는 1.5절.

### 1.2 항목값 가상 문서

- `ui/search/field-doc.ts`의 `buildFieldDoc(notice, extraction): SearchDoc`가 만든다.
  - `overviewGroups(notice, [], extraction)`의 그룹·행을 평탄화한다. 그룹마다 `"[그룹 제목]"` 머리 줄을 쓰고, 행마다 `"라벨: 값"` 줄을 쓴다(hint가 있으면 ` (hint)`를 붙인다).
  - 값이 `—`인 행은 뺀다.
  - 각 줄에 `{ groupId, label, reviewKey? }` 메타를 단다. 검토 탭 링크용이며, `REVIEW_LABEL`을 역조회해 label을 ReviewLeafKey로 바꾼다.
- 이유: 사용자가 개요에서 보는 모습 그대로 검색되게 하기 위해서다. 코어 FieldValue를 다시 포맷하지 않는다.

### 1.3 첨부 txt

- 대상은 `extraction.files` 중 `status==='parsed' && textPath`인 파일이다.
- 라벨은 `displayName`이다(innerPath가 있으면 `name › innerPath`). 종류는 `DOC_KIND_LABEL[docKind]`이다. `origin==='prespec'`이면 앞에 "사전규격 /"을 붙인다.
- 순서는 `priority` 오름차순이고, 같으면 files 배열 순서를 따른다.

### 1.4 `notice/texts` 메시지

- `{ type: 'notice/texts'; payload: { noticeId: string }; response: NoticeTexts }`
- ```ts
  export interface NoticeTextFile { id: string; kind: 'detail' | 'attachment'; textPath: string; name: string; docKind?: DocKind; origin?: AttachmentOrigin; attachmentId?: string; innerPath?: string; priority: number; text: string; truncated: boolean }
  export interface NoticeTexts { noticeId: string; extractionJobId: string | null; files: NoticeTextFile[]; skipped: Array<{ name: string; reason: string }>; totalChars: number }
  ```
- 구현은 `engine/notices/notice-api.ts`의 `readNoticeTexts(store, { noticeId })`다.
  - `loadNotice`와 `loadExtraction`으로 읽는다. detail은 `priority 0`이고, 첨부는 extraction의 priority를 쓴다.
  - 파일당 상한은 2MB(`TEXT_MAX_BYTES`)다. 총합이 `NOTICE_TEXTS_MAX_CHARS = 4_000_000`을 넘으면 이후 파일은 `text:''`로 두고 `skipped`에 `reason:'budget'`으로 넣는다.
  - 읽기에 실패한 파일은 `skipped`에 `reason:'failed'`로 넣는다. NEEDS_FS_PERMISSION은 그대로 던진다.
  - `source/text/` 경로 검증은 `readExtractionText`와 같다.
- `router.ts`의 `EXTENSION_ONLY_TYPES`에 추가하고, `TIMEOUT_MS`에 `['notice/texts', 60_000]`을 넣는다. offscreen `main.ts`에 `listen('notice/texts', …)`를 추가한다.

### 1.5 상세 전문의 AI 재검토 입력 포함 (S1b)

2026-10-22 사용자 결정("상세 전문을 AI 재검토 입력에도 넣는다"), fable-advisor 보완 설계.

확인된 사실(설계 근거):
- `prepareRun`(`src/engine/ai/ai-review-api.ts:99-154`)은 `extraction.files` 중 parsed+textPath만 `ExcerptFileInput`으로 만들고 `p.files`(textPath 배열)로 거른다. `run.files`는 `excerpt.files`를 그대로 저장하며 소비처는 `finishRun`(181-186행) 하나뿐이다. 대시보드는 `run.files`를 표시하지 않는다(`run.skipped`만 `AiRunPanel.tsx:179`).
- AI 근거 열기는 `ReviewTab.tsx:65-69 openText` → `findTextPath`(`src/ui/review/view.ts:149-153`). `ResolveDialog`는 규칙 근거만 연다.
- `locateQuote`·`evidenceSpan`·`buildExcerpt`는 render-text 줄 배열 전제라 상세 전문(D1, 같은 형식)에 그대로 쓴다. 상세에는 `[p N]`이 없어 page는 항상 null.
- `readFileText`(63-72행)는 `<folder>/source/text/` 아래만 허용, 상세 경로 통과.
- parsed 첨부 priority는 1..5(`classify.ts:4`). 상세를 priority 0으로 두면 항상 맨 앞.
- 재수집하면 extract가 다시 돌아 `extractionJobId`가 바뀌므로 기존 stale 판정이 상세 갱신까지 덮는다.
- 가정: 상세 전문 20k~60k자(S1 후 실제 3건으로 재어 `DETAIL_EXCERPT_MAX_CHARS` 조정), `Attachment.id`에 `__detail__`은 쓰이지 않음.

#### 1.5.0 핵심 결정

| # | 결정 | 이유 | 기각 대안 |
|---|---|---|---|
| D11 | 상세 전문은 `prepareRun` 입력에 **기본 포함**. AiRunDialog 체크리스트 첫 행, 해제 가능. 해제는 기존 `files`(textPath) 파라미터, `skipped: unselected` | 공고 잎 9개의 1차 출처가 상세화면. textPath 통일로 프로토콜 무변경 | 해제 불가 / `includeDetail` 플래그 |
| D12 | 가상 식별자 `attachmentId = '__detail__'`, `sourceFile = name = '[상세] 나라장터 상세화면'`, `kindLabel = '상세화면'`, `VerifyFile.docKind = 'notice'`. **`DocKind` 무변경.** 상수는 `src/core/model/detail-text.ts`(S1도 사용) | run.files·EvidenceRef 형태 유지. DocKind 확장은 Record 2곳과 분류 규칙까지 번짐 | DocKind `'detail'` / Extraction.files 삽입 |
| D13 | 발췌 순서 priority 0(맨 앞), 상세 전용 상한 `DETAIL_EXCERPT_MAX_CHARS = 10_000`을 `ExcerptFileInput.maxChars?`(신규)로. 전문 모드는 상한 없이, 총 250k 초과 시 기존 폴백 | 상세는 발췌 키워드를 거의 다 포함해 24k를 채우고 수동 30k에서 첨부를 밀어냄 | 맨 뒤 priority / 전문 모드에서 상세 제외 / 전문 상한 상향 |
| D14 | `AiRun`·`run.files` 스키마 불변. `finishRun`은 `attachmentId === '__detail__'`면 `notice.detailText.textPath`로 읽음 | 옛 run은 분기에 안 들어감. stale은 extractionJobId로 충분 | `AiRun.detailCapturedAt` |
| D15 | 근거 열기는 `evidenceTextPath(e, files, detail?)` 헬퍼, 변경은 `ReviewTab.openText` 한 곳 | AI 근거를 여는 곳은 ReviewTab뿐 | `findTextPath` 시그니처 변경 |
| D16 | `SYSTEM_PROMPT` [여러 값] 절에 상세화면 우선 규칙 1줄, `PROMPT_VERSION = '2.3.0'` | 새 종류 "상세화면"의 충돌 우선순위 필요 | 프롬프트 무변경 |
| D17 | 공고 잎 verdict·valueInQuote·ruleRelation 계산 불변, 상세 출처 match 별도 표시 없음 | 같은 화면의 독립 파싱으로서 확인 가치. cite에 파일명이 보임 | "같은 출처" 배지 |
| D18 | 커버리지 기준선 재생성 안 함, 픽스처에 상세 txt 넣지 않음 | 발췌 알고리즘 불변. 기존 회귀 38건을 덮으면 안 됨 | `AI_EVAL_UPDATE_BASELINE=1` |

#### 1.5.1 입력 구성 (`prepareRun`)
- `notice.detailText`가 있으면 첨부 루프 뒤(109~120행 뒤, `NO_DOCUMENTS` 검사 앞)에 처리:
  - `p.files`가 있고 `detailText.textPath`가 없으면 `skipped.push({ name: DETAIL_TEXT_NAME, reason: 'unselected' })`.
  - 아니면 `readFileText(store, notice, detailText.textPath)`. null이면 `skipped … 'failed'`. 성공 시 `inputs.unshift({ attachmentId: DETAIL_ATTACHMENT_ID, sourceFile: DETAIL_TEXT_NAME, name: DETAIL_TEXT_NAME, kindLabel: DETAIL_KIND_LABEL, priority: 0, maxChars: DETAIL_EXCERPT_MAX_CHARS, text })`.
- parsed 첨부가 0개여도 상세가 있으면 실행된다(의도된 변경). `extraction` 자체가 없으면 기존대로 `NOT_FOUND`.
- 프롬프트 머리글 `=== 파일: [상세] 나라장터 상세화면 (상세화면) ===`, 구간 머리 `--- 쪽 미상, 줄 a~b ---`(기존 함수).
- `excludedFiles`는 UNREADABLE만 세므로 변경 없음. 원클릭(`ai/run scope auto`)·일괄·비교 실행은 `files`가 없어 상세 기본 포함.

#### 1.5.2 발췌 (`src/core/ai/excerpt.ts`)
- `ExcerptFileInput.maxChars?: number`. `cap = Math.min(file.maxChars ?? EXCERPT_FILE_MAX_CHARS, maxTotal)`. 243행 `buildSegments(..., Math.min(EXCERPT_FILE_MAX_CHARS, maxTotal))` → `cap`, 251~255행의 `EXCERPT_FILE_MAX_CHARS` 3곳(while 조건, slice, 경고 숫자) → `cap`.
- `buildFullText` 변경 없음. 총 상한 제거 순서 그대로.

#### 1.5.3 검증·근거 위치
- `finishRun` 181행 루프: `rf.attachmentId === DETAIL_ATTACHMENT_ID`면 `notice.detailText?.textPath`로 읽어 `VerifyFile { attachmentId: DETAIL_ATTACHMENT_ID, sourceFile: rf.sourceFile, name: rf.name, docKind: 'notice', text }`. `detailText`가 없으면 건너뜀(그 인용은 `quote_not_found`로 거부, 허용).
- `locateQuote`·`findFileByName`·`evidenceOf`·`applySuggestion`·TextDrawer 변경 없음. EvidenceRef는 `{ attachmentId: '__detail__', sourceFile: '[상세] 나라장터 상세화면', line, location: 'line N', docKind: 'notice' }`.

#### 1.5.4 출처 표시
- `AiSuggestionBlock.tsx:87`이 `s.file`을 보이므로 cite에 상세 이름. 쪽 없음. 해제 시 AiRunPanel 제외 파일에 이름. 추가 UI 없음.

#### 1.5.5 공고 잎 비교 영향
- 상세에서 읽은 일정·금액이 html/api 값과 같으면 match 증가, 파서가 놓친 항목은 new, 오독은 differs. datetime `2026/10/21 10:00`은 `toIsoKst`로 환산, amount는 `amountFromText`, text는 포함 규칙(4자 이상). match가 "같은 화면을 두 번 읽은 결과"일 수 있음은 D17로 수용.

#### 1.5.6 옛 run 호환
- `ai-review.json` schemaVersion 1 유지. 옛 run에는 `__detail__`이 없어 신규 분기에 안 들어감. awaiting 반자동 run을 닫을 때도 `run.files`만 순회. `isStale` 변경 없음.

#### 1.5.7 커버리지 기준선
- 픽스처만 입력이고 `maxChars`는 선택이라 기록 불변. 기존 회귀 38건은 완료 조건에서 제외, **기준선 재생성 금지**.

#### 1.5.8 프롬프트 (`src/core/ai/prompt.ts`)
- `PROMPT_VERSION = '2.3.0'`. [여러 값] 절 "문서 간에 같은 개념의 값이 다르면 …" 줄 바로 뒤에:
  `'- 종류가 "상세화면"인 문서는 나라장터에 등록된 현재 공고 정보입니다. 일정, 금액, 계약 조건이 첨부 문서와 다르면 상세화면 값을 쓰고 다른 값은 note에 적습니다. 정량평가 기준(배점, 실적 조건)은 첨부 문서를 우선합니다.'`
- 숫자 토큰 없음. 테스트의 `'2.2.0'` 리터럴 단언은 `PROMPT_VERSION` 참조로.

#### 1.5.9 위임 단위
S1 보강: `src/core/model/detail-text.ts`는 S1에 포함하고 collect-job 파일명·경로는 이 상수를 쓴다.
```ts
export const DETAIL_TEXT_FILE = '[상세] 나라장터 상세화면.txt';
export const DETAIL_TEXT_NAME = '[상세] 나라장터 상세화면';
export const DETAIL_ATTACHMENT_ID = '__detail__';
export const DETAIL_KIND_LABEL = '상세화면';
export const DETAIL_EXCERPT_MAX_CHARS = 10_000;
export const detailTextPath = (folder: string) => `${folder}/source/text/${DETAIL_TEXT_FILE}`;
export const isDetailEvidence = (e: { attachmentId: string }) => e.attachmentId === DETAIL_ATTACHMENT_ID;
```

| 단위 | 파일 | 작업 | 선행 |
|---|---|---|---|
| S1b-core | `src/core/ai/excerpt.ts`, `src/core/ai/prompt.ts`, `tests/core/ai-excerpt.test.ts`, `tests/core/ai-prompt*.test.ts` | 1.5.2, 1.5.8. 테스트: maxChars 2,000 파일만 상한 적용·다른 파일은 24k / 경고 문구에 그 파일 상한 / maxChars 없으면 기존 결과 동일 / 버전 리터럴·린트 | S1과 병렬 |
| S1b-engine (리뷰 필수) | `src/engine/ai/ai-review-api.ts`, `tests/engine/ai-review-api.test.ts` | 1.5.1, 1.5.3, 1.5.10 케이스 | S1, S1b-core |
| S1b-ui | `src/ui/review/ai-view.ts`(`fileChecklist(files, detail?)` 첫 행, `selectedChars(files, selected, detail?)`), `src/ui/review/view.ts`(`evidenceTextPath`), `AiRunDialog.tsx`(prop `detailText`, 48·76행), `ReviewTab.tsx`(66행, 239행), `tests/ui/ai-view.test.ts`, `tests/ui/review-view.test.ts` | 1.5.4, D15 | S1 |

#### 1.5.10 테스트 케이스 (engine)
- prepareRun: detailText 있으면 `run.files[0]`이 `{ attachmentId: '__detail__', name: '[상세] 나라장터 상세화면' }`, 프롬프트에 상세 머리글.
- prepareRun: `files`에 첨부만 → skipped `unselected`, run.files에 상세 없음.
- prepareRun: parsed 첨부 0개 + detailText → NO_DOCUMENTS 아님.
- prepareRun: textPath가 `source/text/` 밖이거나 파일 없음 → skipped `failed`, 계속.
- prepareRun manual: 상세 15k자(키워드 줄 다수) → 상세 블록 ≤ 10,000 + 머리글, 경고에 "10,000자".
- finishRun: 상세에만 있는 문장 quote의 postedAt 제안 → evidence.attachmentId `__detail__`, file DETAIL_TEXT_NAME, line 일치, page 없음, 같은 분이면 verdict match.
- finishRun: 옛 run(files에 상세 없음)은 상세 txt가 있어도 상세 인용 `quote_not_found`.
- finishRun: run.files에 상세가 있는데 notice.detailText가 없으면 예외 없이 그 인용만 거부.

#### 1.5.11 완료 조건
- tsc, 위 테스트 통과. `ai-eval-coverage` 실패 38건 변화 없음(새 회귀 0, 기준선 파일 무변경).
- 수동: 재수집 공고의 [AI로 다시 찾기] 첫 행에 "[상세] 나라장터 상세화면 (상세화면)" 체크 → 실행 → 공고 잎 cite에 그 이름 → [원문에서 확인]이 상세 txt 해당 줄 → 해제 후 실행하면 "제외 파일"에 표시 → 이전 run 정상 열림. 프롬프트 복사 모드에서 상세 블록 10k 이내, 첨부 구간 남음.

#### 1.5.12 하지 말 것
1. `DocKind`에 `'detail'` 추가 금지. 2. `AiRun`·`run.files`·`EvidenceRef` 필드 추가 금지. 3. `Extraction.files`에 상세 삽입 금지. 4. `API_FULLTEXT_MAX_CHARS`·`EXCERPT_MAX_CHARS` 상향 금지. 5. 상세 상한을 24k로 두지 않음. 6. 기준선 재생성·픽스처 추가 금지. 7. 상세 출처 match를 숨기거나 verdict 변경 금지. 8. extraction 없음 → NOT_FOUND 유지. 9. ResolveDialog 무변경. 10. AskRunner(D9)와 섞지 않음. 11. 프롬프트 문구에 숫자 금지, 버전은 올림. 12. 상세 page null은 정상. 13. 별도 플래그 금지(`filesParam`이 처리).


---

## 2. 1단계: 로컬 검색

### 2.1 코어 (`src/core/search/`)

- `constants.ts`: `SEARCH_MIN_QUERY_CHARS = 2`(정규화 후), `SEARCH_MAX_HITS_PER_DOC = 300`, `SEARCH_SNIPPET_CHARS = 160`, `DETAIL_TEXT_MAX_CHARS`, `NOTICE_TEXTS_MAX_CHARS`, 2단계 상수(3.6절).
- `types.ts`:
  ```ts
  export interface SearchDoc { id: string; kind: 'fields' | 'detail' | 'attachment'; label: string; kindLabel: string; textPath?: string; priority: number; lines: string[] }
  export interface SearchUnit { kind: 'line' | 'row'; start: number; end: number; lines: number[]; norm: string; /** norm[i] → { line, col } */ map: Array<{ line: number; col: number }> }
  export interface SearchQuery { terms: string[]; phrases: string[]; raw: string }
  export interface SearchSpan { line: number; from: number; to: number }  // 원문 줄, displayLine 기준 열
  export interface SearchHit { docId: string; unit: number; line: number; spans: SearchSpan[]; snippet: string }
  export interface SearchGroup { doc: SearchDoc; hits: SearchHit[]; total: number; truncated: boolean }
  ```
- `normalize.ts`:
  - `normalizeLine(line: string): { norm: string; map: number[] }`
    - 처리 순서: `displayLine(line)`(태그 제거) → `|` 제거 → NFC → zero-width 제거 → `：`→`:` → 공백 제거 → 소문자.
    - `map[i]`는 displayLine 문자열에서의 열이다.
    - `compact`를 그대로 쓸 수 없는 이유는 역매핑이 필요하기 때문이다.
  - `parseQuery(raw: string): SearchQuery`
    - `"…"` 묶음은 phrases로 보낸다. 나머지는 공백으로 나눈 뒤 항마다 정규화하고, 빈 항은 버린다.
    - 항·구문의 총 길이가 MIN보다 작으면 `terms:[]`를 돌려준다.
- `units.ts`: `buildUnits(lines: string[]): SearchUnit[]` — core로 옮긴 `buildTextBlocks(lines)`의 결과를 순회한다.
  - `line` 블록 → 유닛 1개. 빈 줄, `[표 k]` 줄, `[p N]` 줄은 유닛을 만들지 않는다.
  - `table` 블록 → 행마다 유닛 1개. 셀들의 `lines`를 r, c 순으로 이어 norm을 만들고, map에 line 정보를 담는다.
  - `page` 블록은 건너뛴다.
- `match.ts`: `searchDoc(doc, units, q, max = SEARCH_MAX_HITS_PER_DOC): { hits: SearchHit[]; total: number }`
  - 적중 조건: 유닛마다 `terms.every(t => norm.includes(t)) && phrases.every(...)`.
  - spans: 각 항의 모든 등장 위치를 `indexOf`로 반복해 찾는다(항당 최대 20). 찾은 위치는 map으로 원문 (line, from, to)로 바꾼다.
  - snippet: 첫 적중 주변 `SEARCH_SNIPPET_CHARS`자를 `displayLine` 텍스트에서 잘라낸다. 표 행은 셀을 ` | `로 잇는다. 앞뒤가 잘리면 `…`를 붙인다.
  - 문서 순서를 유지한다. `max`를 넘는 적중은 개수만 센다.
- `score.ts`: 2단계 전용이다. 1단계에서는 쓰지 않는다(3절).

### 2.2 `core/doc/text-blocks.ts` 이동 (D5)

- `ui/review/text-view.ts`의 다음 심볼을 그대로 옮긴다: `CELL_RE/TABLE_RE/PAGE_RE/MAX_TRAILING/TextCell/TextBlock/displayLine/parseCell/buildTextBlocks`.
- `text-view.ts`는 `export { buildTextBlocks, displayLine, type TextBlock, type TextCell } from '../../core/doc/text-blocks'`로 다시 내보낸다. 이 파일에는 `evidenceSpan`과 로컬 함수 `compact`만 남긴다.
- 동작 변경은 없다.

### 2.3 UI (`src/entrypoints/dashboard/search/`, 순수 로직은 `src/ui/search/`)

- `src/ui/search/search-view.ts` (React 없음)
  - `buildSearchDocs(notice, extraction, texts: NoticeTexts): SearchDoc[]`: 항목값 문서 → detail → 첨부(priority 순).
  - `groupLabel(doc)`
  - `drawerTargetOf(hit, doc, query): DrawerTarget`: `{ textPath, line: hit.line + 1, title: doc.label, query: raw }`를 돌려준다.
  - `fieldLinkOf(hit, doc): { hash: string; label: string } | null`: reviewKey가 있으면 `noticeHash(id,'review')`, 없으면 개요로 연결한다.
- `NoticeSearchProvider.tsx`
  - Context는 `{ open(noticeId: string, opts?: { title?: string; query?: string; mode?: 'search' | 'ask' }); close(); setCurrent(noticeId: string | null, title?: string) }`이다.
  - 상태는 `{ noticeId, title, query, mode } | null`이다.
  - 단축키 리스너(document keydown): `Ctrl+Shift+F`, 또는 `/`(target이 input/textarea/contenteditable이 아니고 수정키가 없을 때). current가 없으면 토스트 "공고 화면에서 쓸 수 있습니다"를 띄운다.
  - `App.tsx`에서 `<main>`의 형제로 `<NoticeSearchHost/>`를 렌더한다(EvalAutoDock 옆).
- `useSearchContext(noticeId, title)` 훅
  - 마운트 시 `setCurrent`, 언마운트 시 `setCurrent(null)`을 호출한다.
  - 사용 화면: `NoticeDetailPage`, `MailPreparePage`, `EvaluationDetailPage`, `CompareResultPage`(next 공고가 있을 때).
- `NoticeSearchPanel.tsx`
  - 배치: 오른쪽 고정 패널 `w-[min(760px,60vw)]`. 배경 딤은 `z-40`, aside는 `z-[45]`다. TextDrawer는 z-50이라 그 위에 겹친다.
  - 머리: 공고 제목(말줄임 금지, 2줄 wrap), 모드 세그먼트 [검색 | AI에게 질문], 닫기 버튼.
  - 데이터: 열릴 때 `notice/get`과 `notice/texts`를 병렬로 불러온다. 로딩 중에는 스피너, 실패하면 InlineAlert를 보인다.
  - 계산: `useMemo`로 docs→units를 1회 계산하고, 질의는 150ms 디바운스한다.
  - 닫기: Escape는 TextDrawer가 열려 있지 않을 때만 패널을 닫는다(drawer state로 판정).
- `SearchResults.tsx`
  - 그룹별 접이식 목록이다. 머리에는 종류 배지, 파일명, `n건`을 두고 기본은 펼침이다. 0건 그룹은 아래로 모아 회색 "일치 없음"으로 보인다.
  - 결과 하나는 스니펫이다. spans 위치를 `<mark>`로 강조하고, 표 행은 셀 구분을 `|`로 보인다. 쪽/줄도 표시한다(`[p N]` 역추적용으로 `pageAt`과 비슷한 함수를 core/search에 추가).
  - 클릭하면 TextDrawer가 열린다. 항목값 그룹은 드로어 대신 링크로 이동한다.
  - 상단에 "총 N건 · 문서 M개" 요약을 둔다. 상한을 넘은 그룹에는 "처음 300건만 표시"를 붙인다.
- 진입점 추가
  - `NoticeDetailPage` 헤더: 아이콘 버튼(`Search`, aria-label "이 공고에서 통합검색", 단축키 툴팁)을 MoreMenu 밖에 둔다. decisions 790행 사용자 결정의 "밖 3개" 다음에 아이콘 전용 버튼 1개를 추가하는 것이라 폭 영향이 작다.
  - `NoticesPage` 행: 제목 셀에 hover 시 보이는 작은 아이콘 버튼을 둔다. 행 클릭으로 전파되지 않게 `stopPropagation`을 건다. 구현자는 `open(id)`를 호출하는 셀 옆에 둔다.
  - `MailPreparePage`, `EvaluationDetailPage` 헤더에 아이콘 버튼을 둔다.
  - `RfpPage` 공고 슬롯(`source==='notice'`)과 `CompareResultPage`에 "이 공고에서 검색" 텍스트 버튼을 둔다.
  - `TextDrawer`: 검색 입력 오른쪽에 "모든 문서에서 검색"을 둔다(query를 넘겨 `open(noticeId, { query })`). RFP 업로드 문서(`load` prop 사용)일 때는 숨긴다.

### 2.4 성능 판단

- 공고 1건은 보통 첨부 5~15개, 총 20만~150만 자다.
- `normalizeLine`은 로드할 때 1회만 돈다(수십 ms). 질의마다 유닛 수(수만 개) × `includes`를 돌려도 수 ms다.
- 인덱스와 워커는 필요 없다. 400만 자 상한에서도 100ms 안에 끝난다. `useMemo`와 디바운스면 충분하다.

---

## 3. 2단계: AI 질문

### 3.1 후보 선정 (`core/search/score.ts`, `context.ts`)

- `questionTerms(q: string): { terms: string[]; bigrams: Set<string> }`
  - compact 후 끝에 붙은 조사·의문 어미를 떼어낸다. 목록은 상수 `ASK_STOPWORDS`다: 이야, 인가, 인가요, 뭐, 몇, 어떻게, 얼마, 언제, 까지, 부터, 은, 는, 이, 가, 을, 를, 의, 에, 로 등.
  - 공백으로 나눈 2자 이상의 항과, 질문 전체의 문자 bigram을 만든다.
- `scoreUnit(unit.norm, qt): number`
  - 점수 = `3 × (등장한 항 수)` + `(bigram 교집합 크기)` + 짧은 줄(30자 이하) 머리글 가산 1.
  - 0이면 후보가 아니다.
- `selectContext(docs, units, question, budget = ASK_CONTEXT_MAX_CHARS(40_000)): ContextSegment[]`
  - 점수 높은 유닛부터 창을 넓혀 담는다.
    - 표 밖 유닛: `[start-4, end+12]`.
    - 표 행 유닛: 그 표 전체(최대 150줄, excerpt `TABLE_MAX_LINES`와 같음)에 표 끝 뒤 주석 줄(`NOTE_LINE_RE` 재사용)까지.
  - 겹치는 창은 병합한다. 파일당 상한은 15,000자다.
  - 세그먼트는 `{ docId, from, to, text }`이다. text는 `renderLines` 방식으로 표 행을 ` | `로 잇는다(`core/ai/excerpt.ts`의 `renderLines`를 export해 재사용).
  - 항목값 문서는 항상 전부, 맨 앞에 넣는다.
- 점수가 모두 0이면 각 문서의 앞 60줄(excerpt `NO_KEYWORD_LINES`와 같음)과 항목값 문서를 보낸다.

### 3.2 프롬프트·스키마 (`core/search/ask-prompt.ts`)

- `ASK_SCHEMA_TAG = 'bidmate-search-ask/1'`, `ASK_PROMPT_VERSION = '1.0.0'`.
- system 원칙(기존 SYSTEM_PROMPT 어조를 따른다):
  - 문서에 적힌 내용만 답한다. 추정과 외부 지식은 금지한다.
  - 문서끼리 다르게 말하면 둘 다 출처와 함께 `conflicts`에 넣는다.
  - 찾지 못하면 `coverage:'not_found'`로 하고 "문서에서 찾지 못했습니다"라고 답한다.
  - 인용은 글자 그대로, 한 줄 또는 표 한 행, 300자 이내로 한다.
  - file은 `=== 파일: … ===`의 이름을 그대로 쓰고, page는 `[p N]`을 쓴다.
  - 프롬프트에 공고 고유의 숫자·문구를 넣지 않는다. 기존 린트 `ai-prompt-lint` 방식을 이 파일에도 적용한다.
- user 메시지 구성: `## 질문`, `## 출력 형식`(예시 JSON), `## 문서 발췌`. 세그먼트 머리는 excerpt 형식을 재사용한다(`=== 파일: 이름 (종류) ===`, `--- [p N] 부근, 줄 a~b ---`).
- 출력 스키마 `askOutputSchema(runId)`
  - `providers/schema.ts` 옆이 아니라 core에 둔다. 형식은 같은 표준 JSON Schema다(additionalProperties false, 모든 속성 required, enum 사용).
  ```json
  { "schema": "bidmate-search-ask/1", "runId": "...", "answer": "string", "coverage": "answered|partial|not_found",
    "citations": [{ "file": "string|null", "page": "integer|null", "quote": "string", "note": "string" }],
    "conflicts": [{ "topic": "string", "values": [{ "file": "string", "quote": "string", "value": "string" }] }] }
  ```
- `parseAskResponse(text, { runId })`
  - `extractJson`을 재사용한다(`core/ai/parse.ts`에서 이미 export).
  - schema와 runId를 검사한다.
  - citations는 최대 12개, conflicts는 최대 6개로 자르고, answer는 4,000자에서 자른다.

### 3.3 검증 (`core/search/ask-verify.ts`)

- `locateCitations(citations, docs: Array<{ id, name, textPath, text }>): LocatedCitation[]`
  - 파일은 `findFileByName`과 비슷하게 찾는다(정확 일치 → endsWith).
  - 그 파일에서 `locateQuote(text, quote)`(`core/ai/verify.ts` export 유지)로 위치를 찾는다. 못 찾으면 다른 문서도 차례로 찾는다.
  - 결과는 `{ ...citation, located: { docId, textPath, line, endLine, page } | null, partial }`이다.
  - conflicts의 values도 같은 방식으로 처리한다.
- 값 자체는 검증하지 않는다. AiKey 의미가 없어서 `valueInQuote`를 쓸 수 없다.
- UI 문구는 "근거 위치 확인됨" / "원문에서 찾지 못함(답은 참고만)"이다.

### 3.4 엔진·메시지 (`src/engine/search/`)

- 타입(`src/core/types/search.ts`):
  ```ts
  export interface AskCitation { file: string | null; page: number | null; quote: string; note: string; located: { docId: string; textPath: string; line: number; endLine: number; page: number | null } | null; partial?: boolean }
  export interface AskConflict { topic: string; values: Array<{ file: string; quote: string; value: string; located: AskCitation['located'] }> }
  export interface AskRecord { id: string; createdAt: ISODate; finishedAt?: ISODate; question: string; provider: AiProvider; model: string; promptVersion: string; contextMode: 'context' | 'full'; contextChars: number; files: Array<{ docId: string; name: string; chars: number }>; status: 'done' | 'failed' | 'cancelled'; answer?: string; coverage?: 'answered' | 'partial' | 'not_found'; citations: AskCitation[]; conflicts: AskConflict[]; usage?: { inputTokens: number; outputTokens: number }; error?: { code: string; message: string }; warnings: string[]; promptPath: string; responsePath?: string; extractionJobId: string | null; detailCapturedAt?: ISODate }
  export interface AskFile { schemaVersion: 1; noticeId: string; asks: AskRecord[] }  // 최신 먼저, 최대 ASK_MAX_RECORDS=30
  ```
- `search-store.ts`
  - 경로: `askFilePath(folder)=…/search/asks.json`, `askPromptPath/askResponsePath(folder, id)=…/search/<id>-prompt.txt|-response.txt`.
  - `AskStore.load/mutate`는 AiReviewStore와 같은 패턴을 쓴다(락, 초과분 txt 삭제).
- `ask-api.ts`: `askNotice(store, p: { noticeId; askId; question; provider; api: { key; model }; contextMode; fetch; signal }, deps: { now?; isBusy? }): Promise<AskRecord>`
  1. notice와 extraction을 불러온다.
  2. `readNoticeTexts`를 재사용해 detail과 첨부 텍스트를 읽는다.
  3. 질문 길이를 검사한다(1~500자, `ASK_QUESTION_MAX_CHARS`).
  4. 항목값 문서는 대시보드가 보낸 `fieldDocText: string`을 쓴다. 엔진은 ui를 import할 수 없어 `overviewGroups`를 쓰지 못하기 때문이다(`ai-review-api.ts:27` 주석과 같은 이유).
  5. `selectContext`로 컨텍스트를 고른다. full 모드면 `buildFullText`처럼 전문을 이어 붙인다. 상한을 넘으면 'context'로 돌아가고 warning을 남긴다.
  6. `buildAskPrompt`로 프롬프트를 만든다. 진행 중 record는 메모리에만 두고(status 'requesting'은 두지 않음), 파일에는 완료/실패만 기록한다.
  7. `callProvider(adapter, { schema: askOutputSchema, schemaName: 'bidmate_search_ask', maxTokens: 4096 })`를 호출한다.
  8. 응답을 parse하고 인용 위치를 locate한다.
  9. `AskStore.mutate`로 저장하고(prompt/response txt 포함) record를 돌려준다.

  예외 처리는 다음과 같다.
  - 실패도 record(status failed)로 저장해 이력에 남긴다.
  - 취소(signal)면 저장하지 않고 `AI_RUN_CLOSED`를 던진다.
- `ask-runner.ts`: `AskRunner { exec(p): Promise<AskRecord>; cancel({ noticeId, askId }) }`
  - 공고당 1개만 실행한다(`Map<noticeId, {askId, abort}>`). 이미 실행 중이면 `SEARCH_ASK_BUSY`.
- 메시지(`protocol.ts`)
  - `search/ask`: 대시보드→SW. `{ noticeId; askId; question; fieldDocText: string; provider?: AiProvider; contextMode?: 'context' | 'full' }` → `AskRecord`
  - `search/ask-exec`: SW→offscreen 전용. 위 payload에 `api: { key; model }`를 더한다 → `AskRecord`
  - `search/ask-cancel`: `{ noticeId; askId }` → `{ cancelled: boolean }`
  - `search/asks-get`: `{ noticeId }` → `AskFile | null`
- `router.ts`의 `relaySearchAsk()`: `ai/run` 릴레이(259~277행)와 구조가 같다.
  - 순서: `assertExtensionSender` → `readAiSettings` → provider 기본값 적용 → `requireAiAccess` → `ensureOffscreen` → `send('search/ask-exec', …, { target:'offscreen', timeoutMs: 150_000 })`.
  - 키나 모델이 없으면 `AI_KEY_MISSING`/`AI_MODEL_MISSING`을 던진다.
  - 오류 메시지에는 `maskKey`를 적용한다.
  - `question` 500자, `fieldDocText` 20,000자 상한을 검사한다(초과 시 PAYLOAD_TOO_LARGE).
  - `search/ask-cancel`과 `search/asks-get`은 `EXTENSION_ONLY_TYPES`에 넣는다.
  - 대시보드의 `send` 타임아웃은 160초다.
- offscreen `main.ts`: `const askRunner = new AskRunner({ store: fileStore, fetch })`를 만들고 `listen` 세 개를 추가한다.
- **부가 결정**
  - `AiRunner`(재검토)와 `AskRunner`는 잠금을 공유하지 않는다(쓰는 파일이 다르다).
  - 삭제 중인 공고(`deletingNotices`)는 `askNotice` 진입 시 `deps.isBusy?.(noticeId)`로 확인해 `JOB_ALREADY_RUNNING`을 던진다(ai-review-api와 같음).
  - `notice/delete`가 공고 폴더를 지우면 asks.json도 같이 지워진다. 폴더 안에 있으므로 추가 작업이 필요 없다.

### 3.5 UI (`AskPanel.tsx`)

- 입력
  - 질문 textarea: Enter로 질문하고 Shift+Enter로 줄을 바꾼다.
  - 공급자 `Select`: 키가 있는 공급자만 보인다. 기본값은 settings.ai.provider이고 `ProviderIcon`을 쓴다.
  - 보내기 버튼.
  - 키가 없으면 InlineAlert와 `#/settings?section=ai` 링크를 보인다.
- 진행
  - 버튼에 스피너를 띄우고 "문서 N개 · 약 M자 전송"을 안내한다. 같은 core 함수 `selectContext`를 대시보드에서 먼저 돌려 글자 수를 미리 계산한다.
  - 취소 버튼은 `search/ask-cancel`을 보낸다.
- 답
  - answer(줄바꿈 유지)와 coverage 배지(답함/일부/못 찾음)를 보인다.
  - 근거 목록: 파일명, 쪽, 인용을 보이고, 클릭하면 TextDrawer를 `{ textPath, line, quote, title }`로 연다. `located:null`이면 회색으로 "원문에서 찾지 못함"을 보인다.
  - 상충 블록: topic별로 값과 출처를 나열하고, 각각 클릭하면 원문 위치로 이동한다.
  - usage 토큰 수를 보인다.
  - coverage가 answered가 아니면 "전문으로 다시 질문" 버튼(contextMode 'full', 안내 "최대 25만 자 전송")을 보인다.
- 이력
  - 패널을 열 때 `search/asks-get`으로 최근 질문 목록(질문, 시각, 공급자)을 불러온다. 클릭하면 답을 다시 보인다.
  - `extractionJobId`가 현재와 다르거나 `detailCapturedAt`이 현재 notice.detailText와 다르면 "그 뒤 다시 수집됨" 배지를 단다.
- 검색 모드에서 질문 모드로 바꾸면 현재 질의어를 textarea 초깃값으로 넘긴다.

### 3.6 비용·상한 상수 (`core/search/constants.ts`)

| 상수 | 값 |
|---|---|
| `ASK_CONTEXT_MAX_CHARS` | 40_000 |
| `ASK_FILE_MAX_CHARS` | 15_000 |
| `ASK_FULL_MAX_CHARS` | `API_FULLTEXT_MAX_CHARS`(250_000) |
| `ASK_MAX_TOKENS` | 4_096 |
| `ASK_QUESTION_MAX_CHARS` | 500 |
| `ASK_MAX_RECORDS` | 30 |
| `ASK_MAX_CITATIONS` | 12 |
| `ASK_TIMEOUT_MS` | 150_000 (대시보드 160_000) |

---

## 4. 단계 분할 (위임 단위)

### S0 — 코어 이동과 검색 코어 (implementer, 테스트 포함)

| 파일 | 작업 |
|---|---|
| `src/core/doc/text-blocks.ts` (신규) | text-view.ts에서 `displayLine`, `buildTextBlocks`, 타입, 정규식을 옮긴다 |
| `src/ui/review/text-view.ts` | 옮긴 심볼을 re-export하고 `evidenceSpan`·`compact`만 남긴다 |
| `src/core/search/{constants,types,normalize,units,match}.ts` (신규) | 2.1절 시그니처 |
| `tests/core/search-normalize.test.ts`, `search-units.test.ts`, `search-match.test.ts` | 7절 케이스 |

완료 조건: 기존 테스트 전부 통과(이동만 했으므로), 새 테스트 통과, `tsc --noEmit` 통과.

### S1 — 상세 전문 수집과 저장 (implementer, collect-job 변경은 코어에 가까우므로 리뷰 필수)

| 파일 | 작업 |
|---|---|
| `src/adapters/g2b/detail-text.ts` (신규) | `readPageDoc(doc, opts): DocModel \| null`, `readPageText(doc, opts): { text: string; truncated: boolean } \| null`(renderText 적용) |
| `src/core/types/job.ts` | `HtmlFields.pageText?: string; pageTextTruncated?: boolean` |
| `src/core/types/notice.ts` | `Notice.detailText?` |
| `src/entrypoints/g2b.content.ts:32`, `src/ui/g2b-panel/controller.ts:306` | `readHtmlFields` 결과에 `readPageText` 결과를 합친다(match/notice가 있을 때만) |
| `src/engine/jobs/collect-job.ts` | `persistPageText` 헬퍼, 169~172행과 224행 뒤에서 호출 |
| `src/ui/notice-detail/view.ts`, `FilesTab.tsx` | 상세화면 가상 행 |
| `tests/g2b/detail-text.test.ts`(jsdom, `tests/fixtures/g2b-detail.html` 재사용), collect-job 테스트 | pageText 저장 케이스 추가 |

완료 조건:
- 실제 나라장터 상세에서 수집하면 `source/text/[상세] 나라장터 상세화면.txt`가 생기고 notice.json에 detailText가 들어간다.
- FilesTab에서 이 행을 누르면 TextDrawer로 열린다.
- 재추출한 뒤에도 파일과 필드가 남아 있다.

### S2 — `notice/texts`와 1단계 UI (implementer, UI 모양은 메인이 확인)

| 파일 | 작업 |
|---|---|
| `src/messaging/protocol.ts`, `src/background/router.ts`, `src/entrypoints/offscreen/main.ts`, `src/engine/notices/notice-api.ts` | `notice/texts` |
| `src/ui/search/{search-view,field-doc}.ts` (신규) | 2.3절 |
| `src/entrypoints/dashboard/search/{NoticeSearchProvider,NoticeSearchPanel,SearchResults,SearchButton}.tsx` (신규) | 2.3절 |
| `App.tsx` | Provider로 감싸고 Host를 렌더 |
| `NoticeDetailPage.tsx`, `NoticesPage.tsx`, `MailPreparePage.tsx`, `evaluations/EvaluationDetailPage.tsx`, `rfp/{RfpPage,CompareResultPage}.tsx`, `review/TextDrawer.tsx` | 진입점과 `useSearchContext` |
| `tests/ui/search-view.test.ts` | 그룹 순서, DrawerTarget 변환, 항목값 문서 평탄화 |

완료 조건:
- 어느 공고 화면에서든 패널이 열린다.
- 띄어쓰기가 다른 질의(`실적인정기간`과 `실적 인정 기간`)가 같은 결과를 낸다.
- 표 행 결과를 누르면 드로어가 해당 행으로 이동해 강조한다.
- 상세 전문이 없는 공고에는 안내 문구가 보인다.

### S3 — 2단계 코어 (메인 직접 또는 implementer, 리뷰 필수)

| 파일 | 작업 |
|---|---|
| `src/core/types/search.ts` (신규) | 3.4절 타입 |
| `src/core/search/{score,context,ask-prompt,ask-verify}.ts` (신규) | 3.1~3.3절 |
| `src/core/ai/excerpt.ts` | `renderLines`, `pageAt` export(동작 변경 없음) |
| `src/core/ai/parse.ts` | `extractJson`이 이미 export되어 있어 변경 없음 |
| `tests/core/search-score.test.ts`, `search-context.test.ts`, `ask-prompt.test.ts`(숫자 토큰 금지 린트, `ai-prompt-lint`와 같음), `ask-verify.test.ts` | 7절 케이스 |

완료 조건: 테스트와 프롬프트 린트 통과.

### S4 — 2단계 엔진·메시지·UI (implementer, 라우터와 러너는 리뷰)

| 파일 | 작업 |
|---|---|
| `src/engine/search/{search-store,ask-api,ask-runner}.ts` (신규) | 3.4절 |
| `protocol.ts`, `router.ts`(`relaySearchAsk`, EXTENSION_ONLY_TYPES, TIMEOUT), `offscreen/main.ts` | 메시지 4종 |
| `src/entrypoints/dashboard/search/AskPanel.tsx` (신규), `NoticeSearchPanel.tsx` 모드 전환 | 3.5절 |
| `tests/engine/ask-api.test.ts`(메모리 FileStore와 fetch 모의), `tests/background/search-router.test.ts`(`ai-router.test.ts` 패턴) | 7절 케이스 |

완료 조건:
- Gemini 키로 실제 질문 1회가 성공한다.
- 인용을 누르면 원문 위치로 이동한다.
- 키가 없는 공급자는 고를 수 없다.
- 취소가 동작한다.
- asks.json이 30건 상한을 지킨다.

### S5 — 마무리 (메인)

- `architecture.md`/README에 반영할지 확인한다.
- 전체 테스트와 타입체크를 1회 돌린다.
- 쓰지 않는 export를 정리한다.

---

## 5. 하지 말아야 할 것

1. **pageText를 `Job`·storage.session·`CollectResult`에 넣지 않는다.** `JobRunPayload.html`로만 흐른다(storage.session 대용량 금지 결정, 178행).
2. **상세 전문 파일 이름을 첨부 패턴(`${index}_…`)으로 만들지 않는다.** extract-step의 `usedText` 충돌 회피와 별도 네임스페이스여야 재추출에 안전하다.
3. **core/search가 `ui/`를 import하지 않는다.** 항목값 문서(`overviewGroups`)는 ui 계층에서 만들고, 엔진에는 `fieldDocText`로 넘긴다.
4. **1단계에 관련도 정렬을 넣지 않는다.** 문서 순서가 결정 사항이다. 점수 함수는 2단계 전용이다.
5. **AI 답의 숫자를 "검증됨"으로 표시하지 않는다.** 검증하는 것은 인용문의 위치뿐이다. UI 문구도 "근거 위치 확인"으로 한정한다.
6. **`AiRunner`·`ai-review.json`·`AiKey`를 재사용하지 않는다.** 질문에는 키 색인이 없다(RFP D10과 같은 판단).
7. **반자동(붙여넣기) 모드를 2단계에 넣지 않는다.** 범위 밖이다.
8. **detail-reader의 안정 판정에 pageText를 넣지 않는다.** 전문은 렌더 타이밍에 따라 흔들려 45초 타임아웃을 일으킨다. `fields`만 비교하는 현재 구조를 유지한다.
9. **TextDrawer의 `line`은 1부터 센다**(`evidenceSpan`이 `line-1`을 쓴다). SearchHit.line은 0부터이므로 +1 한다.
10. **표 행 유닛의 norm은 셀 경계 없이 이어진다.** "경영|상태"가 "경영상태"로 매치되는 것은 의도된 동작이다(띄어쓰기 무시와 같은 논리). 거짓 적중이 보고되면 그때 경계 문자 삽입을 다시 검토한다.
11. **`notice/texts` 응답은 패널을 닫아도 버리지 않는다.** noticeId를 키로 1건만 캐시해 같은 공고를 다시 열 때 비용이 들지 않게 한다. 다른 공고를 열면 교체한다. `notice/get` 결과와 비교해 `extractionJobId`가 바뀌었으면 다시 불러온다.
12. **단축키 `/`는 입력 요소에 포커스가 있을 때 절대 가로채지 않는다**(TextDrawer 검색창, 템플릿 편집기 등).

---

## 6. 검증 방법

- **코어 테스트**(S0/S3): 7절 케이스를 쓴다. `tests/fixtures`의 실제 추출 txt 1~2개로 유닛 분해 회귀를 확인한다.
- **DOM 테스트**(S1): `tests/fixtures/g2b-detail.html`로 `readPageDoc`을 확인한다.
  - (a) 표를 DocTable로 만든다.
  - (b) 입력값을 포함한다.
  - (c) display:none 요소를 제외한다.
  - (d) 같은 텍스트가 중복되지 않는다.
  - (e) renderText 결과를 `buildTextBlocks`가 다시 표로 읽는다.
- **수동 확인**
  1. 나라장터 공고 1건을 재수집하고 FilesTab에 상세 행이 생기는지 본다.
  2. 검색 패널에서 "제안서 제출"을 검색해 상세·공고문·항목값 세 그룹에 결과가 뜨는지, 각 결과를 누르면 이동하는지 본다.
  3. "실적 인정 기간은?"이라고 질문해 coverage와 인용 위치를 확인하고, "전문으로 다시 질문" 경로를 1회 확인한다.
- **보안 경계**
  - `search/ask-exec`는 offscreen 전용이다. `EXTENSION_ONLY_TYPES`에 넣지 않고, SW 리스너도 두지 않는다.
  - 대시보드 payload에는 키가 없어야 한다(`ai-router.test.ts`와 같은 방식으로 테스트).

---

## 7. 테스트 케이스

- **normalize**
  - 공백·탭·줄바꿈 제거
  - `[셀 1 2 rs2] 텍스트`에서 태그를 제거한 뒤 map이 displayLine 열을 가리킴
  - `|` 제거, 대문자→소문자, NFC(자모 분리 입력), 전각 콜론
  - parseQuery: `"실적 인정"` 구문과 일반 항 혼합, 1자 항 제거, 전부 1자면 terms 빈 배열
- **units**
  - 문단 줄 → line 유닛
  - `[표 1]`과 셀 3개 2행 → row 유닛 2개, lines에 이어진 줄 포함
  - `[p 3]` 줄과 빈 줄은 유닛 없음
- **match**
  - AND 의미(한 항만 있으면 불일치)
  - 표 행에서 두 항이 다른 셀에 있어도 적중
  - spans가 원문 줄·열로 환산됨
  - 300건 상한과 total
  - 스니펫 앞뒤 `…`
  - 구문은 공백을 무시한 연속 일치
- **detail-text**: 6절 (a)~(e)와 300k자 상한 truncated
- **collect-job**
  - html.pageText가 있으면 파일 저장과 `notice.detailText` 설정
  - 없으면 둘 다 없음
  - 재시도 경로에서도 저장
  - writeText 실패가 잡 상태를 바꾸지 않음
- **notice/texts**
  - detail이 priority 0으로 맨 앞, 첨부는 priority 정렬
  - 파일당 2MB·총 4M 상한 초과 시 skipped budget
  - `source/text` 밖 textPath는 무시(PATH_FORBIDDEN이 아니라 skipped failed)
  - extraction이 없으면 detail만
- **score/context**
  - 항 적중 가중치가 bigram보다 큼
  - 표 행 적중 시 표 전체와 주석 결속 포함
  - 파일당·총 상한 준수
  - 적중 0이면 앞 60줄 폴백
  - 항목값 문서가 항상 맨 앞
- **ask-prompt**
  - schema·runId 고정, 숫자 토큰 린트, 세그먼트 머리 형식
  - parse: runId 불일치는 `AI_RUN_MISMATCH`, citations 12개 절단, answer 절단
- **ask-verify**
  - 정확 일치, 표 행 조각(`a | b`), 못 찾으면 null
  - 파일명 endsWith 매칭
  - 다른 파일에서 찾으면 warning
- **ask-api**
  - 성공 저장(asks.json과 txt 2개), 실패 저장(status failed), 취소 시 저장 없음
  - 공고당 1개 BUSY
  - 30건 초과 시 오래된 txt 삭제
  - full 모드 상한 초과 시 context 폴백과 warning
- **router**
  - 키 없음 `AI_KEY_MISSING`
  - payload에 키 없음, exec에 키 주입
  - question 500자 초과 시 PAYLOAD_TOO_LARGE
  - 확장 밖 발신자 거부
- **search-view**
  - 그룹 순서(fields→detail→attachment priority)
  - DrawerTarget line +1
  - 항목값 문서에서 `—` 행 제외, review 키 링크

---

## 8. 가정 (실측 권장)

- Chrome이 브라우저 수준에서 `Ctrl+Shift+F`와 `/`를 쓰지 않는다고 가정했다. `/`는 확실하다. `Ctrl+Shift+F`는 Windows Chrome에 바인딩이 없는 것으로 알고 있지만 실측이 필요하다.
- `readPageDoc` 테스트는 `tests/g2b/detail-page.test.ts`와 같은 jsdom 환경에서 가능하다(파일 머리의 `// @vitest-environment jsdom` 확인함).
- SW 요청/응답 150초 유지는 `eval/collect` 90초, `rfp/upload` 120초 전례에 근거한 추정이다. 1회 실측을 권장한다.
