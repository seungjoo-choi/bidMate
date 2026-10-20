# AI로 다시 찾기 (AI 재검토) 명세

설계: fable-advisor (2026-10-20), 사용자 승인. 결정 요약은 `decisions.md` "2026-10-20 AI 재검토" 절.
독자: 맥락 없는 서브에이전트. 이 문서의 결정만 따르고, 벗어나야 하면 중단하고 보고한다.

## 0. 목표와 확정 요구사항

규칙 기반 추출(`extract-step.ts` → `decide.ts`) 결과를 사용자가 확인 화면에서 보고, 이상하면 [AI로 다시 찾기]를 눌러 AI에게 다시 찾게 한다.

1. 자동 실행 없음. 확인 화면 버튼으로만 실행.
2. 범위는 실행 때 선택: ① 확인 필요 항목만(`pendingKeys`) / ② 7개 전체(`EXTRACTION_KEYS`).
3. AI 결과는 "AI 제안"(근거 인용 포함)으로만 표시. 사용자가 [적용]해야 값이 들어간다.
4. 공급자 3개(Claude / OpenAI / Gemini) × 방식 2개(API / 반자동)를 설정에서 고른다. 실행 다이얼로그에서 "이번만" 바꿀 수 있다.
5. 기본값: 공급자 Gemini, 방식 API(무료 등급 목적).
6. 반자동 = 요청문 클립보드 복사 + 공급자 웹 새 탭 열기 → 사용자가 붙여넣고 답(코드 블록 JSON)을 복사 → 확장이 클립보드 읽기 또는 붙여넣기 칸으로 받음. 웹 화면 자동 조작·URL 프리필 금지(약관).

## 1. 지켜야 할 기존 결정

- 파일 I/O 작성자는 offscreen 하나. offscreen은 `chrome.storage`·`chrome.permissions` 사용 불가 → 키·설정·권한 검사는 SW가 하고 offscreen에 주입(`g2b/test` 릴레이 방식).
- UI는 `chrome.storage.session` 상태 구독.
- 자동 확정 금지. AI 값은 어떤 경우에도 `status: 'verified'`로 쓰지 않는다.
- JobType 추가 금지(eval/collect 전례). 요청/응답 + 세션 상태로 처리.
- 고정 `host_permissions` 추가 금지. API 호스트는 optional 런타임 요청(`optional_host_permissions: https://*/*`가 이미 있음).
- 외부 라이브러리 추가 금지. SDK 3종 모두 쓰지 않고 fetch 직접 호출.
- Extraction schemaVersion 2, Notice 1 유지. 선택 필드 추가만.

## 2. 데이터

### 2.1 `src/core/types/ai.ts` (신규)
```ts
export type AiProvider = 'claude' | 'openai' | 'gemini';
export type AiMode = 'api' | 'manual';
export type AiScope = 'pending' | 'all';
export type AiRunStatus = 'awaiting' | 'requesting' | 'done' | 'failed' | 'cancelled'; // awaiting = 반자동 답변 대기
export type AiRejectReason = 'quote_missing' | 'quote_too_short' | 'quote_not_found' | 'bad_format' | 'unknown_key' | 'file_not_found';
export type AiErrorCode =
  | 'AI_KEY_MISSING' | 'AI_MODEL_MISSING' | 'AI_PERMISSION_MISSING' | 'AI_MODE_MISMATCH'
  | 'AI_AUTH' | 'AI_RATE_LIMIT' | 'AI_QUOTA' | 'AI_OVERLOADED' | 'AI_BAD_REQUEST' | 'AI_HTTP'
  | 'AI_REFUSED' | 'AI_TRUNCATED' | 'AI_NETWORK' | 'AI_TIMEOUT'
  | 'AI_BAD_RESPONSE' | 'AI_RUN_MISMATCH' | 'AI_CLIPBOARD_IS_PROMPT' | 'AI_RUN_CLOSED'
  | 'AI_SUGGESTION_INVALID' | 'AI_STALE' | 'AI_RUN_BUSY' | 'NOTHING_TO_REVIEW' | 'NO_DOCUMENTS' | 'AI_INTERRUPTED';

export interface AiReviewFile { schemaVersion: 1; noticeId: string; runs: AiRun[] } // 최신 먼저, 최대 AI_MAX_RUNS(10)
export interface AiRun {
  id: string; createdAt: ISODate; finishedAt?: ISODate;
  provider: AiProvider; mode: AiMode; model: string | null; // manual은 null
  promptVersion: string; scope: AiScope; keys: ExtractionKey[];
  extractionJobId: string; extractedAt: ISODate;            // 이 run이 본 extraction. 현재 jobId와 다르면 stale
  status: AiRunStatus;
  files: Array<{ attachmentId: string; sourceFile: string; name: string; chars: number; truncated: boolean }>;
  skipped: Array<{ name: string; reason: 'scanned' | 'unsupported' | 'encrypted' | 'drm' | 'failed' | 'unselected' }>;
  excerptChars: number; truncated: boolean;
  usage?: { inputTokens: number; outputTokens: number };
  error?: { code: AiErrorCode; message: string };
  warnings: string[];
  suggestions: Partial<Record<ExtractionKey, AiSuggestion>>;
  rejected: Array<{ key: string; reason: AiRejectReason; value?: unknown; quote?: string; file?: string }>;
  promptPath: string; responsePath?: string;               // `<folder>/ai/<runId>-prompt.txt`, `-response.txt`
}
export interface AiSuggestion {
  key: ExtractionKey; value: unknown | null; quote: string; note?: string; file?: string; page?: number | null;
  evidence?: EvidenceRef;   // 검증 성공 시 코드가 생성. ruleId `ai:<provider>:<promptVersion>`, location `line N`
  verdict: 'match' | 'differs' | 'new' | 'none';
  baseline: unknown | null; // 비교 당시 효과값(userEdited.value 우선, 없으면 item.value)
  valueInQuote: boolean;    // false면 경고만
  appliedAt?: ISODate; dismissedAt?: ISODate;
}
export interface AiRunState { // storage.session `aiRun.<noticeId>`
  noticeId: string; runId: string; provider: AiProvider;
  status: 'preparing' | 'requesting' | 'verifying' | 'done' | 'failed' | 'cancelled';
  label: string; at: ISODate; error?: { code: AiErrorCode; message: string };
}
export interface OutputSpec { tag: 'bidmate-ai-review/1'; runId: string; keys: ExtractionKey[]; kindOf: Record<ExtractionKey, 'number' | 'string' | 'boolean'> }
export const AI_RUN_SESSION_PREFIX = 'aiRun.';
export const AI_SCHEMA_TAG = 'bidmate-ai-review/1';
export const AI_MAX_RUNS = 10;
```

