# 메일 서비스 선택(네이버웍스/Gmail)과 Gmail 주소 방식 작성

## 목표
메일 작성과 트래커봇 메일 수신에 쓸 서비스를 설정에서 네이버웍스/Gmail 중 고를 수 있게 한다. Gmail 1차는 작성 창 주소에 받는 사람, 참조, 제목, 본문(일반 텍스트)을 넣어 여는 "주소 방식"이다. 첨부와 서식 본문은 1차에서 수동(복사 안내)이며, 실측 후 자동화하기 쉬운 구조로 둔다.

배경: 사용자가 웹메일 호스트를 `mail.google.com`으로 바꿔 시험하자 Gmail 받은편지함이 열리고 작성 화면으로 가지 않았다. 사용자는 앞으로 Gmail을 쓰게 될 수도 있어 둘 다 지원을 요청했다. Fable 설계(2026-10-18).

## 공통 제약
- 설정은 추가만 한다. `sites.naverworks`는 유지, schemaVersion 1 유지.
- 전송 자동 클릭 금지 원칙 유지. Gmail URL 빌더는 파라미터 `{fs, tf, to, cc, su, body}`만 내보낸다.
- 셀렉터 값 추정 금지(decisions 174행). Gmail 셀렉터셋은 빈 값 unverified로만 등록.
- 화면 확인 없이 completed를 내지 않는다. Gmail 1차 결과는 partial.
- Job.result(ComposeResult)에 작성 URL 문자열을 넣지 않는다(본문 포함 가능).
- 가운뎃점 문자 금지(주석, 화면 문구 포함). 새 npm 패키지 금지. 기존 코드 관례를 따른다.
- 실제 함수 이름, 줄 번호가 명세와 다르면 같은 역할의 코드에 적용하고 보고. 명세 밖 구조 변경이 필요하면 멈추고 보고.

## 단계
| 단계 | 내용 | 의존 |
|---|---|---|
| S1 | 타입, 기본값과 저장본 보정, provider 유틸, Gmail URL 빌더, Gmail 셀렉터셋 등록, ComposePlan | 없음 |
| S2 | compose-job, compose-relay, 호스트 사용처(site-registry, job-coordinator, router, auto-compose) | S1 |
| S3 | UI(compose-view, handoff-view, ComposeCard, MailServiceCard, AutoComposeCard, MailPreparePage, popup) | S1 |
| S4 | 문서(decisions, compose-flow, architecture) | S3 |
S2/S3 병렬.

---

## 1. 설정 스키마

### 1.1 타입 `src/core/types/settings.ts`
```ts
export type MailProvider = 'naverworks' | 'gmail';
sites: {
  /** 트래커봇 메일을 받는 서비스. CS 등록, webmail 발신자 판정, fs/permission-granted 알림 대상 */
  trackerbot: { urlPatterns: string[]; provider: MailProvider };   // provider 기본 'naverworks'
  naverworks: { ...변경 없음 };
  gmail: { accountIndex: number; selectorSetId: string; selectorOverrides?: Partial<ComposeSelectorSet> }; // 기본 { accountIndex: 0, selectorSetId: 'gmail-v1' }
};
mail: { provider: MailProvider; defaultGroupId?: string; defaultTemplateId?: string };  // provider = 메일 작성 서비스, 기본 'naverworks'
```
- Gmail 호스트는 상수 `GMAIL_HOST = 'mail.google.com'`(설정에 두지 않음).
- `composePath`는 입력 UI 없이 그대로 둔다.

### 1.2 기본값과 병합 `src/core/model/default-settings.ts`
- `defaultSettings()`: `sites.trackerbot.provider = 'naverworks'`, `sites.gmail = { accountIndex: 0, selectorSetId: 'gmail-v1' }`, `mail.provider = 'naverworks'`.
- `withDefaults` 깊은 병합:
```ts
sites: {
  trackerbot: { ...d.sites.trackerbot, ...stored.sites?.trackerbot },
  naverworks: { ...d.sites.naverworks, ...stored.sites?.naverworks },
  gmail:      { ...d.sites.gmail,      ...stored.sites?.gmail },
},
mail: { ...d.mail, ...stored.mail },
```
- 실험 저장본 보정(멱등): `stored.mail?.provider`가 없고 `stored.sites?.naverworks?.host === GMAIL_HOST`이면 `mail.provider = 'gmail'`, `sites.trackerbot.provider = 'gmail'`, `sites.naverworks.host = DEFAULT_WEBMAIL_HOST`로 읽는다. `mail.provider`가 저장돼 있으면 발동하지 않는다.

