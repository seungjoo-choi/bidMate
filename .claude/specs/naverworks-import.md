# 네이버웍스 사내 연락처 불러오기 명세

## 목표
대시보드 수신자 화면에 "네이버웍스에서 불러오기" 버튼을 둔다. 확장이 contact.worksmobile.com의 비공식 API로 사내 직원 목록을 받아와 기존 수신자와 비교하고, 미리보기에서 체크한 것만 일괄 반영한다.

## 확정 사항
- 비교 키: 정규화 이메일(`normalizeEmail`, src/core/recipients/email.ts).
- 미리보기 3분류: 새 사람(기본 체크) / 정보 바뀜(이름·부서 다름, 기본 체크, 전→후 표시) / 목록에 없음(기본 해제, 체크 시 삭제가 아니라 enabled=false).
- 부서 = `orgUnits` 문자열 배열을 `' / '`로 결합(없으면 `orgUnitName`).
- `orgUnitName` 또는 `orgUnits` 원소가 '휴직'·'협력사'·'계약직'과 정확히 일치하면 flagged → 새 사람·정보 바뀜에서 기본 해제(체크하면 enabled true로 등록).
- 새 사람은 그룹 없이 등록(그룹 파일 불변, '전체' 자동 편입·기본 그룹 생성 없음), enabled true, defaultRole 'to'.
- 수동 버튼 실행만. 주기 동기화·삭제·자동 재활성화·응답 캐시 없음.
- 이메일은 대표 `email` 필드만. `emails[]`(OTHER=개인, ALIAS=별칭)는 쓰지 않음.

## 네이버웍스 API(사용자 DevTools로 확인)
- `POST https://contact.worksmobile.com/v2/api/search`, Content-Type application/json, 쿠키 세션.
- 헤더 `X-Xsrf-Token` = 쿠키 `XSRF-TOKEN` 값(응답마다 Set-Cookie로 갱신 → 매 요청 직전 다시 읽기).
- 본문: `{"type":"USER","page":1,"maxResults":100,"filter":{},"domainId":"133918","includedSubOrgUnit":false}`
- 응답: `{"totalCount":80,"results":[{ id, kind, domainId, accountId, name, nickName?, email, organizationName, orgUnitName, orgUnits: string[], positionName?, levelName?, executive, phone?, emails: [...], photoUrl? }]}`
- domainId는 사내 연락처 화면 URL `https://contact.worksmobile.com/p/web/domain/133918`에 있음.

---

## 인터페이스

### 타입 — `src/core/types/config-file.ts`에 추가
```ts
export interface RecipientImportPlan {
  add: Array<{ name: string; email: string; dept?: string }>;
  update: Array<{ id: string; name: string; dept?: string }>;   // dept 생략 = 부서 제거
  disable: string[];                                             // recipient id
}
export interface RecipientImportSummary {
  added: number; updated: number; disabled: number;
  skipped: Array<{ key: string; reason: string }>;               // key = email 또는 id
}
export type RecipientImportResult = RecipientsSnapshot & { summary: RecipientImportSummary };
```

### 원본 타입 — 신규 `src/adapters/naverworks/contacts-types.ts`
```ts
/** 주입 함수가 응답에서 골라 돌려주는 최소 필드. 검증은 core에서. */
export interface NwRawUser { id?: unknown; name?: unknown; email?: unknown; orgUnitName?: unknown; orgUnits?: unknown; positionName?: unknown }
export type NwPageFetchResult =
  | { ok: true; totalCount: number; results: NwRawUser[]; pages: number }
  | { ok: false; code: 'NW_NOT_LOGGED_IN' | 'NW_API_ERROR' | 'NW_BAD_RESPONSE'; status?: number; detail?: string };
```

