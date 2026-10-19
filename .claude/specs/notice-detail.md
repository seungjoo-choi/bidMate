# 공고 상세 화면(탭) 명세

작성 2026-10-19. Fable 설계, 사용자 승인. 결정 근거는 `.claude/specs/decisions.md`의 "2026-10-19 공고 상세 화면(탭)" 절.

## 목표
대시보드에서 수집한 공고 하나의 상세정보를 탭으로 본다. 탭은 개요(기본정보와 일정) / 첨부파일 / 수집과 메일 이력 / 평가정보 검토(기존 검토 화면 편입)이다. 조회 전용이고, 편집은 평가정보 검토 탭에서만 한다(기존 동작 그대로). 평가 점수 분석 탭은 이번 범위가 아니다(다른 세션이 eval S4 진행 중). 메시지와 백엔드는 바꾸지 않는다.

## 공통 제약
- 작업 트리에 다른 세션의 미커밋 변경이 있다. 수정 파일은 지정한 줄 주변만 바꾸고 기존 변경을 되돌리거나 재배치하지 않는다.
- 건드리지 않는 파일: `src/background/*`, `src/messaging/protocol.ts`, `src/entrypoints/offscreen/*`, `src/ui/g2b-panel/*`, `src/ui/trackerbot/*`, `src/entrypoints/sidepanel/*`, `src/ui/components/index.ts`, eval 관련 전부(`EvalProbeSection`, `CompanyCard`, `core/evaluation/*`, `eval/*` 메시지, `ui/open`의 `'evaluation'` 분기), `MailPreparePage.tsx`(S4까지 보류).
- `entrypoints/sidepanel/*`나 `MailPreparePage.tsx`에서 import 금지(entrypoint 간 의존).
- 가운뎃점(·) 문자 사용 금지(코드 주석, 화면 문구 포함). 나열은 쉼표, 짝 개념은 슬래시.

## 1. 라우트

| URL | 의미 |
|---|---|
| `#/notices` | 목록(기존) |
| `#/notices/<encId>` | 상세, 기본 탭 overview |
| `#/notices/<encId>/<tab>` | 상세, 지정 탭. 모르는 tab은 overview |
| `#/notices/<encId>/<tab>?k=v` | 쿼리 허용(handoff 등) |
| `#/review/<encId>?handoff=a,b` | 별칭. `{page:'notice', tab:'review', query}`. 하위 호환 전용, 새 코드에서 생성 금지 |

`src/entrypoints/dashboard/route.ts` 변경(가산적):
```ts
export const NOTICE_TABS = ['overview', 'files', 'history', 'review'] as const;
export type NoticeTab = (typeof NOTICE_TABS)[number];
export type Route =
  | { page: 'grant' }
  | { page: 'notice'; noticeId: string; tab: NoticeTab; query: Record<string, string> }   // 기존 'review' 변형을 대체
  | { page: 'mail'; noticeId: string; query: Record<string, string> }
  | { page: 'template'; id: string }
  | { page: Page };
/** 상세 화면 해시. tab 생략 또는 'overview'면 `#/notices/<enc>` */
export function noticeHash(noticeId: string, tab?: NoticeTab): string;
```
parseRoute 규칙:
- `#/notices` 정확히 일치 → 목록(기존 처리 유지). `startsWith('#/notices/')` 분기를 목록 분기 앞에 둔다.
- `#/notices/<rest>`: 쿼리 분리 → path를 `/`로 split → `[0]` decodeURIComponent → id, `[1]`이 NOTICE_TABS에 있으면 tab, 없거나 비면 overview. id가 비면 home. decode 실패는 기존 관례대로 home.
- `#/review/<rest>`: 기존 분기 유지, 반환을 `{ page:'notice', noticeId, tab:'review', query }`로 바꾼다.

`App.tsx`:
- active 계산: `route.page === 'notice' || route.page === 'mail' ? 'notices'` (기존 `'review'` 대체)
- 렌더: `{route.page === 'notice' && <NoticeDetailPage key={route.noticeId} noticeId={route.noticeId} tab={route.tab} handoff={parseHandoffReasons(route.query.handoff)} />}`. key에 tab을 넣지 않는다.
- import `ReviewPage` → `NoticeDetailPage`(`./notice/NoticeDetailPage`).

