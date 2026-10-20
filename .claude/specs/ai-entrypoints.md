# AI 재검토 진입점 확장 명세

설계: fable-advisor (2026-10-20), 사용자 승인. 선행 명세 `.claude/specs/ai-review.md`(구현 완료, 커밋 5f8ea9a). 결정 요약은 `decisions.md` "2026-10-20 AI 재검토 진입점 확장".
독자: 맥락 없는 서브에이전트. 이 문서의 결정만 따르고, 벗어나야 하면 중단하고 보고한다.

## 0. 요구사항 (사용자 확정)
1. 공고 목록: 체크박스로 고른 공고만 [선택한 공고 AI로 다시 찾기]로 일괄 실행.
2. 사이드패널 "평가 기준" 그룹: 버튼 → 패널에서 바로 실행, "제안 n건" 요약 표시. [적용]은 대시보드 확인 탭으로 이동해서.
3. 확인 탭 원클릭: 누르자마자 실행. 기본 범위 = 확인 필요 항목이 있으면 그것만, 없으면 7개 전체. 나머지 옵션은 ▾ 메뉴.
4. 확인 필요 카드마다 [AI로 찾기] → 그 항목 하나만.
5. 버튼 아이콘은 가능하면 실제 공급자 아이콘(Claude/ChatGPT/Gemini). 시각 디자인은 메인이 목업으로 확정한 뒤 S3~S5에 별도 지시.

## 1. 결정 요약
| # | 결정 |
|---|---|
| D1 | `AiScope = 'pending' \| 'all' \| 'auto' \| 'keys'`, 요청 payload에 `keys?: ExtractionKey[]`. 저장 run에는 해석된 scope만(`auto`→`pending`/`all`, `keys`→`keys`). `run.keys`가 단일 진실이라 프롬프트·발췌·검증 영향 없음. 마이그레이션 없음 |
| D2 | `buildAiCards`의 키별 최신 run 판정은 `run.keys.includes(key)`(요청 여부) 기준. 최신 run이 요청했는데 제안이 없으면(검증 실패) 오래된 run으로 폴백하지 않고 빈칸. `keys: []`인 옛 run은 `Object.keys(run.suggestions)`로 방어 |
| D3 | 반자동: 원클릭·▾·항목별은 `ai/prepare`(기존 ManualWait). 사이드패널은 manual 설정이면 [대시보드에서 AI로 찾기](이동만). 일괄은 API 전용 |
| D4 | 일괄 대기열은 offscreen `AiBatch`(한 번에 1개 배치), 상태는 `ai/batch-status` push → SW가 storage.session `aiBatch`에 기록. JobType 아님 |
| D5 | 순차 1개, 공고 사이 2초. RATE_LIMIT → 60초 대기 후 같은 공고 1회 재시도, 재발 시 중단. QUOTA·AUTH → 즉시 중단. OVERLOADED → 건 실패 기록 후 계속, 연속 3건이면 중단. 그 외(NOT_FOUND, JOB_ALREADY_RUNNING, AI_RUN_BUSY, NO_DOCUMENTS, TIMEOUT, BAD_RESPONSE…) → 건 기록 후 계속 |
| D6 | 배치 고아: UI 마운트 시 `ai/batch-get` → SW가 세션이 running/waiting이면 offscreen 생존 확인(`hasOffscreen()` false면 ensure 하지 않고 고아), 없으면 `stopped{AI_INTERRUPTED}`로 덮어씀 |
| D7 | 목록 선택은 NoticesPage 컴포넌트 state `Set<noticeId>`. 필터·검색·정렬 바꿔도 유지, 페이지 떠나면 소멸. 헤더 체크박스 = 보이는 행 중 선택 가능 전체 토글. 선택 가능 = 입찰공고(사전규격 아님) ∧ extractionStatus ∈ {verified, needs_review} |
| D8 | 사이드패널은 `useAiRun` 재사용, 실행·요약만. `ai/apply` 호출 금지 |
| D9 | 원클릭 = 설정 공급자 + scope `auto`. 키·모델 없음은 UI가 미리 판단해 AiRunDialog를 `initialError`와 함께 연다. 권한 없음은 실행 후 오류로 알게 되므로 같은 다이얼로그로 |
| D10 | 항목별 버튼은 `pendingKeys(extraction.items)`에 든 카드만. 공고에 AI 실행·대기 중이면 모든 AI 버튼 비활성, 실행 중 run이 그 키를 요청했으면 카드에 "AI 찾는 중…" |
| D11 | `AiRunner.exec`의 `done`을 `Promise<AiRunOutcome>`(`{ status: 'done'\|'failed'\|'cancelled'; error?: {code; message}; run?: AiRun }`)로 |

