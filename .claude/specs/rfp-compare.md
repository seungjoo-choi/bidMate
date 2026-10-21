# RFP 요구사항 비교 (Fable 설계, 2026-10-21)

이전 제안요청서와 이번 제안요청서의 요구사항을 번호·내용으로 짝지어 동일/변경/신규/삭제를 보여 준다. 용도: 작년 제안서 재활용 시 변경점 파악.

## 0. 확정된 사용자 결정
- 비교 대상: 수집한 공고의 첨부 RFP, 직접 업로드한 파일(HWP/HWPX/PDF/DOCX), 섞어서도 가능.
- 2개 1:1. 슬롯 이름은 **이전 문서 / 이번 문서**(⇄ 바꾸기 있음). 신규=이번에만, 삭제=이전에만.
- 짝짓기·diff는 규칙 기반, AI는 사용자가 누를 때만 변경점 요약.
- 진입점: 왼쪽 메뉴 "RFP 비교"(`#/rfp`) + 공고 상세 헤더 [변경점 비교] 버튼 → **이번 문서** 슬롯을 그 공고로 채움(`#/rfp?next=<noticeId>`).
- 시각 스타일: `.claude/specs/rfp-compare-mockup.html`(메인 목업) 기준.

## 1. 구조
```
[dashboard #/rfp]  슬롯 2개(이전/이번) → 공고 고르기 | 파일 올리기 → [비교하기]
      │ rfp/*  (SW relayExtensionOnly, 키 주입은 rfp/ai-summarize만)
[offscreen] RfpService: 바이트 읽기(첨부/업로드) → parsers → renderText → core/rfp/extract → RequirementSet JSON 저장
[dashboard #/rfp/compare/<id>]  RequirementSet 2개 + overrides → core/rfp/match(순수) → 결과 화면
                                 AI 요약: core/rfp/ai-input(순수) → rfp/ai-summarize → offscreen callProvider
```
핵심 결정 D1~D13은 `decisions.md` "2026-10-21 RFP 요구사항 비교" 참조.

## 2. 데이터 모델 (`src/core/types/rfp.ts`, 신규)
```ts
export const RFP_EXTRACTOR_VERSION = 1;
export type RfpDocRef =
  | { kind: 'notice'; noticeId: string; attachmentId: string; innerPath?: string }   // innerPath: zip 내부 경로
  | { kind: 'upload'; uploadId: string };
export type RequirementForm = 'card' | 'list' | 'para';
export interface RequirementItem {
  id: string;        // 원문 표기 "SFR-01"
  key: string;       // 정규화 "SFR-001" (접두어 대문자, 하이픈 통일, 번호 3자리, 하위번호 2자리)
  prefix: string; seq: number; sub?: number;
  name: string; category?: string; definition?: string; detail?: string;
  extras?: Array<{ label: string; text: string }>;   // 산출정보, 관련요구사항 등 모르는 라벨
  form: RequirementForm;
  loc: { line: number; page?: number; table?: number };  // 렌더 텍스트 줄(0부터)
  dupCount?: number;  // 같은 key가 여러 곳(요약표+카드)에 있었음
}
export interface RequirementSet {
  schemaVersion: 1; extractorVersion: number; ref: RfpDocRef; extractedAt: ISODate;
  source: { name: string; format: DocFormat; size: number; pages?: number; textPath: string };
  items: RequirementItem[];
  prefixes: Array<{ prefix: string; label?: string; count: number }>;
  quality: 'good' | 'partial' | 'none';
  warnings: string[];
  stats: { tables: number; cardTables: number; listTables: number; paraItems: number; idLikeUnparsed: number; ms: number };
}
export interface RfpUploadEntry { uploadId: string; name: string; label?: string; size: number; format: DocFormat; uploadedAt: ISODate; itemCount: number; quality: RequirementSet['quality'] }
export interface RfpDocCandidate { ref: Extract<RfpDocRef,{kind:'notice'}>; name: string; docKind: DocKind; status: 'ready' | 'parse_needed' | 'unsupported'; itemCount?: number; quality?: RequirementSet['quality'] }

export type RfpPairOverride = { op: 'pair'; prevKey: string; nextKey: string } | { op: 'unpair'; prevKey: string; nextKey: string };
export interface RfpCompareSession {
  schemaVersion: 1; id: string; createdAt: ISODate; updatedAt: ISODate;
  prev: { ref: RfpDocRef; title: string; subtitle?: string };   // 표시용 제목은 저장 시점 스냅샷
  next: { ref: RfpDocRef; title: string; subtitle?: string };
  overrides: RfpPairOverride[];
  reviewed: string[];              // 확인함 pair key
  ai?: RfpAiSummary[];             // 최신이 마지막
}
// 계산 결과(저장 안 함)
export type RfpPairStatus = 'same' | 'changed' | 'added' | 'removed';
export type RfpPairTag = 'renumbered' | 'numeric' | 'minor' | 'split' | 'merged' | 'id_collision';
export interface RfpPair {
  key: string;                      // `${prevKey ?? '-'}|${nextKey ?? '-'}`
  status: RfpPairStatus; prev?: RequirementItem; next?: RequirementItem;
  matchedBy?: 'id' | 'similarity' | 'manual'; score?: number;
  tags: RfpPairTag[]; changeRatio?: number;
  group?: { kind: 'split' | 'merged'; keys: string[] };
}
export interface RfpCompareResult { pairs: RfpPair[]; counts: Record<RfpPairStatus, number>; groups: number; prefixes: string[] }
export type DiffSegment = { op: 'eq' | 'ins' | 'del'; text: string };
export interface RfpAiInput { scope: 'changed' | 'selected'; prevTitle: string; nextTitle: string; items: Array<{ key: string; status: RfpPairStatus; prevId?: string; nextId?: string; name: string; text: string }>; chars: number; truncated: boolean; omitted: number }
export interface RfpAiSummary { id: string; at: ISODate; provider: AiProvider; model: string; scope: RfpAiInput['scope']; selectedKey?: string; overall: string; highlights: Array<{ key: string; summary: string; impact: 'high' | 'medium' | 'low' }>; risks: string[]; usage?: { inputTokens: number; outputTokens: number } }
```

