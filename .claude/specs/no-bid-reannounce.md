# 유찰 감지와 재공고 추적 (no-bid-reannounce) 구현 명세

작성 2026-11-06. Fable 설계, 사용자 답 반영. 기반 문서 `.claude/specs/award-tracking.md`(낙찰 결과 추적), `.claude/specs/follow-target.md`(팔로우 범위), 결정 근거 `.claude/specs/decisions.md` "2026-11-06 유찰 감지와 재공고 추적". 이 문서만 보고 구현한다(대화 참조 없음).

## 미결 사항
없음. 실측 대기 값(유찰 목록 오퍼레이션 이름과 필드, 기간 검색 응답 필드, 한도 초과 오류 코드)은 빈칸이 아니라 "실측 전 값"이 정해져 있고, 각 상수 옆에 교체 지점을 적었다. 실측 전에도 P0~P4 전부 구현할 수 있다.

## 목표
- 수집한 공고가 유찰되면 목록에서 "유찰" 배지와 "유찰" 필터로 보여 준다(팔로우 여부 무관).
- 유찰된 공고의 재공고를 찾아 원 공고에 잇는다. 재공고를 어떤 경로로든 수집하면 자동으로 잇고(수동 연결), 유찰 공고 전체에 대해 나라장터 기간 검색으로 찾는다(능동 검색). 팔로우 공고는 정시 주기로, 비팔로우 공고는 목록을 열 때 하루 1회 간격으로 찾는다.
- 팔로우 범위에 "재공고까지"를 추가한다. 유찰되면 팔로우를 해제하지 않고 재공고가 올라올 때까지 확인해 OS 알림을 보내고, 재공고를 자동 수집한 뒤 팔로우를 재공고로 넘긴다.
- 알림, 자동 수집, 팔로우 승계는 팔로우 공고에만 적용한다. 비팔로우 공고는 표시까지만.

## 확정 선택값 (바꾸지 않는다)
1. 비팔로우 유찰 공고도 능동 검색한다. list 모드에서만, 항목당 24시간 간격, 한 실행 5건, 한 실행 호출 예산 20회. 알림 없음.
2. 팔로우 공고("재공고까지")는 재공고 발견 시 OS 알림 1회, 자동 수집(`collect` 잡 시작), 재공고가 index에 들어오면 팔로우를 재공고로 승계.
3. 승계된 팔로우 범위는 `reannounce`("재공고까지") 유지. `notified`는 비운다.
4. 감시 기간 60일(팔로우, 비팔로우 공통). 팔로우 주기는 평일(KST) 10시, 15시 정시. 비팔로우는 마지막 확인 + 24시간.
5. 재공고를 수집했는데 원 공고 결과가 `waiting` 또는 `expired`면 원 공고를 `no_bid`로 바꾼다(`inferredNoBid: true`). `won`, `lost`, `ranked`, `not_participated`는 바꾸지 않는다.
6. 재공고 발견 알림과 재공고 추적 종료 알림은 전역 설정 `notify.final`로 거른다. 새 설정 없음.
7. 유찰 표시 색조는 `warn`(낙찰 `ok`와 구분). 배지와 셀의 정확한 클래스는 메인이 목업으로 확정하되, 이 명세에서는 `text-warn` 계열을 기본값으로 쓴다.
8. 팔로우 범위 값 이름 `FollowTarget = 'rank' | 'final' | 'reannounce'`. 화면 문구 `reannounce` = "재공고까지". 기본값은 `final` 그대로. 메뉴 순서: 개찰 결과만, 낙찰까지, 재공고까지, (팔로우 중일 때만 구분선 뒤) 팔로우 해제.
9. 이미 유찰 확정된 공고는 "재공고까지"로만 팔로우할 수 있다(재공고가 이미 확인된 공고는 불가).
10. 재공고 연결 키는 재공고 쪽 API 필드 `befBidBbancNo`(원 공고 `bidNtceNo`, 차수 없음)와 `reNtceYn === 'Y'`. 제목 일치는 보조. `ntceKindNm`은 쓰지 않는다. 같은 공고번호의 차수 증가는 재공고가 아니다(정정공고, 기존 round 이전 로직).
11. 유찰 판정은 (A) 1단계 행의 `opengRsltDivNm`에 "유찰"이 포함되거나 (B) 1단계 판정이 `waiting`일 때 1회 추가 호출한 유찰 목록 건수가 1 이상이고 재입찰 번호가 1단계 최신 묶음 이상일 때. 1단계 0건만으로는 유찰이 아니다. 2단계 0건도 유찰 근거가 아니다.
12. 유찰 목록 오퍼레이션, 기간 검색 오퍼레이션의 이름과 필드는 상수 한 곳. 빈 문자열(또는 빈 배열)이면 해당 규칙 비활성.
13. 재공고 감시 상태는 results.json의 결과 항목 안 `reannounce`(파생 캐시). 팔로우 의사는 follows.json `target`만. 새 파일 없음. `schemaVersion`, `INDEX_VERSION` 변경 없음.
14. 알림 문구(SW):
    - final no_bid(기존): "유찰" / `〈공고명〉 유찰되었습니다`
    - final no_bid + `watchingReannounce`: "유찰" / `〈공고명〉 유찰되었습니다. 재공고를 확인합니다`
    - final no_bid + `inferred`: "유찰" / `〈공고명〉 재공고가 올라와 유찰로 판단했습니다`
    - reannounce: "재공고 발견" / `〈공고명〉 재공고 〈재공고번호〉가 올라왔습니다`
    - reannounce_expired: "재공고 추적 종료" / `〈공고명〉 60일 동안 재공고가 없어 팔로우를 해제했습니다`
15. P0 실측 첫 후보 공고번호: `R26BK01789254`(사용자 제공 유찰 공고, 차수 000). 추가 후보(실데이터 재공고의 `befBidBbancNo`, 원 공고가 유찰 또는 취소였을 가능성 높음): R26BK01289373, R26BK01340494, R26BK01340770, R26BK01457271, R26BK01442948, R26BK01465466, R26BK01497465, R26BK01433236, R26BK01495319, R25BK01255964. 기간 검색 실측용 기관: `dminsttCd=B553501`(한국국토정보공사), 2026-02-01~2026-02-28, 재공고 `R26BK01350089`(원 공고 R26BK01289373)가 결과에 있어야 한다.

