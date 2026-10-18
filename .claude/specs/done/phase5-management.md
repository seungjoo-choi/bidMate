# Phase 5 관리 기능: 수신자/그룹, 메일 템플릿/미리보기, 대시보드 홈 (Fable 설계, 2026-10-18)

독자: 맥락 없는 구현 에이전트. 아래는 결정된 사항만 담는다. 벗어나야 하면 구현을 멈추고 보고한다.
문구 규칙: 사용자 노출 문구, 코드 주석 모두 한국어, 가운뎃점 문자 금지(쉼표, 슬래시 사용).

## 0. 목표와 범위
- 네이버웍스 자동 입력 없이, 메일 작성 직전 산출물(수신자 해석 결과, 제목/본문 렌더 결과, 첨부 목록)을 로컬에서 완결한다.
- 산출물 `notices/<folder>/mail-draft.json`(MailDraft)은 나중에 `compose/fill`, `compose/attach-begin` 입력으로 그대로 쓴다.
- 메일 준비 화면 범위: 초안 저장, HTML/텍스트/제목 복사, "전달 완료로 표시/해제". 웹메일 자동 작성 없음.
- 대시보드 기본 화면은 새 홈.

## 1. 저장
| 데이터 | 경로 | 형식 |
|---|---|---|
| 수신자 | `config/recipients.json` | `ConfigList<Recipient>` |
| 그룹 | `config/groups.json` | `ConfigList<Group>` |
| 템플릿 | `config/templates.json` | `ConfigList<Template>` |
| 메일 초안 | `notices/<folder>/mail-draft.json` | `MailDraft` (공고당 1개, 덮어씀) |

```ts
// src/core/types/config-file.ts
export interface ConfigList<T> { schemaVersion: 1; updatedAt: ISODate; items: T[] }
```
- 쓰기는 offscreen FileStore만. 원자성은 기존 `createWritable` 교체에 맡긴다.
- 세 config 파일의 모든 변경은 `store.withLock('config', ...)` 안에서 읽기, 수정, 쓰기. 두 파일을 쓰는 연산은 `recipients.json` 다음 `groups.json` 순서.
- 읽기 로더는 파일을 쓰지 않는다.
  - 파일 없음(`e.name === 'NotFoundError'`) → 빈 목록(템플릿은 내장 기본 1개). 파일 생성 안 함.
  - JSON 파싱 실패, 최상위 비객체, `items` 비배열 → `CONFIG_CORRUPT`(code, path). 덮어쓰지 않음.
  - `schemaVersion > 1` → `CONFIG_NEWER`. 덮어쓰지 않음.
  - `schemaVersion` 없음 또는 1 → 항목별 보정(메모리만, 다음 쓰기에 반영).
- `config/repair {file}`: 원문을 `config/<name>.corrupt-<ISO 타임스탬프, 콜론은 -로>.json`에 복사 후 빈 ConfigList로 다시 쓴다. 원문 읽기도 실패하면 백업 없이 초기화, backupPath ''. 사용자 버튼으로만 실행.
- Notice 스키마 변경 없음(schemaVersion 1). 기존 필드 `mail.status`, `mail.groupId`, `mail.templateId`, `mail.deliveredAt`만 사용.
- `Settings.mail.defaultGroupId/defaultTemplateId`는 읽지도 쓰지도 삭제하지도 않는다. 기본값의 진실은 `isDefault`.

### 항목 보정 규칙
- Recipient: `id` 없으면 `newId('rcp')`, `name` 비문자열이면 `''`, `email` 비문자열/빈 값이면 항목 제외 + warning, `enabled` 비boolean이면 true, `defaultRole`이 'to'/'cc' 아니면 'to', `dept`/`memo` 비문자열이면 삭제, `updatedAt` 없으면 파일 updatedAt 또는 now.
- Group: `id` 없으면 `newId('grp')`, `name` 없으면 `'(이름 없음)'`, `memberIds` 비배열이면 `[]`, 문자열 아닌 원소 제거, `roleOverrides` 비객체면 삭제, 값이 'to'/'cc' 아닌 키 제거, `isDefault` 비boolean이면 false. 끊어진 memberIds는 읽기 때 warnings에 1줄(해석 시 무시), 저장 때 제거.
- Template: `id` 없으면 `newId('tpl')`, `sections` 비배열이면 `[]`, item의 `fieldKey`가 레지스트리에 없으면 item 제거 + warning, `visible` 비boolean이면 true, `subject`/`greeting`/`closing` 비문자열이면 `''`.
- `isDefault === true`가 여러 개면 첫 번째만 남김. 없으면 그룹은 "기본 없음", 템플릿은 첫 항목을 기본으로 본다.
- MailDraft: 읽기 실패/손상이면 null.