저장 위치:
- 수집 공고: `notices/<folder>/rfp/<attachmentId>.json` + `.txt`(렌더 텍스트). zip 내부는 `rfp/<attachmentId>__<sanitize(innerPath 파일명,40)>.json`.
- 업로드: `rfp/uploads/<uploadId>/source.<ext>`, `requirements.json`, `text.txt`. 목록은 디렉터리 나열로 파생(index 없음). `uploadId = u_<yyyymmddHHMMss>_<rand4>`.
- 세션: `rfp/compares/<compareId>.json`. 목록은 나열로 파생. 쓰기는 `withLock(path)`.
- 무효화: 읽을 때 `extractorVersion !== RFP_EXTRACTOR_VERSION` 또는 `source.size !== 현재 파일 크기`면 재추출. `force:true`면 무조건.

## 3. 요구사항 추출 (`src/core/rfp/extract.ts`, 순수 — 코어)
`extractRequirements(doc: DocModel, opts: { sourceName: string }): Omit<RequirementSet,'ref'|'source'|'extractedAt'>`. **반드시 `renderText(doc)` 호출 뒤에** 호출(renderText가 `loc.line`을 채움).

DocModel 사실: hwp5·hwpx 모두 `cell.blocks`에는 **중첩 표만**, 문단은 `cell.text`에 합쳐져 있다. 실물 픽스처: `tests/fixtures/docs/R26BK01722175/2. 제안요청서.hwp`, `tests/fixtures/docs/R26BK01631407/(붙임2) 제안요청서(...).hwp`, 구조 참고 `tests/fixtures/docs/R26BK01722175/research-f3.txt:1520-1600`(카드형·목록형 둘 다, 가이드에 없는 접두어 RSR).

ID 정규식(`core/rfp/ids.ts`): 트림, 전각 하이픈·대시 변형을 `-`로 통일한 뒤 `^(?<prefix>[A-Z]{2,6})\s*[-–—_‐]\s*(?<num>\d{1,4})(?:\s*[-–.]\s*(?<sub>\d{1,3}))?(?<rest>.*)$`. `rest`가 있으면 "ID+명칭 한 셀"로 명칭 후보. 접두어 사전(라벨용, 가이드 최신판 대조 필요): SFR 기능, PER 성능, SER 보안, DAR 데이터, INR 인터페이스, TER 테스트, COR 제약사항, QUR 품질, CSR 지원, PMR 프로젝트 관리, PSR 프로젝트 지원, ECR 시스템 장비구성. **사전에 없어도 패턴이 맞고 문서 안에 같은 접두어가 2회 이상이면 인정.**