## 현재 코드 상태 (확인된 사실)
- 실데이터 `scripts/gold/data/notices.json`(API 응답 80건): 재공고 14건 전부 새 `bidNtceNo`(ord `000`), `reNtceYn: "Y"`, `befBidBbancNo: "<원 공고 bidNtceNo>"`. `ntceKindNm`은 대부분 "재공고"지만 `R26BK01257215`는 "등록공고". `bidNtceOrd`가 000이 아닌 항목 0건. `untyNtceNo`는 공고마다 다름.
- `src/adapters/g2b/award-api.ts:7-8` BASE, `OPENING_OP = 'getOpengResultListInfoOpengCompt'`; `:14-19` `fetchRaw(op, inqryDiv, numOfRows, noticeNo, ctx)`; `:32-47` `AWARD_FIELDS`(`openingWon: ''`, `openingNoBid: ''` 비활성); `:63-67` `flagOf`; `:69-82` `mapOpeningRows`; `:100-101` `OpeningResult`, `AwardResult`; `:112-120` `fetchAward` op 순회 규칙.
- `src/core/results/judge.ts:63-91` `decide`(규칙 2 낙찰 업체 → 3 → 4 `rows.some(r => r.noBid === true)` → 5~7 → 8); `:29-34` `latestBundle`; `:94-125` `judge`; `:141-148` `shouldFetchAward`.
- `src/core/results/plan.ts:25-33` `latestBids`; `:64-74` `resetForBiz`(필드 제거 목록); `:76-101` `planTargets`(terminal 제외, 팔로우 상한 20, 일반 15, list 모드만 일반).
- `src/core/results/schedule.ts` `nextKstSlot(nowMs, hours)`, `followNextCheckAt`, `kstParts`.
- `src/core/results/limits.ts` 상수 전부(REANNOUNCE 없음).
- `src/core/types/result.ts:17-22` `ResultStatus`, `RESULT_TERMINAL`(no_bid 포함); `:24-40` `ResultEntry`; `:43-46` `FollowTarget`, `FollowEntry`; `:48-51` `NotifyEvent`; `:4-15` `ProbePart`, `ResultProbeResult { opening; award }`.
- `src/core/types/index-file.ts:16-17` `IndexEntry.result`(파생), `following?: FollowTarget`; `:21` `INDEX_VERSION = 3`.
- `src/core/types/notice.ts:55-65` `Notice`(codes 없음, `previousNoticeId`는 정정 전용); `src/core/types/org.ts:3-4` `OpKind`, `NoticeCodes { demandOrgCode?; orderingOrgCode?; clsfcNo?; opKind? }`(타입만 있고 미사용).
- `src/adapters/g2b/source.ts:14-35` `NoticeSource`(`idOf`, `refOf`, `mapFields`, `linkedPrespecNo`), bid 소스 `fetch: fetchNotice(ref.noticeNo, ref.round, ctx)`.
- `src/adapters/g2b/openapi.ts:140-162` `fetchNotice(noticeNo, round | undefined, ctx)` → `{ ok: true; item; operation; fetchedAt }`, OPERATIONS 순회; `:102-138` `fetchJsonOp`; `g2bDetailOf`, `redactKey`.
- `src/adapters/g2b/org-api.ts:6-8` `ORG_OPS.noticeSearch = 'getBidPblancListInfo{Kind}PPSSrch'`, `ORG_PARAMS { inqryDiv: '1', begin: 'inqryBgnDt', end: 'inqryEndDt', org: 'dminsttCd', dateFormat: 'YYYYMMDDHHMM', windowDays: 30 }`(추정, 미실측); `:50-56` `probeOrg`. 진단 화면 `src/entrypoints/dashboard/diagnostics/OrgProbeTool.tsx`.
- `src/engine/jobs/collect-job.ts:220` `const { item, operation, fetchedAt } = r;` `:252-260` notice 구성과 `ns.saveNotice(notice, [{ operation, item }, ...])`(raw는 `<folder>/source/api-<operation>.json`).
- `src/engine/notices/notice-store.ts:26-57` `entryOf`; `:84-113` `migrateIndex`; `:166-168` `saveNotice`.
- `src/engine/notices/notice-api.ts:23-56` `listNotices`(results.json, follows.json 병합).
- `src/engine/results/result-store.ts:34-37` `NoticeSchedule`, `readSchedule`; `readJson` 사용.
- `src/engine/results/result-tracker.ts:31-32` `changed`; `:34-43` `minNext`; `:88` prune; `:91-123` list 모드 round 이전과 일정 재계산; `:126-137` needOpening; `:152-200` 대상 루프(`:160` 1차 judge, `:161-166` 2단계, `:170-175` 팔로우 주기 덮어쓰기, `:181-199` 이벤트와 해제); `:204-222` 백필; `:223-269` finally 저장.
- `src/engine/results/follow-api.ts:28-93` `setFollow`(`:50` FOLLOW_FINISHED, `:51` FOLLOW_RANK_DONE, `:60-68` entry 생성/변경, `:72` 응답); `:97` `removeTracking`.
- `src/engine/results/follow-store.ts:25-28` target 정규화(`'rank'` 아니면 `'final'`).
- `src/engine/results/result-probe.ts:25-31` `probeResult`.
- `src/background/result-scheduler.ts:23` `NOTIFY_ID_RE`; `:75-86` `notificationOf`; `:88-94` `notify`(rank → notify.rank, 그 외 notify.final); `:138-153` `followSet`(target 검사); `:156-164` `applyDone`; `:188` `onNotificationClicked`.
- `src/background/job-coordinator.ts:369` `startJob(req: JobRequest): Promise<StartResult>`; `src/background/auto-compose.ts:103-106` SW에서 `d.startJob({...})` 호출 패턴(deps 주입).
- `src/core/diagnostics/g2b-failure.ts:16` `stage: string`(자유 문자열).
- `src/ui/notices/result-view.ts:6` `isWon`; `:8-30` `resultCell`(no_bid는 idle "유찰"); `:32` `FOLLOW_TARGET_LABEL`; `:40-52` `followMenuItems(following, rankDone, notify)`; `:57-61` `followButton`(terminal이면 비활성); `:80-87` `followHint`; `:92-106` `trackSteps`; `:109-119` `followErrorText`; `:122-132` `followToastParts(next, prev, startAt, now)`.
- `src/entrypoints/dashboard/NoticesPage.tsx:33-36` `Filter`와 탭 목록; `:145-149` counts; `:153-166` filtered; `:418-421` 행 변수(`won`, `rc`, `fb`, `hint`); `:441` 제목; `:471` `FollowMenu` 사용(`rankDone` prop).
- `src/entrypoints/dashboard/FollowToggle.tsx:38-54` `FollowMenu({ variant, following, rankDone, notify, ... })`, `followMenuItems(following, rankDone, notify)`.
- `src/entrypoints/dashboard/notice/NoticeDetailPage.tsx:206` `FollowMenu` 사용; `notice/ResultStrip.tsx` `WonCard`, `FollowTrack`.
- `src/entrypoints/dashboard/diagnostics/ResultProbeTool.tsx:11-31` `PartView`, `:33-52` run.
- 테스트: `tests/g2b/award-api.test.ts`, `tests/core/result-judge.test.ts`, `tests/core/result-plan.test.ts`(없으면 신설), `tests/core/result-schedule.test.ts`, `tests/engine/result-tracker.test.ts`, `tests/engine/follow-api.test.ts`, `tests/engine/notice-api.test.ts`, `tests/background/result-scheduler.test.ts`, `tests/ui/result-view.test.ts`.

## 불변 원칙
- award-tracking.md 불변 원칙 전부 유지: offscreen만 파일 쓰기, `result/refresh`와 `follow/set`은 throw하지 않음, 키 미노출(`redactKey`), 1순위는 낙찰 아님, 사업자번호 정규화.
- `RESULT_TERMINAL`에서 no_bid를 빼지 않는다. 재공고 감시는 종료 상태 위에 얹는 부가 상태다. `planTargets`에 감시를 끼워 넣지 않는다(별도 `planReannounce`).
- 판단(유찰 판정, 감시, 승계, 해제)은 엔진. SW는 알림 문구, 필터, 수집 잡 시작만.
- 알림, 자동 수집, 승계는 팔로우 공고만. 비팔로우는 결과 항목 갱신까지.
- `src/adapters/g2b/open-result-api.ts`, `openapi.ts`의 `fetchNotice`와 `mapApiItem`, `org-api.ts`(상수 import만), `deadline-scheduler.ts`, `notify.ts`는 수정하지 않는다.
- `schemaVersion`(results, follows, index), `INDEX_VERSION` 변경 없음. 파일을 열자마자 고쳐 쓰는 마이그레이션 없음(읽을 때 정규화, 감시 보충은 결과 추적 실행의 정상 저장 경로로만).
- 가운뎃점(·) 금지(코드 주석, 화면 문구, 테스트 이름).

## 데이터 모델

### `src/core/types/result.ts`
```ts
export type FollowTarget = 'rank' | 'final' | 'reannounce';
export const FOLLOW_TARGET_DEFAULT: FollowTarget = 'final';   // 그대로

export interface ReannounceWatch {
  status: 'watching' | 'found' | 'expired';
  since: ISODate;                 // 감시 시작(유찰 판정 시각, 보충 시 checkedAt 또는 openingAt)
  nextCheckAt: ISODate; attempts: number; checkedAt?: ISODate;
  orgCode?: string; opKind?: OpKind;   // 검색에 필요. 없으면 보충(P3)
  found?: { noticeNo: string; round: string; title: string; noticeId: string; postedAt?: ISODate; foundAt: ISODate; via: 'collect' | 'search' };
  inferredNoBid?: true;           // 재공고 수집으로 유찰을 추정한 경우
  lastError?: { code: string; message: string };
}
export interface ResultEntry { ...기존; reannounce?: ReannounceWatch }

export interface FollowEntry { noticeId; followedAt; target: FollowTarget; notified: { rank?: ISODate; final?: ISODate; reannounce?: ISODate } }

export type NotifyEvent =
  | { kind: 'rank'; ... 기존 }
  | { kind: 'final'; noticeId; title; status: 'won' | 'lost' | 'not_participated' | 'no_bid'; rank?; winnerName?; watchingReannounce?: true; inferred?: true }
  | { kind: 'expired'; noticeId; title }
  | { kind: 'reannounce'; noticeId: string; title: string; noticeNo: string; round: string; newTitle: string }
  | { kind: 'reannounce_expired'; noticeId: string; title: string };

export interface ResultProbeResult {
  notice: ProbePart & { op: string | null };     // 공고정보 원본(fetchNotice) 1건
  opening: ProbePart;
  failing: Array<ProbePart & { op: string }>;     // 유찰 목록 후보 op 전부
  award: Array<ProbePart & { op: string }>;
}
```
`OpKind`는 `src/core/types/org.ts`에서 import.