## 2. 수신자/그룹 규칙
- `normalizeEmail(s) = s.trim().toLowerCase()`, 정규화 값을 저장. 형식 `^[^\s@]+@[^\s@]+\.[^\s@]+$`, 254자 이하. 실패 `INVALID_EMAIL`.
- 정규화 이메일이 다른 수신자와 같으면 `DUPLICATE_EMAIL`.
- 이름 필수(trim 후 1자 이상), 100자 이하. dept 200자, memo 500자 이하. 위반 `INVALID_VALUE`.
- 한 수신자가 여러 그룹의 `memberIds`에 들어갈 수 있다. 수신자 삭제 시 모든 그룹의 `memberIds`, `roleOverrides`에서 제거. 그룹 삭제는 수신자를 지우지 않는다.
- 그룹 이름 필수, 100자 이하, trim/대소문자 무시 중복이면 `DUPLICATE_NAME`.
- `groups/set-default {id}`는 그 그룹만 true. 기본 그룹을 지우면 기본 없음(다른 그룹 자동 승격 금지), UI 경고.
- 공고별 그룹 선택 우선순위: 요청 payload groupId → `notice.mail.groupId`(존재할 때) → 기본 그룹 → 없으면 `NO_GROUP`.
- `resolveRecipients(group, recipients)`:
  1. memberIds 순서대로 찾는다. 없으면 skipped reason `missing`.
  2. `enabled === false` → skipped `disabled`.
  3. 역할 = `group.roleOverrides?.[id] ?? recipient.defaultRole`.
  4. 정규화 이메일로 중복 제거. TO와 CC에 모두 있으면 TO만(TO 우선). 같은 역할 중복은 첫 것 유지, 나머지 skipped `duplicate`.
  5. 결과 `{ to: string[]; cc: string[]; members: Array<{ id; name; email; role }>; skipped: Array<{ id: string; email?: string; name?: string; reason: 'missing'|'disabled'|'duplicate' }> }`.
  6. TO 0명 CC만 있으면 허용 + warning `TO 수신자가 없습니다`. 둘 다 0명이면 `mail/prepare`가 `NO_RECIPIENTS`.

## 3. 템플릿
### 변수 문법
`{이름}`, 이름 `[가-힣A-Za-z0-9_.]+`, 정규식 `/\{([가-힣A-Za-z0-9_.]+)\}/g`. 레지스트리에 없는 이름은 원문 유지 + `unknownVars`. 이스케이프 문법 없음.

