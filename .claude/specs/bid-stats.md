# 실적 집계 명세

결정 근거: `.claude/specs/decisions.md`의 "2026-10-21 실적 집계" 절. 화면 목업: `.claude/specs/bid-stats-mockup.html`.

## 목표
앱에 등록하고 낙찰 결과를 추적한 공고의 투찰/낙찰 건수, 금액, 순위 분포, 발주기관별 집계를 보여 준다. 대시보드 독립 메뉴 "실적" 페이지 + 홈 숫자 카드 아래 한 줄 띠 + 공고목록 위 한 줄 띠.

## 불변 조건
- `ResultFile.schemaVersion`은 1 그대로. 올리면 기존 results.json이 버려져 API 호출이 폭증한다.
- 백필에서 `judge()`를 다시 돌리지 않는다. 종료 상태가 바뀌면 안 된다.
- 1순위(ranked)를 낙찰로 세지 않는다.
- `src/adapters/g2b/open-result-api.ts`, `fetchOfficialResult`는 수정 금지(평가 분석이 사용).
- results.json에 orderingOrg를 저장하지 않는다. 집계는 index에서 합친다.
- 월 키는 로컬 시간(`getFullYear`, `getMonth`). `toISOString().slice(0,7)` 금지.
- 문서, 주석, 화면 문구에 가운뎃점 문자(U+00B7) 금지.

## S1 금액 확보

### 1. 타입 `src/core/types/result.ts`
`ResultEntry`에 선택 필드 추가:
```ts
/** 1단계 우리 행의 투찰금액(bidprcAmt). 우리 행이 없거나 값이 없으면 생략 */
ourAmount?: number;
/** 백필로 1단계를 다시 읽은 시각. 있으면 다시 시도하지 않는다(값 유무와 무관) */
amountCheckedAt?: ISODate;
```

### 2. 어댑터 `src/adapters/g2b/award-api.ts`
- `AWARD_FIELDS`에 `openingAmount: 'bidprcAmt'`.
- `OpeningRow`에 `bidAmount: number | null`, 1단계 행 매핑에서 `toNum(i[F.openingAmount])`.

### 3. 판정 `src/core/results/judge.ts`
- `Decision`에 `ourAmount` 포함. 우리 행(`mine`)이 있고 `mine.bidAmount !== null`이면 won, lost, ranked, expired(ranked에서 전이) 판정 결과에 `ourAmount` 설정. waiting, not_participated, no_bid는 설정하지 않음.
- `judge()`가 prev에서 파생 필드를 지우는 목록(현재 108행 근처 `rank, bidders, winnerBizNo, ...amount` 구조분해)에 `ourAmount` 추가. `amountCheckedAt`은 지우지 않는다.
- 신설:
```ts
/** 백필 전용. 상태를 바꾸지 않고 ourAmount(있으면 bidders)만 채우고 amountCheckedAt을 찍는다. */
export function applyOurAmount(prev: ResultEntry, rows: OpeningRow[], ourBizNo: string, checkedAt: ISODate): ResultEntry
```
  - 기존 판정과 같은 방식으로 최신 재입찰 묶음(`latestBundle` 등 기존 함수)을 고른 뒤 우리 행 탐색(사업자번호 비교도 기존 방식 재사용).
  - 우리 행의 `bidAmount !== null`이면 `ourAmount` 설정. `prev.bidders === undefined && rows.length > 0`이면 `bidders` 보충.
  - 항상 `amountCheckedAt = checkedAt`. status, rank, winner 계열, amount, nextCheckAt, attempts 등 나머지는 그대로.

### 4. 대상 선정 `src/core/results/plan.ts`, `limits.ts`
- `limits.ts`에 `RESULT_BACKFILL_MAX = 10`.
- 신설:
```ts
/** 투찰금액이 없는 종료 항목. won, lost 전부 + expired는 rank가 있을 때만. ourAmount 있거나 amountCheckedAt 있으면 제외. openingAt 내림차순, 상한 RESULT_BACKFILL_MAX */
export function backfillTargets(index: IndexEntry[], results: ResultFile): string[]
```
  - 기존 `latestBids(index)`의 noticeId만 대상(사전규격, 구 round 제외).