### `src/core/types/notice.ts`
```ts
export interface Notice { ...기존; codes?: NoticeCodes; reannounceOf?: string }   // reannounceOf: 원 공고 noticeNo(차수 없음). reNtceYn Y이고 befBidBbancNo가 비어 있지 않을 때만
```

### `src/core/types/index-file.ts`
```ts
export interface IndexEntry {
  ...기존;
  reannounceOf?: string;          // index.json에 저장. entryOf가 notice.reannounceOf를 복사
  result?: { ...기존; reannounce?: { status: 'watching' | 'found' | 'expired'; noticeNo?: string; round?: string; title?: string; noticeId?: string } };   // 파생. noticeId는 그 재공고가 index에 있을 때만
  reannounceOfId?: string;        // 파생. reannounceOf에 해당하는 원 공고(latestBids 기준)가 index에 있으면 그 noticeId
}
```
`INDEX_VERSION`은 3 유지. 옛 항목은 `reannounceOf` 없음이 정답.

### 프로토콜 (`src/messaging/protocol.ts`)
- `follow/set` payload `target?: FollowTarget`는 타입 확장으로 자동 반영. 메시지 추가 없음.
- `result/probe` 응답 타입은 위 `ResultProbeResult`로 바뀐다.

### 상수 (`src/core/results/limits.ts` 추가)
```ts
export const REANNOUNCE_TRACK_DAYS = 60;
export const REANNOUNCE_HOURS: readonly number[] = [10, 15];        // 팔로우 공고(KST 평일 정시)
export const REANNOUNCE_FIRST_DELAY_MS = 10 * MIN;
export const REANNOUNCE_BATCH_MAX = 10;                             // 팔로우 감시 한 실행 상한
export const REANNOUNCE_GENERAL_MAX = 5;                            // 비팔로우 감시 한 실행 상한(list 모드)
export const REANNOUNCE_GENERAL_INTERVAL_MS = 24 * HOUR;            // 비팔로우 확인 간격
export const REANNOUNCE_CALL_BUDGET = 20;                           // 비팔로우 감시가 한 실행에서 쓸 API 호출 수
export const REANNOUNCE_WINDOW_DAYS = 30;                           // 기간 검색 창(ORG_PARAMS.windowDays와 같은 값 유지)
```

### 어댑터 상수 (실측 전 값 / 실측 후 교체 지점)
`src/adapters/g2b/award-api.ts`
```ts
export const FAILING_OPS = ['getOpengResultListInfoFailing'] as const;   // probe 후보 목록(P0). 실측에서 오류면 이름을 바꿔 재실측
export const FAILING_OP = '';                                             // 실측 전 ''(비활성). 실측 후 확인된 이름으로 교체 → 규칙 (B) 활성
export const FAILING_FIELDS = { rbidNo: 'rbidNo', round: 'bidNtceOrd', at: 'opengDt', reason: '' } as const;   // 실측 후 keys로 교체. reason은 유찰 사유 필드명(없으면 '' 유지)
AWARD_FIELDS에 추가: openingResultDiv: 'opengRsltDivNm', openingNoBidMark: '유찰'   // 확인된 필드. 실측에서 유찰 표기가 다르면 openingNoBidMark만 교체
```
`src/adapters/g2b/reannounce-api.ts`
```ts
export const REANNOUNCE_FIELDS = { prevNo: 'befBidBbancNo', reFlag: 'reNtceYn', no: 'bidNtceNo', ord: 'bidNtceOrd', title: 'bidNtceNm', postedAt: 'bidNtceDt' } as const;   // 공고번호 조회 응답에서 확인됨. 기간 검색 응답에 없으면 실측 후 교체
export const REANNOUNCE_STOP_CODES: readonly string[] = [];   // 한도 초과로 확인된 오류 코드 또는 g2bMsg 조각. 실측 전 빈 배열(비활성). prebid-impl 3.1의 추정 "22", "LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR"를 실측으로 확인한 뒤 채운다
```
오퍼레이션 이름과 파라미터는 `org-api.ts`의 `ORG_OPS.noticeSearch`, `ORG_PARAMS`를 import해서 쓴다(실측 반영 지점 한 곳).

## 단계별 작업

### P0 실측 도구
대상: `src/adapters/g2b/award-api.ts`, `src/core/types/result.ts`(ResultProbeResult), `src/engine/results/result-probe.ts`, `src/entrypoints/dashboard/diagnostics/ResultProbeTool.tsx`.
- `award-api.ts`: `FAILING_OPS` 상수, `export function fetchFailingRaw(noticeNo: string, op: string, ctx: G2bContext): Promise<RawResult>` = `fetchRaw(op, '4', '100', noticeNo, ctx)`.
- `result-probe.ts probeResult`: 순서 notice(`fetchNotice(noticeNo, undefined, ctx)` 결과를 `{ ok, count: 1, keys, sample: [item] }`로, 실패면 ok false와 error, `op`는 성공한 operation 또는 null) → opening(현행) → failing(FAILING_OPS 전부, 중단 없음) → award(현행). `toPart` 재사용. onFailure stage는 `'probe'` 그대로.
- `ResultProbeTool.tsx`: PartView 블록 순서 "0 공고정보", "1 개찰결과", "2 유찰 목록(op별)", "3 낙찰정보(op별)". 기본 입력값을 `R26BK01789254`로 바꾼다. help 문구: "공고정보, 개찰결과, 유찰 목록, 낙찰정보 API 응답을 확인합니다. 저장하지 않습니다."
- `OrgProbeTool.tsx` 변경 없음.
완료 조건: `npx tsc --noEmit`. 테스트 `tests/engine/result-probe.test.ts`(없으면 신설): fetch 모킹으로 notice 1회 + opening 1회 + failing op 수 + award 4회 호출, 한 op 실패해도 나머지 호출됨, 키는 error 문자열에서 마스킹.
실측(사용자, 결과는 decisions.md 해당 절 아래 "S0 실측(유찰)", "S0 실측(기간 검색)" 줄로 기록):
1. ResultProbeTool에 `R26BK01789254`, 그다음 후보 2건. 기록할 것: 공고정보 블록의 `reNtceYn`, `befBidBbancNo`, `dminsttCd`, `rbidPermsnYn`; 개찰결과 건수와 `opengRsltDivNm` 값(0건인지, "유찰" 행인지); 유찰 목록 op 성공 여부(오류면 메시지 원문), keys(특히 `bidNtceOrd`, `rbidNo`, `opengDt`, 유찰 사유로 보이는 필드, `opengRsltDivNm`), sample; 낙찰정보 4개 op 전부 0건인지.
2. 가능하면 재입찰이 있었던 공고(개찰결과 `rbidNo`가 2 이상) 1건으로 유찰 목록에 1차 유찰 기록이 남는지.
3. OrgProbeTool: `B553501`, 2026-02-01~2026-02-28, Servc. 기록: op 성공 여부, keys에 `befBidBbancNo`, `reNtceYn` 포함 여부, `R26BK01350089` 포함 여부, 기간 상한 오류 문구, `inqryDiv` 의미, 한도 초과 시 오류 코드와 메시지(나오면).
4. 실측 반영: `FAILING_OP`, `FAILING_FIELDS`, 필요 시 `openingNoBidMark`, `ORG_OPS`/`ORG_PARAMS`, `REANNOUNCE_FIELDS`, `REANNOUNCE_STOP_CODES`.

### P1 유찰 판정과 유찰 표시
대상: `award-api.ts`, `src/core/results/judge.ts`, `src/engine/results/result-tracker.ts`, `src/ui/notices/result-view.ts`, `src/entrypoints/dashboard/NoticesPage.tsx`.