### core 순수 함수 — 신규 `src/core/recipients/naverworks-contacts.ts`
```ts
export const FLAGGED_ORG_UNITS = ['휴직', '협력사', '계약직'] as const;
export const NW_CONTACT_HOST = 'contact.worksmobile.com';
export const NW_CONTACT_ORIGIN = 'https://contact.worksmobile.com/*';

/** '/p/web/domain/133918'(URL 포함) 또는 '133918' → '133918', 아니면 null */
export function domainIdFrom(text: string): string | null;

export interface NwContact { email: string /* 정규화 */; rawEmail: string; name: string; dept?: string; flagged: boolean; flagReason?: string; positionName?: string }
export interface NwParseResult { contacts: NwContact[]; skippedNoEmail: number; duplicateEmails: number }
export function parseNwUsers(raw: unknown): NwParseResult;

export interface ContactDiff {
  added: NwContact[];
  changed: Array<{ recipient: Recipient; contact: NwContact; fields: Array<'name' | 'dept'> }>;
  missing: Recipient[];              // enabled===true 이고 목록에 없음
  unchanged: number;
  missingAlreadyDisabled: number;
}
export function diffContacts(contacts: NwContact[], recipients: Recipient[]): ContactDiff;

export interface DiffSelection { added: Set<string> /* email */; changed: Set<string> /* recipient id */; missing: Set<string> /* recipient id */ }
export function defaultSelection(diff: ContactDiff): DiffSelection;   // flagged 제외 added/changed 전체, missing 비움
export function buildImportPlan(diff: ContactDiff, sel: DiffSelection): RecipientImportPlan;
export const planCount = (p: RecipientImportPlan) => p.add.length + p.update.length + p.disable.length;
```
규칙:
- `parseNwUsers`: 배열이 아니면 빈 결과. `email`이 문자열이고 `isValidEmail` 통과해야 함(아니면 skippedNoEmail++). 정규화 이메일 중복이면 첫 항목만(duplicateEmails++). `name` trim, 빈 값이면 이메일 `@` 앞부분, 100자 초과 절단. `dept` = `orgUnits`가 배열이면 문자열 원소만 trim·빈 값 제외 후 `' / '` 결합, 결과가 비면 `orgUnitName`(문자열·trim) 단독, 그것도 없으면 undefined. 200자 초과 절단. `flagged` = `orgUnitName` 또는 `orgUnits` 원소 중 하나라도 trim 후 FLAGGED_ORG_UNITS와 정확히 일치. `flagReason` = 일치한 단어.
- `diffContacts`: 기존 수신자를 `normalizeEmail(r.email)`로 Map(중복이면 첫 사람). contact가 없으면 added; 있으면 `r.name.trim() !== c.name` 또는 `(r.dept ?? '') !== (c.dept ?? '')`이면 changed(fields), 아니면 unchanged++. 기존 중 목록에 없는 사람: enabled면 missing, 아니면 missingAlreadyDisabled++. 정렬: added/changed는 dept(빈 값 뒤) → name `localeCompare('ko')`, missing은 name.
- `buildImportPlan`: add에는 정규화 `email`. update는 `{id, name, dept}`, dept undefined면 키 생략. disable은 선택된 missing id.

### 주입 함수 — 신규 `src/adapters/naverworks/contacts-fetch.ts`
```ts
/** executeScript({func})로 직렬화되어 페이지에서 실행된다. 바깥 스코프 참조·import 금지(타입 import만 허용). 인자는 전부 JSON 가능 값. */
export async function fetchContactsInPage(domainId: string, pageSize: number, maxPages: number): Promise<NwPageFetchResult>;
```
`page=1`부터 반복. 매 요청 직전 `document.cookie`에서 `XSRF-TOKEN`을 읽어 있으면 `X-Xsrf-Token` 헤더. `fetch('/v2/api/search', { method:'POST', headers:{'Content-Type':'application/json', ...xsrf}, body: JSON.stringify({ type:'USER', page, maxResults: pageSize, filter:{}, domainId, includedSubOrgUnit:false }), credentials:'same-origin', signal: AbortSignal.timeout(15000) })`.
- 401/403, `res.redirected`, content-type에 json 없음 → `NW_NOT_LOGGED_IN`(status 포함). 그 외 비 2xx → `NW_API_ERROR`. JSON에 `results` 배열 없음 → `NW_BAD_RESPONSE`. fetch 예외 → `NW_API_ERROR`(detail=메시지).
- 종료: 누적 ≥ totalCount, 빈 페이지, page > maxPages. 결과는 `id` 기준 중복 제거 후 `{id,name,email,orgUnitName,orgUnits,positionName}`만.

