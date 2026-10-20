# AI 재검토 대상 13행(잎 16개) 확장 명세

설계 결정: `.claude/specs/decisions.md` "2026-10-20 AI 재검토 대상 13행 확장". 선행: `.claude/specs/notice-review-rows.md`(공고정보 검토 탭, 구현 완료 미커밋).

사용자 결정: 행 버튼, 전체 재검토, 사이드패널 원클릭, 일괄 실행 모두 16개 기준. 시각 없는 날짜는 값이 아님. AI_MAX_TOKENS 16384.

진행 순서: S1 → S2 (지금 가능) → [AI 비교 작업 커밋 대기] → S3 → S4 → S5(메인) → S6.
**S1, S2에서 수정 금지 파일**: `src/core/types/ai.ts`, `src/engine/ai/*`, `src/messaging/protocol.ts`, `src/ui/review/ai-view.ts`, `src/entrypoints/dashboard/review/AiSuggestionBlock.tsx`, `AiRunPanel.tsx`, `AiRunDialog.tsx`, `src/background/router.ts`(다른 세션의 AI 비교 작업 중).

## 진행 상태
- 2026-10-20 S1, S2 완료(리뷰 Major 2건 메인 수정: sameValue 포함 규칙은 공고 잎만, 공동수급 부정 문장은 `jointFromDocText`로 false). tsc, 전체 테스트 통과. 미커밋.
- S2 임시 캐스트: `src/core/ai/verify.ts`의 `key as ExtractionKey`, `src/core/ai/prompt.ts`의 `as unknown as OutputSpec`. S3에서 제거.
- `AI_EXCERPT_EXTRA_KEYWORDS`에서 '공동수급' 제외(ai-eval-coverage 기준선 회귀). 필요하면 기준선 갱신 후 추가.
- 남은 Minor(S3 때 함께): datetime이 오프셋 없는 ISO를 그대로 통과 / joint 인용에 공동 관련 단어가 없어도 거부하지 않음(valueInQuote false로 경고만) / 괄호 안에 괄호가 있는 금액 꼬리는 bad_format.
- 2026-10-20 S3~S5 완료(사용자 지시로 AI 비교 미커밋 상태에서 그 위에 얹음). 리뷰 Critical/Major 없음, Minor 2건 수정(AI 블록 두 칸 비교에 지금 값 재비교, 공고 잎 AI 적용 출처 문구). 테스트, 빌드 통과. 미커밋. ItemCard.tsx 삭제(EditError는 ReviewRows.tsx로).
- 남긴 Minor: 공고 잎 적용 stale 검사가 락 밖 1회(설계상 expectJobId 미도입, isBusy가 대부분 막음) / 사이드패널 배지는 문서 잎만 세지만 원클릭 auto는 16개 기준 / joint 인용 거부, 괄호 안 괄호 금액 꼬리. 남은 일: 사용자 실측(S6 수동 항목).

## 공통 제약
- `ExtractionKey`/`EXTRACTION_KEYS`/`extraction.items`에 공고 잎을 넣지 않는다.
- `pendingKeys`, `reviewCountOf`, handoff 게이트는 건드리지 않는다.
- 프롬프트에 API 값, 후보, 확인 필요 사유를 넣지 않는다(앵커링 방지).
- 공고 잎은 AI가 전부 string(문서 원문 표기)으로 주고 코드가 환산한다.
- `FieldValue.userEdit`에 origin 필드 추가 금지. "AI 적용"은 `source.ref` 파생.
- `types/ai.ts`에 review-rows 런타임 import 금지(순환). 런타임 키 목록은 `core/ai/keys.ts`.
- 시각 없는 날짜를 00:00으로 채우지 않는다.
- 코드 주석, 문구에 가운뎃점(·) 금지.

## S1 코어 키와 값 보조 (implementer)