`award-api.ts`
- `AWARD_FIELDS`에 `openingResultDiv`, `openingNoBidMark` 추가. `mapOpeningRows`의 `noBid`: `flagOf(i, F.openingNoBid) ?? (F.openingResultDiv !== '' && (strOf(i[F.openingResultDiv]) ?? '').includes(F.openingNoBidMark) ? true : null)`.
- `FAILING_OP`, `FAILING_FIELDS` 상수.
```ts
export interface FailingRow { rbidNo: string | null; round: string | null; at: ISODate | null; reason: string | null }
export type FailingResult = { ok: true; rows: FailingRow[]; fetchedAt: ISODate; called: boolean } | { ok: false; error: JobError };
export function mapFailingRows(items: ApiItem[]): FailingRow[]     // FAILING_FIELDS로 매핑, 빈 필드명은 null. at은 toIsoKst
export async function fetchFailing(noticeNo: string, ctx: G2bContext): Promise<FailingResult>   // FAILING_OP === ''면 호출 없이 { ok: true, rows: [], fetchedAt, called: false }. 그 외 fetchRaw(FAILING_OP, '4', '100', ...) → called: true. 키 없음은 G2B_KEY_MISSING
```

`judge.ts`
- `JudgeInput.failing?: FailingResult | null`.
- 규칙 1(오류)은 opening, award만. `failing`이 `ok: false`면 null로 취급(무시).
- `maxRbid(rows: Array<{ rbidNo: string | null }>): number | null`(숫자 변환 가능한 최대값, 없으면 null) 추가.
- 규칙 4 교체: `const noBidByRow = rows.some(r => r.noBid === true); const f = failing && failing.ok ? failing.rows : []; const noBidByList = f.length > 0 && (rows.length === 0 || maxRbid(f) === null || maxRbid(rows) === null || maxRbid(f)! >= maxRbid(rows)!); if (noBidByRow || noBidByList) return { status: 'no_bid', ...(rows.length > 0 ? { bidders: rows.length } : {}) };`
- 규칙 순서 유지(2 낙찰 업체, 3 낙찰 플래그가 유찰보다 먼저).

`result-tracker.ts` 대상 루프(`:160` 뒤): `let failing: FailingResult | null = null; if (opening.ok && j.entry.status === 'waiting') { failing = await fetchFailing(e.noticeNo, ctx); if (!failing.ok) { fail('failing', e, failing.error); if (isKeyError(failing.error.code)) { KEY_INVALID 중단 } } if (failing.ok && failing.called) j = judge({ ourBizNo: ours, now: nt, prev, opening, award: null, failing }); }` 그다음 기존 `shouldFetchAward` 분기는 그대로(2단계 judge 호출에도 `failing` 전달). `g2b-failure.ts:16` 주석의 result stage 목록에 `'failing'` 추가(타입은 string이라 변경 없음).

`result-view.ts`
- `export const isNoBid = (e: Pick<IndexEntry, 'result'>): boolean => e.result?.status === 'no_bid';`
- `ResultCell` tone `'ok' | 'warn' | 'idle'`. no_bid → `{ tone: 'warn', text: '유찰' }`(P2에서 "유찰, 재공고 있음"으로 확장).

`NoticesPage.tsx`
- `Filter`에 `'no_bid'`, 탭 목록에 `{ id: 'no_bid', label: '유찰' }`을 "낙찰" 뒤에. counts `no_bid: all.filter(isNoBid).length`, filtered 분기. 탭 카운트 색: `f.id === 'no_bid' && counts.no_bid > 0`이면 `font-semibold text-warn`.
- 행: `const noBid = isNoBid(n);` 제목 옆 배지 "유찰"(낙찰 배지와 같은 위치와 모양, 색만 `text-warn` 계열 테두리). `resultCell` tone 'warn' → `text-warn` 클래스.
완료 조건: tsc, 아래 테스트.
- `tests/g2b/award-api.test.ts` 추가: `opengRsltDivNm: '유찰'` → noBid true; `'개찰완료'` → null; 필드 없음 → null; `fetchFailing`: FAILING_OP 빈 문자열이면 fetch 미호출 `called: false` rows []; (FAILING_OP를 테스트에서 주입할 수 없으므로 `mapFailingRows` 매핑은 FAILING_FIELDS 기본값으로 rbidNo, round, at 변환, reason null 확인).
- `tests/core/result-judge.test.ts` 추가: 유찰 행 1건 → no_bid; failing 1건 + opening 0건 → no_bid; failing rbidNo 1 + opening 최신 rbidNo 2(순위 없음) → waiting; failing ok false → opening 판정 유지(waiting); 2단계 낙찰자 있으면 failing 있어도 won/lost; failing 있고 opening 행 순위 있음(ranked) → 규칙 4가 먼저라 no_bid(규칙 순서 문서화용, 실측 후 바뀔 수 있음을 테스트 이름에 적지 말고 그냥 현재 규칙으로 고정).
- `tests/engine/result-tracker.test.ts` 추가: 1차 판정 waiting일 때만 fetchFailing 호출(ranked, not_participated면 미호출); failing 키 오류면 KEY_INVALID 중단.
- `tests/ui/result-view.test.ts` 추가: `isNoBid`, no_bid 셀 tone warn 텍스트 "유찰".

### P2 데이터 모델과 수동 연결 (API 호출 0회)
대상: `src/core/types/notice.ts`, `index-file.ts`, `result.ts`(ReannounceWatch), `src/adapters/g2b/source.ts`, `src/engine/jobs/collect-job.ts`, `src/engine/notices/notice-store.ts`, `notice-api.ts`, `src/core/results/reannounce.ts`(신설), `src/core/results/plan.ts`(resetForBiz), `result-tracker.ts`, `result-view.ts`, `NoticesPage.tsx`, `notice/ResultStrip.tsx`, `notice/NoticeDetailPage.tsx`.

`source.ts` `NoticeSource`에 선택 메서드 추가, bid 소스만 구현:
```ts
codesOf?(item: ApiItem, operation: string): NoticeCodes | undefined;   // { demandOrgCode: dminsttCd, orderingOrgCode: ntceInsttCd, clsfcNo: pubPrcrmntClsfcNo, opKind: /(Servc|Thng|Cnstwk|Frgcpt)/.exec(operation)?.[1] } 빈 값 키는 생략, 전부 없으면 undefined
reannounceOf?(item: ApiItem): string | null;   // (item.reNtceYn ?? '').trim().toUpperCase() === 'Y' && (item.befBidBbancNo ?? '').trim() !== '' ? befBidBbancNo.trim() : null
```
`collect-job.ts:255` 뒤: `const codes = src.codesOf?.(item, operation); if (codes) notice.codes = codes; const reOf = src.reannounceOf?.(item) ?? null; if (reOf) notice.reannounceOf = reOf; else delete notice.reannounceOf;`
`notice-store.ts entryOf`: `...(n.reannounceOf ? { reannounceOf: n.reannounceOf } : {})`. 주의: award-tracking.md "entryOf를 건드리지 않는다"는 결과 파생값 금지가 취지이고 `reannounceOf`는 notice.json 원천값이라 허용(decisions 기록).

`src/core/results/reannounce.ts`(순수)
```ts
export function normalizeTitle(t: string): string   // 공백 전부 제거, '(재공고)', '[재공고]', '재공고', '[긴급]', '(긴급)', '긴급' 제거, 소문자
export function ensureWatches(results: ResultFile, now: Date): string[]   // P3에서 사용. 아래 P3 참조
export function linkCollected(index: IndexEntry[], results: ResultFile, now: Date): string[]   // 바뀐 noticeId 목록
```
`linkCollected`: `latestBids(index)`로 noticeNo → 최신 bid 항목 맵을 만든다. `reannounceOf`가 있는 bid 항목 e마다 원 공고 `orig = map.get(e.reannounceOf)`. `orig`가 없거나 `results.entries[orig.noticeId]`가 없으면 건너뛴다. `r = results.entries[orig.noticeId]`. `r.reannounce?.status === 'found'`면 건너뛴다(이미 연결). 아니면 `r.reannounce = { status: 'found', since: r.reannounce?.since ?? now, nextCheckAt: now, attempts: r.reannounce?.attempts ?? 0, ...(orgCode, opKind 유지), found: { noticeNo: e.noticeNo, round: e.round, title: e.title, noticeId: e.noticeId, postedAt: e.collectedAt는 쓰지 않음(생략), foundAt: now, via: 'collect' }, ...(r.status === 'waiting' || r.status === 'expired' ? { inferredNoBid: true } : {}) }`. `r.status`가 `waiting` 또는 `expired`면 `status: 'no_bid'`, `attempts: 0`, `checkedAt: now`, rank/bidders/lastError 제거. 다른 상태는 status 불변. 바뀐 id 반환.

