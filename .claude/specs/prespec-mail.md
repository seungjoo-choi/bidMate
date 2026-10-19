# 사전규격(bfSpecRegNo) 수집 + 메일 발송

작성 2026-10-19. 설계 Fable(사용자 승인). 결정 기록은 `decisions.md` "2026-10-19, 사전규격 수집과 메일 발송".

## 목표
트래커봇 메일의 사전규격 표 각 행에 [사전규격 수집] 버튼을 만들고, 입찰정보와 같은 흐름(나라장터 OpenAPI로 상세 + 규격서 첨부 수집 → 메일 작성 화면에 자동 입력 → 발송)을 사전규격 전용 템플릿으로 수행한다. 발주계획(`oderPlanNo`)은 범위 밖이지만 같은 방식으로 붙일 수 있게 한다.

## 공통 규칙 (모든 단계)
- `NoticeKind = 'bid' | 'prespec' | 'orderplan'`. orderplan은 유니언 예약만, 어떤 collectible 집합에도 넣지 않는다.
- 정규형은 "kind 없음 = bid". bid ref/템플릿/인덱스 엔트리에 `kind: 'bid'`를 명시적으로 쓰지 않는다. 비교는 항상 `kindOf()`.
- 사전규격 noticeId = 등록번호 그대로(`R26BD00273952`). 접두사/접미사 금지. `normalizeNoticeKey`의 문자열 분기는 수정하지 않는다.
- 변수 별칭(같은 fieldKey에 변수 이름 2개) 금지. `VARIABLE_BY_KEY`가 Map이라 덮어쓴다.
- 사전규격 OpenAPI의 엔드포인트/파라미터/필드명은 **추정**이다. 코드 주석과 테스트에 "추정"을 남기고 확정 표기하지 않는다.
- 사전규격에는 평가정보 추출(extract)을 돌리지 않는다.
- `resolveRef`(openapi.ts, 나라장터 CS용)는 bid만 유지.
- 템플릿 `kind` 수정 UI 금지(생성 시에만 지정).
- `loadTemplates`는 읽기 중 파일에 쓰지 않는다(내장 사전규격 템플릿은 반환 목록에만 보충, 다음 save 때 저장).
- 범위 밖 구조 변경(스키마·공개 인터페이스 추가 변경, 권한, host_permissions)이 필요해지면 중단하고 보고.

## 인터페이스

```ts
// src/core/types/notice.ts
export type NoticeKind = 'bid' | 'prespec' | 'orderplan';
export const COLLECTIBLE_NOTICE_KINDS: ReadonlySet<NoticeKind> = new Set(['bid', 'prespec']);
export interface NoticeRef { kind?: NoticeKind; noticeNo: string; round?: string; detailUrl?: string; origin: ... } // 기존 필드 유지 + kind?
export interface NoticePrespec {
  specRegNo: FieldValue<string>; specName: FieldValue<string>; bizDivision: FieldValue<string>;
  assignedBudget: FieldValue<number>; registeredAt: FieldValue<ISODate>; opinionCloseAt: FieldValue<ISODate>;
  officerName: FieldValue<string>; officerTel: FieldValue<string>; relatedBidNo: FieldValue<string>;
}
// NoticeFieldKey에 keyof NoticePrespec 추가, Notice에 prespec: NoticePrespec (schemaVersion 1 유지)

// src/core/model/ids.ts
export const kindOf = (r: { kind?: NoticeKind } | undefined): NoticeKind => r?.kind ?? 'bid';
export function noticeIdOf(ref: { kind?: NoticeKind; noticeNo: string; round?: string }): string;
//   bid -> 기존 noticeId(noticeNo, round) / prespec, orderplan -> noticeNo
export function noticeLabel(e: { kind?: NoticeKind; noticeNo: string; round?: string }): string;
//   bid -> `${noticeNo}-${round}` 형식(기존 표시와 동일) / 그 외 noticeNo
// 기존 noticeId 함수는 유지

// src/core/types/template.ts
export interface Template { ...; kind?: NoticeKind }   // 없음 = bid

// src/core/templates/variables.ts
export interface VariableDef { ...기존; group: '기본' | '일정' | '평가' | '사전규격' | '기타'; kinds: NoticeKind[] }
export function variablesFor(kind: NoticeKind): VariableDef[];

// src/core/types/settings.ts
AutoComposeSettings.prespecTemplateId?: string   // 없으면 사전규격 기본 템플릿

// src/adapters/g2b/source.ts (S2)
export interface NoticeSource {
  kind: NoticeKind;
  fetch(ref: NoticeRef, ctx: G2bContext): Promise<FetchResult>;
  idOf(ref: NoticeRef, item: ApiItem): string;
  refOf(ref: NoticeRef, item: ApiItem): NoticeRef;
  mapFields(item: ApiItem, fetchedAt: string): FieldMap;
  attachments(item: ApiItem): NewAttachment[];
  sourceUrl(item: ApiItem, ref: NoticeRef, fetchedAt: string): FieldValue<string>;
  isCorrection(item: ApiItem): boolean;
  extract: boolean;
  acceptsHtml: boolean;
}
export function sourceFor(kind: NoticeKind): NoticeSource; // orderplan이면 KIND_UNSUPPORTED
```