### 2.2 기존 타입 변경
- `src/core/types/extraction.ts`: `userEdited?: { value; editedAt; note?; origin?: { kind: 'ai'; runId: string; provider: AiProvider; model: string | null; promptVersion: string } }`. 그 외 변경 없음.
- `src/core/types/settings.ts`: `ai: { provider: AiProvider; mode: AiMode; models: Partial<Record<AiProvider, string>> }`.
- `src/core/model/default-settings.ts`: 기본 `{ provider: 'gemini', mode: 'api', models: AI_DEFAULT_MODELS }`. withDefaults에 `ai: { ...d.ai, ...stored.ai, models: { ...d.ai.models, ...stored.ai?.models } }`.
- secrets(storage.local, 기존 `g2bServiceKey`와 같은 객체): `ai?: Partial<Record<AiProvider, string>>`. 보안 수준은 g2bServiceKey와 동일. UI는 끝 4자리만 표시.
- `AI_DEFAULT_MODELS = { claude: 'claude-sonnet-5-5', openai: '', gemini: 'gemini-3.5-flash' }`(gemini는 S0 실측 확정, decisions.md "AI 공급자 실측"). openai는 S0 후 채운다. 비어 있으면 실행 시 `AI_MODEL_MISSING`.
- `src/core/extraction/decide.ts`: `valueKey` export(비교 함수 단일 출처).

### 2.3 저장 위치
- `notices/<folder>/ai-review.json` (AiReviewFile). 락 키 `<folder>/ai-review.json`. 손상 시 null로 읽는다.
- `notices/<folder>/ai/<runId>-prompt.txt`, `-response.txt`. runs 10개 초과 시 오래된 run과 그 txt 삭제.
- extraction.json, notice.json은 [적용] 전에는 건드리지 않는다.

### 2.4 stale
`run.extractionJobId !== 현재 extraction.jobId`면 stale. stale 제안은 카드에 표시하지 않고 적용 불가(`AI_STALE`). 파일은 수정하지 않는다(읽을 때 판정).

## 3. core (순수, vitest 대상)

### 3.1 `src/core/ai/prompt.ts`
- `PROMPT_VERSION = '1.0.0'`, `REQUEST_MARKER(runId) = '<<BIDMATE-AI-REQUEST runId=<id> v=<PROMPT_VERSION>>>'`.
- `ITEM_DEFS: Record<ExtractionKey, { name; valueFormat; description; hints: string[]; pitfalls: string[] }>`.
  값 형식(VALUE_CHECK와 일치): 배점 3종 = number 0~1000(점) / performancePeriod = "N년" / performanceMinAmount = 원 단위 정수 / performanceCondition = 원문 문자열(2000자 이하) / differentialScoring = boolean.
  pitfalls(decisions.md 규칙 보정 지식): 0점은 배점 아님 / 등급별 점수표 행(AAA, BBB- 등)은 배점 아님 / 소계 행·"수행실적 및 경영상태 4점" 묶음 문장은 값 아님 / 제재·입찰참가제한 행은 경영상태 아님 / 금액 구간별 점수표("10억원 이상: 3")는 인정금액 아님 / 추정가격·기초금액은 인정금액 아님 / 창업기업 예외 기간은 인정기간 아님 / "차등점수제를 적용한 경우"·"적용 대상이 아님"은 적용 아님 / 질의답변에서 찾은 값은 note에 '질의답변'.