### 레지스트리 `src/core/templates/variables.ts`
```ts
export type VariableKind = 'text' | 'amount' | 'datetime' | 'date' | 'bool_joint' | 'bool_apply' | 'score' | 'period' | 'url' | 'list' | 'number';
export interface VariableDef { name: string; fieldKey: TemplateFieldKey; label: string; group: '기본' | '일정' | '평가' | '기타'; kind: VariableKind; }
export type TemplateFieldKey = NoticeFieldKey | 'sourceUrl' | 'attachmentList' | 'attachmentCount' | 'collectedAt' | 'isCorrection' | `custom.${string}`;
```
| 변수명 | fieldKey | kind | 그룹 |
|---|---|---|---|
| 공고번호 | noticeNo | text | 기본 |
| 공고차수 | round | text | 기본 |
| 공고명 | title | text | 기본 |
| 게시일시 | postedAt | datetime | 기본 |
| 공고구분 | noticeType | text | 기본 |
| 발주기관 | orderingOrg | text | 기본 |
| 수요기관 | demandOrg | text | 기본 |
| 사업금액 | budgetAmount | amount | 기본 |
| 추정가격 | estimatedPrice | amount | 기본 |
| 사업기간 | projectPeriod | text | 기본 |
| 계약방법 | contractMethod | text | 기본 |
| 낙찰자결정방법 | awardMethod | text | 기본 |
| 예가방법 | priceMethod | text | 기본 |
| 공동수급 | jointVentureAllowed | bool_joint | 기본 |
| 참가자격 | eligibility | text | 기본 |
| 참가자격등록마감 | registrationDeadline | datetime | 일정 |
| 입찰시작일 | bidStartAt | datetime | 일정 |
| 입찰마감일 | bidCloseAt | datetime | 일정 |
| 제안서제출기간 | proposalPeriod | text | 일정 |
| 제안서평가일 | proposalEvalAt | datetime | 일정 |
| 개찰일시 | openingAt | datetime | 일정 |
| 평가방법 | evalMethod | text | 평가 |
| 차등점수제 | differentialScoring | bool_apply | 평가 |
| 대외신인도 | credibilityScore | score | 평가 |
| 경영상태 | managementScore | score | 평가 |
| 실적평가 | performanceScore | score | 평가 |
| 실적인정기간 | performancePeriod | period | 평가 |
| 실적인정금액 | performanceMinAmount | amount | 평가 |
| 실적인정조건 | performanceCondition | text | 평가 |
| 공고URL | sourceUrl | url | 기타 |
| 첨부파일목록 | attachmentList | list | 기타 |
| 첨부파일수 | attachmentCount | number | 기타 |
| 수집일시 | collectedAt | datetime | 기타 |
| 정정공고 | isCorrection | text("정정공고" 또는 "") | 기타 |
- fieldKey 이름은 실제 `NoticeFieldKey`(src/core/model/notice-fields.ts, src/core/types/notice.ts)와 대조해 맞춘다. 표의 키가 실제와 다르면 실제 키를 쓰고 보고한다.
- `custom.<key>`: `notice.customFields[key]`를 text로. 레지스트리에 없고 접두사로 처리. 매핑 UI는 범위 밖.
- `VARIABLE_BY_NAME`, `VARIABLE_BY_KEY`(Map), `isTemplateFieldKey` 제공.

### 값 해석 `resolveValue(notice, fieldKey): ResolvedValue`
```ts
export interface ResolvedValue { text: string; status: 'ok' | 'needs_review' | 'missing'; raw: unknown; }
```
- FieldValue `missing` 또는 value null → text `확인 필요`, status missing.
- `needs_review`(값 있음) → `<값> (확인 필요)`, status needs_review.
- `verified`/`user_edited` → 포맷, ok.
- 포맷: amount `formatAmountFull`(예 "5억 원 (500,000,000원)"), datetime `YYYY-MM-DD HH:mm`(로컬), date `YYYY-MM-DD`, bool_joint 허용/불허, bool_apply 적용/미적용, score `N점`, period `formatPeriod`, number 정수, text trim(빈 문자열이면 missing 규칙), url 문자열.
- attachmentList: `notice.attachments`를 index 순, originalName. `failed`/`size_mismatch`면 ` (다운로드 실패)`, `pending`/`downloading`/`skipped`면 ` (미확보)`. 빈 목록이면 `첨부 없음`, ok.
- `확인 필요`는 상수 `NEEDS_REVIEW_TEXT`. HTML에서도 평문(색, span 없음).

### Template 타입 (`src/core/types/template.ts` 개정, 기존 사용처 없음)
```ts
export interface TemplateFieldItem { fieldKey: TemplateFieldKey; label: string; visible: boolean; }
export interface TemplateSection { id: string; title: string; items: TemplateFieldItem[]; }
export interface Template {
  id: string; name: string; isDefault: boolean;
  subject: string; greeting: string; closing: string;   // {변수} 허용, 평문, greeting/closing은 줄바꿈 유지
  sections: TemplateSection[];
  updatedAt: ISODate;
}
```
`extraction.${string}` fieldKey는 없앤다. 자유 HTML 본문 모드 없음.