## 단계

### S0. 사용자 실측 (2026-10-19 결과)
1. 활용신청/필드명 사전 확인: 생략(사용자 결정). 추정값으로 진행하고, 설정의 [사전규격 API 테스트]와 첫 수집 raw(`source/api-*.json`)로 S5에서 확정. 키 미등록 오류가 나면 그때 활용신청.
2. 트래커봇 메일 사전규격 표 머리글: `사업명 | 기관명 | 사업구분 | 링크`(사업구분 값 예: 물품, 일반용역). 기존 `TITLE_HEADERS`의 '사업명'으로 인식됨.
3. 규격서 첨부: 나라장터는 로그인 없이 받을 수 있음(사용자 확인).

### S1. 코어 타입/식별자/템플릿 레지스트리 (의존 없음)
- `src/core/types/notice.ts`: 위 인터페이스.
- `src/core/model/ids.ts`: `kindOf`, `noticeIdOf`, `noticeLabel`.
- `src/core/model/notice-fields.ts`: `PRESPEC_KEYS`, `ALL_FIELD_KEYS`에 포함, `groupOf`가 prespec 처리, `emptyNotice`가 `prespec`을 전부 missing으로 채움, `fillMissingFields`가 `n.prespec`이 없으면 만들고 채움(옛 notice.json 호환).
- `src/core/model/job-conflict.ts`: `NoticeKey.kind?`(객체 입력일 때만 채움, 문자열 입력은 생략). `refsConflict(a,b)`: `kindOf(a) !== kindOf(b)`면 false, 그 외 기존. `jobsConflict`: 두 키 모두 kind가 있고 다르면 false, 그 외 기존.
- `src/core/types/index-file.ts`: `IndexEntry.kind?: NoticeKind`.
- `src/engine/notices/notice-store.ts` `entryOf`: `kind`는 `n.ref.kind`가 bid가 아닐 때만 넣음. `bidCloseAt`은 prespec이면 `n.prespec.opinionCloseAt.value ?? undefined`(의도된 재사용, 주석 남김), 그 외 기존.
- `src/engine/notices/lookup.ts`: `kindOf(entry) === kindOf(ref)` 필터 추가.
- `src/core/types/template.ts`: `Template.kind?`.
- `src/core/templates/variables.ts`: `kinds` 필드, group '사전규격', `variablesFor`. 사전규격 변수(전부 `kinds: ['prespec']`, group '사전규격'):
  `{사전규격등록번호}` specRegNo text / `{사전규격명}` specName text / `{업무구분}` bizDivision text / `{배정예산}` assignedBudget amount / `{공개일시}` registeredAt datetime / `{의견등록마감일시}` opinionCloseAt datetime / `{담당자}` officerName text / `{담당자연락처}` officerTel text / `{연계입찰공고번호}` relatedBidNo text.
  공용(`kinds: ['bid','prespec']`): `{발주기관}`, `{수요기관}`, `{공고URL}`, `{첨부파일목록}`, `{첨부파일수}`, `{수집일시}`, `{오늘}`(레지스트리에 있는 이름 기준). 나머지 기존 변수는 `kinds: ['bid']`.