1. 신규 `src/core/ai/keys.ts`
```ts
import { REVIEW_LEAF_KEYS, REVIEW_KIND, isExtractionLeaf, type ReviewLeafKey, type ReviewValueKind } from '../extraction/review-rows';
export type AiKey = ReviewLeafKey;
export const AI_KEYS: readonly AiKey[] = REVIEW_LEAF_KEYS;
export const isAiKey = (k: unknown): k is AiKey => typeof k === 'string' && (AI_KEYS as string[]).includes(k);
export const isDocAiKey = isExtractionLeaf;
export const aiKindOf = (k: AiKey): ReviewValueKind => REVIEW_KIND[k];
```
2. `src/core/model/dates.ts`: `docDateToIso`를 `src/engine/extraction/extract-step.ts`(113~126행 부근)에서 그대로 옮기고 extract-step은 `export { docDateToIso } from '../../core/model/dates'`. 동작 불변.
3. `src/core/model/field-edit.ts`
   - `applyUserEdit(prev, value, nowIso, o: { raw?; note?; source?: { ref: string; evidence?: string; page?: number } })`: source가 있으면 `{ kind: 'user', ref: o.source.ref, evidence?, page?, fetchedAt }`, 없으면 기존 `{ kind: 'user', ref: 'dashboard' }`. 기존 호출부 무변경.
   - `export function checkLeafValue(key: ReviewLeafKey, v: unknown): boolean`: ExtractionKey면 `VALUE_CHECK[key](v)`, 아니면 `validateFieldValue(key, v).ok`.
4. `src/engine/notices/notice-api.ts` `editNoticeField`: opts에 `source?: { ref: string; evidence?: string; page?: number }` 추가, `applyUserEdit`에 전달. ExtractionKey 위임 분기는 `editExtraction(store, p, { ...opts, source: opts.source })`(editExtraction이 source를 이미 받는지 확인, 안 받으면 멈추고 보고).
5. `src/core/extraction/review-rows.ts` `leafReviewState` 공고 잎 user_edited 분기: `f.source?.ref?.startsWith('ai:')`면 editedOrigin 'ai', 아니면 기존 confirm 판정.
6. 테스트
   - `tests/core/review-rows.test.ts`: 공고 잎 source.ref 'ai:x' → editedOrigin 'ai'.
   - `tests/engine/notice-field-edit.test.ts`: source 옵션을 주면 FieldValue.source.ref, evidence, page 기록, raw 보존.
   - 신규 `tests/core/ai-keys.test.ts`: AI_KEYS 16개 순서, isDocAiKey 7개.

## S2 프롬프트, 파서, 검증, 발췌 상수 (implementer)

`AiKey`는 `core/ai/keys.ts`에서 import한다(types/ai.ts 변경은 S3). 기존 타입이 `ExtractionKey`인 공개 함수 시그니처를 AiKey로 넓혀도 호출부(engine 등)는 ExtractionKey가 부분집합이라 컴파일되어야 한다. 컴파일을 위해 수정 금지 파일을 고쳐야 하면 멈추고 보고.

