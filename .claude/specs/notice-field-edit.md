# 공고 필드 직접 수정(notice/field-edit)

메일 준비 화면의 "확인 필요" 팝업(`src/entrypoints/dashboard/mail/ResolveDialog.tsx`, 이미 구현됨)에 [공고에 저장]을 붙이기 위한 서버·병합·검증 작업이다. 설계 결정은 `.claude/specs/decisions.md`의 "2026-10-20 공고 필드 직접 수정"을 따른다.

- 1단계(implementer): 타입·core 순수 모듈·병합·엔진·메시지·테스트
- 2단계(메인): 팝업 연결(이 문서 7절)

## 1. 목표
임의의 공고 필드(basic/schedule/evaluation/prespec, `custom.*`)를 사용자가 직접 고치고 되돌릴 수 있게 한다. 재수집·재추출이 사용자 값을 덮어쓰지 않고, 되돌리면 최신 자동값으로 돌아가야 한다.

## 2. 전제(이미 있는 동작, 바꾸지 말 것)
- `src/core/model/merge.ts` `mergeFields`는 `prev.status === 'user_edited'`인 키를 보존한다. 재수집(`collect-job.ts`)은 모두 이 함수를 거친다.
- `extract-step.ts` `fillDocOnlyFields`와 `merge.ts` `mergeDocumentLayer`는 user_edited를 건너뛴다.
- `src/engine/notices/notice-api.ts` `editExtraction`은 `editLockKey` 락과 `isBusy`로 잡 실행 중의 수정을 거부한다. 같은 패턴을 쓴다.

## 3. 인터페이스

### 3.1 FieldValue 확장 (`src/core/types/common.ts:5-10`)
```ts
/** 사용자 수정 메타. status==='user_edited'일 때만 존재. before=수정 직전 자동값(없으면 되돌릴 때 missing/삭제). */
userEdit?: { editedAt: ISODate; note?: string; before?: FieldValue<T> };
```
`before` 안에는 `userEdit`를 넣지 않는다(저장할 때 제거). 스키마 버전은 올리지 않는다.

### 3.2 `src/core/model/amount.ts` (신규)
`src/adapters/g2b/html-parse.ts`의 `parseAmount`를 그대로 이 파일로 옮기고, html-parse는 import해서 쓴다. 외부에서 html-parse의 parseAmount를 import하는 곳이 있으면 re-export한다. 동작은 바꾸지 않는다.