- `src/core/templates/values.ts`: `ALL_FIELD_KEYS` 기반이면 수정 불필요, 확인만.
- `src/core/templates/normalize.ts`: `kind`가 NoticeKind 값이고 'bid'가 아닐 때만 보존, 그 외 생략.
- `src/core/templates/default-template.ts`: `TEMPLATE_PRESPEC_DEFAULT_ID = 'tpl_prespec_default'`, `builtinPrespecTemplate(now)`: kind prespec, subject `[사전규격 공유] {사전규격명}`, greeting `안녕하세요.\n아래 사전규격을 공유드립니다.`, closing 기존 내장과 동일, layout list. 섹션: 기관명(inline `{발주기관}`) / 사업명(inline `{사전규격명}`) / 사전규격 정보: `{사전규격등록번호}`, `{업무구분}`, `{공개일시}`, 의견등록마감일시(기존 내장 템플릿의 강조 서식과 동일하게), text `{배정예산}` 라벨 '배정예산', text 라벨 '담당자' 값 `{담당자} ({담당자연락처})` / 제안부서(기존 내장과 동일) / 관련 자료: `{공고URL}` 라벨 '나라장터 사전규격 URL', `{첨부파일목록}` 라벨 '규격서 목록'. 섹션 구조 표현은 기존 `builtin` 템플릿 작성 방식을 따른다.
- `src/core/templates/sample-notice.ts`: `samplePrespecNotice()`(ref.kind prespec, prespec 필드 verified, basic 표시 필드도 채움, 첨부 2개 '규격서.hwp', '과업내용서(안).pdf').
- `src/core/types/settings.ts`: `AutoComposeSettings.prespecTemplateId?`.
- `src/messaging/protocol.ts`: `notice/lookup`, `notice/lookup-batch`, `job/latest-for-tab` payload에 `kind?: NoticeKind`. `g2b/test` payload `{ serviceKey?: string; kind?: NoticeKind }`.
- 테스트: `tests/core/job-conflict.test.ts`(kind 다르면 비충돌, 한쪽 kind 없음은 기존 규칙, prespec ref vs 번호만인 noticeId 문자열 충돌), `tests/engine/notice-lookup.test.ts`(kind 필터, kind 없는 옛 엔트리 = bid), `tests/core/template-normalize.test.ts`(kind 보존/생략), `tests/core/render-template.test.ts`(사전규격 변수 치환, bid 공고에서 사전규격 변수는 기존 미확인 표시), ids 테스트(noticeIdOf 3종, noticeLabel), notice-fields(옛 notice에 prespec 보충). 기존 테스트 파일이 없으면 기존 테스트 관례에 맞춰 새로 만든다.

### S2. 어댑터 + 엔진 (S1 의존, 매핑은 S0 결과로 확정)
- `src/adapters/g2b/openapi.ts`: operation 루프 안 fetch+타임아웃+취소 합성을 `fetchJsonOp(url, operation, ctx)`로 추출, `fetchNotice`는 이를 사용(동작 불변).
- `src/adapters/g2b/prespec-api.ts`(신규): `PRESPEC_API_BASE`, `PRESPEC_OPERATIONS`, `PRESPEC_MAP`(단일 상수 표), `fetchPrespec(regNo, ctx)`, `mapPrespecItem(item, fetchedAt)`(ALL_FIELD_KEYS missing 초기화 후 채움, basic 표시 필드 중복 채움: noticeNo←specRegNo, title←specName, orderingOrg, demandOrg, postedAt←registeredAt, budgetAmount←assignedBudget(note '배정예산')), `listPrespecAttachments(item)`. 같은 번호 항목이 여러 개면 rcptDt 최신.
  - 추정값: base `https://apis.data.go.kr/1230000/ao/HrcspSsstndrdInfoService/`, operation 순차 `getPublicPrcureThngInfoServc`/`Thng`/`Cnstwk`/`Frgcpt`, 파라미터 `serviceKey, pageNo=1, numOfRows=10, type=json, inqryDiv=2, bfSpecRgstNo`.
  - 추정 매핑: specRegNo `bfSpecRgstNo` / specName `prdctClsfcNoNm`(미확인) / bizDivision `bsnsDivNm` / orderingOrg `orderInsttNm` / demandOrg `rlDminsttNm` / assignedBudget `asignBdgtAmt` / registeredAt `rcptDt` / opinionCloseAt `opninRgstClseDt` / officerName `ofclNm` / officerTel `ofclTelNo` / relatedBidNo `bidNtceNo` / 첨부 `specDocFileUrl1..N`·`specDocFileNm1..N` / sourceUrl은 `ref.detailUrl`(kind 'derived').
  - 오류 코드는 bid와 공유. 0건이면 `G2B_NOT_FOUND`("사전규격을 찾지 못했습니다: R…").
