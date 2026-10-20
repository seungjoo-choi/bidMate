# 입찰 전 기능 5종 검토와 사용자 선택

작성 2026-10-20. Fable 검토, 사용자 "추천대로" 승인. 결정 근거는 `decisions.md`의 "2026-10-20 입찰 전 기능 5종 방향" 절. 기능별 구현 명세는 단계마다 따로 작성한다(이 문서는 범위와 선택값만).

진행 순서: 4 마감 일정판과 알림 → 1 자격 판정 → 2 예상 정량 점수 → 3 기관 이력과 예상 경쟁사 → 7 투찰가 시뮬레이터.

## 공통 기반
- 알림: `.claude/specs/award-tracking.md`의 SW 스케줄러(`src/background/result-scheduler.ts`), `alarms`/`notifications` 권한(`wxt.config.ts`), `Settings.notify`(`src/core/model/default-settings.ts`), KST 슬롯 순수 함수(`src/core/results/schedule.ts`, 미구현), 알림 클릭 시 `openDashboard('#/notices/<id>/overview')`. 4가 먼저 만들고 award-tracking S2가 재사용한다.
- 회사 정보: 등급과 속성은 `Settings.company`(`src/core/types/settings.ts:41`) 확장, 실적 목록은 `config/performances.json`(`ConfigList<PerformanceRecord>`, 수신자 불러오기의 미리보기, 계획, 적용 패턴).
- IndexEntry에 notice 파생 선택 필드를 추가하는 것은 재생성에 안전하다(`src/engine/notices/notice-store.ts:15-66`).

## 4. 마감 일정판과 알림
- 화면: 홈 "마감 예정" 카드(`HomePage.tsx:76-83`, `src/core/dashboard/stats.ts:36-38`)를 일정판으로 확장. 열은 참가등록 마감, 입찰(제안서) 마감, 제안서 평가, 개찰. D-day 포맷은 `src/ui/review/format.ts:30-47`. 공고 상세 개요에 알림 예정 표시. 설정 알림 섹션에 마감 알림 on/off.
- 저장: IndexEntry `schedule?` 선택 필드, storage.local `deadlinePlan`, 발송 기록 키 `deadline:<noticeId>:<kind>:<D>`.
- 선택값: 알림 대상 일정은 입찰(제안서) 마감과 참가등록 마감. 대상 공고는 메일 전달을 마친 공고만. D-3, D-1, 당일 모두 09:00 KST. 브라우저가 꺼져 놓친 알림은 버리고 당일 것만 보낸다.
- 주의: proposalPeriod는 문자열이라 끝 날짜 파싱, 실패 시 알림 제외. 정정공고는 같은 noticeNo의 최대 round만 대상.

## 1. 자격 판정
- 화면: 공고 상세 개요의 "참가 자격" 카드(충족 / 미달 가능 / 확인 필요, 근거 3줄, 해당 실적 표). 설정 > 회사 > 실적 목록(표 편집 + 엑셀 가져오기, 열 매핑 UI).
- 판정: 기간은 endAt이 [공고게시일 − N년, 공고게시일] 안. 금액은 건당 계약금액 ≥ 인정금액. 둘 다 verified 또는 userEdited이고 해당 실적이 1건 이상이면 충족, 0건이면 미달 가능, 그 외나 인정조건 원문이 있으면 확인 필요. 기준이 여러 개(conflict)면 후보별로 여러 줄.
- 보류(1차 제외): 공고 목록 배지, "확인 필요"의 수동 확정 저장.
- 가정(필요 시 사용자에게 재확인): 부가세는 입력한 계약금액 그대로 비교, 공동수급 실적은 jointShare가 있으면 지분 금액.
- 엑셀은 `src/engine/parsers/xlsx.ts` 재사용, 대시보드에서 파싱.

## 2. 예상 정량 점수
- 화면: 공고 상세 개요의 "예상 정량 점수" 카드(경영상태, 대외신인도, 수행실적: 배점은 추출값, 우리 점수는 입력, 근거 보기, 합계). 설정 > 회사에 신용평가등급과 가점 해당 항목.
- 저장: `<folder>/estimate.json`, `Settings.company.creditGrades?`, `attributes?`.
- 기본 비율표 추정은 하지 않는다. 등급표 자동 추출은 보류.

## 3. 기관 이력과 예상 경쟁사
- 착수 전 S0 probe: 공고 기간 검색 오퍼레이션(기관 코드 파라미터, 조회 기간 상한), 낙찰 목록 오퍼레이션 필드(낙찰률 등).
- 기준: 수요기관(dminsttCd), 3년, 공고 수 상한(예 150건), 수동 [기관 이력 가져오기].
- 저장: NoticeBasic에 기관 코드와 분류 코드 선택 필드, 캐시 `orgs/<기관코드>.json`.
- 화면: 공고 상세 "기관 이력" 탭(낙찰 업체 순위, 자주 참여한 업체와 우리 전적, 낙찰률 분포 CSS 막대).
- 평가분석 연결: `cumulative()`의 CompetitorRecord(`analyze.ts:405,438-447`) bizNo 조인, 새 순수 함수 competitorStrengths.

## 7. 투찰가 시뮬레이터
- 계산만, 저장 없음. NoticeEvaluation에 `priceEvalRate` 추가(API `bidPrceEvlRt`, 옛 공고는 evalMethod raw에서 보정).
- 선택값: 분모 기본 추정가격(사업금액, 직접 입력으로 변경 가능), 경쟁 최저 투찰률 기본 88%(기관 분포가 있으면 그 값), 낙찰하한율 입력 시 그 아래는 계산 제외 경고.
- 재사용: `priceWeightOf`, `verifyPriceFormula`, `exchangeRatio`(`analyze.ts:201-223,391`). 화면에 "가정"과 평가 이력 검증 비율 표기.

## 사용자에게 받아야 할 값 (해당 단계 착수 전)
- 1: 실적 엑셀의 열 이름(샘플 1줄).
- 2: 신용평가 종류(기업신용, 회사채, 기업어음 중), 가점 해당 항목.
- 3: data.go.kr 서비스키 일일 트래픽 한도.