### 렌더 `src/core/templates/render.ts`
```ts
export interface UnresolvedVar { name: string; label: string; status: 'needs_review' | 'missing'; where: 'subject' | 'greeting' | 'closing' | string /* sectionId */ }
export interface RenderedMail { subject: string; html: string; text: string; unresolved: UnresolvedVar[]; unknownVars: string[]; }
export function renderMail(template: Template, notice: Notice): RenderedMail;
```
- 입력은 Notice뿐(`notice.evaluation`이 이미 병합 결과). `Date.now()` 사용 금지, 결정론.
- subject: 치환 후 평문, 줄바꿈/제어문자는 공백, trim, 300자 초과 시 자름.
- greeting/closing: 치환(값은 text) → 전체 `escapeHtml` → `\n`을 `<br>`. 빈 문자열이면 블록 생략.
- sections: visible item만, 모두 숨김이면 섹션 생략, 번호는 보이는 섹션 순서로 1부터. HTML `<h3>n. 제목</h3><table>`, 행 `<tr><th align="left">라벨</th><td>값</td></tr>`. attachmentList 값은 `<ul><li>…</li></ul>`. sourceUrl은 `https?://`로 시작할 때만 `<a href="…">…</a>`(href도 이스케이프), 아니면 평문.
- 인라인 스타일은 표 `border-collapse`, 셀 padding 정도. 외부 CSS, 이미지, 스크립트 없음.
- text: 본문 평문. 섹션은 `n. 제목` 줄 + `- 라벨: 값` 줄. attachmentList는 `- 첨부파일목록:` 다음 줄부터 `  - 이름`.
- `escapeHtml`: `& < > " '` 5종. 변수 값, 라벨, 섹션 제목, 인사말/맺음말 전부.
- unresolved: 제목/인사말/맺음말 변수와 보이는 섹션 항목 중 ok가 아닌 것. 여러 곳이면 모두 기록(where 구분).

### 기본 템플릿 `src/core/templates/default-template.ts`
`builtinDefaultTemplate(now): Template`, `TEMPLATE_DEFAULT_ID = 'tpl_default'`, name `기본 템플릿`. 요구사항 8절 양식 그대로(사용자 결정, 추가 항목 없음):
- subject `[입찰공고 공유] {공고명}`
- greeting `안녕하세요.\n아래 입찰공고를 공유드립니다.`
- 섹션 1 `공고 개요`: 기관명(orderingOrg), 사업명(title), 공고 게시일(postedAt), 사업금액(budgetAmount), 사업기간(projectPeriod)
- 섹션 2 `입찰 일정`: 참가자격 등록마감(registrationDeadline), 제안서 제출 기간(proposalPeriod), 제안서 평가일시(proposalEvalAt)
- 섹션 3 `계약 및 평가`: 계약방법(contractMethod), 평가방법(evalMethod), 차등점수제(differentialScoring), 대외신인도 평가(credibilityScore), 수행실적 평가(performanceScore), 실적 인정조건(performanceCondition), 공동수급(jointVentureAllowed), 예가방법(priceMethod)
- 섹션 4 `관련 자료`: 나라장터 공고 URL(sourceUrl), 첨부파일 목록(attachmentList)
- closing `검토 부탁드립니다.`
- 다른 항목(공고번호, 입찰마감일, 경영상태 등)은 템플릿 편집의 [항목 추가]로 넣고 뺀다.
- 마지막 1개 삭제는 `LAST_TEMPLATE`. 기본을 지우면 남은 첫 항목이 기본. `tpl_default`도 수정/삭제 가능(파일 없을 때만 내장값이 다시 나타남).

### MailDraft `src/core/types/mail.ts`
```ts
export interface DraftAttachment { attachmentId: string; name: string; path: string; size: number; }   // path = `${folder}/attachments/${savedName}`
export interface MailDraft {
  schemaVersion: 1; noticeId: string; preparedAt: ISODate; templateId: string; groupId: string;
  to: string[]; cc: string[]; subject: string; html: string; text: string;
  attachments: DraftAttachment[];
  skippedAttachments: Array<{ attachmentId: string; name: string; status: AttachmentStatus }>;
  unresolved: UnresolvedVar[]; unknownVars: string[]; warnings: string[];
}
```
- 첨부는 `status === 'saved'`이고 `savedName`이 있는 것만, size `savedSize ?? expectedSize ?? 0`. 나머지는 skippedAttachments + warning `첨부 N개가 저장되지 않았습니다`.
- `draftToComposeFill(draft)`를 두어 `{to, cc, subject, html}`과 `FileMeta[]`(fileId=attachmentId, name=savedName, size) 변환을 고정한다.