- system 지시: 공공입찰 첨부문서 정량평가 기준 검토자 / 발췌에 있는 것만, 추정·계산·외부지식 금지 / 못 찾으면 value null, quote "" / quote는 발췌 글자 그대로, 한 줄 또는 표 한 행, 300자 이내, 바꿔쓰기·요약 금지 / file은 머리글 파일명 그대로, page는 `[p N]`의 N 또는 null / 값이 여럿이면 평가기준표 값, 나머지는 note / 요청 항목 외 키 금지 / JSON 외 텍스트 금지 / `schema`와 `runId`를 그대로 되돌릴 것.
- user: 요청 항목 정의 + 출력 예시 + 문서 발췌.
- 출력 형식(공급자 중립): `{ schema: 'bidmate-ai-review/1', runId, items: [{ key, value, quote, file, page, note }] }`. key는 요청 키 enum, value는 키별 타입|null.
- `buildPrompt({ runId, keys, excerpt, skippedFiles }) → { system, user, manualText, spec: OutputSpec }`. manualText = 마커 첫 줄 + system + user + 제외 파일 안내("다음 파일은 글자를 읽을 수 없어 제외했습니다. 필요하면 원본을 대화에 직접 첨부하세요: …") + "답은 ```json 코드 블록 하나로".
- **기존 추출값·후보·userEdited·확인 필요 사유는 범위 ①②와 무관하게 프롬프트에 절대 넣지 않는다**(앵커링 방지).

### 3.2 `src/core/ai/excerpt.ts`
- 입력: extraction.files 중 `status==='parsed' && textPath`, priority 오름차순(같으면 files 순서), 선택된 파일만. 각 파일 `{ name(fileDisplayName), docKind, priority, attachmentId, sourceFile, text }`.
- 키워드: rules.synonyms의 credibility·management·performance·perfAnchor·bonusLabel·scoreHeader 전부 + `AI_EXCERPT_EXTRA_KEYWORDS = ['차등점수','배점','정량평가','평가항목','평가기준','실적','인정범위','인정기간','최근','이상의','억원','천만원','인정','신용']`.
- 줄 단위: compact(줄)이 키워드 하나라도 포함 → 창 `[i-6, i+30]`. 키워드 줄이 표 안이면 표 끝까지(최대 150줄). 겹치는 창 병합.
- 표 표현: `[셀 r c …] 텍스트` 줄을 같은 r끼리 ` | `로 이어 한 줄. `[표 k]`, `[p N]` 유지.
- 머리글: 파일 `=== 파일: <name> (<DOC_KIND_LABEL>) ===`, 구간 `--- [p N] 부근, 줄 L~M ---`(해당 줄 이전 마지막 `[p N]`, 없으면 "쪽 미상").
- 키워드가 없는 파일은 앞 60줄만.
- 상한: `EXCERPT_FILE_MAX_CHARS = 16_000`, `EXCERPT_MAX_CHARS = 48_000`. 반자동은 총 상한 `min(48_000, adapter.manualMaxChars)`. 초과 시 **priority가 가장 낮은(뒤) 파일부터** 그 파일의 뒤쪽 구간을 하나씩 빼고, 구간이 1개 남으면 파일을 통째로 뺀 뒤 앞 파일로 넘어간다. `truncated: true`, 파일 상한·총 상한 warning을 각각 기록.
- 시그니처(S1 구현): `buildExcerpt({ files: [{ attachmentId, sourceFile, name, kindLabel, priority, text }], synonyms, maxChars? })`. 정렬은 함수 안에서. core는 ui를 import하지 않으므로 name(fileDisplayName)·kindLabel(DOC_KIND_LABEL)은 호출자가 넣는다.
- 출력 `{ text, files: [{ attachmentId, sourceFile, name, chars, truncated }], chars, truncated, warnings }`. 줄 번호는 1부터(TextDrawer와 동일).
- `file_not_found`는 쓰지 않는다(파일을 못 찾아도 quote_not_found). 같은 key 중복은 첫 번째만 쓰고 warning.