진입 경로:
| 진입 | URL | 도착 탭 | 변경 |
|---|---|---|---|
| 공고 목록 행 클릭 `NoticesPage.tsx` open() | `noticeHash(id)` | overview | 변경 |
| 홈 행 클릭 `HomePage.tsx` | `noticeHash(id)` | overview | 변경 |
| SW `ui/open {page:'review'}`(패널 검수, 트래커봇, 사이드패널) | `#/review/<id>` | review(사전규격이면 overview) | 없음 |
| 자동 작성 검수 이관 `auto-compose.ts:143` | `#/review/<id>?handoff=` | review + 배너 | 없음 |
| 메일 화면 뒤로/확인 필요 링크 `MailPreparePage.tsx:227,518` | `noticeHash(id)`, `noticeHash(id,'review')` | | S4(보류) |

사전규격에 tab=review로 오면 URL은 두고 overview를 렌더, 탭바도 overview 활성(replaceState 안 함).

## 2. 화면

### 2.1 공통 헤더(컨테이너, 모든 탭)
- "공고 목록" 뒤로 링크(`#/notices`), 제목, 공고번호(사전규격은 `noticeLabel`), 배지: 사전규격 / 정정공고(`isCorrection`) / 수집 상태(collected 수집 완료 ok, partial 일부 누락 warn, failed 수집 실패 error, 목록과 같음), 발주기관, 마감일시 + D-day.
- 버튼: 원문 보기, 폴더 경로 복사, 메일 작성 준비/메일 초안 보기, 다시 추출(입찰공고만). 현 `ReviewPage.tsx` 139~165행 로직 그대로 이동.
- handoff 배너(현 166~173행)와 오류 InlineAlert는 헤더와 탭바 사이, 모든 탭에서 보임.
- 탭바(`TabBar`): `NoticesPage.tsx`의 필터 tablist 스타일을 복사(공용 컴포넌트로 뽑지 않음). 각 탭은 `<a role="tab" href={noticeHash(id, tab)} aria-selected>`. 라벨: 개요 / 첨부파일(count = 저장 수) / 수집과 메일 이력 / 평가정보 검토(count = 확인 필요 수, extraction 있을 때만). 사전규격이면 검토 탭 없음.

### 2.2 overview "개요"
입찰공고: `overviewGroups()` 그룹을 `Card` + `<dl>`(현 ReviewPage 179~185행 스타일)로.
1. 공고 개요: 공고번호, 차수, 공고일시(postedAt), 공고종류(noticeType), 발주기관, 수요기관, 정정공고 여부
2. 금액과 계약: 사업예산(budgetAmount), 추정가격(estimatedPrice), 사업기간, 계약방법, 낙찰자 결정방법(awardMethod), 가격 결정방식(priceMethod)
3. 일정: 참가등록 마감, 입찰 개시, 입찰 마감, 제안서 제출기간(proposalPeriod), 제안서 평가(proposalEvalAt), 개찰(openingAt)
4. 참가자격: 공동수급(허용/불허), 참가자격(eligibility, pre 줄바꿈 유지)
5. 평가 기준(공고정보 기준): evalMethod, differentialScoring, credibility/management/performanceScore, performancePeriod, performanceMinAmount, performanceCondition. description "공고정보에서 읽은 값입니다. 문서에서 추출한 값의 확인과 수정은 평가정보 검토 탭에서 합니다." 편집 UI 금지.
6. 기타 항목: customFields가 있을 때만, key를 라벨로.
행 mark: FieldValue.status needs_review → "확인 필요" 작은 배지, user_edited → "수정됨". null → '—'. 금액 formatAmountFull, 일시 formatDateTime. 점수/기간/차등 포맷은 기존 `ui/review/format`의 함수 재사용.
사전규격: 현 ReviewPage 119~131행 prespecRows를 그룹 "사전규격 정보" 하나로. relatedBidNo와 같은 noticeNo(kind bid)가 index에 있으면 그 행에 href(`noticeHash`).

