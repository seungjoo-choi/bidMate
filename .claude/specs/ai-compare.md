# AI 비교 실행(여러 AI 결과 비교) 설계

> 2026-10-20 · fable-advisor 설계. 구현 전 사용자 검토 대상.
> 선행 작업: 검토 탭 ▾ 메뉴의 "공급자 바로 고르기"(ReviewTab `runAi(scope, keys, provider)`, 메뉴 `via-<provider>` 항목)는 이미 반영됨. S4는 그 위에 얹는다.

## 1. 목표

- 평가정보 검토 탭에서 Claude·OpenAI·Gemini 중 2~3개를 한 번에 실행하고, 항목마다 각 AI의 제안을 나란히 보고 하나를 골라 적용한다.
- 비교 실행이 아니어도, 서로 다른 공급자로 따로 돌린 결과가 서로를 가리지 않는다(공급자별 최신 제안을 모두 표시).
- 기존 결정 유지: 공고당 AI 실행 1개, 적용은 [적용] 버튼으로만, extraction.json 스키마 불변, 비교는 API 방식 전용(일괄 실행과 같은 이유).

## 2. 핵심 결정과 이유

| 결정 | 이유 | 기각 대안 |
|---|---|---|
| 표시 규칙을 "키별 최신 run 1개"에서 "키별·공급자별 최신 요청 run"으로 확장. 기존 `buildAiCards` 결과는 그대로 **primary**, 다른 공급자 제안은 **others** | 가려짐 문제는 비교 실행 없이도 발생. compareId로만 묶으면 수동 방식·따로 돌린 결과는 비교가 안 됨 | compareId 그룹만 비교 표시 / 별도 비교 테이블 화면(적용·근거 UI 중복) |
| primary 선정 규칙은 불변(decision 2026-10-20 "요청한 키 기준 최신") | 사이드패널·확인 일치 배지·기존 테스트 무영향 | 설정 공급자 우선(설정을 순수 함수에 넣어야 함) |
| 비교 실행은 `AiRunner.execCompare`가 **같은 공고 잠금을 쥔 채 공급자를 순차 실행** | 공고당 1 run·세션 키 1개·고아 정리·취소가 모두 noticeId 단일 실행 전제. 공급자별 엔드포인트가 달라 동시 실행의 이득은 소요 시간뿐 | 동시 실행(결정 충돌·연쇄 수정) / 대시보드가 ai/run을 순차 호출(페이지 이동 시 중단) / AiBatch 재사용(상태 모양·패널이 "공고 여러 개 × 공급자 1개") |
| 2번째 이후 run은 `scope:'keys', keys: 첫 run.keys`로 고정 | 비교는 같은 항목 집합이어야 의미 있음. 실행 중 사용자가 1번째 제안을 적용하면 pending이 줄어 2번째가 다른 집합을 요청하는 것 방지 | 매 run 같은 scope 재해석 |
| 한 공급자 실패는 기록만 하고 다음 공급자 계속. 취소만 남은 공급자 중단 | 비교 목적상 나머지 결과가 더 중요. 일괄 실행의 QUOTA 즉시 중단은 "같은 키 반복 호출" 보호인데 여기선 키가 공급자마다 다름 | 첫 실패 시 중단 |
| `AiRun.compareId?`(파일)와 `AiRunState.compare?`(세션)만 추가 | 패널에서 "이번 비교"를 묶고 진행(2/3)을 보여 주기 위한 최소 정보. 표시 규칙 자체는 compareId에 의존하지 않음 | 비교 전용 파일 / compareId 없이 시각으로 묶기 |
| 적용은 선택한 공급자의 제안만 appliedAt. 다른 공급자 제안은 그대로 남고 [적용]으로 바꿀 수 있음. 무시는 해당 공급자 제안만 | 비교의 가치는 "마음 바꾸기"에 있음. 자동 무시는 정보 손실 | 적용 시 나머지 자동 dismiss |
| 비교 시작 UI는 AiRunDialog 안의 "사용할 AI" 영역에 [하나로 실행 / 여러 AI로 비교] 전환 + 공급자 체크박스 | 파일 선택·범위와 함께 결정해야 하는 값. 메뉴에 공급자 조합을 늘어놓지 않음 | MenuButton에 "전부 비교" 항목 하나 고정 |

