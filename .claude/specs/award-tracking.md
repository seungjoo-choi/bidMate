# 낙찰 결과 추적과 팔로우 알림 (award-tracking)

Fable 설계(2026-10-20), 사용자 승인. 결정 기록은 `.claude/specs/decisions.md`의 같은 날짜 "낙찰 결과 추적" 항목.

## 목표
- 공고 목록에서 우리 회사가 최종 낙찰된 공고에 "낙찰" 배지와 "낙찰" 필터를 보여 준다. 다른 상태(대기, 순위, 탈락, 미참여, 유찰, 종료)는 화면에 그리지 않는다.
- 일반 공고는 공고 목록을 열 때만 결과를 확인한다(주기 알람 없음).
- 사용자가 "팔로우"한 공고만 chrome.alarms로 자주 확인하고 OS 알림(chrome.notifications)을 보낸다.

## 불변 원칙
- 1순위는 낙찰이 아니다. "낙찰(won)"은 2단계(낙찰정보 API)에서 낙찰 업체가 우리일 때만(또는 S0에서 확인된 1단계 낙찰 플래그). 2순위 이하도 2단계 확정 전엔 lost가 아니다.
- 파일 쓰기는 offscreen만(기존 결정). SW는 파일을 쓰지 않는다. notice.json, index.json, `entryOf`는 건드리지 않는다.
- `src/adapters/g2b/open-result-api.ts`(`fetchOfficialResult`)는 수정하지 않는다(평가 점수 분석이 사용).
- 서비스키 또는 우리 사업자번호(Settings.company.bizNo)가 없으면 API 호출 0회, offscreen도 띄우지 않는다.
- `result/refresh`, `follow/set`은 throw하지 않는다. 결과 추적이 실패해도 목록 화면은 정상 동작.
- 대시보드 payload에 서비스키를 넣지 않는다. 키는 SW가 secrets에서 읽어 offscreen 전용 메시지에만 주입, 오류 메시지는 `redactKey`.
- 사업자번호 비교 전 숫자만 남긴다(API가 하이픈 포함으로 올 수 있음). `src/core/evaluation/company.ts`의 정규화/`isOurs` 재사용.
- `supersededBy`에 의존하지 않는다(채워지지 않음). 최대 round는 직접 계산.

## API (확인 / 추정)
- 1단계(확인됨): `https://apis.data.go.kr/1230000/as/ScsbidInfoService/getOpengResultListInfoOpengCompt?inqryDiv=4&bidNtceNo=…&type=json`, 항목 `prcbdrBizno`, `opengRank`, `bidNtceOrd`, `bidprcAmt`, `totalEvlAmtVal`. numOfRows 999.
- 1단계 추가 필드(추정, S0 확인): `sucsfYn`(낙찰여부), `rbidNo`(재입찰번호), `progrsDivCdNm`, `rlOpengDt`.
- 2단계(추정, S0 확인): 같은 서비스 `getScsbidListSttusServc`, `getScsbidListSttusThng`, `getScsbidListSttusCnstwk`, `getScsbidListSttusFrgcpt`. 파라미터 `inqryDiv=2` + `bidNtceNo`. 응답 `bidwinnrBizno`, `bidwinnrNm`, `sucsfbidAmt`, `sucsfbidRate`, `fnlSucsfDate`, `bidNtceOrd`, `rbidNo`.
- 업무구분이 공고에 없으므로 2단계는 Servc, Thng, Cnstwk, Frgcpt 순 호출, 첫 비어 있지 않은 응답 사용 후 `listOp`에 기억(다음부터 그 하나만). 호출 오류는 즉시 반환(다음 op 시도 안 함), 빈 응답이면 다음 op. 4개 모두 빈 응답이면 낙찰 미확정.
- 필드명은 `AWARD_FIELDS` 상수 객체 한 곳에 모아 S0 결과로 교체 가능하게 한다. 확인 안 된 필드 상수는 빈 문자열로 두고, 빈 문자열이면 해당 규칙 비활성.