- `src/adapters/g2b/source.ts`(신규): `bidSource`(기존 openapi 함수 감싸기, 동작 불변), `prespecSource`(isCorrection false, extract false, acceptsHtml false), `sourceFor`.
- `src/engine/jobs/collect-job.ts`: fetch_basic 블록을 `sourceFor(kindOf(ref))` 사용으로 교체. html 레이어는 `src.acceptsHtml`일 때만(재시도 경로 포함). extract는 `!deps.extract || !src.extract`면 skipped(라벨 '평가정보 추출 대상 아님').
- `src/engine/jobs/extract-job.ts`: `kindOf(notice.ref) !== 'bid'`면 `EXTRACT_NOT_APPLICABLE` 실패(재시도 불가).
- `src/engine/config/templates-api.ts`: isDefault 종류별 하나(로드 시 종류별 첫 isDefault만 유지, 없으면 그 종류 첫 항목), 저장된 사전규격 템플릿 0개면 내장 사전규격을 반환 목록에 보충, `setDefaultTemplate` 같은 종류 안에서만, LAST_TEMPLATE 종류별, 기본 삭제 시 같은 종류 첫 항목 승격, `validateInput` kind 검증, 수정 저장 시 저장된 kind 유지.
- `src/engine/mail/prepare.ts`: 템플릿 결정 = payload templateId → `notice.mail.templateId` → 공고 종류 기본 → 그 종류 첫 항목. 종류 불일치면 `draft.warnings`에 "템플릿 종류(입찰공고)가 공고 종류(사전규격)와 다릅니다"(종류명은 실제 값).
- `src/background/auto-compose.ts`: `paramsOf(settings, kind)` — prespec이면 `prespecTemplateId`. `pumpInner`에서 `kindOf(head.ref)`.
- `src/entrypoints/offscreen/main.ts`: `g2bTest(serviceKey, kind)` — prespec이면 `fetchPrespec('R26BD00273952', …)`, title은 specName.
- `src/entrypoints/dashboard/auto-compose-logic.ts`: `findBroken/sanitizeForSave`에 `prespecTemplateId`.
- 테스트: `tests/g2b/prespec-api.test.ts`(합성 JSON → 매핑, 0건, 키 오류, 첨부), collect-job(prespec: id=번호, 필드 채움, extract skipped, html 무시, 폴더 `notices/<연도>/<번호>_<제목>`, bid 기존 테스트 무수정 통과), templates-api, mail-prepare, auto-compose, extract-job 거부.