### 3.3 `src/core/ai/parse.ts`
- `extractJson(text)`: ```json 코드 블록 우선, 없으면 첫 `{`부터 균형 잡힌 `}`.
- `detectClipboard(text) → 'request' | 'response' | 'unknown'`: 마커 있으면 request.
- `coerceValue(key, v)`: 배점·금액 숫자 문자열 → number(금액은 parseKoreanAmount 허용), period 숫자 → `${n}년`·"5년간" → "5년", differential "적용/미적용/true/false" → boolean. 보정 후 VALUE_CHECK 통과해야 함.
- `parseAiResponse(text, { runId, keys })` → `{ ok: true; items } | { ok: false; code: 'AI_CLIPBOARD_IS_PROMPT' | 'AI_BAD_RESPONSE' | 'AI_RUN_MISMATCH'; message }`. schema 태그 불일치도 AI_BAD_RESPONSE.

### 3.4 `src/core/ai/verify.ts`
- `normalizeForMatch(line)`: `[셀 …]`, `[표 k]`, `[p N]` 태그 제거 → `|` 제거 → compact. quote와 원문 양쪽에 같은 변환.
- `locateQuote(text, quote)`: 줄별 정규화 누적 문자열에서 indexOf → `{ line, endLine, page }`. 50자 넘는 quote가 실패하면 앞 50자로 재시도(partial).
  - **최소 근거(리뷰 보강, 2차 수정):** 정규화한 quote에 한글·영문 글자가 2자 미만이면 항상 거부. 정규화 8자 미만이거나 글자 4자 미만인 짧은 quote는 **원문 한 줄 전체** 또는 **같은 표 행 전체**(같은 `[표 k]` 안 같은 r 셀을 이은 것)와 정규화 결과가 정확히 같을 때만 허용(예: "신용평가 | 10점" 행 전체는 허용, 날짜 속 "15"는 거부). 거부 사유는 `quote_too_short`(AiRejectReason에 추가, `quote_missing`은 빈 quote 전용). 짧은 quote(exact_only)는 원문 기준 valueInQuote가 false면 경고가 아니라 `quote_too_short`로 거부(값 없는 셀 하나를 근거로 쓰는 것 방지). 값 null 항목은 예외.
  - **줄 넘김 제한:** 매치 구간이 3줄을 넘으면 실패로 본다. 단 걸친 줄이 모두 같은 표의 같은 행(`[셀 r …]`의 r 동일) 셀이면 줄 수와 무관하게 허용.
  - **값 확인은 원문 기준:** valueInQuote는 AI가 준 quote가 아니라 매치된 원문 줄(start~endLine) 텍스트로 계산한다.
  - **partial 제한:** partial 매치이고 원문 기준 valueInQuote가 false면 `quote_not_found`로 거부. performanceCondition은 partial을 허용하지 않고, value 자체(정규화)가 파일 텍스트에 있어야 한다(없으면 `quote_not_found`).
- **대조 대상은 발췌가 아니라 파일 전체 텍스트**(readText).
- `verifySuggestions(raw, { files, baseline, requested, provider, promptVersion })` → `{ suggestions, rejected, warnings }` (warnings는 호출자가 run.warnings에 합친다):
  1. 요청 밖 key → `unknown_key`.
  2. value null → verdict `none`(quote 있으면 locate 시도, 실패해도 통과).
  3. coerce → VALUE_CHECK 실패 `bad_format`. quote 600자 초과도 `bad_format`.
  4. quote 빔 → `quote_missing`.
  5. file 이름으로 파일 찾기(정확 일치 → endsWith → 전체 순회). 어디에도 없으면 `quote_not_found`. 명시 파일과 다른 파일에서 찾으면 warning만.
  6. evidence `{ attachmentId, sourceFile, page, line, location: 'line N', evidence: quote.slice(0,300), ruleId: 'ai:<provider>:<promptVersion>', docKind }`.
  7. verdict: baseline null → `new`, `valueKey` 같음 → `match`, 다름 → `differs`.
  8. valueInQuote: 배점·기간·금액은 숫자 포함 여부(금액은 quote 안 금액 후보 중 일치), differential은 "적용/차등" 포함, condition은 true.
- 검증 실패분은 카드에 올리지 않고 `rejected`로만 남긴다.

## 4. 공급자 어댑터 (engine, 순수 함수 묶음)

`src/engine/ai/providers/{types,index,claude,openai,gemini}.ts`. 어댑터는 네트워크를 직접 하지 않는다(listModels 제외, fetch 주입).

```ts
export interface AiProviderAdapter {
  id: AiProvider; label: string;
  apiOrigin: string;            // 권한 요청·contains 검사 `${apiOrigin}/*`
  webUrl: string;               // 반자동 탭
  manualMaxChars: number;       // 초기 30_000, S0 후 조정
  buildRequest(r: { apiKey: string; model: string; system: string; user: string; spec: OutputSpec; maxTokens: number }): { url: string; headers: Record<string, string>; body: unknown };
  parseResponse(status: number, json: unknown): { ok: true; text: string; usage?: { inputTokens: number; outputTokens: number }; finish: 'stop' | 'length' | 'refusal' | 'other' } | { ok: false; error: AiError };
  listModels(apiKey: string, fetch: typeof globalThis.fetch): Promise<Array<{ id: string; displayName?: string }>>;
}
export interface AiError { code: AiErrorCode; message: string; retryable: boolean; provider: AiProvider; status?: number }
```

| 항목 | Claude | OpenAI | Gemini |
|---|---|---|---|
| 엔드포인트 | `POST https://api.anthropic.com/v1/messages` | 1차 후보 `POST https://api.openai.com/v1/chat/completions` (S0 확정) | `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` (S0 확인) |
| 인증 | `x-api-key`, `anthropic-version: 2023-06-01`, `anthropic-dangerous-direct-browser-access: true` | `Authorization: Bearer` | `x-goog-api-key` (쿼리 `?key=` 금지) |
| 메시지 | `system`, `messages[user]` | `messages[system, user]` | `systemInstruction`, `contents[user]` |
| 구조화 출력 | `output_config.format {type:'json_schema', schema}` | `response_format {type:'json_schema', json_schema:{name, schema, strict:true}}`, `const` 대신 `enum` | **실측 확정:** `generationConfig.responseMimeType:'application/json'` + `responseJsonSchema`(표준 JSON Schema 그대로) + `thinkingConfig:{thinkingLevel:'low'}` |
| 결정성 | temperature 0 | temperature 0 | temperature 0 |
| 응답 | `content[].text`, `stop_reason` end_turn/max_tokens/refusal | `choices[0].message.content`, `message.refusal`, `finish_reason` | `candidates[0].content.parts[0].text`, `finishReason` STOP/MAX_TOKENS/SAFETY/RECITATION, `promptFeedback.blockReason` → refusal |
| 토큰 | `usage.input_tokens/output_tokens` | `usage.prompt_tokens/completion_tokens` | `usageMetadata.promptTokenCount/candidatesTokenCount` |
| 모델 목록 | `GET /v1/models` | `GET /v1/models` | `GET /v1beta/models` |
| 429 | AI_RATE_LIMIT | `error.code==='insufficient_quota'` → AI_QUOTA, 그 외 AI_RATE_LIMIT | `RESOURCE_EXHAUSTED` → AI_QUOTA |
| 키 오류 | 401 → AI_AUTH | 401 → AI_AUTH | 400 `API_KEY_INVALID`·401·403 → AI_AUTH |
| 과부하 | 529/503 → AI_OVERLOADED | 500/503 | 500/503 |
| 반자동 URL | `https://claude.ai/new` | `https://chatgpt.com/` | `https://gemini.google.com/app` |