라벨 동의어(공백·괄호 제거 후 비교): 고유번호={요구사항고유번호,고유번호,요구사항번호,요구사항ID,ID,식별번호,식별자}, 명칭={요구사항명칭,요구사항명,명칭,요구사항이름,항목명}, 분류={요구사항분류,분류,구분,유형}, 정의={정의,요구사항정의,개요}, 세부내용={세부내용,상세내용,요구사항세부내용,상세설명,내용,요구사항내용,설명}. 그룹 라벨 {요구사항상세설명,상세설명,설명}은 같은 행의 **다음 셀이 라벨이면** 그 하위 라벨을 쓴다(예: c0 "요구사항 상세설명", c1 "정의", c2 값).

표 처리(모든 표를 `cell.blocks` 중첩 표까지 **재귀**):
1. 가상 격자 전개: rowSpan/colSpan을 채워 `grid[r][c] → cell`(병합 셀은 원 셀 참조).
2. **카드형**: 각 행에서 "라벨 셀 → 바로 오른쪽 비어 있지 않은 셀" 쌍을 왼→오 훑는다(4열 `고유번호|SFR-001|명칭|로그인`도). 고유번호 라벨의 값이 ID 정규식에 맞으면 카드 시작, 다음 고유번호 라벨까지의 쌍을 필드로 매핑, 매핑 안 되는 라벨은 `extras`. 한 표에 카드 여러 장도 처리. **값 열을 고정 인덱스로 짜지 말 것.**
3. **목록형**: 처음 3행 중 라벨 동의어 2개 이상 + 고유번호 계열 포함 행을 헤더로 열 맵. 헤더가 없어도 ID 정규식에 맞는 셀이 3개 이상인 열은 ID 열(요약표). 각 행: ID 셀이 맞으면 항목, 병합 셀은 격자에서 이어받음. 명칭 열이 없고 `rest`가 있으면 rest가 명칭.
4. **문단형 폴백**(카드+목록 합계 < 3일 때만, PDF는 사실상 이 경로): 문단이 `^ID[\s:：.)]+명칭`이면 항목, 다음 ID 줄 또는 짧은 번호 제목줄(`^\d+(\.\d+)*\s`, 30자 이하) 전까지를 detail(2,000자 상한).
5. 같은 key 중복 병합: detail이 긴 쪽 우선, 빈 필드는 다른 쪽으로 채움, `dupCount` 기록. 접두어별 집계.
6. 품질: `none`(0건) / `partial`(5건 미만, 또는 `idLikeUnparsed` > 항목수×0.2, 또는 명칭 빈 항목 30% 초과) / `good`. warnings 예: "표 12개 중 ID 셀이 있으나 라벨을 못 찾은 표 3개", "PDF는 표를 인식하지 않아 목록형만 제한적으로 인식".

## 4. 짝짓기·차이 (`src/core/rfp/{normalize,similarity,diff,match,constants}.ts` — match는 코어)
`normalizeText`: NFC, 라틴 소문자, 각 줄 글머리 제거(`^[o○●•·▪◦ㅇ※\-–]\s*`), 전각 문장부호→반각, 연속 공백 1칸, 끝 문장부호 제거. `dice(a,b)`: 공백 제거 후 문자 bigram Dice, 길이 <2는 동일성.

상수(`constants.ts`, S5 실측 후 조정): `ID_ACCEPT_NAME=0.5`, `ID_ACCEPT_BODY=0.4`, `PAIR_THRESHOLD=0.6`, `W_NAME=0.6`, `W_BODY=0.4`, `PREFIX_BONUS=0.1`, `CONTAIN_THRESHOLD=0.6`, `CONTAIN_MIN_CHARS=20`, `MINOR_RATIO=0.05`, `RFP_UPLOAD_MAX_MB=20`, `AI_INPUT_MAX_CHARS=60_000`, `AI_ITEM_MAX_CHARS=1_500`. body = definition+detail 정규화 결합.