### 메시지 — `src/messaging/protocol.ts`
```ts
| { type: 'contacts/naverworks-fetch'; payload: { domainId?: string }; response: { domainId: string; users: NwRawUser[]; totalCount: number; tabReused: boolean } }  // 대시보드→SW
| { type: 'recipients/import'; payload: { plan: RecipientImportPlan }; response: RecipientImportResult }  // 대시보드→SW→offscreen
```
오류 코드(BusError): `NEEDS_SITE_PERMISSION`, `NW_NOT_LOGGED_IN`, `NW_NO_DOMAIN_ID`, `NW_TAB_TIMEOUT`, `NW_INJECT_FAILED`, `NW_API_ERROR`, `NW_BAD_RESPONSE`, `INVALID_VALUE`.

### SW 핸들러 — 신규 `src/background/naverworks-contacts.ts`
```ts
export interface NwContactsDeps { tabs; scripting; permissions }   // chrome 부분 주입(테스트용), 기본값 globalThis.chrome — auto-compose.ts 방식
export function registerNaverworksContacts(deps?: Partial<NwContactsDeps>): void;   // listen('contacts/naverworks-fetch', ..., 'sw')
```
절차(순서 고정):
1. 확장 내부 sender만 허용(기존 compose-relay·router의 sender 검사 방식 따름).
2. `permissions.contains({origins:[NW_CONTACT_ORIGIN]})` 아니면 `NEEDS_SITE_PERMISSION`.
3. `tabs.query({url:'https://contact.worksmobile.com/*'})` → 있으면 URL에 domainId가 있는 탭 우선, 없으면 첫 탭(`tabReused=true`). 없으면 `tabs.create({ url: domainId ? 'https://contact.worksmobile.com/p/web/domain/'+domainId : 'https://contact.worksmobile.com/', active:false })` 후 로드 완료 대기 20초(`compose-relay.ts`의 `waitComplete`를 export해 재사용). 시간 초과 → `NW_TAB_TIMEOUT`(생성 탭 닫음).
4. `tabs.get` → hostname이 `contact.worksmobile.com`이 아니면 탭을 `active:true`로 올리고 `NW_NOT_LOGGED_IN`. 이때 생성 탭은 닫지 않는다.
5. domainId: `payload.domainId` → `domainIdFrom(tab.url)` → 없으면 500ms 간격 최대 5초 `tabs.get` 재시도 → 없으면 `NW_NO_DOMAIN_ID`(생성 탭 닫음).
6. `scripting.executeScript({ target:{tabId}, func: fetchContactsInPage, args:[domainId, 100, 50] })` 예외 → `NW_INJECT_FAILED`(생성 탭 닫음). 결과 `ok:false`면 그 코드로 throw(`NW_NOT_LOGGED_IN`이면 4처럼 탭 활성화·닫지 않음, 그 외는 생성 탭 닫음).
7. 성공: 생성 탭이면 `tabs.remove`. 재사용 탭은 손대지 않음. `{domainId, users, totalCount, tabReused}` 반환.

### engine — `src/engine/config/recipients-api.ts`
```ts
export function importRecipients(store: IFileStore, plan: RecipientImportPlan, opts: ConfigOpts = {}): Promise<RecipientImportResult>;
```
- `saveRecipient`의 이메일·이름·부서 검증을 `validateRecipientFields(input)`로 추출해 공용화(saveRecipient 동작·오류 코드 불변).
- `withConfigLock` 안: plan 형식 검사(add/update/disable이 배열 아니면 `INVALID_VALUE`) → `loadState` →
  - add: 검증 실패 또는 기존/이번 추가분과 이메일 중복 → `skipped.push({key:email, reason})`; 아니면 `{id:newId('rcp'), name, email(정규화), dept?, enabled:true, defaultRole:'to', updatedAt}`.
  - update: id 없으면 skipped; 있으면 `{...existing, name, updatedAt}` + dept 있으면 설정, 없으면 dept 키 삭제. 다른 필드 불변. 이름·부서 검증 실패는 skipped.
  - disable: id 없으면 skipped; 이미 false면 카운트 없이 통과; 아니면 `enabled:false, updatedAt`.
  - 변경이 있으면 recipients 파일 **1회** 기록. 그룹 파일은 쓰지 않는다. 빈 plan/변경 없음은 기록 없음.
  - 반환 `{...snapshot, summary}`.