## 상태 모델 (`src/core/types/result.ts` 신설)
```ts
export type ResultStatus =
  | 'waiting'          // 개찰 전이거나 결과/순위 미게시
  | 'ranked'           // 순위 있음, 최종 낙찰자 미확정
  | 'won' | 'lost' | 'not_participated' | 'no_bid' | 'expired'; // 종료
export const RESULT_TERMINAL: ReadonlySet<ResultStatus>; // won, lost, not_participated, no_bid, expired

export interface ResultEntry {
  noticeId: string; noticeNo: string; round: string;
  status: ResultStatus;
  openingAt: ISODate;           // 없으면 bidCloseAt 대체, 둘 다 없으면 항목 미생성
  proposalEvalAt?: ISODate;
  startAt: ISODate;             // max(openingAt, proposalEvalAt)
  rank?: number; bidders?: number;
  winnerBizNo?: string; winnerName?: string; awardedAt?: ISODate; amount?: number;
  listOp?: string;
  phase?: 'burst' | 'office' | 'ranked';
  checkedAt?: ISODate; nextCheckAt: ISODate; attempts: number;
  lastError?: { code: string; message: string };
}
export interface ResultFile { schemaVersion: 1; bizNo: string; updatedAt: ISODate; entries: Record<string, ResultEntry> }

export interface FollowEntry { noticeId: string; followedAt: ISODate; notified: { rank?: ISODate; final?: ISODate } }
export interface FollowFile { schemaVersion: 1; updatedAt: ISODate; entries: Record<string, FollowEntry> }

export type NotifyEvent =
  | { kind: 'rank'; noticeId: string; title: string; rank: number; bidders: number }
  | { kind: 'final'; noticeId: string; title: string; status: 'won'|'lost'|'not_participated'|'no_bid'; rank?: number; winnerName?: string }
  | { kind: 'expired'; noticeId: string; title: string };

export interface ResultRunSummary {
  ran: boolean; checked: number; updated: number; won: number;
  skipped?: 'NO_KEY'|'NO_BIZNO'|'NO_FS'|'THROTTLED'|'BUSY'|'KEY_INVALID';
  error?: string;
  nextFollowCheckAt: ISODate | null;
  events: NotifyEvent[];
}
```
- IndexEntry(`src/core/types/index-file.ts`)에 선택 필드 `result?: { status: ResultStatus; rank?: number; awardedAt?: ISODate }`, `following?: true`. index.json에 저장하지 않고 `listNotices`가 합친다.
- 설정(`src/core/types/settings.ts`): `notify: { rank: boolean; final: boolean }` 기본 둘 다 true. `default-settings.ts` withDefaults에 `notify: { ...d.notify, ...stored.notify }`. `SettingsSection`에 `'notify'`. expired 알림은 `notify.final`에 묶는다.

## 저장
- `results.json`(저장 폴더 루트, 락 키 동일): 파생 캐시. 손상/없음이면 빈 파일로 취급하고 재계산.
- `follows.json`(루트): 사용자 의사. 손상 시 `follows.corrupt-<ts>.json`으로 이름 바꿔 남기고 빈 파일로 시작.
- index에 없는 noticeId 항목은 실행 시 제거(prune).
- 저장 순서: results.json 다음 follows.json. 실행 도중 오류여도 try/finally로 진행분 저장.
- `file.bizNo !== 현재 bizNo`면 모든 결과 항목을 waiting, attempts 0, nextCheckAt now로 초기화.