## 3. 데이터·타입 변경

### src/core/types/ai.ts
```ts
export const AI_PROVIDERS: readonly AiProvider[] = ['gemini', 'claude', 'openai']; // 표시·선택 순서. AiRunDialog의 지역 PROVIDER_IDS를 이것으로 교체
export interface AiRun { ...; compareId?: string; }              // 비교 실행으로 만들어진 run. 같은 id = 같은 비교
export interface AiRunState { ...; compare?: { id: string; providers: AiProvider[]; index: number }; } // index = 현재 실행 중 공급자의 0-based 순번
```
- 마이그레이션 없음(옵션 필드). `AI_MAX_RUNS`(10) 유지 — 3개 비교면 3칸 소모, 이력 약 3회분. 늘리지 않는다.

### src/messaging/protocol.ts
```ts
| { type: 'ai/compare-run'; payload: { noticeId: string; scope: AiScope; keys?: ExtractionKey[]; providers: AiProvider[]; files?: string[] }; response: { compareId: string; runId: string } } // 대시보드→SW. 키는 SW가 주입
| { type: 'ai/compare-exec'; payload: { noticeId: string; scope: AiScope; keys?: ExtractionKey[]; files?: string[]; compareId: string; targets: Array<{ provider: AiProvider; api: { key: string; model: string; sendFullText?: boolean } }> }; response: { compareId: string; runId: string } } // SW→offscreen 전용
```
- `ai/compare-run`은 `ai/run`처럼 SW 전용 리스너(EXTENSION_ONLY_TYPES에 넣지 않음).

### src/engine/ai/ai-review-api.ts
- `PrepareInput`에 `compareId?: string` 추가. `prepareRun`이 run 객체에 `...(p.compareId ? { compareId: p.compareId } : {})`로 기록. 그 외 변경 없음.

### src/ui/review/view.ts
- `CardModel`에 `aiOthers?: AiCardInfo[]` 추가(다른 공급자의 최신 제안, primary 제외, `AI_PROVIDERS` 순).
- `buildCards(ex, ai?, others?: Partial<Record<ExtractionKey, AiCardInfo[]>>)` 세 번째 인자 추가. `others[k]`가 비어 있지 않을 때만 `aiOthers` 설정. 사이드패널 호출(2인자)은 무변경.

## 4. 화면 동작

### 4.1 항목 카드의 AI 제안 블록(AiSuggestionBlock)
- 입력 제안 목록 `infos = [card.ai, ...card.aiOthers]`(undefined 제거). 1개면 지금과 동일.
- 2개 이상이면 블록 맨 위에 **공급자 칩 행**: 칩마다 `data-ai={provider}`, ProviderIcon + 라벨 + 짧은 값(`formatItemValue`, value null이면 "못 찾음", multi면 "조건별 N개"). 선택 칩은 `aria-pressed`. 칩 행 오른쪽에 **일치 알약**(§4.4 `aiAgreement` 결과: "AI 2개 일치" / "AI끼리 다름" / "일부만 찾음" / "모두 못 찾음").
- 선택 기본값: appliedAt이 있는 제안이 있으면 그것(여럿이면 appliedAt 최신) → 없으면 card.ai(primary) → 없으면 infos[0]. 선택한 run이 infos에서 사라지면(무시 후) 기본값으로 되돌림(useState + 렌더 시 유효성 검사, useEffect 불필요: `const selected = infos.find(i => i.run.id === sel) ?? default`).
- 블록 본문(verdict 알약·값·variants·인용·메모·버튼)은 선택한 제안 하나를 지금 코드 그대로 그린다. 블록 바깥 `data-ai`는 선택 제안의 provider.
- "적용됨" 표시: 선택 제안의 `appliedAt && card.userEdited`. 다른 칩은 `suggestionActions` 그대로(값이 있으면 [적용] 노출 = 다른 AI 값으로 바꾸기).
- 훅 순서: `useState`들을 `if (!info) return null` 앞으로 옮긴다.