### 설정 — `src/core/types/settings.ts`
`sites.naverworks`에 `contactDomainId?: string` 추가(기본값 불필요).

---

## 단계

### S1 core (먼저, 단독)
- 신규 `src/adapters/naverworks/contacts-types.ts`, 신규 `src/core/recipients/naverworks-contacts.ts`, `src/core/types/config-file.ts` 타입 추가.
- 신규 `tests/core/naverworks-contacts.test.ts`:
  - `domainIdFrom`: 전체 URL / 숫자만 / 경로 뒤 쿼리 / 없음→null.
  - `parseNwUsers`: 정상 매핑(orgUnits `' / '` 결합) / orgUnits 없음→orgUnitName / 둘 다 없음→undefined / email 없음·형식 오류 skip / 대소문자만 다른 중복→1건 / 이름 빈 값→로컬파트 / 이름 101자·부서 201자 절단 / flagged: orgUnitName '휴직', orgUnits 중간 원소 '협력사', '휴직자'는 false / 배열 아님→빈 결과.
  - `diffContacts`: 새 사람 / 이름만(fields ['name']) / 부서만 / 둘 다 / 기존 dept 있고 NW 없음→changed / 대소문자 다른 이메일 매칭 / 목록 없음+enabled→missing / +disabled→missingAlreadyDisabled / 정렬.
  - `defaultSelection`: flagged 제외, missing 비움. `buildImportPlan`: 선택만, dept 키 생략, 정규화 이메일.

### S2 engine + 메시지 배선 (S1 뒤, S3과 병렬) — protocol.ts의 두 메시지 모두 S2가 추가
- `recipients-api.ts`: `validateRecipientFields` 추출, `importRecipients`.
- `protocol.ts`: `recipients/import`와 `contacts/naverworks-fetch` 둘 다 추가.
- `src/background/router.ts`의 EXTENSION_ONLY 목록(69-74행 근처)에 `'recipients/import'` 추가. `contacts/naverworks-fetch`가 router를 거치는 구조인지 확인해 필요하면 같은 방식으로 처리.
- `src/entrypoints/offscreen/main.ts:191` 옆에 `listen('recipients/import', ({ plan }) => importRecipients(fileStore, plan), 'offscreen')`. recipients/save가 SW에서 offscreen으로 중계되는 방식과 동일하게 배선.
- 테스트: `tests/engine/recipients-api.test.ts`(없으면 기존 config 테스트 패턴으로 신규) — add2+update1+disable1 → 파일 1회 기록, 그룹 파일 미기록 / update 후 memo·defaultRole·enabled·그룹 memberIds 유지 / dept 제거 / add 중복 이메일→skipped, 나머지 정상 / update id 없음→skipped / disable 이미 false→카운트 0 / 빈 plan→기록 없음 / 형식 오류→INVALID_VALUE / 새 사람 그룹 없음, '전체' 미생성 / saveRecipient 기존 테스트 통과. `tests/background/router.test.ts`에 recipients/import EXTENSION_ONLY 확인.

### S3 background 탭 fetch (S1 뒤, S2와 병렬) — protocol.ts는 수정하지 않음(S2 담당)
- 신규 `src/adapters/naverworks/contacts-fetch.ts`, 신규 `src/background/naverworks-contacts.ts`, `compose-relay.ts`의 `waitComplete` export, `src/entrypoints/background.ts`에 `registerNaverworksContacts()` 등록.
- 테스트: `tests/adapters/contacts-fetch.test.ts`(fetch·document.cookie stub): 2페이지(150=100+50) 합침 / 매 요청 최신 XSRF / 401·redirected·HTML→NOT_LOGGED_IN / 500→API_ERROR / results 없음→BAD_RESPONSE / 빈 페이지 종료 / maxPages 상한 / id 중복 제거 / 본문 필드. `tests/background/naverworks-contacts.test.ts`(chrome mock): 권한 없음 / 기존 탭 재사용·닫지 않음 / 생성→성공→remove / 로그인 페이지→NOT_LOGGED_IN+active:true+remove 안 함 / payload domainId 우선 / URL 추출 / 둘 다 없음→NO_DOMAIN_ID+remove / executeScript 거부→INJECT_FAILED / 외부 sender 거부.