표의 외부 API 형태는 S0 실측으로 확정한다. 실측과 다르면 어댑터 안에서만 고친다.

공통 클라이언트 `src/engine/ai/ai-client.ts`: `callProvider(adapter, req, { fetch, signal, timeoutMs: 120_000 })` — fetch·타임아웃(AI_TIMEOUT)·네트워크 오류(AI_NETWORK)·`retryable`이면 5초 후 1회 재시도·`finish` length → AI_TRUNCATED(파싱 가능분은 반영 + 경고), refusal → AI_REFUSED. 모든 오류 메시지는 키를 `redactKey`로 가린다. maxTokens 8192.

## 5. engine / offscreen / SW

### 5.1 `src/engine/ai/ai-review-store.ts`
`load(notice) → AiReviewFile | null`, `save`, `upsertRun`, `writePrompt/readPrompt/writeResponse`, 10개 초과 정리.

### 5.2 `src/engine/ai/ai-review-api.ts`
- `prepareRun({ noticeId, scope, provider, mode, model, files? }, { rules, now, isBusy })`: notice/extraction 로드(없으면 NOT_FOUND), 같은 공고 extract 잡 실행 중이면 `JOB_ALREADY_RUNNING`, keys 계산(① 대상 0개면 거부), textPath 읽어 excerpt, run 저장(manual → awaiting, api → requesting), 프롬프트 txt 저장. 새 run 시작 시 같은 공고의 awaiting run은 cancelled.
- `execApiRun`: callProvider → finishRun.
- `finishRun({ noticeId, runId, responseText })`: run 상태가 awaiting/requesting 아니면 AI_RUN_CLOSED → parse → verify(파일 전체 텍스트 재로드) → 실행 중 재추출됐으면 warning → done 저장, 응답 txt 저장. 반자동 파싱 실패는 run을 닫지 않고 오류만 반환(재시도 가능).
- `applySuggestion({ noticeId, runId, key, note? })`: run·제안 확인(없음/dismissed/stale → AI_SUGGESTION_INVALID/AI_STALE), extract 잡 중 거부, `editExtraction`에 `origin`·`source` 전달, `appliedAt` 기록. stale 검사는 editExtraction 락 안에서 한 번 더 한다(opts `expectJobId`: 현재 extraction.jobId와 다르면 AI_STALE, 저장 안 함). 반환 `{ notice, extraction, aiReview }`.
- `dismissSuggestion`, `cancelRun`(AbortController, 늦게 온 응답이 run을 덮지 않게 runId+status 가드), `getReview`, `listModels`.

### 5.3 `src/engine/notices/notice-api.ts` `editExtraction`
opts에 `origin?`, `source?: { ref; evidence?; page? }` 추가. `userEdited = { value, editedAt, note?, origin? }`. notice 필드 source `{ kind: 'user', ref: opts.source?.ref ?? 'dashboard', evidence?, page?, fetchedAt }`. note가 비면 `AI 제안 적용(<label> <model>)`. 기존 호출부 무영향. **SourceKind에 'ai'를 추가하지 않는다**(mergeDocumentLayer 함정).

`transplantEdits`(extract-step.ts)는 수정 없음(userEdited 통째 이식으로 origin 유지). 테스트만 추가.