`plan.ts resetForBiz`: 제거 목록에 `reannounce` 추가(사업자번호 변경 시 전부 waiting으로 돌아가므로 감시도 버린다).

`result-tracker.ts` list 모드, needOpening 처리(137행) 뒤: `for (const id of linkCollected(index, results, t0)) { touched.add(id); const prev = /* linkCollected 호출 전 복사 */; if (바뀐 status가 no_bid이고 이전이 no_bid 아님) { out.updated++; const f = follows.entries[id]; if (f && !f.notified.final) { events.push({ kind: 'final', noticeId: id, title, status: 'no_bid', inferred: true }); f.notified.final = now } ; if (f && f.target !== 'reannounce') { delete follows.entries[id]; followRemoved.add(id); } } }`. 구현은 `linkCollected`가 `{ id, prevStatus }[]`를 돌려주게 해도 된다(시그니처는 구현자가 정하되 테스트는 결과로 검증). target이 `reannounce`인 팔로우는 유지(이미 found라 호출 없음, 승계는 P3).
`changed()`(`:31-32`)에 `a.reannounce?.status !== b.reannounce?.status || a.reannounce?.found?.noticeNo !== b.reannounce?.found?.noticeNo` 추가.

`notice-api.ts listNotices`: `result.reannounce` 병합 `{ status, ...(found ? { noticeNo, round, title, ...(index에 found.noticeId 있으면 noticeId) } : {}) }`. `reannounceOfId`: `n.reannounceOf`가 있고 `latestBids` 기준 원 공고가 index에 있으면 그 noticeId.

`result-view.ts`
- `resultCell`: no_bid이고 `result.reannounce?.status === 'found'`면 `{ tone: 'warn', text: '유찰, 재공고 있음' }`.
- `export type NoticeBadge = 'won' | 'no_bid' | 'reannounced' | 'reannounce'; export function noticeBadges(e: Pick<IndexEntry, 'result' | 'reannounceOf'>): NoticeBadge[]` — won → ['won']; no_bid → ['no_bid', found면 'reannounced']; `reannounceOf` 있으면 'reannounce' 추가(맨 뒤). 라벨 `BADGE_LABEL = { won: '낙찰', no_bid: '유찰', reannounced: '재공고 있음', reannounce: '재공고' }`.
`NoticesPage.tsx`: 제목 옆 배지를 `noticeBadges(n)`로 그린다(won은 기존 모양, 나머지는 warn 계열, reannounce는 muted 테두리).
`ResultStrip.tsx`에 `export function ReannounceCard({ entry, onCollect, busy }: { entry: IndexEntry; onCollect: (ref: { noticeNo: string; round: string }) => void; busy: boolean })`:
- `entry.result?.reannounce?.status === 'found'`: 제목 "재공고", 본문 `〈noticeNo〉-〈round〉 〈title〉`. `noticeId`가 있으면 "열기" 링크(`#/notices/<encodeURIComponent(noticeId)>/overview`), 없으면 "수집" 버튼(onCollect).
- `entry.reannounceOf`: 제목 "원 공고", 본문 `〈reannounceOf〉의 재공고`, `reannounceOfId`가 있으면 "열기" 링크.
- 둘 다 아니면 null. 두 조건이 겹치면 두 블록 모두.
`NoticeDetailPage.tsx`: overview 탭의 결과 영역(WonCard, FollowTrack 옆)에 `ReannounceCard` 추가. `onCollect`는 `send('job/start', { type: 'collect', ref: { noticeNo, round, origin: 'g2b' } })` 후 토스트 "재공고 수집을 시작했습니다"(실패는 `JOB_ALREADY_RUNNING`이면 "다른 수집이 끝난 뒤 다시 눌러 주세요", 그 외 message). 위치와 모양은 메인이 확정.
완료 조건: tsc, 아래 테스트.
- `tests/core/reannounce.test.ts`: normalizeTitle("[긴급] A 용역 (재공고)") === normalizeTitle("A 용역"); linkCollected: found 기록과 via collect; waiting → no_bid + inferredNoBid; expired → no_bid; lost 불변(found는 기록); 이미 found면 불변(반환 목록에 없음); 원 공고 결과 항목 없으면 건너뜀; 원 공고 round 000/001 중 최신에 연결.
- `tests/engine/result-tracker.test.ts` 추가: list 모드에서 재공고 index 항목이 있으면 원 공고 found + updated 증가; 팔로우(final) 원 공고가 추정 유찰이면 final 이벤트 `inferred: true` 후 해제; follow 모드에서는 linkCollected 미적용.
- `tests/engine/notice-api.test.ts` 추가: reannounce 병합(found noticeId는 index에 있을 때만), reannounceOfId.
- `tests/engine/notice-store.test.ts`(있으면 추가): entryOf reannounceOf 복사, 없으면 키 없음.
- collect-job 테스트(기존 파일): 응답 item에 `reNtceYn: 'Y'`, `befBidBbancNo: 'R1'` → notice.reannounceOf 'R1', codes.demandOrgCode, opKind 'Servc'; `reNtceYn: 'N'`이면 reannounceOf 없음.
- `tests/ui/result-view.test.ts` 추가: noticeBadges 4경우, 셀 "유찰, 재공고 있음".
- `tests/core/result-plan.test.ts`: resetForBiz가 reannounce를 제거.

### P3 팔로우 범위 "재공고까지", 능동 감시, 알림
대상: `result.ts`, `limits.ts`, `schedule.ts`, `plan.ts`, `reannounce.ts`, `src/adapters/g2b/reannounce-api.ts`(신설), `result-tracker.ts`, `follow-api.ts`, `follow-store.ts`, `src/background/result-scheduler.ts`, `result-view.ts`, `FollowToggle.tsx`, `NoticesPage.tsx`, `NoticeDetailPage.tsx`, `ResultStrip.tsx`, `NotifyCard.tsx`.

`schedule.ts`
```ts
export function reannounceNextCheckAt(w: Pick<ReannounceWatch, 'status' | 'since'>, nowMs: number, followed: boolean): number | null
```
status가 watching이 아니면 null. `nowMs - Date.parse(since) > REANNOUNCE_TRACK_DAYS일`이면 null(호출자가 expired 처리). followed → `nextKstSlot(nowMs, REANNOUNCE_HOURS)`. 아니면 `nowMs + REANNOUNCE_GENERAL_INTERVAL_MS`.

`plan.ts`
```ts
export interface ReannouncePlan { followed: string[]; general: string[] }
export function planReannounce(a: PlanInput): ReannouncePlan
```
공통 조건 `watchDue(id)`: index에 있고 `kindOf === 'bid'`이고 `latestBids` 최신 round이고 `results.entries[id].status === 'no_bid'`이고 `reannounce?.status === 'watching'`이고 `Date.parse(reannounce.nextCheckAt) <= now`. `followed` = `follows.entries[id]?.target === 'reannounce'`인 watchDue, `reannounce.nextCheckAt` 오름차순, 상한 `REANNOUNCE_BATCH_MAX`, 두 모드 공통. `general` = list 모드에서만, 나머지 watchDue(팔로우 없음 또는 target이 reannounce가 아님), `reannounce.since` 내림차순, 상한 `REANNOUNCE_GENERAL_MAX`.

`reannounce.ts ensureWatches(results, now)`: `status === 'no_bid'`이고 `reannounce`가 없는 항목에 `since = checkedAt ?? openingAt`, `attempts: 0`, `nextCheckAt: now`. `now - since > 60일`이면 `status: 'expired'`(호출 없음). 바뀐 id 반환.