### 2.3 files "첨부파일"
- 요약 줄: 전체, 저장, 실패(failed + size_mismatch), 건너뜀 수 + 첨부 폴더 경로 텍스트와 복사 버튼(`folderRelPath` + `/attachments`).
- 표 열: 번호(index+1) / 파일명(originalName, savedName이 다르면 아래 작은 글씨) / 종류(docKind 있으면 DOC_KIND_LABEL, 없으면 확장자 대문자) / 크기(savedSize ?? expectedSize, size_mismatch는 "저장 X / 예상 Y") / 상태 배지 / 시도 / 비고(lastError ?? note ?? '') / 동작.
- 상태: pending 대기 warn, downloading 받는 중 warn, saved 저장됨 ok, failed 실패 error, skipped 건너뜀 idle, size_mismatch 크기 불일치 error.
- 동작: openable(status saved 또는 size_mismatch, savedName 있음, 확장자 pdf/png/jpg/jpeg/gif/webp/txt)이면 "열기"(S3에서 연결, S2에서는 버튼 자리만 또는 생략). 아니면 비우고 행 title "브라우저에서 열 수 없는 형식입니다. 폴더 경로를 복사해 탐색기에서 여세요".
- 0개면 EmptyState "첨부파일이 없습니다".

### 2.4 history "수집과 메일 이력"
1. 수집: 상태 배지, 수집 시각, 마지막 잡 id(mono 작게), 오류 표(단계 라벨 / 코드 / 메시지 / 재시도 가능). 0개면 "오류 없음". 단계 라벨: fetch_basic 공고정보 조회, fetch_html 상세화면 읽기, download_attachments 첨부파일 다운로드, extract 평가정보 추출, render_mail 메일 본문 생성, open_compose 메일 창 열기, fill_fields 항목 입력, attach_files 첨부, verify 확인 (StepId 실제 값에 맞출 것).
2. 정정공고 연결(입찰공고만): isCorrection이면 "이 공고는 정정공고입니다". `relatedNotices()` 결과로 같은 공고번호 다른 차수 목록(차수, 제목, 수집일, 링크), 현재 공고 "현재" 표시, supersededBy 있으면 "이 공고를 대체한 공고" 링크. 없으면 "같은 공고번호의 다른 차수는 수집되지 않았습니다".
3. 메일: 상태 배지(none 초안 없음 idle, drafting 초안 작성됨 warn, ready_for_review 검토 대기 warn, delivered 전달 완료 ok), lastComposedAt, deliveredAt. `mail/draft-get` 결과가 있으면 준비 시각, 제목, 받는 사람 수, 참조 수, 첨부 수, 제외/건너뜀 수, 편집 시각. 버튼 → `#/mail/<id>`.
4. 이번 세션 작업: `useJobs()` 중 noticeId 일치 잡, 최신순. 열: 종류(collect 수집, extract 평가정보 추출, compose 메일 작성) / 상태(queued 대기, running 진행 중, cancelling 취소 중, completed 완료, partial 일부 실패, failed 실패, cancelled 취소됨, interrupted 중단됨) / 시작, 종료 / 오류 수와 첫 메시지 / 후속(handoff.action: compose 자동 작성, review 검수 이동, edit 편집 이동, ask 선택 대기, none 생략). description "브라우저를 다시 시작하면 사라지는 기록입니다". 비면 "이번 세션에 이 공고로 실행한 작업이 없습니다".

### 2.5 review "평가정보 검토"(입찰공고만)
현 ReviewPage 188~239행과 TextDrawer를 그대로 옮긴다. `Collapsible`은 ReviewTab 파일 안으로.

## 3. 파일