## 4. 대시보드 홈 지표 `src/core/dashboard/stats.ts`
```ts
export interface HomeStats {
  total: number;
  recent: { count: number; items: IndexEntry[] };          // collectedAt 최근 7일 이내(정확히 7일 전 포함), items 최신 5개
  mailPending: { count: number; items: IndexEntry[] };
  collectFailed: { failed: number; partial: number; items: IndexEntry[] };  // failed + partial 최신순 5개
  dueSoon: { count: number; items: IndexEntry[] };         // bidCloseAt이 now 이상 now+7일 이하, 마감 가까운 순 전부
  needsReview: number;                                     // extractionStatus === 'needs_review'
  monthly: Array<{ month: string; collected: number; failed: number; delivered: number }>; // 로컬 YYYY-MM, 최근 6개월, 오래된 달부터, 빈 달 0
}
export function computeHomeStats(entries: IndexEntry[], now: Date): HomeStats;
export const DUE_SOON_DAYS_HOME = 7; export const RECENT_DAYS = 7; export const MONTHS = 6;
```
- 메일 작성 대기 = `collectStatus !== 'failed'` 이고 `mailStatus`가 'none' 또는 'drafting' 이고 `supersededBy` 없음.
- 수집 실패 = `collectStatus === 'failed'`, 보조로 partial.
- 월별은 로컬 연월(`getFullYear`/`getMonth`), `slice(0,7)` 금지. collected, 그 달 수집 건 중 failed, 그 달 수집 건 중 delivered.
- supersededBy 공고는 total 포함, 대기/마감 예정 제외. bidCloseAt 없는 항목 안전 처리.
- 입력은 기존 `notice/list`(IndexEntry[])뿐. 새 메시지 없음.

## 5. 메시지 프로토콜 (UI→SW→offscreen, `relayExtensionOnly` 발신자 검증)
```ts
export interface ConfigWarnings { warnings: string[] }
export interface RecipientsSnapshot extends ConfigWarnings { recipients: Recipient[]; groups: Group[] }
export interface TemplatesSnapshot extends ConfigWarnings { templates: Template[] }
export type RecipientInput = Omit<Recipient, 'id' | 'updatedAt'> & { id?: string; groupIds?: string[] };
export type GroupInput = Omit<Group, 'id' | 'updatedAt' | 'isDefault'> & { id?: string };
export type TemplateInput = Omit<Template, 'id' | 'updatedAt' | 'isDefault'> & { id?: string };

| { type: 'recipients/list'; payload: void; response: RecipientsSnapshot }
| { type: 'recipients/save'; payload: { recipient: RecipientInput }; response: RecipientsSnapshot }
| { type: 'recipients/delete'; payload: { id: string }; response: RecipientsSnapshot }
| { type: 'groups/save'; payload: { group: GroupInput }; response: RecipientsSnapshot }
| { type: 'groups/delete'; payload: { id: string }; response: RecipientsSnapshot }
| { type: 'groups/set-default'; payload: { id: string }; response: RecipientsSnapshot }
| { type: 'templates/list'; payload: void; response: TemplatesSnapshot }
| { type: 'templates/save'; payload: { template: TemplateInput }; response: TemplatesSnapshot }
| { type: 'templates/delete'; payload: { id: string }; response: TemplatesSnapshot }
| { type: 'templates/set-default'; payload: { id: string }; response: TemplatesSnapshot }
| { type: 'mail/prepare'; payload: { noticeId: string; groupId?: string; templateId?: string }; response: { draft: MailDraft; notice: Notice } }
| { type: 'mail/draft-get'; payload: { noticeId: string }; response: MailDraft | null }
| { type: 'mail/set-status'; payload: { noticeId: string; status: 'delivered' | 'none' }; response: { notice: Notice } }
| { type: 'config/repair'; payload: { file: 'recipients' | 'groups' | 'templates' }; response: { backupPath: string } }
```
- 오류 code: `INVALID_EMAIL`, `DUPLICATE_EMAIL`, `INVALID_VALUE`, `DUPLICATE_NAME`, `NOT_FOUND`, `LAST_TEMPLATE`, `NO_GROUP`, `NO_RECIPIENTS`, `JOB_ALREADY_RUNNING`, `CONFIG_CORRUPT`(path), `CONFIG_NEWER`, `NEEDS_FS_PERMISSION`(기존). 오류는 `Object.assign(new Error(msg), { code, path? })`로 던진다.
- `mail/prepare` 흐름: `editLockKey(noticeId)` 락 → isBusy 검사(`JOB_ALREADY_RUNNING`) → notice 로드(NOT_FOUND) → config 로드 → 그룹 결정 → 템플릿 결정(payload → notice.mail.templateId(존재 시) → 기본) → resolveRecipients → 0명이면 NO_RECIPIENTS → renderMail → draft 조립 → `<folder>/mail-draft.json` 쓰기 → `notice.mail = { ...notice.mail, status: 이전이 'delivered'면 'delivered' 아니면 'drafting', groupId, templateId }`, updatedAt 갱신 → `saveNoticeLatest`. `lastComposedAt`은 찍지 않는다. config 락을 잡은 채 notice 저장 금지.
- `mail/set-status`: 같은 락/isBusy → `delivered`면 status delivered, `deliveredAt=now`. `none`이면 초안 파일이 있으면 drafting, 없으면 none, deliveredAt 삭제.
- isBusy는 `extraction/edit`과 같다: `(noticeId) => registry.findConflict({ type: 'extract', noticeId }) !== undefined`. 이 검사는 collect, download_retry, extract를 같은 군으로 본다(src/core/model/job-conflict.ts).
- 초안을 `mail.json`(ComposeRecord)에 쓰지 않는다. `mail.status`를 `ready_for_review`로 올리지 않는다.