## 2. 범위 모델 (S1)
- `src/core/types/ai.ts`: `AiScope` 확장. 주석: auto/keys는 요청 전용, 저장 run의 scope는 pending|all|keys.
- `ai-review-api.ts` `prepareRun`(키 계산 78행 부근): `PrepareInput.keys?` 추가.
  - all → EXTRACTION_KEYS / pending → pendingKeys, 0개면 NOTHING_TO_REVIEW(현행)
  - auto → pendingKeys ≥1이면 그것(저장 scope pending), 아니면 EXTRACTION_KEYS(저장 scope all)
  - keys → 중복 제거, EXTRACTION_KEYS 부분집합 검사. 빈 배열 NOTHING_TO_REVIEW, 모르는 키 AI_BAD_REQUEST("알 수 없는 항목"). 저장 scope keys
- `ai-runner.ts`: `ExecRequest.keys?`, prepare payload keys 전달, `done: Promise<AiRunOutcome>`(예외 경로는 `{status:'failed', error}`).
- `protocol.ts`: `ai/run`·`ai/exec`·`ai/prepare` payload에 `keys?`. `router.ts` ai/run·ai/prepare 릴레이가 keys 전달.
- `src/core/ai/summary.ts`(신규): `runSummary(run): AiRunSummary`를 ai-view에서 이동, ai-view는 re-export. `AiRunSummary { match; proposals; none; rejected }`(기존 반환 형태가 다르면 기존 필드를 유지하고 보고).
- `src/ui/review/ai-view.ts`: D2 규칙, `scopeLabel(run)`("확인 필요 항목" / "7개 전체" / "항목: 신인도, 실적 기간" — 항목 라벨은 기존 카드 라벨 상수 재사용), `quickView(review, extraction, state) → { phase: 'idle'|'running'|'awaiting'|'done'|'failed'; label; summary?; error? }`(사이드패널·확인 탭 공유).
- `providers/schema.ts`가 spec.keys로 enum을 만드는지 확인(1키 run 스키마).

## 3. 일괄 실행 (S2)
### 3.1 타입 (`src/core/types/ai.ts`)
```ts
export type AiBatchItemStatus = 'queued' | 'running' | 'done' | 'failed' | 'skipped';
export interface AiBatchItem { noticeId: string; status: AiBatchItemStatus; attempts: number; runId?: string; summary?: AiRunSummary; error?: { code: string; message: string } }
export interface AiBatchState {
  batchId: string; provider: AiProvider; model: string;
  status: 'running' | 'waiting' | 'done' | 'stopped' | 'cancelled';
  startedAt: ISODate; updatedAt: ISODate; finishedAt?: ISODate;
  items: AiBatchItem[]; currentIndex?: number; waitUntil?: ISODate;
  stopReason?: { code: string; message: string };
}
export const AI_BATCH_SESSION_KEY = 'aiBatch';
export const AI_BATCH_MAX = 50; export const AI_BATCH_GAP_MS = 2_000;
export const AI_BATCH_RATE_WAIT_MS = 60_000; export const AI_BATCH_OVERLOAD_STOP = 3;
```
AiErrorCode에 `AI_BATCH_BUSY`. `AI_BATCH_CANCELLED`·`AI_BATCH_STOPPED`·`AI_ALREADY_RAN`은 item.error.code(string)로만.