`reannounce-api.ts`
```ts
import { ORG_OPS, ORG_PARAMS } from './org-api';
export const REANNOUNCE_FIELDS = {...};  export const REANNOUNCE_STOP_CODES: readonly string[] = [];
export interface ReannounceHit { noticeNo: string; round: string; title: string; postedAt: ISODate | null; matchedBy: 'prevNo' | 'title' }
export function formatKstCompact(ms: number): string           // YYYYMMDDHHMM, KST(kstParts 또는 +9h 오프셋)
export function matchReannounce(items: ApiItem[], prevNoticeNo: string, prevTitle: string): ReannounceHit | null
export function isStopError(err: JobError): boolean            // REANNOUNCE_STOP_CODES 중 하나가 err.code와 같거나 g2bDetailOf(err).g2bMsg 또는 err.message에 포함되면 true. 배열이 비면 false
export async function searchReannounce(p: { prevNoticeNo: string; prevTitle: string; orgCode: string; opKinds: readonly OpKind[]; fromMs: number; toMs: number }, ctx: G2bContext): Promise<{ ok: true; hit: ReannounceHit | null; opKind: OpKind | null; calls: number; fetchedAt: ISODate } | { ok: false; error: JobError; calls: number }>
```
- `matchReannounce`: 1순위 `befBidBbancNo.trim() === prevNoticeNo`인 항목(자기 자신 `bidNtceNo === prevNoticeNo`는 제외). 2순위 `reNtceYn === 'Y'`이고 `normalizeTitle(bidNtceNm) === normalizeTitle(prevTitle)`. 같은 순위에 여러 건이면 `bidNtceDt` 최신. round는 `bidNtceOrd` 없으면 `'000'`.
- `searchReannounce`: opKinds 순서대로 `ORG_OPS.noticeSearch.replace('{Kind}', kind)`를 `https://apis.data.go.kr/1230000/ad/BidPublicInfoService/` 뒤에 붙여 호출. 쿼리 `serviceKey, type: 'json', numOfRows: '100', pageNo: '1', inqryDiv: ORG_PARAMS.inqryDiv, [ORG_PARAMS.begin]: formatKstCompact(fromMs), [ORG_PARAMS.end]: formatKstCompact(toMs), [ORG_PARAMS.org]: orgCode`. 오류는 즉시 반환. hit가 나오면 중단하고 그 kind를 `opKind`로. 전부 없음이면 `hit: null, opKind: null`. `calls`는 시도한 op 수. 키 없음 G2B_KEY_MISSING. 100건 초과(두 번째 페이지)는 다루지 않는다.

`follow-store.ts:28`: `target: e.target === 'rank' || e.target === 'reannounce' ? e.target : 'final'`.

`follow-api.ts setFollow` 켜기(`target = p.target ?? 'final'`):
1. `:50` FOLLOW_FINISHED 조건을 `r && RESULT_TERMINAL.has(r.status) && !(r.status === 'no_bid' && target === 'reannounce')`로.
2. 그 뒤 추가: `if (target === 'reannounce' && r?.status === 'no_bid' && r.reannounce?.status === 'found') throw err('FOLLOW_REANNOUNCED', '이미 재공고가 확인된 공고입니다. 재공고를 팔로우하세요.')`.
3. `:60-68` entry 생성/변경은 현행(target만 바꾸고 followedAt, notified 유지).
4. `r?.status === 'no_bid' && target === 'reannounce'`면 결과 항목 갱신: `r.reannounce`가 없거나 expired면 `{ status: 'watching', since: now, nextCheckAt: now + REANNOUNCE_FIRST_DELAY_MS, attempts: 0, ...(기존 orgCode, opKind 유지) }`; watching이면 `nextCheckAt = min(기존, now + REANNOUNCE_FIRST_DELAY_MS)`, since 유지. results 저장.
5. 응답 `startAt`: no_bid면 `r.reannounce.nextCheckAt`, 아니면 현행. `nextFollowCheckAt`은 아래 `minNext` 규칙.
끄기: 현행(감시 객체는 남긴다. `planReannounce`에서 general로 분류돼 비팔로우 간격으로 계속 확인된다).

`result-tracker.ts`
- `minNext(results, follows)`: 기존 비종료 항목 외에 `follows.entries[id].target === 'reannounce'`이고 `results.entries[id].reannounce?.status === 'watching'`인 항목의 `reannounce.nextCheckAt`도 최솟값 후보. 비팔로우 감시는 포함하지 않는다.
- list 모드 순서: prune → round 이전 → 승계(아래) → 일정 재계산 → needOpening → `ensureWatches`(touched) → `linkCollected`(P2) → 대상 루프 → 감시 루프 → 백필. follow 모드: prune → needOpening(현행) → 대상 루프 → 감시 루프(followed만).
- 대상 루프 이벤트 처리(`:181-199`) 교체:
  ```
  if (entry.status === 'no_bid' && prev.status !== 'no_bid' && !entry.reannounce) entry.reannounce = { status: 'watching', since: nt, nextCheckAt: iso(nt + REANNOUNCE_FIRST_DELAY_MS), attempts: 0 };   // 팔로우 여부 무관
  ... results.entries[id] = entry 등 현행 ...
  if (!f || !j.event) continue;
  rank: 현행
  final/expired:
    const keep = j.event === 'final' && entry.status === 'no_bid' && f.target === 'reannounce';
    if (!f.notified.final) { ev = ...현행 + (keep ? { watchingReannounce: true } : {}); f.notified.final = nt; followTouched.add(id); }
    if (!keep) { delete follows.entries[id]; followRemoved.add(id); }
  ```
  `keep`일 때 `followNextCheckAt` 덮어쓰기(`:170-175`)는 terminal이라 null을 돌려주므로 영향 없음.
- 감시 루프(대상 루프 뒤, 백필 앞, `out.skipped !== 'KEY_INVALID'`일 때):
  ```
  const plan = planReannounce({ index, results, follows, now: t0, mode });
  let budget = REANNOUNCE_CALL_BUDGET;
  for (const [ids, followed] of [[plan.followed, true], [plan.general, false]]) {
    for (const id of ids) {
      if (!followed && budget <= 0) break;
      const r = await watchTick(id, followed);   // 아래
      if (r === 'stop') { stopAll = true; break; }
      if (!followed) budget -= r.calls;
    }
    if (stopAll) break;
  }
  ```
  `watchTick(id, followed)`:
  1. `e = byId.get(id)`, `r = results.entries[id]`, `w = r.reannounce`. 없으면 skip.
  2. 코드 보충: `w.orgCode`와 `w.opKind`가 없으면 `readJson(notice.json).codes`에서 채운다. 그래도 `orgCode`가 없으면 `fetchNotice(e.noticeNo, e.round, ctx)` 1회(시도 op 수를 calls에 더함): 성공이면 `orgCode = item.dminsttCd`, `opKind = operation에서 추출`, 실패면 `attempts+1`, `lastError`, `nextCheckAt = now + backoffMs(attempts)`, `fail('codes', e, error)`, 키 오류면 KEY_INVALID 중단('stop'), `isStopError`면 'stop'. 보충 후에도 orgCode가 비어 있으면 같은 backoff 처리.
  3. 검색: `fromMs = max(Date.parse(r.openingAt), now - REANNOUNCE_WINDOW_DAYS일)`, `toMs = now`, `opKinds = w.opKind ? [w.opKind] : ['Servc', 'Thng', 'Cnstwk', 'Frgcpt']`. `searchReannounce(...)`.
     - 오류: `attempts+1`, `lastError`, `nextCheckAt = now + backoffMs(attempts)`, `fail('reannounce', e, error)`. 키 오류 또는 `isStopError` → 'stop'(해당 항목은 저장).
     - hit: `w = { ...w, status: 'found', checkedAt: now, attempts: 0, found: { noticeNo, round, title, noticeId: noticeIdOf({ noticeNo, round }), postedAt, foundAt: now, via: 'search' }, opKind: res.opKind ?? w.opKind }`, lastError 제거. `out.updated++`. `followed`이고 `!f.notified.reannounce`면 이벤트 `{ kind: 'reannounce', noticeId: id, title: e.title, noticeNo, round, newTitle: title }`, `f.notified.reannounce = now`, followTouched.
     - 없음: `attempts+1`, `checkedAt = now`, `nx = reannounceNextCheckAt(w, now, followed)`. `nx === null`이면 `status: 'expired'`; followed면 이벤트 `reannounce_expired`(notified.final과 무관하게 1회, 팔로우 제거 followRemoved), 비팔로우면 이벤트 없음. 아니면 `nextCheckAt = iso(nx)`.
  4. `results.entries[id] = { ...r, reannounce: w }`, touched. 반환 `{ calls }` 또는 'stop'.