## 6. 화면
- `App.tsx` 메뉴: 홈(`#/home`, LayoutDashboard), 공고(`#/notices`), 수신자(`#/recipients`, Users), 템플릿(`#/templates`, FileText), 설정, 진단. 해시 없음 기본 라우트는 홈. `#/templates/<id>` 템플릿 편집, `#/mail/<noticeId>` 메일 준비(활성 메뉴는 공고). wide: notices, review, home, recipients, templates, mail.
- HomePage: 지표 카드 5개(전체, 최근 수집 7일, 메일 작성 대기, 수집 실패(+일부 누락), 입찰마감 예정 7일), 클릭 시 `#/notices`. 아래 2열: 마감 예정 목록(D-day, 제목, 기관, 클릭 → review), 최근 수집 5건. 맨 아래 월별 막대(CSS 폭, 6칸). 빈 상태와 NEEDS_FS_PERMISSION 처리는 NoticesPage 패턴.
- RecipientsPage: 2열. 좌 그룹 목록(이름, 멤버 수, 기본 표시, [기본으로] [이름 수정] [삭제], [그룹 추가]). 우 상단 그룹 상세(멤버: 이름, 이메일, 역할 select 기본/TO/CC → roleOverrides, [멤버 추가], 해석 요약 "TO n명, CC m명, 제외 k명(사유)"). 우 하단 수신자 표(이름, 이메일, 부서, 기본 역할, 사용 여부 토글, 소속 그룹 수, [수정] [삭제]). 수신자 폼은 인라인 패널(이름, 이메일, 부서, 메모, 기본 역할, 사용 여부, 소속 그룹 체크박스=groupIds). 저장 응답 스냅샷으로 상태 교체(낙관적 갱신 금지). 삭제는 2단계 버튼(클릭 → "정말 삭제", 3초 후 복귀). CONFIG_CORRUPT면 알림 + [백업 후 초기화].
- TemplatesPage: 목록(이름, 기본 표시, 수정일, [기본으로] [복제] [삭제]) + [새 템플릿](내장 기본 복제로 시작).
- TemplateEditor(`#/templates/<id>`): 좌 편집, 우 미리보기(iframe). 이름, 제목, 인사말, 섹션 목록(제목, 항목 행: visible 체크, 라벨, ▲▼, 삭제, [항목 추가] select는 그 템플릿에 아직 없는 fieldKey만), [섹션 추가] [섹션 삭제], 맺음말. 변수 버튼(그룹별)은 마지막 포커스 입력의 커서 위치에 `{이름}` 삽입. 미리보기 표본은 `notice/list` 최신 1건을 `notice/get`, 없으면 `sampleNotice()`. `renderMail` 직접 호출, 300ms 디바운스. 저장 버튼은 변경 있을 때만.
- MailPreparePage(`#/mail/<noticeId>`): 헤더(공고명, 번호, [공고로 돌아가기]). 그룹 select, 템플릿 select. 수신자 칩 TO/CC, 제외 목록(사유). 제목. 본문 `<iframe sandbox="" srcdoc>`. 첨부 저장됨 목록, 미확보 목록. 확인 필요 변수 목록(name 기준 dedupe, 클릭 → review). 액션 [초안 저장](`mail/prepare`, 토스트 "초안을 저장했습니다"), [HTML 복사] [텍스트 복사] [제목 복사], `mail.status` 배지와 [전달 완료로 표시]/[전달 완료 해제]. 고정 안내(info): "네이버웍스 자동 작성은 아직 검증 전입니다. 초안은 로컬 파일로 저장되며 메일은 직접 작성해 보내 주세요."
- ReviewPage: 헤더 [메일 작성 준비](Mail, primary) → `#/mail/<id>`, `notice.mail.status !== 'none'`이면 "메일 초안 보기".
- 미리보기는 `dangerouslySetInnerHTML` 금지, `iframe sandbox srcdoc`만.
- 색, 간격, 스타일은 기존 `src/ui/components`, `src/ui/theme`를 그대로 쓴다.