### 5.3a 닫히지 않은 run 정리 (S2a 리뷰 보강)
- 상태가 `requesting`인데 offscreen 실행 Map에 없는 run은 고아다(offscreen 재시작, 실패 기록 자체가 실패한 경우). `ai/get`·`ai/prepare`·`ai/exec` 처리 시작 시 해당 공고의 고아 run을 `failed`(error `AI_INTERRUPTED`, "실행이 중단되었습니다. 다시 실행하세요")로 닫고 `ai/status` failed를 push한다.
- 공고당 1개는 반자동에도 적용: 실행 Map에 살아 있는 run이 있으면 `ai/prepare`도 `AI_RUN_BUSY`.
- 10개 정리는 `awaiting`·`requesting` run을 지우지 않는다(닫힌 run 중 오래된 것부터).
- finishRun은 상태 확인(락 안) 후에만 응답 txt를 쓴다. 파싱 실패만 AI_BAD_RESPONSE, 그 외 오류(NOT_FOUND, 권한 등)는 그대로 전파.
- ai/run 릴레이 타임아웃 60초(offscreen이 prepare 후 응답).
- offscreen 실행 조율(Map, 상태 push, 취소 abort, 예외 시 failRun + failed push)은 `src/engine/ai/ai-runner.ts`로 분리해 테스트하고, main.ts는 listen 연결만 한다.

### 5.4 offscreen `src/entrypoints/offscreen/main.ts`
`Map<noticeId, { runId; abort }>`로 공고당 1개. `ai/exec`는 즉시 `{ runId }` 응답 후 비동기 진행하며 `ai/status` push(preparing → requesting → verifying → done|failed|cancelled). `ai/prepare`, `ai/submit`, `ai/get`, `ai/apply`, `ai/dismiss`, `ai/cancel`, `ai/prompt-get`, `ai/models` 핸들러.

### 5.5 프로토콜 `src/messaging/protocol.ts`
```
ai/get        { noticeId } → AiReviewFile | null
ai/run        { noticeId; scope; provider?; files?: string[] } → { runId }          // 대시보드→SW. files는 extraction 파일의 textPath, 고르지 않은 파일은 skipped 'unselected'
ai/exec       { noticeId; scope; provider; files?; api: { key; model } } → { runId } // SW→offscreen 전용
ai/status     AiRunState → void                                                     // offscreen→SW 전용
ai/cancel     { noticeId; runId } → { cancelled: boolean }
ai/prepare    { noticeId; scope; provider?; files? } → { runId; text; webUrl; stats: { chars; files; truncated; excludedFiles: string[] } }
ai/prompt-get { noticeId; runId } → { text }
ai/submit     { noticeId; runId; text } → AiReviewFile       // text 상한 200KB(SW 검사)
ai/apply      { noticeId; runId; key; note? } → { notice; extraction; aiReview }
ai/dismiss    { noticeId; runId; key } → AiReviewFile
ai/test       { provider } → { ok; models?: Array<{ id; displayName? }>; error?: { code; message } }  // 대시보드→SW
ai/models     { provider; apiKey } → { models }              // SW→offscreen 전용
```
`SettingsSection`에 `'ai'` 추가. 대시보드 payload에 키 필드를 두지 않는다.

### 5.6 SW `src/background/router.ts`
- `EXTENSION_ONLY_TYPES`에 `ai/get, ai/prepare, ai/prompt-get, ai/submit, ai/apply, ai/dismiss, ai/cancel` 추가. 타임아웃: prepare·submit·test 30초.
- `ai/run` 릴레이: assertExtensionSender → provider(payload ?? settings) → (설정 mode는 검사하지 않는다. ai/run 자체가 API 실행이고, 실행 다이얼로그의 "이번만 API"를 허용하기 위해서다) → `secrets.ai[provider]`(AI_KEY_MISSING) → `models[provider]`(AI_MODEL_MISSING) → `permissions.contains({ origins: [apiOrigin+'/*'] })`(AI_PERMISSION_MISSING) → ensureOffscreen → `ai/exec`.
- `ai/test`: 키 주입해 `ai/models`.
- `ai/status`: offscreen.html 발신만 수용(job/progress 검사 재사용) → `storage.session['aiRun.'+noticeId]`.
- `ui/open` known 섹션에 'ai'.

### 5.7 `wxt.config.ts`
`optional_permissions: ['webRequest', 'clipboardRead']`. host 변경 없음.

## 6. UI

### 6.1 설정 `src/entrypoints/dashboard/AiCard.tsx` (SettingsPage `slot('ai', …)`)
- 공급자 라디오 3 + 방식 라디오 2. 선택 공급자 섹션만 펼침: 키 입력(password) + [저장](클릭 핸들러의 **첫 await**로 `permissions.request({ origins: [apiOrigin+'/*'] })`, 거부 시 저장은 하되 경고) + 저장됨 배지(끝 4자리) + [연결 테스트](→ `ai/test`, 모델 목록 드롭다운) + 모델 select(목록 없으면 자유 입력) + 안내 문구. 다른 공급자는 "저장됨/미설정"만.
- 안내: Claude·OpenAI "종량제, 비용은 해당 계정에 청구". Gemini "무료 등급은 분당·일일 호출 제한이 있고, 입력 내용이 Google 서비스 개선에 쓰일 수 있습니다(공고문은 공개 자료)". 공통 "키는 이 브라우저에만 저장됩니다".
- 반자동 선택 시 "열릴 사이트: <webUrl>", 붙여넣기 상한 안내, [클립보드 읽기 권한 허용](선택).