### 3.3 `src/core/model/field-edit.ts` (신규, 순수 함수)
```ts
export type EditableKey = NoticeFieldKey | `custom.${string}`;
export const NON_EDITABLE_NOTICE_KEYS: ReadonlySet<NoticeFieldKey>; // 'noticeNo', 'round'
export const CUSTOM_KEY_RE = /^custom\.[\w가-힣-]{1,40}$/;
export function isEditableKey(k: unknown): k is EditableKey; // ALL_FIELD_KEYS 중 비편집 키 제외 + CUSTOM_KEY_RE
export type EditInputKind = 'text' | 'longtext' | 'amount' | 'datetime' | 'bool_joint' | 'score' | 'period' | 'amount_short' | 'bool_apply';
export function inputKindOf(key: EditableKey): EditInputKind;
export const VALUE_CHECK: Record<ExtractionKey, (v: unknown) => boolean>;
export function validateFieldValue(key: EditableKey, value: unknown, raw?: string): { ok: true } | { ok: false; message: string };
export function editTargetsOf(fieldKey: TemplateFieldKey): EditableKey[];
export function applyUserEdit<T>(prev: FieldValue<T> | undefined, value: T, nowIso: string, o: { raw?: string; note?: string }): FieldValue<T>;
export function revertUserEdit<T>(prev: FieldValue<T> | undefined): FieldValue<T> | undefined;
export function parseFieldInput(kind: EditInputKind, text: string, extra?: { joint?: boolean }): { ok: true; value: unknown; raw?: string } | { ok: false; message: string };
```
규칙:
- `inputKindOf`: ExtractionKey는 `VARIABLE_BY_KEY`의 kind를 그대로 쓴다(score/period/amount_short/text/bool_apply). `eligibility`·`performanceCondition`·`evalMethodDoc`·`proposalPeriod`는 `'longtext'`, `custom.*`는 `'text'`. 그 외는 `VARIABLE_BY_KEY.get(key).kind`를 매핑한다(amount→amount, datetime·date→datetime, bool_joint→bool_joint, 나머지→text).
- `VALUE_CHECK`: `notice-api.ts:27-36`에서 내용 그대로 옮기고, notice-api는 import한다.
- `validateFieldValue`: text는 2000자 이하 string, longtext는 5000자 이하이고 빈 문자열 불가, amount는 0 이상의 정수(Number.isFinite), datetime은 `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/`, bool_joint는 boolean, ExtractionKey는 VALUE_CHECK. `raw`는 500자 이하 string.
- `editTargetsOf`: `credibilityEval` → `['managementScore','credibilityScore']`, `evalMethodText` → `['evalMethodDoc','evalMethod']`, `isEditableKey`이면 `[fieldKey]`, 나머지(sourceUrl, collectedAt, today, isCorrection, attachmentCount, attachmentList, noticeNo, round, 'custom.')는 `[]`.
- `applyUserEdit`: `before = prev?.status === 'user_edited' ? prev.userEdit?.before : prev`(prev 전체를 저장하되 userEdit는 뺀다). 반환값은 `{ value, ...(raw && { raw }), status: 'user_edited', source: { kind: 'user', ref: 'dashboard', fetchedAt: nowIso }, userEdit: { editedAt: nowIso, ...(note && { note }), ...(before && { before }) } }`.
- `revertUserEdit`: prev가 user_edited가 아니면 prev를 그대로 돌려준다. user_edited이면 `prev.userEdit?.before`(없으면 undefined).
- `parseFieldInput`: datetime은 `src/core/model`에 있는 KST→ISO 변환 함수가 있으면 그것을 쓴다(없으면 `YYYY-MM-DD HH:mm` → `YYYY-MM-DDTHH:mm:00+09:00`). ISO 정규식을 통과하면 그대로 쓰고, 둘 다 아니면 오류 "2026-10-21 18:00 형식으로 입력하세요". amount·amount_short는 parseAmount 결과가 0 이상의 정수가 아니면 오류. score는 0~1000의 수. period는 `/^\d{1,2}년$/`를 허용하고 숫자만 들어오면 `${n}년`으로 바꾼다. bool_joint는 `extra.joint`가 필수이고 value=joint, raw=text(trim해서 빈 값이면 생략). bool_apply는 '적용'→true, '미적용'→false. text·longtext는 trim하고 빈 값이면 오류.

### 3.4 엔진 `src/engine/notices/notice-api.ts`
```ts
export async function editNoticeField(
  store: IFileStore,
  p: { noticeId: string; key: string; value: unknown | null; raw?: string; note?: string },
  opts: { now?: () => Date; isBusy?: (noticeId: string) => boolean } = {},
): Promise<{ notice: Notice; extraction: Extraction | null }>
```
순서:
1. `isEditableKey(p.key)`가 아니면 `INVALID_KEY`. note 검증은 editExtraction과 같다(500자 이하).
2. ExtractionKey이면 락 밖에서 `loadExtraction`을 한다. null이 아니면 `return editExtraction(store, p, opts)`. null이면 일반 경로로 간다. 일반 경로의 락 안에서 extraction이 생긴 것을 확인하면 `JOB_ALREADY_RUNNING`.
3. `value !== null`이면 `validateFieldValue`를 하고, 실패하면 `INVALID_VALUE`(message 포함).
4. `store.withLock(editLockKey(noticeId))` 안에서: `isBusy`가 true면 `JOB_ALREADY_RUNNING`, `loadNotice`가 null이면 `NOT_FOUND`.
5. 대상은 `custom.`이면 `notice.customFields[k]`, 아니면 `getField(notice, key)`.
6. value≠null이면 `applyUserEdit`로 바꾼다. null이면 `revertUserEdit`를 하고, 결과가 undefined면 notice 키는 `missing()`, custom 키는 delete. user_edited가 아닌 필드에 null이 오면 아무것도 바꾸지 않고 현재 상태를 돌려준다(오류 아님).
7. `notice.updatedAt = nowIso`로 두고 락 안에서 `saveNotice`만 부른다(`saveNoticeLatest` 금지, 교착). 응답은 `{ notice, extraction: loadExtraction 결과 }`.
- 오류는 기존 editExtraction과 같은 오류 클래스·코드 문자열을 쓴다.
- `editExtraction`이 notice에 쓰는 FieldValue(63행 부근)와 `src/engine/notices/notice-store.ts` `setUserEdited`(128행 부근)에도 `userEdit: { editedAt, note? }`를 붙인다(before 없음). setUserEdited 시그니처에 note를 추가한다.