### 4.2 ItemCard
- props 시그니처 변경: `onAiApply?: (runId: string, note?: string, variantIndex?: number) => Promise<AiBlockError|null>`, `onAiDismiss?: (runId: string) => Promise<AiBlockError|null>`.
- 블록 렌더 조건: `(card.ai || card.aiOthers?.length) && onAiApply && onAiDismiss`.
- "AI 확인 일치" 배지(verified)는 primary 기준 유지.

### 4.3 ReviewTab
- `aiCards = buildAiCards(...)`(primary) + `byProvider = buildAiCardsByProvider(...)` + `others = aiOthers(aiCards, byProvider)` → `buildCards(extraction, aiCards, others)`.
- `aiApply(key)`/`aiDismiss(key)`가 runId를 인자로 받는 형태로 변경. 카드에 `onAiApply`/`onAiDismiss`를 `card.ai || card.aiOthers?.length`일 때 전달.
- MenuButton items에 추가(options 바로 앞, dividerBefore: true는 options에 유지): `{ key: 'compare', label: '여러 AI로 비교…', description: 'Claude·OpenAI·Gemini 결과를 나란히 봅니다', onSelect: () => setDialog({ compare: true }) }`. disabled 조건은 기존 `aiDisabled`.

### 4.4 ai-view.ts 순수 함수(모두 테스트 대상)
```ts
export function buildAiCardsByProvider(review, extraction): Partial<Record<ExtractionKey, Partial<Record<AiProvider, AiCardInfo>>>>
// 공급자마다 buildAiCards와 같은 규칙(그 공급자의 run만 보고: done·non-stale·요청한 키 기준 최신, 제안 없거나 dismissed면 빈칸). 내부는 buildAiCards 본문을 `pick(runs: AiRun[])`로 빼서 공유
export function aiOthers(primary, byProvider): Partial<Record<ExtractionKey, AiCardInfo[]>>
// 키마다 AI_PROVIDERS 순으로 byProvider 항목 중 run.id !== primary[key]?.run.id 인 것. 빈 배열이면 키 생략
export type AiAgreement = 'agree' | 'agree_none' | 'differ' | 'partial';
export function aiAgreement(infos: AiCardInfo[]): { n: number; verdict: AiAgreement } | null
// n<2면 null. 값 키: value null/verdict none → 'none'; multi → 'm:' + variants value의 valueKey 정렬 join; 그 외 core/extraction/decide.valueKey(value).
// 전부 'none' → agree_none; 일부 'none' → partial; none 없고 키 전부 같음 → agree; 아니면 differ
export const AGREEMENT_LABEL: Record<AiAgreement, (n: number) => string> // agree: `AI ${n}개 일치`, agree_none: 'AI 모두 못 찾음', differ: 'AI끼리 다름', partial: '일부만 찾음'
export interface CompareRow { provider: AiProvider; run?: AiRun; status: 'done' | 'running' | 'failed' | 'cancelled' | 'queued' | 'missing'; summary?: AiRunSummary }
export function compareRows(review, state: AiRunState | null): { compareId: string; rows: CompareRow[]; scopeRun: AiRun } | null
// latest = review.runs[0]; latest.compareId 없으면 null. 같은 compareId run들을 createdAt 오름차순(=공급자 실행 순)으로 모음.
// 계획 공급자 = state?.compare?.id === compareId면 state.compare.providers, 아니면 run들의 provider 순서.
// 행 상태: run 있음 → run.status 매핑(requesting→running, done→done+runSummary, failed, cancelled). run 없음 → state.compare 살아 있고 index보다 뒤면 'queued', 아니면 'missing'(offscreen 중단 등).
// scopeRun = 첫 run(범위 표시용)
export function compareAgreementSummary(primary, others): { compared: number; agree: number; differ: number; partial: number; none: number }
// 키마다 infos = [primary[k], ...others[k]]가 2개 이상인 것만 집계
```
- `quickView`: running 분기에서 `state.compare`가 있으면 label을 `AI 비교 ${index+1}/${providers.length} · ${state.label}`로.