- `resetForBiz`(사업자번호 변경 시 초기화)의 제거 목록에 `ourAmount`, `amountCheckedAt` 추가.

### 5. 엔진 `src/engine/results/result-tracker.ts`
- 변경 감지 함수 `changed()`에 `a.ourAmount !== b.ourAmount` 추가.
- 일반 대상 루프 다음, 같은 try 안에서 `mode === 'list'`이고 키 오류로 중단되지 않았을 때만 백필 루프:
  - `backfillTargets(index, results)`의 각 id에 대해 1단계(개찰결과)만 조회. 2단계는 호출하지 않는다.
  - 키 오류: 기존 키 오류 처리와 같게 `skipped = 'KEY_INVALID'`로 두고 루프 중단.
  - 그 외 오류: 해당 건 건너뜀(`amountCheckedAt` 미기록).
  - 성공: `applyOurAmount(prev, rows, 우리 사업자번호, now)`로 교체, 기존 저장 경로가 쓰는 touched 집합에 추가, `changed`면 `out.updated++`.
  - `out.checked`에는 더하지 않는다. 알림 이벤트, follows는 변경 없음. follow 모드에서는 실행하지 않는다.

### 6. 목록 병합 `src/core/types/index-file.ts`, `src/engine/notices/notice-api.ts`
- `IndexEntry.result` 타입에 `ourAmount?: number; openingAt?: ISODate` 추가.
- `listNotices`의 results 병합부에서 두 필드를 값이 있을 때만 병합(기존 필드 병합 방식과 동일).

### S1 테스트(기존 테스트 파일에 추가, 없으면 같은 폴더 관례로 신설)
- award-api: `bidprcAmt` 매핑(쉼표 제거, 빈 값 null).
- judge: won/lost/ranked에 ourAmount 설정, not_participated는 없음, 재판정 시 prev.ourAmount가 지워진 뒤 다시 설정됨, `applyOurAmount`가 status/rank/winner/nextCheckAt을 바꾸지 않고 amountCheckedAt만 찍음, 우리 행 없어도 amountCheckedAt 기록, bidders 보충.
- plan: `backfillTargets` 상한 10, won/lost 포함, rank 없는 expired 제외, ourAmount 또는 amountCheckedAt 있으면 제외, 사전규격과 구 round 제외, openingAt 내림차순. `resetForBiz`가 두 필드 제거.
- result-tracker: list 모드에서 종료 won 항목에 1단계 1회 호출 후 ourAmount 저장, 2단계 미호출, follow 모드에서 미호출, 두 번째 실행에서 재호출 없음, API 오류 시 amountCheckedAt 미기록, 키 오류 시 KEY_INVALID, updated 증가, 상한 10.
- 실측 fixture 테스트(`tests/engine/result-real-fixture.test.ts`): 1단계 우리 행에 `bidprcAmt: '291990000'` 추가 후 `ourAmount: 291990000` 확인.
- notice-api: ourAmount, openingAt 병합.

## S2 집계 순수 함수 `src/core/results/stats.ts` (신설)

```ts
export type StatsPeriod = number | 'all';
export interface ResultStatsInput { entries: IndexEntry[]; period: StatsPeriod; now: Date }
export interface ResultStats {
  period: StatsPeriod;
  /** 투찰 건이 1건 이상 있는 연도 내림차순. 올해(now 기준)는 항상 포함 */
  years: number[];
  counts: { bids: number; won: number; lost: number; pending: number; winRate: number | null };
  amounts: { bidTotal: number; wonTotal: number; amountWinRate: number | null; missingBid: number; missingWon: number };
  ranks: { first: number; second: number; thirdOrBelow: number; unknown: number; avgBidders: number | null };
  /** 연도: 12개(1~12월, 비어도 0). 전체: 투찰이 있는 연도별 1개(key 'YYYY') 오름차순 */
  monthly: Array<{ key: string; label: string; bids: number; won: number; bidAmount: number; wonAmount: number }>;
  byOrg: Array<{ org: string; bids: number; won: number; lost: number; winRate: number | null; bidAmount: number; wonAmount: number }>;
  excluded: { waiting: number; notParticipated: number; noBid: number; expiredNoRank: number };
}
export function computeResultStats(input: ResultStatsInput): ResultStats
/** 올해 투찰 1건 이상이면 올해, 아니면 투찰이 있는 가장 최근 연도, 그것도 없으면 올해 */
export function defaultPeriod(entries: IndexEntry[], now: Date): StatsPeriod
export function isBid(r: IndexEntry['result'] | undefined): boolean
/** amount ?? ourAmount */
export function wonAmountOf(r: NonNullable<IndexEntry['result']>): number | undefined
```