### 6.2 확인 화면
- `src/ui/hooks/useAiRun.ts`: `aiRun.<noticeId>` 구독(useJobs 패턴). done/failed/cancelled가 되면 `ai/get` 재조회.
- `src/ui/review/ai-view.ts`(순수): `buildAiCards(review, extraction)` — **키별로 가장 최근 non-stale done run의 제안**(최신→과거 순회, dismissed 제외), `runSummary(run)`(match/differs/new/none/rejected), `latestRun`, `isStale`, `suggestionActions(card, suggestion)`, VERDICT_LABEL, REJECT_LABEL.
- `src/ui/review/view.ts`: CardModel에 `ai?`, `editedOrigin?: 'ai'`. userEdited 배지 텍스트 분기 "AI 제안 적용".
- `AiRunDialog.tsx`: 범위 라디오(① "확인 필요 항목만 (N개)", 0개면 비활성 / ② "7개 항목 전체 재검토") + "공급자·방식: Gemini API (설정값)" + [이번만 바꾸기](공급자 3 × 방식 2, 키 없는 API 조합은 비활성+사유) + 파일 체크리스트(기본 전부, 스캔 등은 회색 고정·"AI 재검토 제외") + 반자동 상한 초과 경고 + [실행] 또는 [요청문 복사하고 탭 열기]. `AI_KEY_MISSING/MODEL_MISSING/PERMISSION_MISSING`이면 InlineAlert + [설정 열기(section=ai)] + [이번만 반자동으로 실행].
- 반자동: `navigator.clipboard.writeText` 후 `window.open(webUrl, '_blank', 'noopener')`. 대기 패널에 [다시 복사](ai/prompt-get) [탭 다시 열기] [클립보드에서 읽기](첫 await로 `permissions.request({ permissions: ['clipboardRead'] })`, 거부면 칸만) + 붙여넣기 textarea + [반영] + [취소]. awaiting run은 파일에서 복원되므로 화면을 떠났다 와도 유지.
- `AiRunPanel.tsx`: 진행(API: 상태 라벨 + [취소]) / 대기(반자동) / 완료 요약 "AI 재검토 · <공급자> <모델> · 시각 · 일치 a / 제안 b / 못 찾음 c / 검증 실패 d(펼침: 키·사유·값·인용 앞 80자) / 제외 파일" + "이전 run의 제안 n개 표시 중" / 오류. `AI_QUOTA`·`AI_RATE_LIMIT`이면 [잠시 후 다시] [다른 공급자로 실행]. stale이면 "다시 추출되어 이전 AI 제안은 적용할 수 없습니다".
- `AiSuggestionBlock.tsx`(ItemCard 안, info 톤): verdict 라벨(match "AI 확인 일치" / differs "AI 제안 (현재 값과 다름)" / new "AI 제안" / none "AI도 찾지 못함"), 공급자 라벨, 값, 인용 blockquote, 파일·쪽, note, valueInQuote false면 "근거 문장에 값이 보이지 않음", [전체 텍스트에서 보기](TextDrawer). 버튼: differs/new → [적용][무시], match인데 항목이 verified 아님 → [이 값으로 확정](= 적용), verified+match → 없음, none → [무시]. 적용 전 메모(선택) + "사용자 수정으로 저장됩니다. 되돌리기로 해제할 수 있습니다."
- `ReviewTab.tsx`: 요약 줄 오른쪽 [AI로 다시 찾기](extraction 없음·busy·parsed 0이면 비활성), AiRunPanel, 카드에 제안 주입. `NoticeDetailPage.tsx`: apply 응답으로 setData.

## 7. 금지 사항
- AI 값을 items.value/evidence/status에 쓰지 않는다. match여도 verified로 바꾸지 않는다.
- SourceKind 'ai' 추가 금지.
- 검증 실패 제안을 "경고 달고 적용 가능"으로 보여 주지 않는다.
- 대시보드가 공급자 API를 직접 fetch하지 않는다. 키는 SW→offscreen 주입만. run 파일·세션·로그·오류 메시지·프롬프트 txt에 키 금지.
- offscreen에서 chrome.storage·chrome.permissions 호출 금지.
- 웹 화면 content script 주입·DOM 조작·URL 프리필 금지.
- 모델 ID 하드코딩 목록 금지(기본값 상수만).
- 비용 추정액 표시 금지(토큰 수만 기록).
- API에 PDF·이미지 직접 전송 금지. 스캔·암호 문서는 제외 안내.
- 여러 메시지로 쪼개 보내는 반자동 분할 금지(답 하나 = JSON 하나). 분할은 파일 체크리스트로 run을 나눠서.
- `permissions.request`는 클릭 핸들러의 첫 await.