- 승계(list 모드, round 이전 루프 바로 뒤): 팔로우 id마다 `w = results.entries[id]?.reannounce`; `w?.status === 'found'`이고 `byId.has(w.found.noticeId)`이고 `!follows.entries[w.found.noticeId]`면 `follows.entries[newId] = { noticeId: newId, followedAt: now, target: f.target, notified: {} }`(followTouched, followMoved.set(newId, id)), `delete follows.entries[id]`(followRemoved). 이미 새 id에 팔로우가 있으면 옛 것만 제거. 원 공고 결과 항목은 그대로(found 유지). 새 공고 결과 항목은 같은 실행의 needOpening이 만든다.
- finally: 현행 유지. `rankSeen`과 마찬가지로 followRemoved는 되살리지 않는다.
- 진단 `fail` stage 값: `'failing' | 'codes' | 'reannounce'`(`g2b-failure.ts:16` 주석 갱신).

`result-scheduler.ts`
- `NOTIFY_ID_RE = /^result:(.+):(rank|won|lost|not_participated|no_bid|expired|reannounce|reannounce_expired)$/`.
- `notificationOf`: 확정 선택값 14의 문구. id `result:<noticeId>:reannounce`, `result:<noticeId>:reannounce_expired`. final no_bid는 id 그대로(`:no_bid`), 본문만 분기.
- `notify`: `ev.kind === 'rank'`만 notify.rank, 나머지(reannounce, reannounce_expired 포함) notify.final.
- `followSet`: target 검사에 `'reannounce'` 추가.
- 자동 수집: `ResultSchedulerDeps`에 `startJob: (req: JobRequest) => Promise<StartResult>` 추가(기본 deps는 `job-coordinator.ts`의 `startJob`. 순환 import가 생기면 `registerResultScheduler` 호출 지점에서 주입). `applyDone`에서 알림 뒤 `for (const ev of events) if (ev.kind === 'reannounce') { try { await d.startJob({ type: 'collect', ref: { noticeNo: ev.noticeNo, round: ev.round, origin: 'g2b' } }); } catch { /* JOB_ALREADY_RUNNING 등은 무시, 상세 카드 수집 버튼으로 */ } }`. `notify.final`이 꺼져 있어도 수집은 한다(알림과 독립). 자동 수집 잡은 사용자가 패널에서 수집한 것과 같은 취급(auto-compose 규칙 변경 없음). 수집 완료 뒤 승계는 다음 목록 진입 또는 다음 팔로우 알람의 list 실행에서 이뤄진다(즉시 승계를 위해 수집 완료 훅을 추가하지 않는다).
- 클릭: 현행(원 공고 overview).

`result-view.ts`
- `FOLLOW_TARGET_LABEL.reannounce = '재공고까지'`.
- `followMenuItems(following: FollowTarget | null, result: IndexEntry['result'] | undefined, notify)`(시그니처 변경, `rankDone`은 내부에서 `result?.status === 'ranked'`):
  - `rank`, `final`: 현행 규칙. 추가로 `result?.status === 'no_bid'`면 둘 다 disabled, description "이미 유찰된 공고입니다". no_bid 외 종료 상태면 둘 다 disabled, description "결과가 확정된 공고입니다".
  - `reannounce`: label "재공고까지". description: `result?.status === 'no_bid' && result.reannounce?.status === 'found'` → "이미 재공고가 확인된 공고입니다"(disabled). no_bid 외 종료 상태 → "결과가 확정된 공고입니다"(disabled). `!notify.final` → "설정에서 최종 결과 알림이 꺼져 있어 재공고 알림은 오지 않습니다"(warn). 그 외 → "유찰되면 재공고가 올라올 때까지 확인해 알립니다". checked = following === 'reannounce'.
  - 순서 rank, final, reannounce, off.
- `followButton`: `!e.following && e.result && RESULT_TERMINAL.has(e.result.status)`일 때, `e.result.status === 'no_bid' && e.result.reannounce?.status !== 'found'`면 `{ visible: true, disabled: false }`, 아니면 현행 비활성(reason "결과가 확정된 공고입니다").
- `followHint`: `e.following === 'reannounce'`이고 `e.result?.status === 'no_bid'`: watching → "재공고 확인 중", found → `재공고 ${noticeNo} 확인됨`, expired → null. 그 외 reannounce는 final과 같은 문구.
- `trackSteps(r, now, target)`: `target === 'reannounce'`면 세 단계 뒤에 네 번째 `{ label: '재공고', state }`: `r?.status === 'no_bid'`이고 `reannounce.status === 'found'` → done(label `재공고 ${noticeNo}`), watching → now, 그 외 todo. no_bid일 때 세 번째 단계 label은 "유찰"(done).
- `followErrorText`: `'FOLLOW_REANNOUNCED'` → "이미 재공고가 확인된 공고입니다. 재공고를 팔로우하세요".
- `followToastParts(next, prev, startAt, now, status?: ResultStatus)`: `next === 'reannounce'`: `status === 'no_bid'` → { "팔로우했습니다", "재공고가 올라오면 알려 드릴게요", happy }; 새 팔로우 → { "팔로우했습니다", startAt 미래면 `${formatCheckAt}부터 확인해 낙찰까지 알리고 유찰이면 재공고까지 알려 드릴게요` 아니면 "낙찰까지 알리고 유찰이면 재공고까지 알려 드릴게요", happy }; 범위 변경(prev 있음) → { "팔로우 범위를 바꿨습니다", "유찰이면 재공고까지 알려 드릴게요", happy }. prev가 reannounce이고 next가 final → text "최종 결과까지만 알려 드릴게요". 해제 문구 현행.
- `isFollowing` 현행.

`FollowToggle.tsx FollowMenu`: prop `rankDone: boolean` → `result: IndexEntry['result'] | undefined`. `followMenuItems(following, result, notify)`. 메뉴 항목 3개여도 동작 동일(generic).
`NoticesPage.tsx:471`, `NoticeDetailPage.tsx:206`: `rankDone={...}` → `result={n.result}` / `result={entry.result}`. `applyFollow`의 토스트 호출에 `status` 전달(`followToastParts(..., n.result?.status)`).
`ResultStrip.tsx FollowTrack`: `trackSteps(result, now, target)` 그대로(4단계 대응). `NotifyCard.tsx` final 설명 끝에 " 재공고 발견 알림도 여기에 포함됩니다."
완료 조건: tsc, 아래 테스트.
- `tests/core/result-schedule.test.ts` 추가: reannounceNextCheckAt(followed) 수 12:10 → 수 15:00, 금 15:30 → 월 10:00, 평일 10:00 정각 → 15:00; (비팔로우) now + 24h; 61일 → 둘 다 null; found → null.
- `tests/core/result-plan.test.ts` 추가: planReannounce followed/general 분리; follow 모드 general 빈 배열; target final 팔로우는 general; watching 아님과 due 아님 제외; since 내림차순 상한 5; followed nextCheckAt 오름차순 상한 10; 000/001 중 001만.
- `tests/core/reannounce.test.ts` 추가: ensureWatches(no_bid + reannounce 없음 → watching since checkedAt; checkedAt 없으면 openingAt; 61일 지난 것은 expired; 이미 있으면 불변; won 불변).
- `tests/g2b/reannounce-api.test.ts`: matchReannounce(prevNo 우선, 자기 자신 제외, 제목 정규화 매칭, 여러 건이면 bidNtceDt 최신, 없으면 null); searchReannounce(op 순회 중단, 오류 즉시 반환 calls, 모두 없음 hit null opKind null calls 4, URL에 inqryDiv와 dminsttCd와 YYYYMMDDHHMM 기간); formatKstCompact(UTC 2026-02-01T00:00Z → 202602010900); isStopError(빈 배열 false).
- `tests/engine/result-tracker.test.ts` 추가: no_bid 판정 시 팔로우 없어도 watching 생성; no_bid + target reannounce → final 이벤트 `watchingReannounce` + 팔로우 유지 + watching; no_bid + target final → 해제(현행); 감시 틱: codes 없으면 notice.json codes 사용, 그것도 없으면 fetchNotice 1회 후 orgCode/opKind 저장; hit → found + reannounce 이벤트 1회, 두 번째 실행 이벤트 없음; 비팔로우 hit → found, events 빈 배열, updated 증가; follow 모드에서 비팔로우 검색 0회; list 모드 general 5건까지; 호출 예산 소진 시 남은 항목 nextCheckAt 불변; 키 오류 → KEY_INVALID 중단; 61일 → 팔로우는 expired + 이벤트 + 해제, 비팔로우는 expired만; 승계: found.noticeId가 index에 있으면 새 팔로우 target reannounce notified {} 옛 팔로우 제거; minNext에 팔로우 watching 포함, 비팔로우 미포함; 백필 앞에서 감시 루프 실행.
- `tests/engine/follow-api.test.ts` 추가: no_bid + reannounce 허용 + watching 생성 + 응답 startAt이 nextCheckAt; no_bid + final → FOLLOW_FINISHED; found → FOLLOW_REANNOUNCED; expired 감시에 다시 켜면 since 재시작; 옛 파일 target 'reannounce' 유지.
- `tests/background/result-scheduler.test.ts` 추가: 문구 5종(no_bid 기본, watchingReannounce, inferred, reannounce, reannounce_expired); id 정규식에 새 kind; notify.final off면 reannounce 미발송; followSet 'reannounce' 통과, 'x' 거부; applyDone에서 reannounce 이벤트마다 startJob collect 호출(ref origin 'g2b'), events 비어 있으면 미호출, startJob throw해도 알람 재예약은 수행.
- `tests/ui/result-view.test.ts` 추가: followMenuItems 3항목과 순서, no_bid면 rank/final 비활성, found면 reannounce 비활성, lost면 전부 비활성, notify.final off 경고; followButton no_bid 활성, no_bid+found 비활성; followHint 3문구; trackSteps reannounce 4단계; followToastParts reannounce 4경우; followErrorText.