`compareSets(prev, next, overrides): RfpCompareResult`(결정적: 같은 입력 → 같은 출력):
0. override `pair`는 먼저 확정(matchedBy manual), `unpair`는 후보 금지 집합.
1. key 일치: `dice(name)≥0.5 || dice(body)≥0.4 || 둘 다 비어 있음`이면 matchedBy id. 아니면 보류 + `id_collision` 태그(최종 짝에 유지).
2. 남은 것끼리 `score = 0.6·dice(name) + 0.4·dice(body) + (접두어 같으면 0.1)`, `≥0.6` 후보, 내림차순 그리디 1:1. matchedBy similarity, key가 다르면 `renumbered`.
3. 남은 next 항목 T(본문 ≥20자): prev 항목 B 중 포함률 `|bi(T)∩bi(B)|/|bi(T)| ≥ 0.6` 최대인 B가 있으면 B의 그룹에 `split`(T는 added 유지, group 표시). 대칭으로 prev 잔여는 `merged`.
4. 상태: name·category·definition·detail 정규화 후 전부 같으면 `same`, 아니면 `changed`, `changeRatio=(ins+del 문자수)/max(len)`. `<0.05`이고 숫자 토큰 변화가 없으면 `minor`. 숫자 토큰(`\d[\d,.]*\s*(%|년|개월|일|건|명|식|대|억|만|GB|TB|초|ms)?`) 집합이 다르면 `numeric`.
5. 정렬: 접두어 → seq(next 기준, 없으면 prev).

`diffWords(a,b): DiffSegment[]`: 토큰=어절 + `\n` 단독 토큰, Myers O(ND), 외부 패키지 금지. 인접 del/ins 쌍이 둘 다 ≤30자면 `diffChars`로 재세분. 토큰 합계 >20,000이면 diff 생략. 필드별 diff는 선택된 쌍만 지연 계산.

## 5. 화면 UX (시각은 목업 기준)
### 5.1 진입 `#/rfp` (메뉴 "RFP 비교", lucide `GitCompareArrows`)
- 제목 + 한 줄 설명. 슬롯 2개 가로 배치 "이전 문서" | ⇄ | "이번 문서".
- 빈 슬롯: 점선 드롭존 + [공고에서 고르기] [파일 올리기] + "올린 문서에서 고르기"(보관함 있을 때). 드래그 앤 드롭은 슬롯 어디에나.
- 채워진 슬롯: 제목, 부제(수요기관 · 게시일 / 올린 날짜 · 크기), 문서 Select(후보 2개 이상일 때만), "요구사항 97개" + 접두어 칩 상위 6개 + "+n", 품질 배지, [원문 텍스트] [비우기].
- 슬롯 상태: 비어 있음 → 고르는 중 → 추출 중("파일 읽는 중 → 표 인식 중", 90초 타임아웃) → 준비됨 / 일부만 인식(주황) / 요구사항 없음(회색) / 실패(ParseFailReason 라벨 + [다른 문서] [다시 시도]). 스캔 PDF: "텍스트가 없는 스캔본입니다. HWP 원본이 있으면 그 파일을 올리세요".
- [비교하기]: 두 슬롯이 준비됨/일부만 인식일 때 활성, 세션 저장 후 결과로 이동. 같은 문서면 경고. `none`은 막지 않고 경고 배너.
- 아래: "최근 비교"(이전→이번 제목, 날짜, 검토 n/m, [열기] [삭제]) / "올린 문서"(이름·라벨 편집, 크기, 요구사항 수, 품질, [이전에 넣기] [이번에 넣기] [삭제]).
- 공고 피커(모달): 검색(제목·공고번호·기관) + 목록(`notice/list`). 다른 슬롯이 공고면 상단 "추천": 같은 수요기관/공고기관 → "같은 기관", 제목 bigram ≥0.3 → "제목 유사". 공고 선택 → 2단계로 문서 후보(`rfp/docs`), docKind rfp 기본 선택, 추출된 건 "97개", 미추출은 "선택하면 분석". [이 문서 사용].
- 쿼리: `?next=<noticeId>` → 이번 슬롯 자동 추출 + 이전 슬롯 피커 자동 열기(추천 정렬). `?prev=`도 받음.