### S3. 트래커봇 CS + SW (S1 의존, S2와 병렬 가능)
- `src/adapters/g2b/link.ts`: `COLLECTIBLE_KINDS = {'bid','prespec'}`. `linkToNoticeRef`: bid 기존 그대로(kind 생략), prespec `{ kind:'prespec', noticeNo: id, detailUrl: url, origin }`, orderplan null.
- `src/adapters/trackerbot/mail-scan.ts`: 변경 없음(머리글 '사업명' 확인됨).
- `src/ui/trackerbot/controller.ts`: `keyOfRef` → `noticeIdOf`, lookup/lookup-batch payload에 `kind`, restore 키 계산도 같은 함수.
- `src/ui/trackerbot/row-view.ts`: idle이고 panelView 라벨이 '공고 수집'이며 `kindOf(entry.ref) === 'prespec'`이면 라벨 '사전규격 수집'. 그 외 문구 공용.
- `src/background/job-coordinator.ts`: `makeNoticeId(req.ref!.noticeNo, req.ref!.round)` → `noticeIdOf(req.ref!)`. `req.ref.kind`가 `COLLECTIBLE_NOTICE_KINDS`에 없으면 `INVALID_REQUEST`.
- offscreen lookup 핸들러가 ref의 kind를 `lookupInIndex`에 그대로 넘기는지 확인.
- `src/background/router.ts:30`: `g2b/test` 전달 시 payload의 `kind`도 넘긴다(S2에서 offscreen은 kind를 받도록 됨).
- 테스트: link(prespec ref, orderplan null, bid kind 없음), trackerbot-scan(사전규격 표 `사업명|기관명|사업구분|링크` 픽스처에서 앵커 포함·제목 추출, 발주계획 제외), trackerbot-controller(prespec 행 job/start payload `ref.kind='prespec'`, round 없음, 키=번호, lookup payload kind), trackerbot-row-view(라벨), job-coordinator(prespec noticeId=번호, orderplan INVALID_REQUEST).

### S4. 대시보드 (S1 의존, 보이는 모양은 메인 판단)
- **먼저(S2 리뷰 Major)**: `MailPreparePage.tsx:62`의 `templates.find((t) => t.isDefault)`가 종류를 보지 않아 사전규격 공고에서 bid 기본이 선택되어 77행 `mail/prepare`·178행 ComposeCard params로 넘어간다. `kindOf(t) === kindOf(notice.ref)`인 기본 → 그 종류 첫 항목 순으로 고친다.
- AutoComposeCard: `findBroken`의 `prespecTemplateMissing`(S2에서 추가)을 끊어짐 배지에 연결.
- NoticesPage/HomePage: `noticeLabel` + prespec '사전규격' 배지, 열 '입찰마감' → '마감'.
- ReviewPage: 머리글 noticeLabel·배지, prespec이면 평가정보 카드/다시 추출 숨기고 "사전규격 정보" 카드(9개 필드 + 발주/수요기관), closeAt = opinionCloseAt.
- MailPreparePage: 템플릿 Select는 같은 종류 우선, 다른 종류는 구분선 아래 선택 가능. 기본 선택은 prepareMail 규칙.
- TemplatesPage/TemplateEditor: 종류 배지, 새 템플릿·기본 양식 생성 시 종류 선택, 복제 시 kind 전달, 미리보기 표본 kind별, 변수 팔레트·자동완성 kind 필터(`matchVariables(query, kind)`), GROUPS에 '사전규격'(항목 없는 그룹 숨김).
- AutoComposeCard: "사전규격 템플릿" Select + 끊어짐 배지. G2bCard: 활용신청 안내 + [사전규격 API 테스트].

### S5. 실측 확정과 문서
- `PRESPEC_MAP`/operation/파라미터를 실제 응답으로 고정, 첫 수집의 `source/api-<operation>.json`을 `tests/fixtures/g2b-prespec-<번호>.json`으로 저장, S2 테스트를 픽스처로 교체.
- 첨부 호스트가 g2b 밖이면 `wxt.config.ts host_permissions` 추가(격상 보고 후).
- `trackerbot-mail.md` 13/27/221행, `architecture.md`에 NoticeSource 한 줄.

## 수동 검증 (사용자)
1. 설정 [사전규격 API 테스트] → ok와 제목.
2. 트래커봇 메일: 사전규격 행에 [사전규격 수집], 발주계획 행 없음, 입찰정보 행 기존대로.
3. 클릭 → 완료, `notices/<연도>/<등록번호>_<제목>`에 규격서, `source/api-*.json`.
4. 공고 목록 '사전규격' 배지, 마감 열 의견등록마감.
5. 메일 준비 기본 템플릿 = 사전규격, 입찰공고 템플릿 선택 시 경고.
6. 자동 작성 → 작성 창에 `[사전규격 공유] …`와 규격서 첨부.
7. 미공개 사전규격 → 첨부 0개 완료.
