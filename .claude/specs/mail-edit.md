# 수집 후 대시보드 경유와 공고별 메일 편집

설계: fable-advisor(2026-10-19), 사용자 승인. 결정 기록은 `.claude/specs/decisions.md` "2026-10-19, 공고별 메일 편집과 수집 후 동작 선택" 절.

## 목표
1. 대시보드 메일 준비 화면(`#/mail/<noticeId>`)에서 공고별로 메일 내용을 편집한다: 템플릿 항목 값(예: 제안PM `txt_pm`), 섹션/항목 추가 삭제, 받는 사람/참조 추가 삭제(등록 안 된 이메일 직접 입력 허용), 제목 수정, 첨부 제외. 편집은 공고별로만 저장하고 다음 공고로 이어지지 않는다.
2. 수집 완료 후 동작을 "대시보드 경유(편집 화면 열기)" / "바로 작성"에서 고른다. 설정(자동 작성 카드)에서 기본값, 트래커봇 우측 하단 진행 팝업에서 이번 건만 변경.
3. compose 잡은 편집 반영된 초안을 그대로 쓴다(네이버웍스 셀렉터가 verified되면 자동 입력, 그 전엔 기존 수동 모드).

범위 밖: 네이버웍스 composePath/셀렉터 실측(compose-flow.md S6), 나라장터 플로팅 패널(g2b-panel)의 선택 UI.

## 사용자 결정
- `afterCollect` 기본값 `'compose'`(기존 동작 유지, 사용자가 설정에서 바꿈).
- 등록 안 된 이메일 직접 입력 허용(`isValidEmail` 통과분만).
- 대시보드 경유 모드에서는 이미 작성/전달한 공고를 재수집해도 대시보드를 연다(already_composed 생략은 compose 경로에만).
- 편집값은 공고별 저장만.

## 1. 데이터

```ts
// src/core/types/mail.ts
export interface MailEdits {
  schemaVersion: 1;
  noticeId: string;
  updatedAt: ISODate;
  /** 복사 원본. 변경 감지/안내용 */
  base: { templateId: string; templateName: string; updatedAt: ISODate };
  /** 이 공고 전용 양식. id는 base.templateId와 같다(템플릿 목록에 저장/노출하지 않음) */
  template: Template;
  /** 있으면 그룹 해석 대신 이 목록을 그대로 쓴다 */
  recipients?: { to: string[]; cc: string[] };
  /** 초안에서 빼는 첨부 id(`${noticeId}:a${index}`). 모르는 id는 무시 */
  excludedAttachmentIds: string[];
}
// MailDraft 추가(schemaVersion 1 유지, 선택 필드):
//   recipientSource?: 'group' | 'custom' | 'edited'
//   excludedAttachments?: Array<{ attachmentId: string; name: string }>
//   edited?: { at: ISODate }
```

- 파일: `notices/<folder>/mail-edits.json`. `mail-draft.json`(렌더 결과)과 분리. 쓰기는 항상 `mail/prepare { edits }` 경로(offscreen prepareMail)로만.
- 필드 항목 값 고치기 = 그 항목을 `kind:'text'` 항목으로 전환(현재 해석 값을 text로 복사). 템플릿 모델에 새 종류/override 필드 추가 금지.
- 제목 수정 = 복사본 `template.subject` 수정.

### 충돌 규칙
| 상황 | 규칙 |
|---|---|
| 편집 파일이 있고 `prepareMail`에 다른 `templateId`가 옴 | 편집 파일 우선, `warnings`에 "이 공고 전용 양식(템플릿 '<base.templateName>' 기준)을 사용했습니다. 요청한 템플릿은 적용하지 않았습니다" |
| 화면에서 템플릿 Select 변경 | 확인 대화 → `mail/prepare { edits: null, templateId }` → 편집 파일 삭제, 새 템플릿으로 재생성 |
| 원본 템플릿 수정됨(`updatedAt` 다름) | 자동 반영 안 함. warning "원본 템플릿이 변경되었습니다. 이 공고 양식은 저장 당시 복사본입니다" + 화면 배너 [원본 양식으로 초기화] |
| 원본 템플릿 삭제 | 복사본으로 계속 동작, warning "원본 템플릿이 삭제되었습니다" |
| 같은 noticeId 재수집 | 편집 유지, 새 공고 데이터로 재렌더 |
| 편집 파일 손상 | 없는 것으로 보고 warning "편집 파일이 손상되어 무시했습니다", 삭제하지 않음 |
| 덮어쓴 수신자가 0명 | `NO_RECIPIENTS` |
| edits.noticeId 불일치 | `INVALID_VALUE` |

## 2. 수집 후 분기