## 판정 규칙 (`src/core/results/judge.ts`, 순수 함수)
입력: 우리 bizNo, now, 이전 항목, 1단계 결과(행 또는 오류), 2단계 결과(행 또는 null 또는 오류). 출력 `{ entry, event?: 'rank' | 'final' | 'expired' }`.
위에서 먼저 맞는 하나:
1. 1단계 오류: 상태 유지, attempts+1, lastError, nextCheckAt = now + backoff(attempts). `G2B_KEY_INVALID`/`G2B_KEY_MISSING`이면 엔진이 실행 전체 중단.
2. 2단계에 낙찰 업체 사업자번호 있음: 우리면 won(awardedAt = 낙찰일 필드 또는 fetchedAt, amount), 아니면 lost(winnerBizNo, winnerName).
3. 1단계 우리 행에 낙찰 플래그(AWARD_FIELDS.openingWon, S0 확인 전엔 비활성) → won.
4. 1단계 유찰 식별 필드(S0 확인 전엔 비활성) → no_bid.
5. 1단계 행 중 순위 있는 행(rank !== null 또는 totalScore !== null)이 0개 → waiting(bidders = 행 개수).
6. 순위 있는 행이 1개 이상이고 우리가 없음 → not_participated.
7. 우리가 있음 → ranked(rank, bidders).
8. 5 또는 7 결과인데 now - openingAt > 120일 → expired.
보조: 1단계 행은 bidNtceOrd로 거르지 않는다(결과는 마지막 차수 기준). rbidNo가 있으면 최대 rbidNo 묶음만 본다. backoff = 30분, 2시간, 6시간, 24시간, 이후 24시간.
이벤트: rank = 이전 waiting, 새 ranked. final = 새 상태가 won/lost/not_participated/no_bid이고 이전이 그 상태가 아님. expired = 새 상태 expired. 같은 상태 반복이면 이벤트 없음.
2단계 호출 조건: 1단계에서 우리가 ranked이거나 prev.status가 ranked, 또는 1단계 빈 배열이지만 prev.listOp가 있을 때. not_participated 판정 시 2단계 미호출.

## 대상 선정 (`planTargets`, 순수 함수)
- `kindOf(e) === 'bid'`만(사전규격 제외). 같은 noticeNo는 round 최대 하나만(`latestRound`).
- 결과 항목이 없는 공고는 엔진이 notice.json을 1회 읽어 openingAt, proposalEvalAt 확보 후 `newEntry`. 첫 확인 시각 = openingAt + 30분.
- 일반 대상: 비종료이고 nextCheckAt <= now, openingAt 내림차순, 상한 15(RESULT_BATCH_MAX). 120일 이전 공고는 1회 확인 후 미확정이면 expired.
- 반환: `{ targets, prune, needOpening }`.

## 팔로우 주기 (`src/core/results/schedule.ts`, 순수 함수)
```ts
export const KST_OFFSET_MS = 9 * 3600_000;
export function kstParts(ms: number): { dow: number; hour: number; minute: number; dayStartMs: number }
export function isKstWeekday(ms: number): boolean
export function nextKstSlot(nowMs: number, hours: readonly number[]): number   // now보다 큰 첫 평일 정시
export function followStartAt(openingAt: ISODate | null, proposalEvalAt: ISODate | null): ISODate | null
export function followNextCheckAt(e: Pick<ResultEntry,'status'|'startAt'>, nowMs: number): number | null
```
followNextCheckAt:
1. 종료 상태 → null
2. now < startAt → startAt + 10분
3. waiting이고 now < startAt + 6시간 → now + 10분
4. waiting, 그 뒤 → nextKstSlot(now, [9..17]) (18시 이후, 주말은 다음 평일 09:00)
5. ranked → nextKstSlot(now, [10, 14, 17])
팔로우 공고의 nextCheckAt은 이 값으로 덮어쓴다. 공휴일 미고려.

## 상수 (`src/core/results/limits.ts`)
RESULT_BATCH_MAX=15, RESULT_FIRST_DELAY_MS=30분, RESULT_BACKOFF_MS=[30분,2h,6h,24h], RESULT_TRACK_DAYS=120, RESULT_REFRESH_THROTTLE_MS=10분, RESULT_RUN_TIMEOUT_MS=120_000, FOLLOW_FIRST_DELAY_MS=10분, FOLLOW_BURST_MS=6h, FOLLOW_BURST_INTERVAL_MS=10분, FOLLOW_OFFICE_HOURS=[9..17], FOLLOW_RANKED_HOURS=[10,14,17], FOLLOW_BATCH_MAX=20.