### 1.3 provider 유틸 `src/core/model/mail-provider.ts` (신규, 순수)
```ts
export const GMAIL_HOST = 'mail.google.com';
export const PROVIDER_LABEL: Record<MailProvider, string> = { naverworks: '네이버웍스', gmail: 'Gmail' };
export function providerHost(s: Settings, p: MailProvider): string;   // naverworks: s.sites.naverworks.host || DEFAULT_WEBMAIL_HOST, gmail: GMAIL_HOST
export function composeProvider(s: Settings): MailProvider;             // s.mail.provider
export function composeHost(s: Settings): string;
export function inboxProvider(s: Settings): MailProvider;               // s.sites.trackerbot.provider
export function inboxHost(s: Settings): string;
export const originOf = (host: string) => `https://${host}/*`;
```
- `DEFAULT_WEBMAIL_HOST`는 default-settings에 두고 import(순환 금지). GMAIL_HOST를 default-settings가 써야 하면 상수를 순환 없는 위치에 둔다.

---

## 2. compose 흐름

### 2.1 ComposePlan `src/engine/mail/compose-plan.ts` (신규, 순수)
```ts
export type ComposeField = 'to' | 'cc' | 'subject' | 'body';
export interface ComposePlan {
  provider: MailProvider;
  host: string;
  url: string;
  prefilled: ComposeField[];
  omitted: Array<{ field: ComposeField; reason: 'URL_TOO_LONG' }>;
  needsUserOpen: boolean;
  selector?: { set: ComposeSelectorSet; config: ComposeSelectorConfig };  // verified일 때만
}
export function planCompose(settings: Settings, draft: MailDraft, selectorSets: Record<string, ComposeSelectorSet>): ComposePlan;
```
- naverworks: `url = https://${host}${composePath ?? '/'}`, prefilled [], needsUserOpen true, 셀렉터는 `sites.naverworks`.
- gmail: `buildGmailComposeUrl` 결과로 url, prefilled(to, cc, subject, 본문이 들어갔으면 body), omitted(본문이 빠졌으면 body/URL_TOO_LONG), needsUserOpen false, 셀렉터는 `sites.gmail`.
- selector: 해당 selectorSetId로 조회해 `mergeSelectorSet` 후 status가 verified일 때만. 없는 id면 undefined. 빈 cc도 prefilled에 포함.
- ComposeSelectorConfig 구성은 기존 compose-job의 방식을 그대로 옮긴다.

### 2.2 `src/engine/jobs/compose-job.ts`
- 106~110행 부근의 site, set, manual, webmailUrl 계산을 `const plan = planCompose(...)`로 교체. `manual = !plan.selector`.
- `compose/open` payload: `{ jobId, url: plan.url, selector: plan.selector?.config }`.
- 셀렉터 없음 분기(기존 수동 분기 일반화):
  - fields: prefilled 필드는 `{ status: 'prefilled', method: 'url' }`, omitted 필드는 `{ status: 'unsupported', method: 'none', error: 'URL_TOO_LONG' }`, 나머지는 기존 unsupported/SELECTOR_UNVERIFIED.
  - attachments: 전부 skipped. error는 gmail이면 'ATTACH_MANUAL', naverworks면 기존 'SELECTOR_UNVERIFIED'.
  - step 라벨(gmail): fill_fields skipped "주소로 전달(받는 사람, 참조, 제목, 본문)", attach_files skipped "첨부는 직접", verify skipped "주소 방식은 확인 생략".
  - mode: `plan.prefilled.length > 0 ? 'url' : 'manual'`. 감지 폴링 없음.
- verified 경로 detect 라벨: needsUserOpen이면 기존 "[메일쓰기]를 눌러 주세요", 아니면 "작성 화면을 확인하는 중".
- finish: ComposeRecord `adapterId = plan.provider`, `webmailUrl = plan.url`(mail.json에만), `selectorSetVersion = plan.selector?.set.version ?? 'none'`. ComposeResult에 `provider` 기록, url은 넣지 않는다.
- outcome 판정은 그대로('prefilled'는 ok가 아니므로 partial). `reverify` 조기 반환 조건에 'prefilled'를 넣지 않는다.