새 파일:
| 경로 | 역할 |
|---|---|
| `src/ui/notice-detail/view.ts` | 순수 함수. React/chrome/entrypoints import 금지(vitest node) |
| `src/entrypoints/dashboard/notice/NoticeDetailPage.tsx` | 컨테이너 `({ noticeId, tab, handoff })` |
| `src/entrypoints/dashboard/notice/TabBar.tsx` | `({ noticeId, tabs, active })` |
| `src/entrypoints/dashboard/notice/OverviewTab.tsx` | `({ notice, index })` |
| `src/entrypoints/dashboard/notice/FilesTab.tsx` | `({ notice, toast })` |
| `src/entrypoints/dashboard/notice/HistoryTab.tsx` | `({ notice, index, jobs })`, mail/draft-get 자체 호출 |
| `src/entrypoints/dashboard/notice/ReviewTab.tsx` | `({ noticeId, extraction, busy, running, onExtract, onEdit, toast })` |
| `src/entrypoints/dashboard/notice/open-attachment.ts` | S3 |
| `tests/ui/notice-detail-view.test.ts`, `tests/ui/dashboard-route.test.ts` | 테스트 |

수정: `route.ts`, `App.tsx`(import, active 계산, review 렌더 줄), `NoticesPage.tsx` open(), `HomePage.tsx` 행 클릭 해시. 삭제: `ReviewPage.tsx`(S2).

### view.ts 시그니처
```ts
export interface DetailRow { label: string; value: string; mark?: 'needs_review' | 'user_edited'; href?: string; pre?: boolean }
export interface DetailGroup { id: string; title: string; description?: string; rows: DetailRow[] }
export function overviewGroups(n: Notice, index: IndexEntry[]): DetailGroup[];
export const ATTACHMENT_STATUS: Record<AttachmentStatus, { label: string; tone: BadgeStatus }>;
export const VIEWABLE_EXT: ReadonlySet<string>;
export interface AttachmentRow { id: string; no: number; name: string; savedName: string | null; kind: string; size: string; status: AttachmentStatus; attempts: number; remark: string; openable: boolean }
export function attachmentRows(n: Notice): AttachmentRow[];
export function attachmentSummary(n: Notice): { total: number; saved: number; failed: number; skipped: number };
export function formatBytes(n: number | null | undefined): string;   // 값 없으면 '—'
export function folderRelPath(folder: string): string;   // 현 ReviewPage 88~89행 규칙 이동
export function attachmentPath(folder: string, savedName: string): string[];   // normalizePath(folder) 세그먼트 + 'attachments' + savedName. savedName에 '/', '\\', '..' 있으면 throw
export interface RelatedNotice { noticeId: string; round: string; title: string; collectedAt: string; current: boolean }
export function relatedNotices(n: Notice, index: IndexEntry[]): { rounds: RelatedNotice[]; supersededBy?: string };   // 같은 kind, 같은 noticeNo, round 오름차순
export const MAIL_STATUS: Record<MailStatus, { label: string; tone: BadgeStatus }>;
export interface MailSummary { status: MailStatus; lastComposedAt: string | null; deliveredAt: string | null; draft: { preparedAt: string; subject: string; to: number; cc: number; attachments: number; skipped: number; editedAt: string | null } | null }
export function mailSummary(n: Notice, draft: MailDraft | null): MailSummary;
export const STEP_LABEL: Record<StepId, string>;
export const JOB_STATUS_LABEL: Record<JobStatus, string>;
export interface SessionJobRow { id: string; type: string; status: string; startedAt: string; endedAt: string; errorCount: number; firstError: string; handoff: string }
export function sessionJobRows(jobs: Job[], noticeId: string): SessionJobRow[];
export function detailTabs(n: Notice, extraction: Extraction | null): Array<{ id: NoticeTab; label: string; count?: number }>;
export function effectiveTab(tab: NoticeTab, n: Notice): NoticeTab;   // prespec + review → overview
```
허용 import: `core/types/*`, `core/model/*`(format, ids, path), `ui/review/format`, `ui/review/view`, StatusBadge 타입, route.ts의 NoticeTab 타입(타입 전용 import).