## 7. 작업 단위 (의존 순서)
### 단계 A: core (순수, `src/ui`, `src/engine`, `chrome.*` import 금지)
- A1 타입: `src/core/types/config-file.ts`(신규), `template.ts`(개정), `mail.ts`(신규: MailDraft, DraftAttachment, UnresolvedVar, RenderedMail, ResolvedValue), `index.ts` export 추가.
- A2 포맷 이동: `src/core/model/format.ts` 신규. `src/ui/review/format.ts`의 `formatAmountShort`, `formatAmountFull`, `formatScore`, `formatPeriod`, `formatDifferential`을 옮기고 `formatDateTimeFull`, `formatDateFull`, `formatJoint` 추가. `src/ui/review/format.ts`는 재export. `tests/ui/format.test.ts` 무수정 통과.
- A3 수신자: `src/core/recipients/email.ts`, `resolve.ts`, `normalize.ts`(`normalizeRecipient`, `normalizeGroup`, `dedupeDefault`).
- A4 템플릿: `src/core/templates/variables.ts`, `escape.ts`, `values.ts`, `render.ts`, `default-template.ts`, `normalize.ts`(`normalizeTemplate(raw, now): { template; warnings }`), `sample-notice.ts`(`sampleNotice()`, 모든 필드 verified, 첨부 2개, 확인 필요 1개 포함).
- A5 통계: `src/core/dashboard/stats.ts`.
### 단계 B: engine (A 뒤)
- B1 `src/engine/config/config-store.ts`: `CONFIG_LOCK`, `CONFIG_PATHS`, `loadList`, `saveList`, `withConfigLock`, `repairConfig`.
- B2 `src/engine/config/recipients-api.ts`: list/save/delete 수신자, save/delete/set-default 그룹. `groupIds`로 소속 맞춤, 저장 시 끊어진 memberIds 제거.
- B3 `src/engine/config/templates-api.ts`: list/save/delete/set-default. 저장 입력의 알 수 없는 fieldKey는 `INVALID_VALUE`로 거부(보정 아님). 파일 없을 때 list는 `[builtinDefaultTemplate(now)]`, 첫 저장에 목록 전체 기록.
- B4 `src/engine/mail/prepare.ts`: `prepareMail`, `getDraft`, `setMailStatus`, `draftPath(folder)`, `draftToComposeFill`.
### 단계 C: 배선 (B 뒤, 한 implementer)
- `src/messaging/protocol.ts`, `src/background/router.ts`(relayExtensionOnly 유니온과 등록 배열), `src/entrypoints/offscreen/main.ts`(listen 14개).
### 단계 D: UI (C 뒤, D1 먼저)
- D1 `App.tsx`, `src/ui/hooks/useConfig.ts`(`useRecipients`, `useTemplates`: data, error, reload, run(op)), `src/ui/hooks/useFsError.tsx`(NoticesPage의 NEEDS_FS_PERMISSION 분기를 `FsErrorAlert`로 추출, NoticesPage 교체).
- D2 HomePage(+ `home/StatCard.tsx`, `home/MonthlyBars.tsx`).
- D3 RecipientsPage(+ `recipients/` 하위).
- D4 TemplatesPage, TemplateEditor(+ `templates/SectionEditor.tsx`, `VariablePalette.tsx`, `MailPreviewFrame.tsx`).
- D5 MailPreparePage(MailPreviewFrame 재사용), ReviewPage 버튼.