### 3.2 `src/engine/ai/ai-batch.ts` (신규)
```ts
export interface AiBatchDeps { runner: AiRunner; pushStatus(s: AiBatchState): void; getReview(noticeId: string): Promise<AiReviewFile | null>; now?(): Date; gapMs?: number; rateWaitMs?: number }
export class AiBatch {
  start(p: { batchId; noticeIds; provider; api: { key; model } }): { batchId; done: Promise<void> } // 활성 배치 있으면 AI_BATCH_BUSY
  cancel(batchId): { cancelled: boolean }
  current(): AiBatchState | null
}
```
루프(공고 i):
1. 취소면 남은 항목 skipped `AI_BATCH_CANCELLED`, status cancelled, 종료.
2. 사전 검사(getReview): 최신 run이 awaiting → skipped `AI_RUN_BUSY`("반자동 답변 대기 중"). 최신 run이 done이고 createdAt ≥ batch.startedAt → skipped `AI_ALREADY_RAN`.
3. `runner.exec({ noticeId, scope: 'auto', provider, api })`. exec가 던지면 skipped{code}, 계속.
4. `await done` → done: 항목 done + summary, 연속 과부하 0 / failed AI_QUOTA·AI_AUTH: 항목 failed, 배치 stopped{code}, 남은 항목 skipped `AI_BATCH_STOPPED` / AI_RATE_LIMIT: attempts<2면 status waiting + waitUntil=now+rateWaitMs, **abortable** sleep 후 같은 공고 재실행, attempts≥2면 stopped / AI_OVERLOADED: failed, 연속++ , 3이면 stopped / 그 외 failed·cancelled: 기록 후 계속.
5. 다음 공고 전 gapMs abortable sleep(취소 즉시 깨어남).
6. 정상 종료 status done + finishedAt. push는 상태 변화마다.
- 반드시 `runner.exec`를 거친다(prepareRun 직접 호출 금지). 키는 start 인자로만, 상태·오류에 넣지 않는다. 공고 제목도 상태에 넣지 않는다(UI가 join).
- cancel은 현재 공고의 runner.cancel도 호출한다.

### 3.3 프로토콜·SW·offscreen
```
ai/batch-run    { noticeIds: string[]; provider?: AiProvider } → { batchId }          // 대시보드→SW
ai/batch-exec   { batchId; noticeIds; provider; api: { key; model } } → { batchId }   // SW→offscreen 전용
ai/batch-status AiBatchState → void                                                   // offscreen→SW 전용
ai/batch-get    {} → AiBatchState | null                                              // 대시보드→SW(→offscreen 생존 확인)
ai/batch-cancel { batchId } → { cancelled: boolean }                                  // EXTENSION_ONLY 일반 릴레이
ai/batch-clear  { batchId } → void                                                    // SW 단독, running/waiting이면 AI_BATCH_BUSY
```
- `ai/batch-run`: assertExtensionSender → noticeIds 배열·문자열 검사·중복 제거·빈 배열 거부·AI_BATCH_MAX 초과 PAYLOAD_TOO_LARGE → ai/run과 같은 키·모델·권한 검사(maskKey) → batchId=randomUUID → 초기 상태(items 전부 queued, status running)를 세션에 먼저 기록 → ensureOffscreen → ai/batch-exec(25초).
- `ai/batch-status`: isOffscreenSender만, 세션 set. `ai/batch-get`: D6. `ai/batch-clear`: 세션 remove.
- offscreen main.ts: `new AiBatch({ runner: aiRunner, pushStatus, getReview })`, 핸들러 batch-exec·batch-get(current())·batch-cancel.