### 4.5 AiRunPanel
- `compareRows(review, state)`가 null이 아니면(최신 run이 비교 소속) 기존 body 대신 `CompareSummary` 렌더. 단, latest.status === 'awaiting'은 발생하지 않음(비교는 API 전용).
- CompareSummary: 제목 "AI 비교 · {scopeLabel(scopeRun)}" / 행마다 ProviderIcon·라벨·모델·상태: done → `제안 n · 일치 n · 못 찾음 n · 검증 실패 n`(DoneSummary의 수치 부분 재사용, 검증 실패 펼침은 생략 가능) / running → 스피너 + state.label + [취소](ai/cancel with state.runId) / failed → 오류 코드·메시지 + [다시 실행] / queued → "대기" / missing → "실행되지 않음" + [실행]. [다시 실행]·[실행]은 `onOpenDialog({ scope: scopeRun.scope, ...(scopeRun.scope==='keys' ? {keys: scopeRun.keys} : {}), provider })` — 단독 재실행 결과도 공급자별 표시 규칙으로 자연히 비교에 합류한다(compareId는 붙지 않음, 패널 행은 'missing' 그대로지만 카드엔 보임 — 허용).
- 맨 아래 한 줄: `compareAgreementSummary` → "비교 항목 {compared}개 · 일치 {agree} · 다름 {differ} · 일부만 찾음 {partial}". 모두 0이면 생략.
- 패널 `data-ai`: running 행이 있으면 그 provider, 없으면 속성 없음(기본 보라).
- stale(첫 run이 stale)이면 기존과 같은 경고 한 줄.

### 4.6 AiRunDialog(비교 모드)
- `AiDialogPreset`에 `compare?: boolean`.
- "사용할 AI" fieldset 상단에 라디오 2개: "AI 하나로 실행"(기존 UI 그대로) / "여러 AI로 비교". preset.compare면 후자 기본.
- 비교 선택 시: `AI_PROVIDERS` 순 체크박스. `apiBlock(p)`(기존 함수)가 문자열을 돌려주면 disabled + 사유 표시. 기본 체크 = 사용 가능한 공급자 전부. 안내 문구: "비교는 API 방식으로만 실행합니다. 공급자마다 run이 하나씩 만들어집니다."
- 실행 버튼: 라벨 `${n}개 AI로 비교`, `n < 2`면 disabled(툴팁 "두 개 이상 고르세요"). 클릭 → `send('ai/compare-run', { noticeId, scope, keys(기존 조건), providers, files(기존 조건) }, { timeoutMs: 70_000 })` → onStarted, onClose. 오류 처리는 기존 `error` 상태 그대로(AI_KEY_MISSING 등은 메시지에 공급자 라벨이 들어온다).
- 파일 체크리스트·범위는 공용. `overLimit` 경고는 manual 전용이므로 비교에선 표시 안 함.

## 5. 적용·무시 시 다른 공급자 제안 처리

- 적용(ai/apply, runId=선택 공급자): 그 제안만 `appliedAt`. 같은 키의 다른 공급자 제안은 변경 없음. 카드는 userEdited(origin ai, 그 runId)가 되고 블록 기본 선택은 적용된 칩. 다른 칩은 값이 있으면 [적용]이 남는다(= 바꾸기). 되돌리기(자동 결과로)는 기존 그대로.
- 무시(ai/dismiss, runId=선택 공급자): 그 제안만 `dismissedAt`. 남은 제안이 있으면 블록 유지·선택 기본값으로 이동, 없으면 블록 사라짐.
- 백엔드(applySuggestion/dismissSuggestion) 변경 없음.
- "AI 확인 일치" verified 배지·사이드패널 배지는 primary 기준 그대로.