### P4 수동 수집 버튼과 마무리
- P2의 `ReannounceCard` 수집 버튼이 비팔로우 공고의 유일한 수집 경로다(자동 수집 없음). P3 완료 뒤 `tests/engine/result-tracker.test.ts`에 "비팔로우 found 항목은 startJob 경로를 타지 않는다"가 SW 테스트(events 비어 있음)로 고정돼 있는지 확인.
- `NotifyCard.tsx` 문구 반영, `docs` 갱신 없음.
완료 조건: 전체 `npx vitest run`, `npx tsc --noEmit`.

## 하지 말아야 할 것
- 1단계 0건을 유찰로 판정하기. 2단계 0건을 유찰 근거로 쓰기.
- `ntceKindNm === '재공고'`로 재공고 판정하기. 같은 noticeNo의 차수 증가를 재공고로 잇기.
- `RESULT_TERMINAL`에서 no_bid 빼기. `planTargets`에 감시 항목 넣기.
- 감시 상태를 follows.json에 넣기. 사용자 의사는 `target` 하나.
- 재공고를 찾았다고 원 공고 팔로우를 바로 지우기. 승계는 재공고가 index에 들어온 뒤 list 모드에서만.
- 비팔로우 공고에 알림, 자동 수집, 승계 적용하기. 비팔로우 감시를 `minNext`에 넣어 알람을 당기기.
- 비팔로우 감시를 follow 모드(알람)에서 돌리기. list 모드 전용.
- 재공고 수집으로 유찰을 추정할 때 won, lost, ranked, not_participated 덮기.
- SW에서 승계나 해제 판단하기. SW는 문구, 필터, 수집 잡 시작만.
- `follows.json`, `results.json`, `index.json`을 열자마자 고쳐 쓰기. `schemaVersion`, `INDEX_VERSION` 올리기.
- `FAILING_OP`, `REANNOUNCE_STOP_CODES`를 실측 없이 채우기.
- 기간 검색 두 번째 페이지 조회하기(1차 범위 밖).
- 가운뎃점(·) 사용.

## 흔한 오해
- "재공고까지"는 확인 주기를 바꾸지 않는다. 유찰 뒤 해제 시점만 미룬다. 개찰 전, 순위, 최종 결과 단계는 "낙찰까지"와 같다.
- 유찰 알림과 재공고 발견 알림은 별개 알림 2건이고 둘 다 `notify.final`로 걸러진다.
- 재입찰(같은 공고 rbidNo 증가)은 재공고가 아니다. 1단계 `latestBundle`이 처리하고, 규칙 (B)의 rbidNo 비교가 1차 유찰 기록으로 no_bid가 되는 것을 막는다.
- "재공고 있음"(원 공고)과 "재공고"(재공고 쪽) 배지는 다른 공고에 붙는다.
- 비팔로우 공고의 감시도 60일 뒤 expired가 되지만 알림은 없고 배지도 바뀌지 않는다(유찰 그대로).
- 팔로우를 끄면 감시 객체는 남고 비팔로우 간격(24시간, list 모드)으로 계속 확인된다. 다시 켜면 10분 뒤부터 정시 슬롯으로 돌아간다.
- `ensureWatches`는 배포 전 유찰 항목을 위한 것이다. 새 유찰은 대상 루프에서 바로 watching이 된다.
- 자동 수집은 이벤트가 있을 때만 일어나고 이벤트는 팔로우 공고에서만 생긴다. 비팔로우 공고를 자동 수집하지 않기 위한 별도 분기는 없다.
- 호출 예산 20은 비팔로우 감시에만 적용된다. 팔로우 감시는 상한 10건으로만 제한한다.

## 하위 호환
- 옛 results.json: `reannounce` 없음. 유찰 항목은 list 모드 `ensureWatches`가 보충(60일 지난 것은 expired). 그 외 항목은 유찰 판정 시 생성.
- 옛 follows.json: `target`이 `'rank'` 또는 `'reannounce'`가 아니면 `'final'`. 파일은 고쳐 쓰지 않는다.
- 옛 notice.json: `codes`, `reannounceOf` 없음. 감시에 필요할 때만 `fetchNotice`로 보충해 results.json의 watch에 저장한다(notice.json은 고치지 않는다). 이미 수집돼 있던 옛 재공고는 연결되지 않는다("다시 수집"하면 `reannounceOf`가 채워져 다음 list 실행에 연결).
- 옛 index.json: `reannounceOf` 없음이 정답. INDEX_VERSION 유지.
- `IndexEntry.result.reannounce`, `reannounceOfId`는 파생 필드라 index.json에 저장하지 않는다.
- 프로토콜: `follow/set`의 target 값 하나 추가, `result/probe` 응답 필드 추가. 기존 호출자는 영향 없음.

## 수동 검증 (사용자, dist 빌드 로드)
1. P0: 설정 진단의 결과 probe에 `R26BK01789254` 입력 → 공고정보, 개찰결과, 유찰 목록, 낙찰정보 4블록. 기관 probe에 `B553501` 2026-02 → `R26BK01350089`와 `befBidBbancNo` 확인. decisions.md에 기록 후 상수 교체.
2. P1: `R26BK01789254-000`을 수집(이미 있으면 유지) → 공고 목록 진입 → 제목 옆 "유찰" 배지, "유찰" 필터 카운트 1 이상, 셀 "유찰". results.json의 해당 항목 `status: 'no_bid'`, `reannounce.status: 'watching'`.
3. P2: 재공고(예: `R26BK01350089`)와 그 원 공고(`R26BK01289373`)를 둘 다 수집 → 목록 재진입 → 원 공고 "유찰, 재공고 있음"(원 공고가 대기 상태였으면 유찰로 바뀜), 재공고 행 "재공고" 배지, 양쪽 상세의 재공고/원 공고 카드에 "열기" 링크.
4. P3 비팔로우: 2번 공고를 팔로우하지 않은 채 목록을 열고 10분 뒤 다시 열기 → results.json `reannounce.checkedAt`이 찍히고 `nextCheckAt`이 약 24시간 뒤. OS 알림 없음.
5. P3 팔로우: 2번 공고의 별 → 메뉴에서 "개찰 결과만", "낙찰까지"는 비활성, "재공고까지" 선택 → 토스트 "재공고가 올라오면 알려 드릴게요", 둘째 줄 "재공고 확인 중". SW 콘솔 `chrome.alarms.get('follow-check')` scheduledTime이 약 10분 뒤, 그다음은 다음 평일 10시 또는 15시. 재공고가 실제로 있는 공고라면 첫 틱에 OS 알림 "재공고 발견"과 수집 잡 시작, 다음 목록 진입 시 팔로우가 재공고 행으로 옮겨져 "재공고까지" 표시, 원 공고는 "유찰, 재공고 있음".
6. 설정 > 알림에서 최종 결과 알림을 끄면 메뉴 "재공고까지" 설명이 경고 문구로 바뀌고 알림이 오지 않는다(수집은 된다).
7. 키 제거 → 감시 호출 0회, 유찰 배지와 재공고 표시는 캐시대로 유지.

## 보고 형식
결론, 변경 파일 경로(줄 범위), 테스트 결과, 명세와 다르게 한 점과 이유, 실패 항목. 한국어, 가운뎃점(·) 사용 금지.