## 4. UI (S3~S5) — 시각 디자인은 메인 목업 확정 후 별도 지시
### 4.1 확인 탭 (S3)
- `src/ui/components/MenuButton.tsx`(신규): 주 버튼 + ▾, absolute 드롭다운, Escape·바깥 클릭·선택 시 닫힘, aria-haspopup="menu".
- ReviewTab: settings·useAiKeyPresence로 blocked(api 모드에서 키/모델 없음) 사전 판단. run(scope, keys?): blocked면 AiRunDialog({scope, keys, initialError}) / mode manual이면 ai/prepare(35초) / api면 ai/run(70초) → ai.reload. 설정 오류(isSetupError)는 다이얼로그, 그 외(JOB_ALREADY_RUNNING, AI_RUN_BUSY, NOTHING_TO_REVIEW 등)는 요약 줄 아래 InlineAlert.
- 주 버튼 "AI로 다시 찾기"(manual이면 "(반자동)"), 툴팁 "확인 필요 N개만"/"7개 전체". ▾: 7개 전체 재검토 / 확인 필요 항목만 (N, 0이면 비활성) / 옵션 열기…(공급자·방식·파일).
- AiRunDialog preset: `keys?`(scope keys면 세 번째 범위 "이 항목만: <라벨>" 고정), `initialError?`.
- AiRunPanel: scopeLabel 표시, 재시도 preset에 keys 포함.
- ItemCard: `onAiFind?`, `aiFinding?`, `aiDisabled?`. pendingKeys에 든 카드에만 ReviewTab이 onAiFind 전달. aiFinding이면 버튼 대신 "AI 찾는 중…".
- 비활성: busy ∨ parsed 0 ∨ aiActive ∨ starting ∨ 설정 로딩 중.

### 4.2 공고 목록 (S4)
- `useAiBatch.ts`(신규): 세션 aiBatch 구독, 마운트 시 running/waiting이면 ai/batch-get 1회.
- `src/ui/review/ai-batch-view.ts`(신규, 순수): 사유 라벨(JOB_ALREADY_RUNNING "추출 중" / AI_RUN_BUSY "AI 실행·대기 중" / AI_ALREADY_RAN "배치 중 직접 실행됨" / NOT_FOUND "추출 결과 없음" / NO_DOCUMENTS "읽을 문서 없음" / AI_BATCH_STOPPED "중단으로 미실행" / AI_BATCH_CANCELLED "취소" / 그 외 code·message), 집계, 진행 텍스트, 재실행 대상 id(skipped AI_BATCH_STOPPED + queued), `selectableForAi(entry)`, 헤더 토글 계산.
- NoticesPage: 첫 열 체크박스(stopPropagation, 선택 불가 행 disabled + title 사유), 선택 1개 이상이면 툴바("선택 n건" [선택한 공고 AI로 다시 찾기] [선택 해제]). 배치 active·키 없음이면 비활성+사유+[설정 열기]. 실행 성공 시 선택 해제.
- `AiBatchPanel.tsx`(신규, PageTitle 아래): running(진행 i/n, 현재 공고 제목, 진행 막대, [취소]) / waiting(분당 한도 · N초 후 계속 카운트다운) / 종료(완료·실패·건너뜀 집계, 공고별 결과 표: 제목 링크 → 확인 탭, "제안 2 · 일치 3 · 못 찾음 1" 또는 사유) + stopped면 사유와 [남은 공고 다시 실행] + [닫기](batch-clear).

### 4.3 사이드패널 (S5)
- useAiRun 빈 noticeId 가드. App.tsx에서 useAiRun·useSettings·useAiKeyPresence 연결.
- SummaryCard "평가 기준" 그룹 헤더 오른쪽 버튼, quickView 상태별: idle·api [AI로 찾기](비활성: parsed 0, 잡 active, aiActive, 키·모델 없음→"설정 필요"+[설정]) / idle·manual [대시보드에서 AI로 찾기] / running "AI 찾는 중"+[취소] / awaiting "반자동 답변 대기 중"+[대시보드에서 계속] / done "AI 제안 n · 일치 a · 못 찾음 b · 검증 실패 c"+[대시보드에서 적용] / failed 오류 라벨(+[설정] 또는 "잠시 후 다시").
- 제안 있는 키의 평가 행에 작은 "AI 제안" 배지(summary-view SummaryRow `ai?`).
- 실행 `ai/run {noticeId, scope:'auto'}` 70초. 이동 `ui/open review`, 설정 `ui/open settings section ai`.