```ts
// src/core/types/settings.ts
export type AfterCollect = 'dashboard' | 'compose';
// AutoComposeSettings에 afterCollect: AfterCollect 추가 (기본 'compose'). enabled는 그대로 유지
// src/core/types/job.ts
// Handoff에 { action: 'edit'; opened: boolean; at: ISODate } 추가
// Job에 afterCollect?: AfterCollect  (collect만: 시작 시 SW가 스냅샷, 팝업에서 이번 건만 변경)
```

- collect 잡 생성 시 SW가 `settings.autoCompose.enabled ? afterCollect : undefined`를 Job에 기록. 재시도(`retryOf`)는 이전 잡 값 승계. `undefined`면 팝업 선택 UI 없음(자동 작성 꺼짐). `undefined`를 'dashboard'로 추정 금지.
- `decideHandoff`(src/core/model/handoff.ts): 기존 순서 유지(review 우선). 마지막 "그 외 completed → compose"를 `(job.afterCollect ?? s.afterCollect) === 'dashboard'`면 `edit`, 아니면 `compose`로. `already_composed` 생략은 compose 경로만. edit는 웹메일 권한 검사 없음.
- edit 처리(auto-compose.ts handleCollect): `openDashboard('#/mail/<encodeURIComponent(noticeId)>?from=collect', {nearTabId})` → `setHandoff({action:'edit', opened, at})`. compose 경로(권한, 큐, pump) 타지 않음.
- 메시지 `auto-compose/choose { collectJobId, afterCollect } → { applied: boolean }`: 발신자 검사는 `auto-compose/dequeue`와 동일. 대상이 collect이고 ACTIVE일 때만 적용(putJob + notifyUpdate), 아니면 `applied:false`. compose를 시작하지 않는다.
- 수집 중 설정 변경 → 잡 스냅샷 우선. enabled가 false가 되면 기존 `disabled` 판정.

### 표시 매핑 (handoff edit)
| 위치 | 표시 |
|---|---|
| `handoffView` | kind `'edit'`, text "대시보드에서 메일 내용을 확인한 뒤 작성하세요", tone info, action `open-mail`, actionLabel '편집' |
| `rowView` | done ok '수집 완료' + 보조 버튼 [편집](open-mail) |
| progress 팝업 종결 | rowView 위임(ok, 8초 자동 소멸) |

## 3. 메시지 프로토콜 (src/messaging/protocol.ts)
- `mail/prepare` payload에 `edits?: MailEdits | null` (null=편집 파일 삭제, 객체=검증 후 저장, 없음=기존 파일 사용).
- `{ type: 'mail/edits-get'; payload: { noticeId: string }; response: MailEdits | null }`
- `{ type: 'auto-compose/choose'; payload: { collectJobId: string; afterCollect: AfterCollect }; response: { applied: boolean } }`
- `mail/edits-get`은 router.ts `EXTENSION_ONLY_TYPES`에 포함(mail/prepare 기존 처리 확인).

## 4. 단계

의존: S1 → (S2, S3, S4 병렬) → S5. 공통 금지: 가운뎃점 문자 금지, 새 npm 패키지 금지, `renderMail`에 편집 인자 추가 금지, 복사본 템플릿을 templates.json에 저장 금지, `MailEdits.template.id` 변경 금지, `editLockKey` 락 중첩 금지.

### S1. 코어 타입과 순수 함수
- 위 1·2·3의 타입/프로토콜 추가. `src/core/model/default-settings.ts` 기본 `afterCollect: 'compose'`(얕은 병합으로 옛 저장본 호환 확인).
- `src/core/mail/edits.ts`(신규, 순수):
  - `editsPath(folder)` → `${folder}/mail-edits.json`
  - `createMailEdits(noticeId, template, now)`: structuredClone, base={id,name,updatedAt}, excludedAttachmentIds []
  - `normalizeMailEdits(raw, now): MailEdits | null`: schemaVersion 1, noticeId 문자열, base 객체, template은 기존 `normalizeTemplate` 재사용, recipients 문자열 배열만, excludedAttachmentIds 문자열 배열
  - `editsStaleness(e, current?: Template): 'missing' | 'changed' | null`
  - `fieldItemToText(item, notice, now): TemplateTextItem`: id `newId('txt')`, text=기존 값 해석 함수 결과 텍스트, label/visible/style 유지
  - `dedupeEmails({to,cc})`: normalizeEmail, 빈 값 제거, TO 우선, 순서 유지