1. `src/core/ai/prompt.ts`
   - `PROMPT_VERSION = '2.2.0'`. `ITEM_DEFS: Record<AiKey, ItemDef>`, `KIND_OF: Record<AiKey, 'number'|'string'|'boolean'>`(공고 잎 9개 'string'). 키 정렬 `AI_KEYS.filter(...)`.
   - `SYSTEM_PROMPT` 첫 줄: "당신은 공공입찰 공고문과 첨부문서에서 공고 핵심 정보(일정, 금액, 계약 조건)와 정량평가 기준을 찾는 검토자입니다." [근거] 두 번째 줄에 "날짜는 연, 월, 일, 시:분이 문서에 적힌 표기 그대로" 추가(ISO 변환 지시 금지).
   - 린트 제약: 정의 본문에 숫자 토큰 금지(`tests/core/ai-prompt-lint.test.ts`), "예:"/"예)"가 있는 줄은 "(가상 예)", 금지 어구 '사업규모', 'KOICA', '코이카'.
   - 공고 잎 정의(그대로 넣는다):
     - postedAt 공고게시일시: 개념 "이 공고가 나라장터에 게시(공고)된 날짜와 시각". 식별 "공고문 머리나 꼬리의 공고일자 줄", "입찰공고 알림 표의 공고일시 칸". 아님 "입찰서 또는 제안서 마감일시", "사전규격 공개일", "정정공고의 원 공고일(정정공고문이면 정정 게시일)". 값 형식 "string (문서 원문 표기 그대로. 연, 월, 일과 시:분이 모두 있어야 값이며 시각이 없으면 value null, note에 날짜만 적음)".
     - registrationDeadline 입찰참가자격등록 마감: 개념 "입찰참가자격 등록(또는 입찰참가등록)의 마감 일시". 식별 "입찰참가자격 등록 마감 또는 입찰참가등록 기한 줄, 일정 표의 해당 행". 아님 "입찰서 또는 제안서 제출 마감", "현장설명회 일시", "공동수급협정서 제출 기한(별도 항목이면 note)". 값 형식 postedAt과 같음.
     - proposalPeriod 제안서 제출기간: 개념 "제안서(협상 공고에서는 입찰서) 전자 제출의 시작과 마감". 식별 "제안서 제출기간, 입찰서 제출기간, 제안서 접수 줄과 일정 표 행". 아님 "제안서 평가일", "입찰참가자격 등록 마감", "제출 장소나 방법 설명". 값 형식 "string (원문 표기 그대로, 시작과 끝을 한 줄로)". multi "제출 서류 종류별로 기간이 다르면 조건별 값을 모두 적습니다."
     - proposalEvalAt 제안서 평가일자: 개념 "제안서 평가(기술평가, 발표평가)가 열리는 일시". 식별 "제안서 평가 일시, 평가위원회 개최, 발표평가 일정 줄". 아님 "제안서 제출 마감", "가격 개찰 일시", "별도 통보 예정 문구(이 경우 value null, note에 그 문구)". 값 형식 postedAt과 같음.
     - budgetAmount 사업금액: 개념 "이 사업의 사업금액(사업예산, 총 사업비, 배정예산). 부가세 포함 여부가 적혀 있으면 note에". 식별 "사업금액, 사업예산, 총사업비, 배정예산 줄 또는 표 칸". 아님 "추정가격(부가세 제외 기준금액, 별도면 note)", "기초금액, 예정가격", "실적 인정 하한 금액", "연차별 분할 금액(총액이 있으면 총액)". 값 형식 "string (문서 원문 표기 그대로, (가상 예) 300백만원)". multi "연차별 또는 사업 유형별로 금액이 나뉘고 총액이 없으면 조건별 값을 적고 value는 null".
     - projectPeriod 사업기간: 개념 "이 사업(용역)의 수행 기간. 계약일부터 몇 개월 또는 시작일과 종료일". 식별 "사업기간, 용역기간, 계약기간, 과업기간, 수행기간 줄과 표 칸". 아님 "단계별 또는 연차별 기간(총 기간이 있으면 총 기간)", "실적 인정기간", "제안서 제출기간", "하자보수 또는 유지보수 기간". 값 형식 "string (원문 표기 그대로)". multi "단계별로 나뉘고 총 기간이 없으면 조건별 값".
     - evalMethod 평가방법: 개념 "낙찰자 결정 방법(협상에 의한 계약, 적격심사, 최저가 등)과 기술 가격 배분 비율이 있으면 그 비율". 식별 "낙찰자 결정 방법, 계약 방법, 평가 방법 줄", "기술평가와 가격평가 배점 비율 문구". 아님 "평가항목별 배점표 내용", "차등점수제 적용 여부(별도 항목)", "입찰 방식(전자입찰 등 절차 설명)". 값 형식 "string (원문 표기 그대로, 한 줄로)".
     - jointVentureAllowed 공동수급 여부: 개념 "공동수급(공동계약, 컨소시엄)을 허용하는지와 허용 시 방식(공동이행, 분담이행, 주계약자)". 식별 "공동수급 허용, 공동계약 가능, 공동수급체 구성 가능 또는 불가 줄", "공동계약 방식 칸". 아님 "하도급 허용 여부", "공동수급협정서 제출 절차 설명", "지역업체 참여 의무 비율만 있는 문장(방식 명시 없으면 note)". 값 형식 "string (문서 원문 표기 그대로. (가상 예) 공동이행방식 허용, 공동수급 불가)".
     - priceMethod 예가방법: 개념 "예정가격 결정 방법(복수예비가격 추첨, 단일 예가, 예가 미작성 등)". 식별 "예정가격 결정 방법, 예가 산정, 복수예비가격 줄". 아님 "낙찰 하한율 숫자만 있는 문장(note에)", "가격평가 산식", "기초금액 자체". 값 형식 "string (원문 표기 그대로)".