## 6. 실행 방식

- 순차 실행, 동시 실행 없음. `AiRunner.runs` 항목 1개를 시리즈 전체 동안 유지 → 그 사이 `exec`/`prepare`/일괄 실행의 같은 공고 시도는 `AI_RUN_BUSY`(일괄은 해당 공고를 skipped로 기록하고 계속, 기존 동작).
- 공급자 간 간격 0ms(엔드포인트가 다름). ai-client의 재시도(retryable 1회)와 120초 타임아웃은 run마다 그대로. 최악 3 × 120초.
- 분당 한도: 공급자마다 키·한도가 별개라 비교 자체는 한도를 더 쓰지 않음. RATE_LIMIT/QUOTA가 나와도 그 공급자만 failed, 다음 계속.
- 취소: `ai/cancel { noticeId, runId: state.runId }` — 러너의 abort는 시리즈 공용이라 현재 run 취소 + 남은 공급자 미실행(패널 행 'missing'). run 사이 짧은 틈에 이전(done) runId로 와도 abort되어 다음을 시작하지 않는다(`cancelRunState`는 done run엔 false 반환, 정상).
- 2번째 이후 run의 prepareRun 실패(저장소 오류 등)는 outcome failed로 기록하고 다음 공급자 계속(run 파일엔 안 남음 → 패널 'missing').
- offscreen 재시작: 진행 중이던 run은 기존 `sweepOrphans`가 AI_INTERRUPTED로 닫음. 남은 공급자는 실행되지 않고 'missing'으로 보임 → 사용자가 행의 [실행]으로 채움.

### AiRunner 변경(src/engine/ai/ai-runner.ts)
```ts
export interface CompareRequest { noticeId: string; scope: AiScope; keys?: ExtractionKey[]; files?: string[]; compareId: string; targets: Array<{ provider: AiProvider; api: ExecRequest['api'] }> }
async execCompare(p: CompareRequest): Promise<{ compareId: string; runId: string; done: Promise<AiRunOutcome[]> }>
```
- 검증: targets 2~3개, provider 중복 없음 → 아니면 `AI_BAD_REQUEST`.
- 흐름: `sweepOrphans` → busy면 `AI_RUN_BUSY` → entry 등록(runId '') → targets[0] `prepareRun({...p.scope/keys/files, provider, mode:'api', model, sendFullText, compareId})` 실패 시 entry 삭제·rethrow → entry.runId 설정, `preparing` push(compare {id, providers, index:0}) → 즉시 `{compareId, runId}` 반환. `done`은 setTimeout 0 뒤: outcomes[0] = runOne(...); i≥1: `signal.aborted`면 중단; `prepareRun({ scope:'keys', keys: firstRun.keys, files, provider, ..., compareId })` 예외면 outcomes.push failed 후 continue; entry.runId 갱신, preparing push(index i), outcomes.push(await runOne); outcome cancelled && signal.aborted면 중단. finally에서 entry 삭제(같은 entry일 때만).
- 리팩터: 현재 `run()`에서 Map 삭제(finally)를 분리해 `runOne(p, prepared, entry, compare?)`로 만들고, `exec`가 `runOne` 후 삭제를 맡는다. `push`에 `compare?` 인자 추가, `onStatus` 경유 push에도 전달. 기존 `exec` 동작·push 순서는 불변(기존 ai-runner 테스트가 그대로 통과해야 함).
- `cancel`은 무변경. `AiBatchRunner` 인터페이스 무변경.