- `handoff.ts` Verdict에 `{ kind: 'edit' }`와 위 분기.
- 테스트: `tests/core/mail-edits.test.ts`(깊은 복사, 손상/타입 불일치 null, staleness 3종, fieldItemToText 값과 style 유지, dedupe TO 우선/대소문자/공백), handoff 테스트에 4케이스(job 스냅샷 우선, 설정 폴백, edit는 mailStatus 무시, compose는 기존 skip), default-settings 기본값/병합.
- 완료: `tsc --noEmit`, 관련 테스트 통과.

### S2. 엔진
- `src/engine/mail/prepare.ts` prepareMail, 락 안 순서:
  1. isBusy, notice 로드(기존)
  2. `p.edits === null` → store.remove(editsPath)(없으면 무시) / 객체 → normalizeMailEdits 검증(noticeId 불일치 INVALID_VALUE) 후 writeJson
  3. edits 로드(손상이면 null + warning)
  4. 템플릿: edits 있으면 `edits.template`, 충돌 표 warning들. 없으면 기존 규칙
  5. 수신자: edits.recipients 있으면 dedupeEmails, 0명 NO_RECIPIENTS, recipientSource 'edited', 그룹 미사용. 없으면 기존 규칙
  6. 첨부: excludedAttachmentIds에 있는 saved 첨부는 attachments에서 빼고 `draft.excludedAttachments`에 기록(skippedAttachments에 섞지 않음)
  7. edits 있으면 `draft.edited = { at: edits.updatedAt }`. draft 저장, notice.mail 갱신(templateId = tpl.id)
- `export async function getEdits(store, noticeId): Promise<MailEdits | null>`(getDraft 패턴).
- `src/entrypoints/offscreen/main.ts`: `mail/edits-get` listen. `src/background/router.ts`: 중계/EXTENSION_ONLY에 추가(기존 mail/* 방식).
- compose-job 변경 없음.
- 테스트 `tests/engine/mail-prepare.test.ts`: 복사본으로 렌더(txt_pm 값이 본문에), templateId 불일치 warning, edits:null로 삭제 후 기존 규칙, 수신자 덮어쓰기(그룹 없어도 성공, 'edited', 0명 NO_RECIPIENTS), 첨부 제외와 모르는 id 무시, 원본 삭제/변경 warning, 손상 파일 warning, noticeId 불일치 INVALID_VALUE. compose-job 테스트 1건: edits 있는 공고에서 params.templateId가 달라도 복사본 제목이 fill.subject에.

### S3. 서비스 워커
- `src/background/job-coordinator.ts`: startJob에서 collect 신규 생성 시 afterCollect 스냅샷(settings는 withDefaults로), 재시도 승계. `export function setAfterCollect(jobId, v): Promise<boolean>`(serial, collect && ACTIVE만).
- `src/background/auto-compose.ts`: verdict `edit` 분기(2절), `listen('auto-compose/choose')`. `AutoComposeDeps`에 setAfterCollect.
- 테스트: edit 판정 시 openDashboard 해시와 handoff(opened true/false), edit 경로 permissions.contains 미호출, choose 발신자 검사(타 탭 거부), 끝난 잡 applied false, collect 시작 스냅샷(enabled false면 없음), 재시도 승계, setAfterCollect가 compose/종결 잡에 false.

### S4. 콘텐츠 스크립트 UI
- `src/ui/handoff-view.ts`, `src/ui/trackerbot/row-view.ts`: edit 매핑(2절 표).
- `src/ui/trackerbot/progress-view.ts`: `ProgressItem.choice?: { value: AfterCollect }` — active, phase collect, `job.afterCollect` 있을 때만.
- `src/ui/trackerbot/progress-card.ts`: 콜백 `choose(key, value)`. actions 위 한 줄 `완료 후:` + 버튼 [대시보드 편집] [바로 작성], 선택 쪽 `aria-pressed="true"` + 강조. choice 없으면 hidden. 노드 재사용 규칙 유지.
- `src/ui/trackerbot/controller.ts`: `chooseAfterCollect(key, value)`: entry.job이 ACTIVE collect면 `send('auto-compose/choose', ...)` 후 fetchJob.
- `src/ui/trackerbot/progress-popup.ts`: choose → controller.chooseAfterCollect.
- 테스트: 위 각 파일 기존 테스트에 edit/choice 케이스 추가.

### S5. 대시보드 (메인)
- AutoComposeCard: "완료 후 동작" 라디오(enabled=false면 비활성).
- SectionEditor: 선택 prop `onConvertToText?(itemIndex)` → 필드 항목 행에 [값 고치기].
- MailPreparePage: 편집 UI(제목/인사말/맺음말, 섹션 편집, 수신자 칩 + 추가, 첨부 체크박스, 배너들, [초안 저장], [메일 작성]=저장 후 compose 시작). 순수 로직은 `mail-edit-logic.ts` + 테스트.
- App.tsx: mail 라우트 `query.from` 전달.