### 5.2 결과 `#/rfp/compare/<compareId>`
- 헤더: "이전 제목 → 이번 제목", [문서 바꾸기], [⇄ 방향 바꾸기], [AI 요약], [내보내기 ▾](S9), "검토 12/45".
- 요약 띠 = 필터 토글: 변경·신규·삭제·동일(+분할/병합 k). 기본 ON 변경·신규·삭제, 동일 OFF. 검색(ID·명칭), 접두어 Select, 토글 "수치 변경만", "미확인만".
- 마스터-디테일(좌 2/5 목록, 우 3/5 상세 sticky):
  - 목록: 접두어별 구역 헤더("SFR 기능 32 · 변경 5"). 행: 상태 점+라벨, ID(재배정 `PER-003 → PER-004`), 명칭, 힌트("+120자 −30자", "수치", "분할 2", "ID 충돌"), 확인 체크. 200행 초과면 구역 접기 기본 + `content-visibility:auto`(라이브러리 금지).
  - 상세: 상태 배지·matchedBy("번호 일치"/"내용 유사 0.78"/"수동")·태그. 필드별 2열(이전|이번), 변경 필드만 diff 하이라이트, 동일 필드는 접힘. "나란히/한 줄로" 전환. 신규/삭제는 한쪽 빈 패널 + [짝 맺기…]. 분할/병합은 그룹 링크 칩. 하단 [원문 위치 보기](TextDrawer, 해당 줄 스크롤), [짝 풀기]/[짝 맺기], [이 변경만 AI 요약], 확인함.
  - 키보드: ↑/↓ 이동, Space 확인 토글, `N` 다음 미확인 변경.
- 수동 짝: [짝 맺기] → 반대편 미매칭 항목 유사도순 피커 → `pair` override. [짝 풀기] → `unpair`. 저장 `rfp/compare-save` 디바운스 500ms, 실패 시 토스트+재시도.
- AI 요약 패널: 실행 전 "변경 23·신규 4·삭제 2 → 약 18,000자, 공급자(모델)" + [실행] / [프롬프트 복사]. 결과: 전체 요약, 영향 큰 항목(impact 배지, 클릭 시 행 선택), 리스크, 이력 선택. 수동 모드(`settings.ai.mode==='manual'`)면 복사만.
- 상태: 로딩(재추출 진행 문구) / 문서 없음(공고 삭제됨 + [문서 다시 고르기], 세션 자동 삭제 금지) / 양쪽 0건 / 변경 0건("달라진 요구사항이 없습니다. 동일 n개" + [동일도 보기]) / AI 오류(AiErrorCode 라벨 재사용).

### 5.3 공고 상세
헤더 액션에 ghost 버튼 [변경점 비교](`GitCompareArrows`), `notice.attachments.some(saved && SUPPORTED_EXT)`일 때만. `#/rfp?next=<noticeId>`. 사전규격 공고도 허용.

## 6. AI 요약 (`core/rfp/ai-input.ts`, `core/rfp/ai-prompt.ts`, `engine/ai/rfp-summary.ts`)
- `buildRfpAiInput(result, session, scope, selectedKey?)`: changed는 필드별 diff unified(`- 이전`/`+ 이번`, 컨텍스트 0) 항목당 1,500자, added/removed는 명칭+정의+세부 600자. 전체 60,000자 상한: 초과 시 `minor` 항목부터 제외 → detail 400자 축소 → `truncated, omitted`. `selected`는 항목 1개 전체(6,000자). **동일 항목·문서 전문 금지.**
- 프롬프트(버전 상수): "공공 SW 제안요청서 변경점 분석", diff만 근거·추정 금지, 수치·기간·범위·대상 시스템 변경 우선, 제안서 작업 관점. 출력 스키마 `{overall, highlights:[{key,summary,impact}], risks}`. 입력에 없는 key highlight는 버림.
- 경로: 대시보드 `rfp/ai-summarize {provider?, input}` → SW(`assertExtensionSender`, `readAiSettings`, `requireAiAccess`, `input.chars ≤ 80_000`) → offscreen `rfp/ai-summarize-exec {provider, api:{key,model}, input}` → `callProvider(adapter, {..., schema, schemaName:'bidmate_rfp_summary', maxTokens:4096})`. 타임아웃 SW→offscreen 150s, 대시보드→SW 160s. 저장은 대시보드가 세션에 넣어 `rfp/compare-save`.
- AiRunner·AiReviewFile·`ai/status`·공고당 1 run 잠금과 무관(별도 경로).
- D11 어댑터 일반화: `engine/ai/providers/types.ts`의 `AiBuildRequestInput.spec` → `schema: unknown; schemaName: string`. gemini/openai/claude 어댑터는 `r.schema` 사용(openai `json_schema.name = r.schemaName`). `ai-review-api.ts:261` 호출부는 `schema: outputSchema(prepared.built.spec), schemaName: 'bidmate_ai_review'`. 관련 테스트 수정.