### SW 라우터(src/background/router.ts, `registerAiMessages` 안, 'ai/run' 리스너 옆)
- `ai/compare-run`: `assertExtensionSender` → providers 검증(배열·2~3개·중복 없음·`AI_PROVIDERS` 포함, 아니면 `INVALID_VALUE`) → `readAiSettings` 1회 → 공급자마다 순서대로 키·모델·권한 확인(`requireAiAccess` 재사용). 오류 메시지에 라벨 접두: `Claude: API 키가 없습니다. 설정에서 저장하세요.`(코드는 기존 AI_KEY_MISSING/AI_MODEL_MISSING/AI_PERMISSION_MISSING). 하나라도 실패하면 offscreen에 보내지 않는다 → `ensureOffscreen` → `send('ai/compare-exec', { noticeId, scope, keys, files, compareId: crypto.randomUUID(), targets }, { target:'offscreen', timeoutMs: 60_000 })`. 예외 메시지는 모든 키로 `maskKey`.
- offscreen main.ts: `listen('ai/compare-exec', async (p) => { const r = await aiRunner.execCompare(p); return { compareId: r.compareId, runId: r.runId }; }, 'offscreen')`.

## 7. 단계별 작업 분할

S1 타입·프로토콜·저장 (implementer, 1명)
- src/core/types/ai.ts: `AI_PROVIDERS`, `AiRun.compareId?`, `AiRunState.compare?`.
- src/messaging/protocol.ts: `ai/compare-run`, `ai/compare-exec` 추가(ai/run 옆).
- src/engine/ai/ai-review-api.ts `PrepareInput.compareId?` + `prepareRun` 기록.
- src/entrypoints/dashboard/review/AiRunDialog.tsx 상단 `PROVIDER_IDS` → `AI_PROVIDERS` import로 교체(이 파일의 다른 부분은 S4에서).
- 테스트: tests/engine/ai-review-api.test.ts에 "compareId를 주면 run.compareId에 저장, 없으면 필드 없음" 1건.

S2 러너·라우터 (메인 직접 권장: 동시성·잠금 코어)
- src/engine/ai/ai-runner.ts: `runOne` 분리, `push(compare?)`, `execCompare`(§6).
- src/background/router.ts: `ai/compare-run` 리스너(§6).
- src/entrypoints/offscreen/main.ts: `ai/compare-exec` 리스너.
- 테스트 tests/engine/ai-runner.test.ts(기존 픽스처 재사용): ① 순차 — 2번째 fetch는 1번째 done 이후, 동시에 fetch 2개가 열리지 않음 ② 각 run에 compareId, 2번째 이후 scope 'keys'·keys = 첫 run.keys ③ push마다 `compare.index`가 0,1,2 ④ 2번째 공급자 API 실패여도 3번째 실행, outcomes 길이 3 ⑤ 시리즈 중 `exec`는 AI_RUN_BUSY, 끝나면 Map 비움 ⑥ 1번째 실행 중 cancel → 1번째 cancelled, 2·3번째 run 생성 없음 ⑦ targets 1개 → AI_BAD_REQUEST ⑧ 기존 exec 테스트 전부 통과.
- 테스트 tests/background/ai-router.test.ts: ① providers 1개/중복/미지 값 → INVALID_VALUE, offscreen 미호출 ② 2번째 공급자 키 없음 → AI_KEY_MISSING 메시지에 라벨, offscreen 미호출 ③ 정상 → compare-exec payload targets에 공급자별 key·model·sendFullText, compareId uuid ④ offscreen 오류 메시지에 키 전부 가림.

S3 표시 순수 함수 (implementer)
- src/ui/review/ai-view.ts: `buildAiCardsByProvider`, `aiOthers`, `aiAgreement`, `AGREEMENT_LABEL`, `compareRows`, `compareAgreementSummary`, `quickView` compare 라벨(§4.4). `buildAiCards`는 결과 불변(내부 공유 함수로 리팩터만).
- src/ui/review/view.ts: `CardModel.aiOthers?`, `buildCards` 3인자.
- 테스트 tests/ui/ai-view.test.ts 추가 케이스: ① Gemini run 뒤 Claude run(같은 키 요청) → primary=Claude, others=[Gemini] ② Claude run이 키를 요청했지만 제안 없음 → primary 없음, others=[Gemini](공급자별 규칙) ③ dismissed된 공급자 제안은 others에서 제외 ④ stale run 제외 ⑤ 같은 공급자 run 2개면 최신만 ⑥ others 순서 = AI_PROVIDERS 순 ⑦ aiAgreement: 숫자 동일 agree / "3년" vs "3 년" agree(valueKey) / 다른 값 differ / 한쪽 none partial / 모두 none agree_none / multi 같은 variants agree / n<2 null ⑧ compareRows: state.compare 살아 있을 때 queued, 없을 때 missing, 실행 순 정렬, latest에 compareId 없으면 null ⑨ quickView compare 라벨 ⑩ 기존 buildAiCards 테스트 무변경 통과.