### 2.3 타입
- `src/core/types/compose.ts`: `FieldResult.status`에 `'prefilled'`(주석: 주소 파라미터로 전달, 화면 확인 안 함).
- `src/core/types/job.ts`: `ComposeResult.mode: 'auto' | 'manual' | 'url'`, `provider?: MailProvider`.
- `src/messaging/protocol.ts`: `compose/open` payload `{ jobId: string; url: string; selector?: ComposeSelectorConfig }`.

### 2.4 SW `src/background/compose-relay.ts` open
- 권한 검사 origin은 `new URL(p.url).origin + '/*'`. https가 아니면 `COMPOSE_BAD_URL` throw.
- `tabs.create({ url: p.url })`.
- `p.selector`가 없으면 셀렉터 저장과 주입을 하지 않고 완료 대기만 한 뒤 `{ tabId }`.
- Gmail 1차는 작성 화면 감지를 하지 않는다.

### 2.5 결과 표시 `src/ui/compose-view.ts`
- 변형 추가: `{ kind: 'url'; provider; prefilled: ComposeField[]; pending: FieldResult[]; attachments; copies: CopyKind[]; attachDir?; canFocus }`. partial에서 `result.mode === 'url'`이면 이 변형. pending = status가 ok도 prefilled도 아닌 필드.
- 복사 규칙: 필드는 `status !== 'ok'`이고 `(field === 'body' || status !== 'prefilled')`일 때 복사 대상. 주소로 넣은 to, cc, subject는 복사 버튼 없음, 본문은 prefilled여도 "본문 복사(서식)" 유지. 첨부는 기존 규칙.
- `src/ui/handoff-view.ts`: url 결과는 `{ kind: 'compose_partial', text: 'Gmail 작성 창을 열었습니다. 첨부와 서식 본문은 직접 넣어 주세요', tone: 'warn', action: 'open-mail', actionLabel: '열기' }`.

---

## 3. Gmail URL `src/adapters/gmail/compose-url.ts` (신규, 순수)
```ts
export const GMAIL_URL_MAX = 8000;
export interface GmailComposeInput { accountIndex: number; to: string[]; cc: string[]; subject: string; bodyText: string }
export function buildGmailComposeUrl(i: GmailComposeInput, maxLength = GMAIL_URL_MAX): { url: string; bodyIncluded: boolean };
```
- 형태: `https://mail.google.com/mail/u/${n}/?fs=1&tf=cm` 뒤에 to, cc, su, body 순. 빈 값 파라미터는 생략.
- accountIndex는 0 이상 정수만, 아니면 0.
- 값마다 `encodeURIComponent`(URLSearchParams 금지). 줄바꿈 `\r\n`은 `\n`으로 정규화.
- 수신자: trim, 빈 값 제거, 소문자 비교 중복 제거, 쉼표로 결합.
- 본문은 `draft.text`(HTML 변환 없음).
- 길이: body 없이 만든 URL이 이미 한도를 넘으면 그대로 반환(bodyIncluded false). body를 붙여 넘으면 body를 통째로 뺀다(절단 금지).

### Gmail 셀렉터셋 `src/adapters/gmail/selectors/gmail-v1.ts` (신규)
- `id: 'gmail-v1'`, `version: '0.0.0-unverified'`, `status: 'unverified'`, hostPattern GMAIL_HOST, 셀렉터 전부 빈 값, `forbidden.textPatterns: ['보내기', '전송', 'Send', '발송']`. 기존 타입 구조에 맞춘다. `src/adapters/naverworks/selectors/index.ts`의 `SELECTOR_SETS`에 등록.

---

## 4. 호스트 사용처 (S2)
- `src/background/site-registry.ts`: `getWebmailHost` 삭제. `getInboxHost()`(`inboxHost(withDefaults(cache))`), `getComposeHost()` 추가. `isWebmailUrl`과 doSync 기본 getHost는 getInboxHost.
- `job-coordinator.ts` resolveKind: `inboxHost(await getSettings())`.
- `router.ts` fs/permission-granted: getInboxHost.
- `auto-compose.ts`: deps 이름 `getComposeHost`, handleCollect 권한 검사에 사용.
- provider 전환 시 site-registry의 storage.onChanged가 재동기화(추가 코드 없음).