## 7. 메시지 프로토콜·모듈
`src/messaging/protocol.ts` 추가(모두 대시보드→SW→offscreen, `relayExtensionOnly`; `router.ts` 타임아웃 `SLOW_TYPES` Set → `Map<type, ms>`):

| type | payload | response | timeout |
|---|---|---|---|
| `rfp/docs` | `{noticeId}` | `RfpDocCandidate[]`(zip 엔트리 펼침) | 30s |
| `rfp/extract` | `{ref; force?}` | `RequirementSet` | 90s |
| `rfp/upload` | `{name; size; b64}` | `{uploadId; set}` | 120s (SW: `b64.length ≤ RFP_UPLOAD_MAX_MB·1.37·1MB`, 초과 PAYLOAD_TOO_LARGE) |
| `rfp/uploads` | void | `RfpUploadEntry[]` | 25s |
| `rfp/upload-rename` / `rfp/upload-delete` | `{uploadId; label}` / `{uploadId}` | entry / void | 25s |
| `rfp/text` | `{ref}` | `{text}` | 30s |
| `rfp/compare-save` | `{session}`(id 빈 문자열이면 생성) | `RfpCompareSession` | 25s |
| `rfp/compare-list` / `-get` / `-delete` | void / `{compareId}` | entries / session\|null / void | 25s |
| `rfp/ai-summarize` | `{provider?; input}` | `RfpAiSummary` | 160s(SW 전용 릴레이, 키 주입) |
| `rfp/ai-summarize-exec` | `{provider; api; input}` | `RfpAiSummary` | SW→offscreen 전용 |