### S4 UI (S1~S3 뒤)
- `settings.ts`에 `contactDomainId?`.
- `recipients/shared.tsx` `Modal`에 `size?: 'md' | 'xl'`(max-w-lg ↔ max-w-3xl, 기본 md). `MESSAGES`에 NW 오류 문구.
- `RecipientTable.tsx`: `onImport` prop, 헤더 "수신자 추가" 왼쪽에 `<Button variant="secondary" icon={<Download />} disabled={busy} onClick={onImport}>네이버웍스에서 불러오기</Button>`, 빈 상태에도 같은 버튼.
- 신규 `recipients/NaverworksImportModal.tsx`: 상태 `'fetching' | 'domain-input' | 'preview' | 'applying' | 'error'`. 열리면 `send('contacts/naverworks-fetch', { domainId }, { timeoutMs: 90_000 })` → 응답 domainId가 prop과 다르면 `onDomainIdDetected` → parse → diff → defaultSelection. 미리보기 3섹션(섹션별 모두 선택/해제, 행=체크·이름·부서·이메일, 정보 바뀜은 바뀐 필드만 `이전(취소선) → 이후`, flagged 배지, 목록에 없음 설명 "체크하면 삭제하지 않고 메일 발송만 끕니다."). 푸터 좌: "변경 없음 N명 · 이미 꺼짐 N명 · 이메일 없음 N명 제외"(0 생략), 우: 취소 / `선택 반영 (N건)`(0이면 disabled). 모두 비면 "이미 최신 상태입니다. 네이버웍스 N명이 모두 등록되어 있습니다." + 닫기. 반영: `send('recipients/import', { plan })` → `onApplied(summary)` → 닫기.
  - 오류: NEEDS_SITE_PERMISSION "네이버웍스 연락처(contact.worksmobile.com) 접근이 허용되지 않았습니다." / NW_NOT_LOGGED_IN "네이버웍스에 로그인되어 있지 않습니다. 열린 탭에서 로그인한 뒤 [다시 시도]를 눌러 주세요." / NW_NO_DOMAIN_ID → domain-input(입력칸, 도움말 "사내 연락처 화면 주소(예: https://contact.worksmobile.com/p/web/domain/숫자)를 붙여 넣어 주세요", domainIdFrom 통과 시 재시도) / NW_API_ERROR·NW_BAD_RESPONSE·NW_INJECT_FAILED "네이버웍스 연락처 방식이 바뀌었을 수 있어 불러오지 못했습니다. (코드: …)" / TIMEOUT·NW_TAB_TIMEOUT "응답이 늦어 중단했습니다. 네이버웍스 탭을 닫고 다시 시도해 주세요." 모두 InlineAlert + 다시 시도.
- `RecipientsPage.tsx`: `useSettings()`, `importOpen`. `openImport`의 **첫 await는 `chrome.permissions.request({ origins: [NW_CONTACT_ORIGIN] })`**(앞에 다른 await 금지). false면 NEEDS_SITE_PERMISSION 오류 표시, true면 모달 열기. `onDomainIdDetected` → settings 저장(`sites.naverworks.contactDomainId`). `onApplied` → `reload()` + 토스트 "{added}명 추가, {updated}명 수정, {disabled}명 발송 끔"(+ skipped 있으면 " / {n}건 건너뜀").

## 금지
1. host_permissions 고정 추가·cookies 권한 추가 금지(optional 런타임 요청).
2. `fetchContactsInPage` 안 모듈 스코프 참조 금지(직렬화되어 ReferenceError).
3. 새 사람을 recipients/save로 넣지 말 것. importRecipients는 그룹 파일을 쓰지 않음.
4. update는 `{...existing, ...}`로 덮어쓸 것(memo·defaultRole·enabled 보존).
5. 이메일 비교는 양쪽 normalizeEmail.
6. permissions.request 앞에 다른 await 금지.
7. 로그인 필요 상태의 생성 탭은 닫지 말 것. 재사용 탭은 절대 닫지 말 것.
8. 삭제·자동 재활성화·캐시 금지. emails[]의 OTHER/ALIAS 사용 금지.
9. XSRF 쿠키는 매 요청 직전 다시 읽기.