## 엔진 (offscreen)
- `src/engine/results/result-store.ts`: `ResultStore { load(); save(f) }`. 권한 오류(NEEDS_FS_PERMISSION, DISK_FULL)만 던짐.
- `src/engine/results/follow-store.ts`: load, save, 손상 시 rename.
- `src/engine/results/result-tracker.ts`: `runResultRefresh(deps, { mode: 'list' | 'follow' })`.
  - deps: `{ store: IFileStore; fetch; serviceKey; bizNo; now?; checkPermission() }`.
  - 공통 순서: checkPermission → loadIndex → results/follows load → bizNo 초기화 → prune → needOpening → 대상 확인 → judge → 이벤트 처리 → 저장.
  - list: 팔로우 공고의 notice.json을 다시 읽어 openingAt, proposalEvalAt, startAt 갱신(바뀌었고 비종료면 attempts 0, nextCheckAt 재계산). 같은 noticeNo에 더 큰 round가 수집됐으면 팔로우를 그 noticeId로 이전(notified 승계). 대상 = due 팔로우(상한 20) + 일반 15.
  - follow: due 팔로우만(상한 20), notice.json 재읽기 없음.
  - 이벤트: 팔로우 공고이고 follows의 notified[kind]가 비어 있을 때만 events에 담고 시각 기록(expired는 final 슬롯 사용). final/expired가 나오면 follows에서 제거(자동 해제).
  - nextFollowCheckAt = 남은 팔로우 공고 nextCheckAt 최솟값, 없으면 null.
  - KEY_INVALID면 즉시 중단 `skipped:'KEY_INVALID'`.
- `src/engine/results/follow-api.ts`: `setFollow(store, { noticeId, follow }, { now })`.
  - follow=true: notice.json에서 followStartAt, null이면 `FOLLOW_NO_SCHEDULE`("개찰일시나 제안서 평가일시가 없어 팔로우할 수 없습니다"). 사전규격 `FOLLOW_UNSUPPORTED`. 종료 상태면 `FOLLOW_FINISHED`("이미 결과가 확정된 공고입니다"). 결과 항목 없으면 생성(waiting), 있으면 nextCheckAt 재계산.
  - follow=false: follows에서 제거만(결과 항목 유지, nextCheckAt은 일반 backoff로 복귀).
  - 응답 `{ following, nextFollowCheckAt, startAt }`.
- `src/engine/notices/notice-api.ts` listNotices: results.json, follows.json을 try/catch로 읽어 `result`, `following` 병합. 실패는 무시.

## 어댑터 (`src/adapters/g2b/award-api.ts` 신설)
```ts
export const AWARD_OPS = ['getScsbidListSttusServc','getScsbidListSttusThng','getScsbidListSttusCnstwk','getScsbidListSttusFrgcpt'] as const;
export const AWARD_FIELDS = { … };   // 필드명 한 곳
export interface OpeningRow { bizNo: string; rank: number | null; totalScore: number | null; rbidNo: string | null; won: boolean | null }
export interface AwardRow { bizNo: string; name: string | null; amount: number | null; awardedAt: ISODate | null; rbidNo: string | null }
export function mapOpeningRows(items: ApiItem[]): OpeningRow[]
export function mapAwardRows(items: ApiItem[]): AwardRow[]
export async function fetchOpeningRaw(noticeNo, ctx)   // S0 probe용 원본
export async function fetchAwardRaw(noticeNo, op, ctx)
export async function fetchOpening(noticeNo, ctx): Promise<{ ok:true; rows: OpeningRow[]; fetchedAt } | { ok:false; error }>
export async function fetchAward(noticeNo, ops: readonly string[], ctx): Promise<{ ok:true; rows: AwardRow[]; op: string | null; fetchedAt } | { ok:false; error }>
```
`fetchJsonOp`, `G2bContext`(`src/adapters/g2b/openapi.ts`) 재사용. 키 없으면 G2B_KEY_MISSING. 날짜는 `toIsoKst` 재사용.

## 프로토콜 (`src/messaging/protocol.ts`)
```ts
| { type: 'result/refresh'; payload: { reason: 'list' | 'manual' }; response: ResultRunSummary }   // 대시보드→SW
| { type: 'result/run'; payload: { mode: 'list' | 'follow'; serviceKey: string; bizNo: string }; response: ResultRunSummary }   // SW→offscreen 전용
| { type: 'follow/set'; payload: { noticeId: string; follow: boolean }; response: { following: boolean; nextFollowCheckAt: ISODate | null; startAt: ISODate | null } }   // 대시보드→SW→offscreen
| { type: 'result/probe'; payload: { noticeNo: string; serviceKey?: string }; response: ResultProbeResult }   // 대시보드→SW→offscreen(키는 SW가 주입)
```
`ResultProbeResult = { opening: ProbePart; award: Array<ProbePart & { op: string }> }`, `ProbePart = { ok: boolean; count: number; keys: string[]; sample: ApiItem[]; error?: string }`(sample 앞 3건).