---

## 5. UI (S3)

### 5.1 `src/entrypoints/dashboard/MailServiceCard.tsx` (신규, NaverWorksCard 교체)
- 제목 "메일 서비스", 설명 "메일 작성과 트래커봇 메일의 [공고 수집] 버튼에 쓸 서비스를 고르고 접근 권한을 허용합니다."
- 라디오 "메일 작성 서비스": 네이버웍스 / Gmail (`mail.provider`).
- 라디오 "트래커봇 메일을 받는 서비스": 네이버웍스 / Gmail (`sites.trackerbot.provider`).
- 둘 중 하나라도 네이버웍스면 기존 호스트 입력(HOST_RE, normalizeHost 그대로).
- 둘 중 하나라도 Gmail이면 "계정 번호" 숫자 입력(min 0, 기본 0), 도움말 "Gmail 주소창의 mail.google.com/mail/u/N/ 에서 N. 계정이 하나면 0". 안내 "Gmail은 작성 창을 열며 받는 사람, 참조, 제목, 본문(서식 없음)을 채웁니다. 첨부 파일과 서식은 직접 넣어야 합니다."
- [저장 및 권한 허용]: 첫 await로 `permissions.request({ origins: originsToRequest(draft) })` 1회 후 save. 권한 배지는 호스트별(같으면 하나).
- `originsToRequest(settings): string[]`는 순수 함수로 분리(중복 제거).
- 기존 NaverWorksCard의 디자인 구조, 컴포넌트(Card, Field, InlineAlert, StatusBadge 등)를 그대로 재사용. `NaverWorksCard.tsx` 삭제, `SettingsPage.tsx` import 교체.

### 5.2 compose 화면
- `src/ui/compose/ComposeCard.tsx`: `view.kind === 'url'` 분기.
  - InlineAlert info: "Gmail 작성 창을 열었습니다. 받는 사람, 참조, 제목, 본문(서식 없음)은 주소로 전달했습니다. 화면에서 내용을 확인하세요."
  - pending에 body가 있으면 경고: "본문이 길어 주소로 넣지 못했습니다. [본문 복사(서식)] 후 붙여 넣으세요."
  - 첨부가 있으면 기존 첨부 안내.
  - 복사 버튼, 포커스 버튼, [다시 작성].
  - 권한 호스트는 getComposeHost.
- `MailPreparePage.tsx`: 129행 부근 안내를 provider별로(gmail: "Gmail은 작성 창을 열고 받는 사람, 참조, 제목, 본문(서식 없음)을 채웁니다. 첨부와 서식 본문은 직접 넣어 주세요."), 163행 부근 카드 설명 "선택한 그룹과 템플릿으로 {PROVIDER_LABEL[provider]} 작성 화면을 엽니다."
- `AutoComposeCard.tsx`: 권한 호스트를 `composeHost(settings)`(동기 계산, 첫 await는 permissions.request 유지).
- `popup/App.tsx` 64행 부근 "네이버웍스 감지" → "웹메일 감지".

---

## 6. 2차 확장 지점(이번에 구현하지 않음)
- Gmail 셀렉터 실측 후 gmail-v1 값을 채우고 verified로 바꾸면 planCompose가 selector를 채워 기존 detect/fill/attach/verify 경로로 들어간다.
- 그때 `compose/fill`에 채울 필드 목록을 추가하고, needsUserOpen이 false면 detect 타임아웃을 짧게 한다.
- `adapters/naverworks`를 `adapters/webmail`로 옮기는 이름 정리는 2차.

---