지표 정의:
- 대상: 입찰공고(사전규격 제외, 공고 종류 판별은 기존 `kindOf` 등 관례 함수 재사용), `result`가 있고 `result.openingAt`이 있고 기간 안인 항목. 연도 판정은 `new Date(openingAt).getFullYear()`.
- 투찰(isBid): won, lost, 또는 (ranked 또는 expired) 이면서 rank 있음. 나머지(waiting, not_participated, no_bid, rank 없는 expired)는 `excluded`에 계수(기간 안의 것만).
- counts: bids, won, lost는 상태 그대로, pending = 투찰 중 ranked + expired. `winRate = won + lost > 0 ? won / (won + lost) : null`.
- amounts: `bidTotal` = 투찰 건 ourAmount 합, `missingBid` = 투찰 건 중 ourAmount 없는 수. `wonTotal` = won 건 wonAmountOf 합, `missingWon` = won 중 값 없는 수. `amountWinRate` = (won 건 wonAmountOf 합) / (won 건 wonAmountOf + lost 건 ourAmount 합). 값 없는 건은 분자 분모 양쪽에서 제외, 분모 0이면 null. ranked는 넣지 않는다.
- ranks: 투찰 건의 rank 1 / 2 / 3 이상 / 없음. avgBidders = bidders 있는 투찰 건 평균, 소수 1자리 반올림, 없으면 null.
- monthly: 연도면 `YYYY-01`~`YYYY-12`, label "1월"~"12월". 전체면 key `YYYY`, label "2026년". bidAmount, wonAmount는 amounts와 같은 규칙.
- byOrg: `orderingOrg?.trim() || '기관 미상'`. 정렬 bids 내림차순, won 내림차순, org 오름차순(`localeCompare('ko')`).

포맷 `src/ui/notices/result-view.ts`에 추가:
```ts
/** 1억 이상 "8.2억원"(소수 1자리, .0 제거), 1만 이상 "3,450만원"(내림), 그 외 "9,500원" */
export function formatWonShort(n: number): string
/** null → '—', 0.254 → '25%' */
export function formatPercent(r: number | null): string
```

### S2 테스트 `tests/core/result-stats.test.ts` 신설 + result-view 테스트에 포맷 추가
- 투찰 판정 7상태 각각, rank 없는 expired 제외, 사전규격 제외, openingAt 없는 항목 제외.
- winRate 분모(ranked 제외, won+lost 0이면 null), amountWinRate(값 없는 건 양쪽 제외, ranked 미포함).
- wonAmountOf 대체(amount 없으면 ourAmount), missingBid/missingWon.
- 월 귀속 로컬 기준(연말 경계), 연도 12칸 0 채움, 전체 연도 버킷.
- byOrg 정렬과 '기관 미상', defaultPeriod 세 분기, years에 올해 포함.
- formatWonShort 경계: 9,999원, 1만원, 1억원, 12.0억 → "12억원".

## S3 화면 (메인이 직접, 목업 기준)
- route `stats`, 메뉴 "실적"(평가분석 뒤), `stats/StatsPage.tsx`, `ResultBars.tsx`, `RankDistribution.tsx`, `OrgTable.tsx`, `ResultSummaryStrip.tsx`.
- 띠는 홈 숫자 카드 아래, 공고목록 필터 탭 위 두 곳.

## S4 사용자 실측
dist 빌드 로드 → 공고목록 진입(백필) → 실적 숫자를 나라장터 개찰결과의 투찰금액과 2건 이상 대조.