### 3.5 병합 `src/core/model/merge.ts` `mergeFields`
키 하나를 처리하는 본문(현재 48~92행)을 내부 함수 `mergeKey(prev, layers, queried)`로 추출한다. user_edited 분기는 이렇게 바꾼다.
```ts
if (prev?.status === 'user_edited') {
  const auto = mergeKey(prev.userEdit?.before, layers, queried);
  out[key] = prev.userEdit ? { ...prev, userEdit: { ...prev.userEdit, before: auto } } : prev;
  continue;
}
```
user_edited 키의 value·status·source는 바꾸지 않는다. prev가 undefined일 때 mergeKey는 기존 동작과 같아야 한다. `mergeDocumentLayer`와 `fillDocOnlyFields`는 바꾸지 않는다.

### 3.6 메시지·라우팅
- `src/messaging/protocol.ts`의 `extraction/edit` 아래에 추가:
  `| { type: 'notice/field-edit'; payload: { noticeId: string; key: NoticeFieldKey | \`custom.${string}\`; value: unknown | null; raw?: string; note?: string }; response: { notice: Notice; extraction: Extraction | null } }`
- `src/background/router.ts`의 `EXTENSION_ONLY_TYPES`에 `'notice/field-edit'`를 추가한다.
- `src/entrypoints/offscreen/main.ts`: `extraction/edit` listen 옆에 `listen('notice/field-edit', (p) => editNoticeField(fileStore, p, { isBusy: isNoticeBusy }), 'offscreen')`. `isNoticeBusy` 선언이 아래쪽에 있으면 위로 올린다.
- `src/core/templates/values.ts`의 `formatByKind`를 export한다(동작은 그대로).

## 4. 금지
- noticeNo/round를 편집 가능하게 열지 않는다.
- before 안에 userEdit를 넣지 않는다. 두 번째 수정은 원래 자동값을 이어받는다.
- 되돌리기에 candidates나 basis를 쓰지 않는다.
- ExtractionKey를 notice에만 쓰지 않는다. extraction이 있으면 반드시 editExtraction에 맡긴다.
- collect-job의 다른 saveNotice 호출은 고치지 않는다.
- parseAmount를 복제하지 않는다(이동).
- `src/entrypoints/dashboard/**`는 건드리지 않는다(2단계에서 메인이 한다).

## 5. 테스트
`tests/core/field-edit.test.ts`(신규)
1. editTargetsOf: credibilityEval→[managementScore, credibilityScore], evalMethodText→[evalMethodDoc, evalMethod], projectPeriod→[projectPeriod], sourceUrl/today/noticeNo/round→[], 'custom.비고'→['custom.비고'], 'custom.'→[].
2. validateFieldValue: budgetAmount 1000은 통과하고 -1, 1.5, '100'은 실패. bidCloseAt '2026-10-21T18:00:00+09:00'은 통과하고 '2026-10-21'은 실패. jointVentureAllowed true+raw는 통과하고 'yes'는 실패. eligibility 5001자는 실패. credibilityScore 1001은 실패.
3. applyUserEdit: needs_review인 prev(candidates 포함)는 before에 통째로 보존되고 status는 user_edited. user_edited인 prev를 다시 고쳐도 before는 최초 자동값을 유지. revertUserEdit는 before를 돌려주고, 수정되지 않은 prev는 그대로 돌려준다.
4. parseFieldInput: datetime '2026-10-21 18:00' → '+09:00'이 붙은 ISO. amount '1,000,000원' → 1000000. period '5' → '5년'. bool_joint joint=true, raw '공동이행'. text '  ' → 오류.