## 7. 테스트
- S1
  - `tests/core/default-settings.test.ts`: 옛 저장본 기본 provider와 gmail 기본값, naverworks.host 보존 / 실험 저장본 보정 / provider 저장 시 보정 미발동 / accountIndex 보존.
  - `tests/core/mail-provider.test.ts`: providerHost, 빈 호스트 기본값, compose/inbox 분리.
  - `tests/adapters/gmail-compose-url.test.ts`: 키 화이트리스트, to/cc 결합과 중복 제거, 빈 cc 생략, 한글/줄바꿈/`+`/`&` 인코딩 왕복, accountIndex 음수/소수 → 0, 길이 초과 시 body 생략, body 없이도 초과면 그대로, 경계값.
  - `tests/engine/compose-plan.test.ts`: naverworks unverified/verified, gmail unverified(prefilled 4개, needsUserOpen false), gmail 긴 본문(omitted body), 없는 selectorSetId.
  - `tests/adapters/forbidden-dispatch.test.ts`: glob에 `src/adapters/gmail/**/*.ts`.
- S2
  - `tests/engine/compose-job.test.ts`: gmail 경로(open url, selector 없음, detect/fill 미호출, prefilled, attachments skipped, mode url, provider gmail, partial, adapterId gmail, ready_for_review, Job.result에 url 없음), 긴 본문 URL_TOO_LONG, naverworks 기존 케이스 payload 갱신.
  - `tests/background/compose-relay.test.ts`: selector 없으면 주입 없음, url origin 권한 검사, http → COMPOSE_BAD_URL.
  - `tests/background/site-registry.test.ts`: inbox gmail이면 `https://mail.google.com/*` 등록, compose provider와 무관.
  - `tests/background/job-coordinator.test.ts`: webmail 발신자 설정 갱신, 작성 gmail/수신 naverworks면 mail.google.com 탭은 unknown.
  - `tests/background/auto-compose.test.ts`: 주입 이름 getComposeHost.
  - `tests/background/router.test.ts`: fs/permission-granted가 inbox host 사용.
- S3
  - `tests/ui/compose-view.test.ts`: mode url → kind url, prefilled, copies `['body']` / `['body','attach']`, URL_TOO_LONG이면 pending에 body, manual 불변.
  - `tests/ui/handoff-view.test.ts`, `tests/ui/trackerbot-row-view.test.ts`: url → compose_partial, 행 라벨 '메일 확인'.
  - originsToRequest 테스트.

## 8. 결정과 기각 대안
| 결정 | 이유 | 기각 대안 |
|---|---|---|
| 설정은 추가만, withDefaults 깊은 병합 | 이전 코드 없이 옛 저장본이 읽힘 | providers 맵으로 재구성 |
| 작성/수신 provider 분리, 호스트는 provider별 값에서 유도 | "Gmail 수신 + 네이버웍스 작성" 표현, 공유 지점이 용도별로 둘로 갈림 | 호스트 하나 공유, 수신 호스트 별도 문자열 |
| Gmail 호스트 상수, 계정은 accountIndex | 입력 불필요, u/N은 문서화된 경로 | authuser=email, u/N 생략 |
| provider 분기는 planCompose 한 곳, compose/open은 {url, selector?} | 2차 확장이 plan 수정으로 끝남 | compose-job 안 분기 산재 |
| Gmail 1차는 partial, mode url, 필드 prefilled | 화면 확인 없이 completed 금지와 일관 | prefilled를 ok 취급 |
| 본문은 draft.text | 템플릿이 text 렌더를 이미 만듦 | HTML 태그 제거 함수 |
| 8000자 초과면 body 생략(절단 금지) | 잘린 본문 전송 위험 | 절단 + 안내 |
| Gmail 1차 작성 화면 감지 생략 | 셀렉터 없이 가능한 건 URL 추정뿐, 오판 비용 큼 | tabs.get url 확인 |
| getWebmailHost 삭제, getInboxHost/getComposeHost | 호출부마다 용도를 고르게 함 | alias 유지 |
| 실험 저장본(host가 mail.google.com) 자동 보정 | 사용자가 이미 만든 상태, 멱등 | 수동 복구 |

## 9. 실측 필요
1. Gmail 작성 URL 길이 한도(8000자에서 시작).
2. 로그인 전 상태에서 작성 창까지 이어지는지.
3. accountIndex가 계정 수를 넘을 때 쿼리 보존 여부.
4. `tf=cm`이 막히면 `view=cm`으로 교체(빌더 상수 1곳).
(트래커봇 버튼의 Gmail 읽기 화면 동작은 사용자가 확인함.)

## 보고 형식
결론, 변경 파일 경로, 테스트 결과, 명세와 다르게 한 점과 이유, 실패 항목. 한국어로 작성.