## SW (`src/background/result-scheduler.ts` 신설)
- `registerResultScheduler(deps?)`, `refreshResults(reason: 'alarm'|'list'|'manual'|'follow', deps)`, `armFollowAlarm(nextAt)`.
- deps 주입: `alarms: Pick<typeof chrome.alarms,'create'|'clear'|'get'>`, `notifications: Pick<typeof chrome.notifications,'create'|'clear'>`, `storage`, `toOffscreen`, `openDashboard`, `now`.
- refreshResults: secrets.g2bServiceKey, settingsCache.company.bizNo(10자리) 확인, 없으면 skipped(알람 미설정, offscreen 미기동). list는 session `resultRefreshAt` 10분 스로틀. `ensureOffscreen` 후 `result/run`. 성공 시 resultRefreshAt 갱신. 예외는 `{ ran:false, error }`(redactKey)로 반환.
- 알람 `follow-check` 하나: clear 후 nextAt 있으면 `create({ when: max(nextAt, now+5s) })`. 재예약 시점: result/run 응답마다, follow/set 응답마다, onStartup/onInstalled에서 follow 모드 1회 실행 후. BUSY면 now+2분. storage.onChanged로 secrets/settingsCache 변경 시 follow 모드 1회(auto-compose.ts:213 패턴).
- 알림 발송은 SW(offscreen은 chrome.notifications 불가). settingsCache.notify로 거름(rank → notify.rank, final/expired → notify.final). 꺼져 있던 이벤트는 버림(재발송 없음).
- notification id `result:<noticeId>:<kind>`, type basic, iconUrl은 public 폴더의 확장 아이콘(구현 시 확인). 문구:
  - rank: "개찰 순위 확인" / "〈공고명〉 우리 N위, 참여 M개사"
  - won: "낙찰" / "〈공고명〉 낙찰되었습니다"
  - lost: "탈락" / "〈공고명〉 낙찰 업체: 〈업체명 또는 사업자번호〉"
  - not_participated: "결과 확정" / "〈공고명〉 개찰 결과에 우리 회사가 없습니다"
  - no_bid: "유찰" / "〈공고명〉 유찰되었습니다"
  - expired: "추적 종료" / "〈공고명〉 120일 동안 결과가 확정되지 않아 팔로우를 해제했습니다"
- onClicked: id 파싱 → `openDashboard('#/notices/<encodeURIComponent(noticeId)>/overview')`(`src/background/dashboard-tabs.ts`) → clear. 리스너는 최상위 동기 등록.
- 릴레이: `result/refresh`, `follow/set`, `result/probe` 모두 assertExtensionSender. router.ts의 EXTENSION_ONLY_TYPES에는 넣지 않는다(키 주입 필요).
- `wxt.config.ts` permissions에 `'alarms'`, `'notifications'` 추가.

## offscreen (`src/entrypoints/offscreen/main.ts`)
- `result/run`: 모듈 변수 Promise로 단일 실행, 실행 중이면 BUSY. NEEDS_FS_PERMISSION은 `skipped:'NO_FS'`.
- `follow/set`, `result/probe` listen.

## 화면 (S4, 디자인은 메인이 목업 확인 후 확정)
- 공고 목록: 낙찰 배지(제목 옆, 제목 잘림과 무관), 필터 탭 "낙찰"(0건이어도 표시), 팔로우 토글(행), 키/사업자번호 미설정 안내 한 줄(bid 공고 1건 이상일 때, 설정 열기 버튼), 로드 후 `result/refresh list` fire-and-forget, `updated > 0`이면 재로드.
- 팔로우 버튼 비활성: 종료 상태, 사전규격(title로 이유).
- 공고 상세 header: 팔로우 토글 버튼.
- 설정: `NotifyCard.tsx`(section 'notify', "결과 알림") 체크박스 2개 + macOS 알림 허용 안내. useSettingsStatus에 notify 상태.
- 순수 뷰 함수 `src/ui/notices/result-view.ts`: `isWon`, 필터 카운트, 팔로우 버튼 상태.