## 8. 단계

| 단계 | 담당 | 내용 | 완료 조건 |
|---|---|---|---|
| S0 | 메인 + 사용자(키 필요) | 실측: ① 호스트 권한 有/無 × 공급자 헤더 조합에서 models GET 200 여부 ② 구조화 출력 파라미터 수용·순수 JSON 응답(OpenAI chat/completions vs responses 확정, Gemini responseSchema 방언) ③ 실제 모델 ID와 기본 후보(Gemini 무료 등급 모델, OpenAI 저가 모델, Claude Sonnet) ④ 잘못된 키·한도 초과 상태 코드와 body ⑤ 무료 웹 계정 30k/48k자 붙여넣기·코드 블록 복사 ⑥ clipboardRead optional 요청과 readText ⑦ 세 웹 URL | decisions.md "AI 공급자 실측" 표 기록, 어댑터 상수·AI_DEFAULT_MODELS 확정 |
| S1 | implementer | core: types/ai.ts, extraction.ts origin, settings·default-settings, decide valueKey export, prompt/excerpt/parse/verify + 테스트 | 테스트 통과, 다른 모듈 변경 없음 |
| S2a | implementer → code-reviewer | ai-client, 어댑터 인터페이스·index, Claude 어댑터, ai-review-store, ai-review-api, notice-api editExtraction opts, protocol, offscreen 핸들러, router | 테스트 통과, 기존 테스트 무변경 통과 |
| S2b | implementer(병렬 가능) | OpenAI·Gemini 어댑터(S0 결과 입력) | 어댑터 테스트 통과 |
| S3 | implementer | AiCard, SettingsPage slot, wxt optional_permissions, ui/open 'ai' | 키 저장·권한 요청·연결 테스트·모델 목록 |
| S4 | implementer | useAiRun, ai-view, view.ts, AiRunDialog, AiRunPanel, AiSuggestionBlock, ItemCard·ReviewTab·NoticeDetailPage 연결 | 수동 시나리오 통과 |
| S5 | 메인 | 리뷰(S2a 전체와 verify.ts는 코어), 전체 테스트·타입체크, 스모크(공급자별 API 1건, 반자동 1건) | 리뷰 Major 0 |

S1 → S2a 순차. S2b·S3·S4는 S2a 이후 병렬 가능(파일 안 겹침).

## 9. 테스트 항목
- S1: excerpt(창 병합, 표 끝까지 포함, 표 행 결합, 머리글 쪽 계산, 파일·총 상한과 truncated, 키워드 없는 파일 앞 60줄, 추출값 미포함) / prompt(요청 키만 spec.keys, 마커 첫 줄, baseline 값 문자열이 프롬프트에 없음) / parse(코드 블록·맨 JSON·설명문 섞임·요청문 판별·runId 불일치·coerce 각 종류) / verify(셀 태그·공백 차이에도 매치, 미매치 거부, 줄·쪽 계산, partial 재시도, 파일명 불일치 fallback, bad_format, quote_missing, verdict 4종, valueInQuote) / default-settings(ai models 깊은 병합).
- S2a: store(10개 상한 정리, 손상 null) / api(prepare pending·all 키, 스캔 skipped, busy 거부, awaiting 자동 취소 / finish stale 경고·rejected 분리 / submit 요청문·runId 불일치·정상 / apply origin·source ref `ai:<runId>`·appliedAt, dismissed·stale 거부, 되돌리기 정상) / ai-client(재시도 1회, 타임아웃, abort, 키 redact) / Claude 어댑터(buildRequest 형태, parseResponse 정상·refusal·length·오류) / router(비확장 발신 거부, 키·모델·권한 없음 코드, ai/status는 offscreen만, 세션 기록) / extract-job(origin 있는 userEdited가 재추출 후 유지).
- S2b: OpenAI·Gemini buildRequest·스키마 방언·parseResponse, 429 insufficient_quota·RESOURCE_EXHAUSTED → AI_QUOTA, Gemini 400 API_KEY_INVALID → AI_AUTH.
- S4: ai-view(키별 최신 non-stale run 병합, dismissed 제외, 요약 집계, suggestionActions, origin 배지).
- 수동: (a) ① 실행 → 적용 → 배지·메일 값 반영·되돌리기 (b) ② 실행 → match/differs 혼합, differs 적용 (c) 재추출 → 제안 비표시, origin 보존 (d) 반자동 전체 흐름 + 클립보드에 요청문 남긴 채 읽기 (e) 키 삭제 후 API 실행 → AI_KEY_MISSING + 이번만 반자동 (f) 실행 중 취소 (g) extract 실행 중 ai/run 거부.
- 보안 점검(code-reviewer): 키가 파일·세션·로그·오류에 없음, ai/exec·ai/models·ai/status가 대시보드에서 호출 불가.