### 컨테이너 데이터 흐름
- 로드: `notice/get`과 `notice/list`를 Promise.all. list 실패는 index `[]`로 진행.
- `useJobs()`는 컨테이너에서 한 번. running 계산과 잡 종료 시 재조회(현 53~57행) 그대로. jobs는 HistoryTab에 props.
- extract, edit, copyPath, toast는 컨테이너 소유. edit 성공 시 setData.
- 로딩/없음 분기(현 103~108행) 유지.
- 탭 상태를 useState로 두지 않는다. useEffect 의존성은 noticeId뿐(탭 전환 시 재조회 없음).

## 4. 첨부 열기(S3)
```ts
export type OpenError = { code: 'NEEDS_FS_PERMISSION' | 'NOT_FOUND' | 'NO_ROOT' | 'UNKNOWN'; message: string };
export async function openAttachment(folder: string, savedName: string): Promise<void>;
```
`loadRootRecord()` → 없으면 NO_ROOT. `queryPermission({mode:'read'})`가 granted 아니면 NEEDS_FS_PERMISSION(requestPermission 호출 금지, FilesTab이 FsErrorAlert로 처리). `attachmentPath()` 세그먼트로 getDirectoryHandle(create 없음) → getFileHandle → getFile → createObjectURL. 클릭 핸들러 시작에서 `window.open('', '_blank')`를 동기로 먼저 열고 성공 시 location 설정, 실패 시 close. NotFoundError → NOT_FOUND(toast "파일이 폴더에 없습니다. 다시 수집해 주세요"), NotAllowedError/SecurityError → NEEDS_FS_PERMISSION. revoke 안 함. 쓰기 API 금지.
blob URL 새 탭 PDF 표시는 추정. 안 되면 `<a download={savedName}>` 복사본 내려받기로 바꾸고 문구 "내려받기(복사본)", 보고.

## 5. 단계
- S1(implementer): view.ts, route.ts, 테스트 2개. 테스트 항목은 아래.
- S2(같은 implementer 이어서): notice/ 화면 파일, App.tsx, NoticesPage, HomePage, ReviewPage 삭제. 로직은 이동만. 완료: tsc, vitest, 빌드 통과.
- 리뷰: S2 뒤 code-reviewer 1회. 불변: ReviewPage 동작 동일, 메시지 추가 없음, eval 파일 무변경, 탭 전환 무재조회.
- S3: open-attachment.ts, FilesTab 연결.
- S4(보류): MailPreparePage 227, 518행 링크 정리. 다른 세션 커밋 뒤.

테스트 항목:
- parseRoute: `#/notices/<enc>` → overview, `/files` → files, 모르는 탭 → overview, `/review?handoff=needs_review` → review + query, `#/review/<enc>?handoff=a,b` → notice/review/query, `#/notices` → 목록, 잘못된 인코딩 → home. noticeHash(id)와 noticeHash(id,'overview') 둘 다 탭 세그먼트 없음, 특수문자 id 왕복.
- overviewGroups: bid에 일정 그룹 있음/prespec 없음, needs_review mark, null → '—', customFields 비면 그룹 없음, prespec relatedBidNo가 index에 있으면 href.
- attachmentRows/Summary: size_mismatch 두 크기, openable은 saved+pdf만(hwp false, failed pdf false), 요약 수.
- attachmentPath: 선행 `notices/` 처리, `..`/`/` 포함 throw. folderRelPath: 백슬래시 치환, `notices/` 중복 없음.
- relatedNotices: 같은 noticeNo 다른 차수 정렬, 자기 자신 current, 다른 kind 제외, supersededBy 전달.
- mailSummary: draft null/있음. sessionJobRows: 다른 공고 제외, 내림차순, 라벨. detailTabs/effectiveTab: prespec에 review 없음.

## 6. 하지 말 것
- `#/review/` 분기 삭제, router.ts/auto-compose.ts 수정.
- 탭을 React state로, `key={noticeId + tab}`.
- view.ts에 React/chrome import.
- 개요의 평가 기준 그룹에 편집 UI(`evaluation` 공고정보와 `extraction.items` 문서 추출은 다른 데이터).
- NoticesPage 필터 탭을 공용 컴포넌트로 추출.