## 단계
- S0 실측 probe: award-api.ts의 AWARD_OPS, fetchOpeningRaw, fetchAwardRaw / protocol `result/probe` / result-scheduler.ts(probe 릴레이만) + background.ts 등록 / offscreen listen / `src/entrypoints/dashboard/ResultProbeSection.tsx`(EvalProbeSection과 같은 자리, 스타일) 설정 g2b 섹션에 부착. 사용자가 낙찰, 탈락, 유찰, 개찰 전 공고로 실측 → decisions.md 기록, AWARD_FIELDS 확정.
- S1 코어/엔진/어댑터 + 단위 테스트.
- S2 SW 스케줄러, 알림, 권한, 프로토콜.
- S3 offscreen 연결.
- S4 화면.
- S5(보류) 수동 "결과 다시 확인".

## 테스트 포인트
- `tests/g2b/award-api.test.ts`: 매핑(하이픈 제거, 빈 사업자번호 제외, rank null), fetchAward op 순회(첫 비어있지 않은 op에서 멈춤, 오류 즉시 반환, 모두 빈 배열 → rows [] op null), 키 없음 G2B_KEY_MISSING, URL 파라미터.
- `tests/core/result-judge.test.ts`: 규칙 1~8 각 1건 이상, 특히 1순위+2단계 없음 → ranked, 2순위+2단계 우리 → won, 1순위+2단계 타사 → lost, 우리 없음 → not_participated(2단계 미호출), 순위/점수 모두 null → waiting, 121일 → expired, 오류 → 상태 유지+backoff, 이벤트 전이, 같은 상태 반복 이벤트 없음. planTargets: bizNo 변경 초기화, 000/001 중 001, prespec 제외, openingAt 없으면 bidCloseAt, 둘 다 없으면 미생성.
- `tests/core/result-schedule.test.ts`: kstParts UTC 경계, nextKstSlot(금 17:30 → 월 09:00, 수 12:10 → 수 13:00, 토 → 월 09:00, 평일 10:00 정각 → 11:00), followNextCheckAt 규칙 1~5, burst 경계(5h59 → +10분, 6h00 → 다음 정시), ranked 금 17:01 → 월 10:00, followStartAt.
- `tests/engine/result-tracker.test.ts`: 배치 상한, 내림차순 우선, 종료 상태 재호출 없음, listOp 기억, 중단 시 진행분 저장, NO_FS, prune, follow 모드 일반 대상 미호출, list 모드 startAt 갱신, 팔로우 이전(notified 승계), final 후 자동 해제, notified로 2회차 이벤트 없음, nextFollowCheckAt 최솟값/null, 저장 순서.
- `tests/engine/follow-api.test.ts`: FOLLOW_NO_SCHEDULE, FOLLOW_FINISHED, FOLLOW_UNSUPPORTED, 해제 시 결과 유지, 손상 follows.json rename.
- `tests/engine/notice-api.test.ts`: listNotices 병합, 손상 시 result 없이 반환.
- `tests/background/result-scheduler.test.ts`: clear 후 create(when), null → clear만, 과거 시각 → now+5s, BUSY → now+2분, onStartup follow 1회, notify off면 create 미호출, id 형식, onClicked 경로와 clear, list 스로틀/follow 무스로틀, 키 없음 → 알람 미설정, throw 없음, 키 마스킹.
- `tests/core/default-settings.test.ts`: notify 기본값 병합.
- `tests/ui/result-view.test.ts`: isWon, 필터 카운트, 팔로우 비활성 조건.

## 수동 검증
1. S0: 설정 probe에 실제 공고번호 입력 → 2단계 응답 op, 필드 확인.
2. 빌드(dist 로드) → 키, 사업자번호 저장 → 공고 목록 진입 → results.json 생성 → 낙찰 배지.
3. 팔로우 켜기 → SW 콘솔 `chrome.alarms.get('follow-check')` scheduledTime이 주기 규칙과 일치.
4. 알림 클릭 → 상세 overview. 설정 토글 off → 알림 없음.
5. 키 제거 → 안내 한 줄, results.json 변경 없음. 폴더 권한 prompt 상태 알람 → 조용히 skip.