모듈:
- `core/types/rfp.ts`, `core/rfp/{constants,ids,normalize,similarity,diff,extract,match,ai-input,ai-prompt,export}.ts` — 순수, vitest.
- `engine/rfp/rfp-store.ts`(경로·읽기/쓰기/무효화/나열, withLock), `engine/rfp/rfp-service.ts`(ref→바이트: 첨부 `notices/<folder>/attachments/<savedName>` + zip 엔트리, 업로드 source; `parsers.detect/get` → `renderText` → `extractRequirements` → 저장. 같은 ref 동시 요청은 in-flight Promise 공유), `engine/ai/rfp-summary.ts`.
- `background/router.ts`: `EXTENSION_ONLY_TYPES`에 rfp/*, `rfp/ai-summarize` 전용 릴레이(`relayAi` 옆), 업로드 크기 검사.
- `entrypoints/offscreen/main.ts`: `listen('rfp/...')`.
- `entrypoints/dashboard/rfp/`: `RfpPage.tsx`, `DocSlot.tsx`, `NoticePicker.tsx`, `UploadZone.tsx`, `LibrarySection.tsx`, `RecentCompares.tsx`, `CompareResultPage.tsx`, `SummaryStrip.tsx`, `ChangeList.tsx`, `PairDetail.tsx`, `DiffText.tsx`, `PairPicker.tsx`, `AiSummaryPanel.tsx`, `useCompareSession.ts`. `route.ts`(Page `'rfp'`, Route `{page:'rfp'; query}`·`{page:'rfp-compare'; compareId}`, `rfpHash()`·`rfpCompareHash()`), `menu.tsx`, `App.tsx`, `notice/NoticeDetailPage.tsx` 버튼. `review/TextDrawer.tsx`에 선택 prop `load?: () => Promise<{text:string}>`(기본은 기존 `extraction/text`).

## 8. 구현 단계
- **S1** core 타입 + `ids/normalize/similarity/diff` + 테스트. 병렬 가능.
- **S2** `extract.ts` + 합성 DocModel 테스트(카드형 3열, 4열 라벨-값-라벨-값, 그룹 라벨+하위 라벨, 목록형 헤더/헤더 없음/rowSpan, 바깥 표 안 중첩 카드, 문단형, 요약표+카드 중복 병합, 모르는 접두어). **코어 — 메인 직접 또는 리뷰 필수.**
- **S3** `match.ts`(+constants) + `ai-input.ts` + `export.ts` + 테스트(ID 일치, 재배정, ID 충돌, 분할/병합, override, 동일/경미/수치, 결정성, 입력 상한 절단). **코어.**
- **S4** engine store/service + protocol + offscreen listen + SW relay(타임아웃 맵, 업로드 크기) + D11 어댑터 일반화.
- **S5 실측**: 픽스처 HWP 2건 `hwp5Parser → renderText → extractRequirements` 통합 테스트. 기대: 둘 다 `good`, 접두어별 개수 출력, 자기 비교 전부 `same`, 교차 비교 무예외. 라벨 동의어·임계값 보정(메인 판단). 20MB 업로드 메시지 통과 실측(실패 시 8MB로 내리고 decisions 기록).
- **S6** 진입 화면(route/menu/App, 슬롯, 피커+추천, 업로드, 보관함, 최근 비교, 상세 버튼).
- **S7** 결과 화면(요약 띠·필터, 목록, 상세 diff, 키보드, 수동 짝, 확인함, 원문 드로어).
- **S8** AI 요약(prompt, engine, SW 키 주입, 패널, 프롬프트 복사).
- **S9 선택**: `runExtractStep`에서 docKind rfp 결과로 rfp JSON 선생성, 내보내기(Markdown/CSV).

## 9. 금지·오해 지점
- ID만 같다고 짝 확정 금지(1단계 보류 규칙). ID가 다르다고 바로 신규/삭제 확정 금지.
- `renderText` 전 `extractRequirements` 호출 금지(loc.line 누락) — 서비스에서 순서 고정, 테스트로 확인.
- 중첩 표 재귀 누락 금지. 카드형 값 셀 고정 열 금지.
- 비교 결과(pairs) 저장 금지. 저장은 override·reviewed·ai만.
- 대시보드에서 파일 직접 쓰기 금지(offscreen 단일 작성자). 메시지에 ArrayBuffer/File 금지(base64 문자열).
- AI 요약을 AiRunner/AiReviewFile/`ai/status`에 끼우지 말 것. AI 입력에 동일 항목·전문 금지.
- 가상화·차트·diff 라이브러리 도입 금지.
- 공고 삭제 시 세션 자동 삭제 금지("찾을 수 없음" 상태).
- PDF 표 복원 시도 금지(기존 결정).

## 9.5 스파이크 실측 (2026-10-21, 전자출하 HWP ↔ 축산물원패스 HWPX, 같은 기관)
- 추출: 96개·86개, 명칭·세부 누락 0, 파싱+추출 136ms/638ms. 모두 카드형(목록형 0). 접두어는 가이드와 다름(FUN·INT 사용) → 모르는 접두어 허용 규칙 필요 확인.
- **양식 변형 실측**: 그룹 라벨 "요구사항 상세설명" 오른쪽이 하위 라벨(정의/세부내용)이 아니라 값이면 그룹 라벨 자체를 세부내용으로 본다(전자출하 양식). 이 규칙 없으면 세부 95/96 누락.
- 짝짓기: 동일 20(번호 바뀐 동일 9), 변경 36(번호 일치 20, 유사도 16), 신규 30, 삭제 40. 번호 재배정(COR-005→COR-004 등) 정상 탐지. 같은 번호 다른 내용(id_collision) 53건은 대부분 FUN(사업 고유 기능) — 다른 사업 비교라 정상.
- 병합 실사례: A PMR-013 의사소통 + PMR-014 이해관계자 → B PMR-010 "의사소통 및 내외부 이해관계자 협의체 운영". §4 3단계(분할/병합) 필요성 확인.
- diff 표시(사용자 피드백 반영, §4 diffWords를 대체): **줄 단위 먼저** — 줄(글머리 제거·공백 무시 키) LCS → 연속된 빠짐/생김 묶음 안에서 bigram dice ≥0.5인 줄끼리 '고친 줄'로 짝짓고 그 안만 어절+글자 diff. 짝 없는 줄은 줄 전체를 빠진 줄(빨강 바탕+왼쪽 막대)/새 줄(초록)로. "강조 없이 원문 나란히"는 무엇이 바뀌었는지 안 보여 기각. 상세 머리에 "바뀐 칸 명칭·정의·세부내용 · 고친 줄 n · 새 줄 n · 빠진 줄 n", 바뀐 칸 라벨에 점 표시. 목록 힌트는 글자 수 대신 "고침 n +n줄 −n줄". body dice <0.5면 "대폭 변경" 힌트.
- ID 일치 약한 짝: `by==='id' && nameDice<0.7 && bodyDice<0.4`면 `weak` 태그 → "다른 항목일 수도" 힌트 + 상세 경고("번호는 같지만 명칭과 내용이 많이 달라요… [짝 풀기]"). 실측 2건(예: DAR-09 연계 데이터 관리체계 수립 ↔ 데이터 개방 관리체계).
- 동일 판정(사용자 결정): 필드별로 공백·문장부호·글머리 기호(`\s . , · : ; - _ ( ) [ ] 「」 " ' ~ ! ? ○ ㅇ ● • ▪ ◦ ※`)를 모두 지운 문자열이 같으면 `same` + `format` 태그("띄어쓰기·문장부호만 달라 같은 항목으로 봤어요"). 글자가 실제로 다르면 아무리 작아도 `changed`(오탈자와 실제 수정은 규칙으로 구분 불가 — 실측 6건 모두 의미 있는 변경: 주관기관→발주기관, 패치→업그레이드 등). §4 4단계의 정규화 비교를 이 규칙으로 대체, `minor` 힌트 문구는 "몇 글자 바뀜".
- 동일 항목 기본 숨김은 유지하되 목록 끝에 "이전과 똑같은 요구사항 n개는 숨겨져 있어요 [보기]" 줄을 둔다(사용자가 일치 항목이 없다고 오인함).
- 스파이크 코드: 세션 스크래치패드(보존 안 됨). 규칙은 위 기록 기준으로 S2에서 재작성.

## 10. 확인 필요
1. 접두어 사전 정확한 목록·라벨(라벨용, 동작 무관).
2. `chrome.runtime.sendMessage` 페이로드 상한(S4·S5 실측).
3. 실제 기관 문서의 카드형 변형(라벨 동의어 누락 가능) — S5·사용자 실문서로 보정.

## 11. 보류(사용자 결정 2026-10-21: 목업대로 개발 먼저, 아래는 이후 검토)
비교 결과를 실제 제안 작업에 잇는 기능. 근거: 두 실측 RFP 모두 "제안요청 내용이 제안서에 어떻게 제안되었는지 목차 및 해당 페이지를 표시하는 조견표(3단 비교)" 제출을 요구하고, 제안서 목차(Ⅲ.2 기능 요구사항 등)를 RFP가 지정함.
- ① 목차별 작업 목록(그대로/고쳐 쓰기/새로 쓰기/빼기) ② 조견표 초안 엑셀(작년 조견표 올리면 목차·페이지 이월) ③ 찾아 바꾸기 목록(반복 용어 변경: 주관기관→발주기관 등) ④ 작년 제안서 파일에서 요구사항 ID 위치(쪽) 찾기.
- 착수 시 fable-advisor 설계 보강 대상(화면 중심·내보내기 구조 변경).
- (후속 아이디어) 실측 두 RFP 모두 "요구사항 분류 총괄표"(`분류명 | 영문 | SER-00 | 13`)가 있어 접두어별 기대 개수를 준다. 추출 개수와 대조해 "n개 덜 읽음" 품질 경고에 쓸 수 있음. 번호 0(`XXX-00`)은 parseReqId에서 제외(총괄표 표기).