2. `src/core/ai/parse.ts` `coerceValue(key: AiKey, v)`: kind 분기 추가.
   - datetime: 문자열이면 `docDateToIso(v) ?? toIsoKst(v) ?? (ISO 형식이면 v)`, 시각 없으면 실패.
   - amount(budgetAmount): 괄호 꼬리("(부가세 포함)" 등) 제거 후 기존 performanceMinAmount와 같은 금액 해석("이상" 꼬리 제거는 performanceMinAmount만).
   - joint: 문자열이면 `parseJointVenture`(src/core/model/joint-venture.ts, 시그니처 확인) 결과가 boolean일 때 그 값, 아니면 실패.
   - text: trim, 빈 문자열 실패.
   - 최종 검사 `VALUE_CHECK[key]` → `checkLeafValue(key, out)`. ctx.keys 타입 AiKey.
3. `src/core/ai/verify.ts`
   - ExtractionKey → AiKey, `EXTRACTION_KEYS.includes` → `isAiKey`, `VALUE_CHECK[key]` → `checkLeafValue`.
   - raw 기록: kind가 amount, period, datetime, joint이고 AI 원문이 문자열이면 raw(40자).
   - `valueInQuote` kind 분기: datetime → sourceText에 연도 4자리와 `HH:MM`(앞 0 없는 `H:MM` 허용)이 모두 있음 / amount → `amountsIn(sourceText).includes(value)`(10^k 보정도 amount kind 전체로 일반화) / joint → `/공동|단독|컨소시엄|분담|이행/` / text → true.
   - `export function sameValue(kind, a, b)`: datetime은 `Date.parse` 동일, text는 공백 제거 후 한쪽이 다른 쪽을 포함(짧은 쪽 4자 이상)이면 같음, 그 외 기존 valueKey 비교. verdict와 relationOf가 이 함수를 쓴다.
4. `src/core/ai/constants.ts`: `AI_FOCUS_KEYWORDS: Record<AiKey, …>`에 9개 추가(synonymKeys 빈 배열): postedAt ['공고일', '게시', '공고일시'], registrationDeadline ['참가자격', '등록마감', '참가등록'], proposalPeriod ['제출기간', '제안서 제출', '입찰서 제출', '접수'], proposalEvalAt ['평가일', '평가 일시', '발표평가', '평가위원회'], budgetAmount ['사업금액', '사업예산', '총사업비', '배정예산', '추정가격'], projectPeriod ['사업기간', '용역기간', '계약기간', '과업기간'], evalMethod ['낙찰자 결정', '협상에 의한', '적격심사', '기술평가', '가격평가'], jointVentureAllowed ['공동수급', '공동계약', '컨소시엄', '공동이행', '분담이행'], priceMethod ['예정가격', '예가', '복수예비가격']. `AI_EXCERPT_EXTRA_KEYWORDS`에 '공고일', '제출기간', '사업금액', '사업기간', '낙찰자', '공동수급', '예정가격' 추가. `excerpt.ts`는 타입만 AiKey.
5. 테스트
   - `tests/core/ai-prompt.test.ts`: 16개 키 요청 시 정의 16개, KIND_OF 공고 잎 string.
   - `tests/core/ai-prompt-lint.test.ts`: lint 대상 keys를 AI_KEYS로 바꿔 통과.
   - `tests/core/ai-parse.test.ts`: datetime "2026. 10. 21.(수) 14:00" → ISO, 시각 없음 → 실패, budgetAmount "3억원(부가세 포함)" → 300000000, joint "공동이행방식 허용" → true, "단독" → false.
   - `tests/core/ai-verify.test.ts`: datetime 기준값과 분 단위 같으면 match, text 포함 관계 match, 공고 잎 raw 기록, joint 인용에 '공동' 등 없으면 quote_not_found.
   - 기존 `tests/core/ai-eval-replay.test.ts` 등 통과 유지.

## S3 엔진과 프로토콜 (implementer, AI 비교 커밋 뒤)
- `src/core/types/ai.ts`: `import type { ReviewLeafKey }`, `export type AiKey = ReviewLeafKey`. `AiRun.keys`, `suggestions`, `AiSuggestion.key`, `OutputSpec`을 AiKey로.
- `src/engine/ai/ai-review-api.ts`
  - `resolveKeys`: pending = `pendingLeafKeys(notice, extraction)`, all = `[...AI_KEYS]`, keys 검증 `isAiKey`, 정렬 AI_KEYS 순.
  - `finishRun` 기준값과 후보: 공고 잎은 `getField(notice, k)`의 value, candidates = 현재값 + `f.candidates` 값.
  - `applySuggestion`: 기존 검사 뒤 note 계산(editExtraction 기본 메모와 같은 문자열). 문서 잎은 기존 editExtraction, 공고 잎은 `editNoticeField(..., { now, isBusy, source: { ref: 'ai:<runId>', evidence?, page? } })`, raw = `(variant ?? s).raw`. stale 검사 공통. appliedAt 기록 공통.
  - dismiss, PrepareInput.keys 등 타입 AiKey.