S4 화면 (implementer)
- AiSuggestionBlock.tsx(§4.1), ItemCard.tsx(§4.2), ReviewTab.tsx(§4.3), AiRunPanel.tsx(§4.5 CompareSummary), AiRunDialog.tsx(§4.6).
- 제약: AiRunDialog의 `override`/`switchOpen` 상태와 "이번만 바꾸기" 블록은 손대지 않고, compare 라디오가 선택됐을 때 그 블록 대신 체크박스 블록을 그린다. `apiBlock`을 재사용한다.
- 제약: ReviewTab의 `runAi(scope, keys, provider)`와 메뉴의 `via-<provider>` 항목(공급자 바로 고르기)은 유지한다.
- 제약: ItemCard·AiSuggestionBlock의 시각(색·간격)은 기존 토큰 그대로. 칩은 `rounded-full border border-ai-line bg-ai-wash text-ai-ink text-xs px-2` 스타일(기존 알약과 동일), 선택 칩은 `bg-ai-ink text-surface`.

S5 기록
- `.claude/specs/decisions.md`에 §2 표를 "2026-10-20, AI 비교 실행" 섹션으로 추가. 2026-10-20 진입점 확장의 "공고당 1 run 유지"는 유지됨을 명시.

## 8. 하지 말아야 할 것 / 흔한 오해

- `AiRunner.runs`를 runId 키로 바꾸거나 공고당 동시 실행을 허용하지 말 것. 세션 키·고아 정리·취소·일괄 실행이 모두 깨진다.
- `buildAiCards`의 primary 규칙(요청한 키 기준, 폴백 없음)을 바꾸지 말 것. 비교 표시는 others를 덧붙이는 것뿐이다.
- 적용 시 다른 공급자 제안을 자동 dismiss하지 말 것.
- `prepareRun`의 "awaiting run을 cancelled로 바꾸는" 동작 때문에 비교에 manual을 섞을 수 없다. 비교는 API 전용이며 다이얼로그에서 manual 선택지를 보이지 않는다.
- 2번째 이후 run에 원래 scope('pending'/'auto')를 다시 넘기지 말 것(키 집합이 달라질 수 있음).
- `compareRows`의 'missing' 행 [실행]은 compareId 없는 보통 ai/run이다. 패널 행은 'missing'으로 남지만 카드에는 공급자별 규칙으로 보인다 — 이것을 "버그"로 보고 compareId를 억지로 붙이려 하지 말 것.
- `AI_MAX_RUNS` 상향 금지. 비교 3개가 10칸 중 3칸을 쓰는 것은 의도된 비용.
- 러너 테스트에서 `done` 프로미스를 기다리지 않고 Map 상태를 단언하면 flaky. 기존 테스트의 대기 방식을 따를 것.
- AiSuggestionBlock의 `useState`가 조기 return 뒤에 있다. 칩 선택 상태를 추가하면서 반드시 훅을 return 앞으로 올릴 것.

## 9. 검증 방법

자동(test-runner, vitest; 드라이브 문자 `C:`로 cd 후 실행):
- S1~S3 테스트 항목 전부 통과 + 기존 `tests/ui/ai-view.test.ts`, `tests/engine/ai-runner.test.ts`, `tests/engine/ai-batch.test.ts`, `tests/background/ai-router.test.ts` 무변경 통과. `tsc --noEmit` 통과(ItemCard props 변경으로 ReviewTab 외 호출처가 없음을 컴파일로 확인).