## 5. 금지
- auto를 run 파일에 저장 금지. buildAiCards 방어 분기 제거 금지. 배치에서 prepareRun 직접 호출 금지. 배치 상태에 제목·키·프롬프트 금지. batch-get에서 ensureOffscreen 금지. 사이드패널 ai/apply 금지. 항목별 버튼을 pendingKeys 밖 카드에 금지. 배치를 Job/jobIds로 만들기 금지. setTimeout 단독 sleep 금지(abortable). 체크박스 stopPropagation 누락 금지.

## 6. 단계
| 단계 | 담당 | 완료 조건 |
|---|---|---|
| S1 범위 모델 | implementer | 기존 테스트 통과 + ai-review-api(auto 2경로, keys 정상·빈·모르는 키, 저장 scope), ai-runner(outcome), ai-view(D2, scopeLabel, quickView), ai-router(keys 전달) 테스트. UI 미변경 |
| S2 일괄 engine·SW·offscreen | implementer → code-reviewer | ai-batch.test(순차·간격, 오류 분기 전부, awaiting·ALREADY_RAN 건너뜀, 취소 즉시성, push 순서, 상태에 키 없음, BUSY) + ai-router(batch-run 검사·상한·초기 세션, batch-status offscreen만, batch-get 고아, batch-clear 거부) |
| 디자인 목업 | 메인 | 사용자 확인 |
| S3 확인 탭 / S5 사이드패널 | implementer(병렬) | §4.1·§4.3 + 목업 지시 |
| S4 공고 목록 | implementer | §4.2 + 목업 지시 |
| S6 | 메인 | 리뷰, 전체 테스트·빌드, Gemini 실제 일괄 3건 스모크(간격 조정) |

## 7. 시각 디자인 (사용자 승인 목업, 2026-10-20)
목업 원본: `.claude/specs/ai-buttons-mockup.html`(브라우저로 열어 확인 가능). 구현은 목업과 같은 모양을 기존 Tailwind 토큰·컴포넌트로 만든다. 목업 CSS 값은 참고용이며 클래스는 프로젝트 방식(Tailwind 유틸)으로 쓴다.