- `src/messaging/protocol.ts`: ai/run, ai/compare-run, ai/compare-exec, ai/exec, ai/prepare, ai/apply, ai/dismiss의 keys/key를 AiKey로. ai-runner.ts의 ExecRequest, CompareRequest도.
- `src/engine/ai/ai-client.ts`: `AI_MAX_TOKENS = 16_384`.
- 테스트 `tests/engine/ai-review-api.test.ts`: pending scope가 공고 잎 needs_review 포함 / all이면 16개 / keys에 'postedAt' 허용, 'noticeNo' → AI_BAD_REQUEST / finishRun 기준값이 공고 잎은 notice 값 / 공고 잎 적용: user_edited, source.ref 'ai:<runId>', raw 보존, extraction.items 무변경, appliedAt / 공고 잎도 stale이면 AI_STALE / 옛 run(keys 7개) 파일 읽기 정상.

## S4 UI 순수 모델 (implementer, S3 뒤)
- `src/ui/review/ai-view.ts`: 순회를 AI_KEYS로, 반환 `Partial<Record<AiKey, …>>`. `scopeKeys` all = AI_KEYS. `scopeLabel`: all은 `${keys.length}개 전체`, keys는 `항목: ${REVIEW_LABEL[k]}`. `isFindingKey(run, key: AiKey)`. `aiAgreement` 값 비교는 `sameValue`. `aiErrorText`의 "7개 항목 전체로" → "전체 항목으로".
- `src/ui/review/rows.ts`: `buildReviewRows`의 ai/others를 AiKey 기준으로, 공고 잎에도 ai/aiOthers 연결. `aiFindable = state === 'needs_review'`. `ReviewLeaf`에 `badge: CardBadge`와 `userEdited: boolean` 추가(AiSuggestionBlock이 ReviewLeaf로 그릴 수 있게).
- 테스트 `tests/ui/ai-view.test.ts`, `tests/ui/review-rows.test.ts`: 공고 잎 제안 카드, scopeLabel all 16, 옛 run all → "7개 전체", 공고 잎 aiFindable, verified 공고 잎 + differs 미처리 → autoOpen.

## S5 화면 (메인)
- ReviewTab: pending = pendingLeafKeys, runAi/starting/aiApply/aiDismiss AiKey, 메뉴 "13개 항목 전체 재검토", 힌트 "확인 필요 N개"/"13개 항목 전체", AiRunDialog pendingCount = pendingLeafKeys 길이. cards/buildCards 제거.
- ReviewRows: LeafActions AiKey 기준, cardOf 삭제, aiFindBtn은 leaf.aiFindable만, AI 블록은 `leaf.ai || leaf.aiOthers?.length`.
- AiSuggestionBlock: props `leaf`(key, label, kind, badge, userEdited, ai, aiOthers), 값 표기 formatLeafValue.
- AiRunPanel, AiRunDialog: ITEM_LABEL → REVIEW_LABEL, "확인 필요 항목만 (N개)"는 pendingLeafKeys 길이.
- 보류 과제 "지금 값 vs AI 두 칸 비교"도 이때 적용.

## S6 검증
- `tsc --noEmit`, `tests/core`, `tests/ui`, `tests/engine/ai-*`, `tests/engine/notice-field-edit.test.ts`, `tests/background/ai-router.test.ts`, `npm run build`.
- 수동: 공동수급 확인 필요 공고에서 행 [AI로 찾기] → 제안 → 적용 → AI 적용 표시, 되돌리기 / 전체 재검토 run.keys 16개 / 사이드패널 원클릭이 공고 잎 확인 필요만 요청 / 옛 run 있는 공고 정상 표시.

## 보고 형식(implementer)
결론, 변경 파일과 줄 범위, 테스트 결과, 명세와 다르게 한 점과 이유, 실패 항목. 한국어. 가운뎃점 금지.