## 8. 테스트 (vitest, MemoryStore: tests/helpers/memory-store.ts)
- `tests/core/email.test.ts`: 정규화, 형식(`a@b.co` 통과, `a@b`, `a b@c.com`, 빈 문자열, 255자 거부).
- `tests/core/resolve-recipients.test.ts`: disabled, missing, roleOverrides, TO/CC 중복 시 TO(대소문자/공백 차이), 같은 역할 중복 duplicate, 순서 보존, 빈 그룹.
- `tests/core/recipients-normalize.test.ts`: id 부여, email 없음 null, 기본값, memberIds 비배열, roleOverrides 잘못된 값, dedupeDefault.
- `tests/core/render-template.test.ts`: 제목 치환, 알 수 없는 변수, missing/needs_review 표기와 unresolved, HTML 이스케이프(`<b>&"'`), `javascript:` URL 평문/`https://` 링크, 첨부 표기와 "첨부 없음", 숨김 항목/섹션 생략/번호 재부여, greeting `<br>`, 기본 템플릿 + sampleNotice에서 unknownVars 없음, 결정론, 포맷(5억 원, 2026-10-22 14:00, 허용/적용), 제목 줄바꿈 공백 치환.
- `tests/core/template-normalize.test.ts`: 알 수 없는 fieldKey 제거 + warning, sections 비배열, id 부여.
- `tests/core/home-stats.test.ts`: total, recent 7일 경계, mailPending 포함/제외 규칙, failed/partial, dueSoon 경계와 정렬, monthly 빈 달과 delivered, bidCloseAt 없음.
- `tests/engine/config-store.test.ts`: 파일 없음, 손상(CONFIG_CORRUPT, 파일 불변), CONFIG_NEWER, 보정 warnings, saveList 형식, repairConfig 백업, withConfigLock 직렬화.
- `tests/engine/recipients-api.test.ts`: 생성/정규화, DUPLICATE_EMAIL, INVALID_EMAIL, groupIds 맞춤, 수신자 삭제 시 그룹 정리, DUPLICATE_NAME, set-default 유일성, 기본 그룹 삭제, 끊어진 memberIds 저장 시 제거, NOT_FOUND.
- `tests/engine/templates-api.test.ts`: 파일 없음 list, 추가, LAST_TEMPLATE, 기본 삭제 승계, INVALID_VALUE, set-default.
- `tests/engine/mail-prepare.test.ts`: 기본 그룹/템플릿 초안 생성과 notice.mail 기록, groupId 지정, NO_GROUP, NO_RECIPIENTS, 첨부 분리, isBusy 거부 시 파일 불변, 초안과 `renderMail` 직접 호출 결과 동일, delivered 유지, set-status, 손상 초안 null, draftToComposeFill.

## 9. 금지 사항 요약
- 읽기 경로에서 파일 쓰기, 손상 파일 자동 초기화.
- 템플릿 값에 HTML 허용, `dangerouslySetInnerHTML`.
- 이메일 중복 판정을 정규화 전에 하기.
- `mail/prepare`에서 재수집, 재추출.
- 홈 메일 대기에 failed 포함.
- 새 npm 의존성(차트, DnD, sanitizer).