### 7.1 공통 (theme 토큰과 ProviderIcon은 메인이 구현 완료. MenuButton은 S3. S4·S5는 import만)
- `src/ui/theme/theme.css` @theme에 토큰 추가: `--color-ai-wash: #f3f0fa; --color-ai-line: #ddd5ee; --color-ai-ink: #5b4a8a; --color-claude: #d97757;` 다크 블록에 `--color-ai-wash: #211d2b; --color-ai-line: #3a3150; --color-ai-ink: #c3b5ea;`(claude는 그대로). 주석: "AI가 만든 것(버튼·제안·진행·AI 배지)에만 쓴다".
- `src/ui/components/ProviderIcon.tsx`(신규, index export): `{ provider: AiProvider; size?: 14|16|20; className? }`. 목업의 `<symbol>` path를 그대로 인라인 SVG로. Gemini는 linearGradient(#1c7dff → #8e6ff7 → #e86a8a, x1=0 y1=1 x2=1 y2=0, 그라데이션 id는 useId로 고유하게), Claude는 `text-claude`(fill currentColor), OpenAI는 `currentColor`(글자색). aria-hidden. 출처 주석: simple-icons CC0, 상표는 각 회사 소유.
- `AiButton` 계열은 만들지 않고 각 화면에서 아래 스타일을 쓴다:
  - AI 분할 버튼(확인 탭 주 버튼): 높이 36px, 배경 `bg-ai-wash`, 테두리 `border-ai-line`, 글자 ink·semibold, 왼쪽 ProviderIcon 16, 라벨 뒤 세로선 + 작은 범위 글씨(`text-xs text-ai-ink`, "확인 필요 N개"/"7개 전체"), 오른쪽 ▾ 칸(34px, 같은 배경, 왼쪽 경계선). hover는 살짝 진하게.
  - 작은 AI 버튼(항목별·사이드패널): 기존 Button secondary sm + 앞에 ProviderIcon 14.
  - 진행 중 표시: `bg-ai-wash text-ai-ink` 알약 + 회전하는 ProviderIcon 14 + "<공급자>가 찾는 중…"(prefers-reduced-motion이면 회전 없음).
- MenuButton 드롭다운: surface 배경, line 테두리, shadow-overlay, 항목은 제목(14px) + 설명(12px muted) 두 줄, 구분선. 목업 §A 메뉴 문구 그대로.

### 7.2 확인 탭 (S3)
- 요약 줄 오른쪽: AI 분할 버튼. 실행 후 패널(AiRunPanel 완료 요약)은 `bg-ai-wash border-ai-line` 한 줄: ProviderIcon 20 + "<공급자> <모델> · <범위> 재검토 완료" + 오른쪽 숫자(제안·일치·못 찾음·검증 실패, 숫자 굵게).
- AiSuggestionBlock: 기존 InlineAlert info 대신 `bg-ai-wash border-ai-line rounded-card` 상자. 머리줄(ProviderIcon 16 · "AI 제안"(ink, semibold) · 공급자명 · verdict 알약(새로 찾음/현재 값과 다름/AI 확인 일치=ok-wash 초록)) → 값(20px bold + 작은 항목명) → 인용 blockquote(surface 바탕, 왼쪽 3px ai-line 선, 값 부분은 기존 mark 강조, 아래 "파일 · N쪽") → 하단 버튼(왼쪽 [전체 텍스트에서 보기] ghost, 오른쪽 [무시] ghost + [적용] primary).
- 확인 완료 카드에 match가 있으면 제목 옆 작은 배지 "AI 확인 일치"(ai-wash/ai-line/ai-ink 알약).
- ItemCard [AI로 찾기]: 작은 AI 버튼, [직접 수정] 앞. 찾는 중이면 진행 중 표시로 교체.

### 7.3 사이드패널 (S5)
- "평가 기준" 그룹 헤더: 제목 · 확인 필요 배지 · (오른쪽) 작은 AI 버튼.
- 결과는 그룹 안 하단 `bg-ai-wash border-ai-line rounded-lg` 상자: ProviderIcon 14 + "**AI 제안 n** · 일치 a · 못 찾음 b" + [대시보드에서 적용 ↗](sm secondary).
- 제안 있는 행 값 옆 작은 "AI 제안" 알약(12px, ai 색).

### 7.4 공고 목록 (S4)
- 첫 열 체크박스(accent-primary). 선택 행 배경은 ai-wash를 surface에 섞은 옅은 색(`bg-ai-wash/60` 수준).
- 선택 1개 이상이면 표 위 **진한 막대**: `bg-ink text-surface rounded-card`, 왼쪽 "N건 선택"(semibold), 오른쪽 [선택 해제](막대 위 ghost, 흐린 글씨) + [선택한 공고 AI로 다시 찾기](surface 바탕 ink 글씨, 앞에 ProviderIcon 14).
- AiBatchPanel: surface 카드 + ai-line 테두리 + shadow-card. 머리줄 ProviderIcon 20 · "AI 일괄 재검토"(semibold) · muted "<공급자> <모델> · i / n · 현재: <제목>" · 오른쪽 [취소]. 아래 **칸 막대**(공고 1건 = 1칸, 8px 높이, 3px 간격, 완료 ok / 실패 danger / 건너뜀 faint / 진행 중 ai-ink 맥박 / 대기 line) + 범례 + 공고별 결과 2열 그리드(제목 링크 accent, 오른쪽 결과: 완료는 ok색 "제안 a · 일치 b · 못 찾음 c", 건너뜀·실패는 muted/danger 사유).

### 7.5 설정 (S3에 포함)
- AiCard 공급자 라디오를 3열 카드로: 각 카드 ProviderIcon 20 + 이름(semibold) + 오른쪽 라디오, 아래 작은 설명(muted 12px: "무료 등급 · <모델>" / "종량제 · <모델>"), 태그(무료=ok-wash 초록, 유료=sunken muted). 선택 카드는 primary 테두리 1px + 링. 좁으면 1열.