수동(대시보드, Gemini 키 1개만 있어도 가능한 것 먼저):
1. Gemini로 "AI로 다시 찾기" → Claude(키 없으면 수동 방식)로 같은 범위 재실행 → 같은 항목에 칩 2개, 둘 다 값·인용 보임. 칩 전환 시 블록 색이 공급자 색으로 바뀜.
2. 한 칩 [적용] → "적용됨"이 그 칩에만, 다른 칩엔 [적용] 유지 → 다른 칩 [적용] → 값이 바뀌고 "AI 제안 적용" 배지 유지.
3. 한 칩 [무시] → 칩 사라지고 남은 칩 선택됨. 둘 다 무시 → 블록 사라짐.
4. 키 2개 이상일 때: 옵션 다이얼로그 → 여러 AI로 비교 → 패널에 행이 순서대로 running→done, 세션 라벨 "AI 비교 2/3". 끝나면 일치 요약 줄.
5. 실행 중 [취소] → 현재 행 cancelled, 나머지 'missing', [실행]으로 개별 채움 가능.
6. 비교 중 같은 공고 항목 "AI로 찾기" → "이미 AI 실행 중" 오류. 비교 중 일괄 실행에 그 공고 포함 → 해당 공고 skipped(AI_RUN_BUSY).
7. 사이드패널: 비교 중 상태 한 줄에 "AI 비교 n/m", 완료 후 배지는 기존과 동일(primary 기준).

## 10. 기각한 대안

- 동시 실행(Promise.all 3개): 공고당 1 run 결정 위반, `aiRun.<noticeId>` 세션 키·AiRunPanel·quickView·sweepOrphans·cancel 전부 다중 run 대응 필요. 이득은 소요 시간뿐.
- 대시보드가 ai/run을 공급자마다 순차 호출: 구현 최소지만 페이지 이동·닫기 시 나머지 공급자 미실행, 실패 처리가 화면 코드에 흩어짐.
- AiBatch에 (noticeId, provider) 항목 일반화: `AiBatchState.provider/model`이 최상위라 모양이 안 맞고, AiBatchPanel·배치 라우터·세션 키까지 연쇄.
- compareId 그룹만 비교 표시: 사용자가 이미 겪는 가려짐 문제(따로 돌린 결과)를 못 고침. 수동 방식 결과도 비교 불가.
- 별도 비교 테이블(항목×공급자 매트릭스) 화면: 적용·근거 보기·무시 UI를 중복 구현. 칩 방식은 기존 블록 그대로 재사용.
- 적용 시 나머지 자동 무시: 되돌려 다른 AI 값으로 바꾸는 흐름이 막힘.
- 비교에 반자동(프롬프트 복사) 포함: awaiting run이 하나만 유지되는 구조(prepareRun이 기존 awaiting을 cancelled 처리)와 충돌.

## 관련 파일

- src/core/types/ai.ts
- src/messaging/protocol.ts (ai/* 메시지)
- src/engine/ai/ai-review-api.ts (PrepareInput, prepareRun)
- src/engine/ai/ai-runner.ts (exec, run, cancel)
- src/background/router.ts (requireAiAccess, ai/run 리스너)
- src/entrypoints/offscreen/main.ts (ai 리스너)
- src/ui/review/ai-view.ts (buildAiCards, quickView)
- src/ui/review/view.ts (CardModel, buildCards)
- src/entrypoints/dashboard/notice/ReviewTab.tsx (runAi/aiApply/aiDismiss/MenuButton)
- src/entrypoints/dashboard/review/ItemCard.tsx
- src/entrypoints/dashboard/review/AiSuggestionBlock.tsx
- src/entrypoints/dashboard/review/AiRunPanel.tsx (DoneSummary, 본체)
- src/entrypoints/dashboard/review/AiRunDialog.tsx (PROVIDER_IDS, 사용할 AI fieldset, start)
- .claude/specs/decisions.md (진입점 확장 결정)