`tests/core/merge.test.ts`(추가)
5. prev가 user_edited(before=api 'A')이고 새 api 레이어가 'B'면 out.value는 사용자 값, `userEdit.before.value === 'B'`, before.status는 'verified'.
6. prev가 user_edited이고 레이어에 값이 없으면 before는 `{ value: null, status: 'missing' }`.
7. userEdit가 없는 옛 user_edited prev는 그대로 통과(회귀).

`tests/engine/notice-field-edit.test.ts`(신규, 기존 엔진 테스트의 store·runCollect 하네스 재사용)
8. projectPeriod를 고치면 notice.json의 `basic.projectPeriod`가 `{ status: 'user_edited', source.kind: 'user', userEdit.before.status: 'missing' }`(또는 수정 직전 상태).
9. 되돌리기(null)를 하면 before가 복원된다. 수정되지 않은 필드에 null을 보내면 아무것도 바뀌지 않고 오류도 없다.
10. 고친 뒤 runCollect로 재수집하면 값은 유지되고 before는 이번 수집 값으로 갱신된다(title처럼 API가 주는 키로 검증).
11. projectPeriod를 고친 뒤 재추출(문서에 사업기간 있음)해도 사용자 값이 유지된다.
12. ExtractionKey(performanceScore)이고 extraction이 있으면 `items.performanceScore.userEdited`가 세팅된다. extraction.json을 지운 뒤 같은 호출을 하면 notice만 user_edited가 되고 오류는 없다.
13. INVALID_KEY: noticeNo, round, 'foo', 'custom.'. INVALID_VALUE: bidCloseAt '내일', budgetAmount -1. note 501자는 실패.
14. isBusy가 true면 JOB_ALREADY_RUNNING이고 파일은 바뀌지 않는다.
15. `custom.담당부서`를 만들면 customFields에 user_edited로 들어가고, 되돌리면 키가 삭제된다. renderMail에 `{custom.담당부서}`를 넣으면 unresolved에서 빠진다.
16. title을 고치면 index.json entry.title이 갱신되고 folder는 그대로다.

`tests/background/router.test.ts`: 목록에 `'notice/field-edit'`를 추가한다.

## 6. 완료 조건
- `tsc --noEmit` 통과
- 위 테스트와 기존 `tests/core/merge.test.ts`, `tests/engine/*`, `tests/extraction/*` 통과
- vitest는 대문자 `C:\workspace\bidMate`에서 실행한다(소문자 c: 경로면 전부 실패)

보고: 변경 파일:줄 범위 목록, 테스트 결과 요약, 명세와 다르게 한 점과 그 이유. 한국어로 작성한다.

## 7. 2단계(메인)
ResolveDialog에 [공고에 저장]을 붙인다.
- `editTargetsOf(fieldKey)`로 대상을 정하고, 대상마다 `inputKindOf`에 맞는 입력칸을 둔다(합성 키는 2칸).
- `parseFieldInput` 결과로 `send('notice/field-edit')`를 보낸다. 성공하면 `setNotice`·`setExtraction`을 하고 `save()`로 초안을 다시 저장한다.
- user_edited이면 [자동값으로 되돌리기]를 보여 준다(value null).
- 대상이 0개이면 "자동으로 정해지는 항목이라 고칠 수 없습니다"라고 안내한다.
- `JOB_ALREADY_RUNNING`이면 "이 공고는 수집/추출 중입니다. 끝난 뒤 다시 시도하세요"를 보여 준다.
