# 조달평가 점수 분석 명세

작성 2026-10-19. Fable 설계, 사용자 승인. 결정 근거는 `.claude/specs/decisions.md`의 "2026-10-19 조달평가 점수 분석" 절.

## 목표
개찰이 끝난 협상에 의한 계약 공고에서 **업체 × 평가위원 × 세부평가항목 점수**를 가져와 로컬 폴더에 누적 저장하고, 대시보드에서 단일 공고 분석과 누적 분석을 보여준다. 우리 회사 기준 보기와 전체 업체 보기를 모두 지원한다. 사용자는 1명(공유 없음).

## 데이터 출처 (실측 확정)
샘플: `docs/probe/www.g2b.go.kr.har` (공고 R26BK01631407-000, 쿠키 제거본, gitignore 처리. 업체 담당자 개인정보와 위원 실명이 들어 있으니 내용을 다른 파일, 테스트, 로그로 복사하지 않는다). HAR 엔트리 인덱스 0, 8, 12, 13, 14, 15.

나라장터 내부 API. 모두 `POST https://www.g2b.go.kr<경로>`, 헤더 `Accept: application/json`, `Content-Type: application/json;charset=UTF-8`, `Menu-Info`, `submissionid`. 응답 공통 `ErrorCode`(0 정상), `ErrorMsg`.

| # | 경로 | 요청 본문 | 응답에서 쓰는 것 |
|---|---|---|---|
| 1 | `/pb/pbo/pboc/OnbsRslt/selectOnbsRsltSbidGods.do` | `{"dlSrchOnbsRsltBidInM":{"bidPbancNo":<공고번호>,"bidPbancOrd":<차수 3자리>,"bidClsfNo":"1","bidPrgrsOrd":"000","prcmBsneSeCd":"03","bidPgstCd":"개찰완료","bzmnRegNo":"","reOpenPbancYN":"Y","currentPage":1,"recordCountPerPage":"10"}}` | `result.etcData.evlNo`, `result.etcData.epropoEvalYn`, `result.etcData.isNego` |
| 2 | `/ee/eep/eepa/evlInfo/selectEvlBaseInfo.do` | `{"dlSrchEvlInfoM":{"evlNo":<evlNo>}}` | `dlEvlBaseInfoM`: evlNm, dmstUntyGrpNm, evlSeNm, techEvlMthdNm, techEvlAlptRt, evlPgstNm, evlEndDt, bestLwstScr2ExclYn, evlUseEvstCnt |
| 3 | `/ee/eep/eepb/evlTrgt/selectEvlTrgtLst.do` | `{"dlSrchEvlTrgtM":COMMON}` | `dlEvlTrgtL[]`: evlTrgtSqno, bzmnRegNo, etpsNm, prsntnOdr, evlExclYn |
| 4 | `/ee/eep/eepd/elmb/selectElmbInfo.do` | `{"dlSrchElmbM":COMMON}` | `dlElmbL[]`: elmbHashVal, elmbNo, evlExclYn, evlCmptnYn. **배열 순서 = 화면 평가위원1~N** |
| 5 | `/ee/eep/eepe/evstevl/selectEvstEvlPritmLst.do` | `{"dSrchEvstEvlM":COMMON}` | `dlEvlFlfmtCrstL[]`: evstNo, evlPritmNo, upEvlPritmNo, evlPritmNoDepth1~4, evlPritmNmDepth1~4, alptScr, evlPritmRsltApprMthdNm |
| 6 | `/ee/eep/eepe/evstevl/selectDtlsPritmEvlRsltLst.do` | `{"dSrchEvstEvlM":COMMON + evstNo}` | `dlDtlsPritmEvlRslL[]`: evlTrgtSqno, elmbHashVal, evlPritmNo, evlScr, rvsoEvlHistScr |

`COMMON = {"evlNo":<evlNo>,"evstNo":"","evlExclYn":"N","evlTyCd":"평010002","elmbTyCd":"주010008","evlCode":""}`. 6번은 `evstNo`에 5번 결과의 evstNo를 넣는다(샘플은 `R26EB00034938` 1종). 5번 결과에 evstNo가 여러 종이면 종류마다 6번을 호출해 이어 붙인다.

헤더 값(HAR 그대로):
- 1번 Menu-Info `{"menuNo":"01523","menuCangVal":"PBOC007_01","bsneClsfCd":"%EC%97%85130028","scrnNo":"02128"}`, submissionid `mf_wfm_container_mainWframe_onbsDtlInfo_wframe_popupCnts_selectOnbsRsltSbidGods`
- 2~6번 Menu-Info `{"menuNo":"10956","menuCangVal":"EEPZ002_01","bsneClsfCd":"%EC%97%85130033","scrnNo":"00244"}`
- submissionid 접두 `mf_wfm_container_mainWframe_onbsDtlInfo_wframe_popupCnts_DitmRsltChrtInqPV_wframe_popupCnts_` + 2번 `srchEvlBaseInfo`, 3번 `sbmSrch1`, 4번 `sbmSrch2`, 5번 `sbmSrch3`, 6번 `sbmSrch4`

샘플 검증값: 업체 2, 위원 8, 세부항목 24(대항목 5), 점수 384줄. 위원별 합계(위원1~8) 엑스코어시스템 84.1, 88.7, 85.5, 82.4, 80.8, 84, 87.4, 84.9 / 웹프라자 79, 80.4, 75.3, 79.4, 75.3, 81, 84.1, 77.1 (나라장터 팝업과 일치).

공개 API(낙찰정보, 서비스키 필요): `https://apis.data.go.kr/1230000/as/ScsbidInfoService/getOpengResultListInfoOpengCompt?inqryDiv=4&bidNtceNo=…&type=json&numOfRows=100&pageNo=1` → 업체별 opengRank, prcbdrBizno, bidprcAmt, bidPrceEvlVal, techEvlVal, totalEvlAmtVal, techEvlNaturVal.

## 개인정보 규칙 (모든 단계 공통, 위반 시 불합격)
- 응답 원문을 파일, storage, 메시지(진단 포함), 로그에 담지 않는다. 허용 목록(`EvalRaw` 인터페이스에 있는 키)만 **g2b 탭 CS 안에서** 복사해 내보낸다.
- 금지 키 예: `elmbNm`, `elmbLabel`, `elmbId`, `elmbNmHashVal`, 모든 `*EncrVal`, 모든 `*HashVal`(elmbHashVal은 CS에서 SW까지 조인용으로만 허용, 저장 금지), `etpsPic*`, `etpsTlphNo`, `evlRprsvNm`, `prsrHashVal`, `evlPic*`, `rsdsRegNo*`.
- 위원은 `elmbNo`와 화면 순번만, 업체는 사업자번호(숫자 10자리)와 상호만 저장한다.

## 구조
```
[트리거] 나라장터 플로팅 패널 버튼 / 대시보드 평가분석 페이지
   │ eval/collect {ref}                (CS 또는 확장 페이지 → SW)
[SW] g2b 탭 확보: 발신 g2b CS면 그 탭, 아니면 열린 g2b 탭 재사용, 없으면 https://www.g2b.go.kr/ 비활성 탭 생성 후 끝나면 닫음
   │ g2b/eval-fetch {noticeNo, round}  (SW → 탭 CS, 동시 1개 FIFO)
[g2b CS] 같은 출처 fetch 6회 → pickEvalRaw(허용 목록) → EvalRaw
   │ eval/save {ref, raw, serviceKey}  (SW → offscreen)
[offscreen] mapEvalRaw → 공개 API 조회(실패는 경고) → evaluations/<noticeId>.json, evaluations/index.json
[대시보드] #/evaluations, #/evaluations/<noticeId>. 지표는 core 순수 함수로 계산
```
하지 않는 것: JobType 추가, `job/*` 경로와 CS 잡 필터 수정, MAIN world 주입, `chrome.cookies`, offscreen에서 g2b 직접 fetch, 차트 라이브러리, `notices/`와 `index.json`, `notice.json` 수정.

## 타입 (`src/core/types/evaluation.ts`)
```ts
export interface EvalBidder { seq: number; bizNo: string; name: string; order: number | null; excluded: boolean }
export interface EvalJudge { index: number; key: string | null; excluded: boolean; completed: boolean }
export interface EvalItem { no: string; parentNo: string | null; sheetNo: string; depth: number; names: string[]; maxScore: number | null; method: string | null; leaf: boolean }
export interface EvalScore { b: number; j: number; i: string; s: number; r?: number }
export interface EvalOfficialRow { bizNo: string; rank: number | null; bidAmount: number | null; priceScore: number | null; techScore: number | null; totalScore: number | null; techRaw: number | null }
export type EvalStatus = 'final' | 'provisional';
export interface EvalRecord {
  schemaVersion: 1;
  noticeId: string; noticeNo: string; round: string;
  evalNo: string; title: string; orgName: string;
  evalKindName: string | null; techMethodName: string | null; techWeight: number | null;
  excludeBestWorst: boolean | null; status: EvalStatus; evaluatedAt: ISODate | null;
  bidders: EvalBidder[]; judges: EvalJudge[]; items: EvalItem[]; scores: EvalScore[];
  official: { fetchedAt: ISODate; rows: EvalOfficialRow[] } | null;
  warnings: string[]; collectedAt: ISODate; firstCollectedAt: ISODate;
}
export interface EvalIndexEntry {
  noticeId: string; noticeNo: string; round: string; title: string; orgName: string; evalNo: string;
  status: EvalStatus; evaluatedAt: ISODate | null; collectedAt: ISODate;
  bidders: Array<{ bizNo: string; name: string }>; judgeKeys: string[]; hasOfficial: boolean;
}
export interface EvalIndexFile { schemaVersion: 1; generatedAt: ISODate; entries: EvalIndexEntry[] }
```
매핑: seq=evlTrgtSqno, bizNo=bzmnRegNo 숫자만, name=etpsNm, order=prsntnOdr, excluded=evlExclYn==='Y' / judge index=dlElmbL 순서(1부터), key=elmbNo, completed=evlCmptnYn==='Y' / item no=evlPritmNo, parentNo=upEvlPritmNo, sheetNo=evstNo, names=evlPritmNmDepth1~4 중 빈 값 제외, depth=names 길이, maxScore=alptScr, method=evlPritmRsltApprMthdNm, leaf=다른 항목의 parentNo로 등장하지 않음 / score b=seq, j=judge index, i=evlPritmNo, s=evlScr, r=rvsoEvlHistScr(숫자이고 s와 다를 때만) / status=evlPgstNm==='확정'?final:provisional, evaluatedAt=evlEndDt, techWeight=techEvlAlptRt, excludeBestWorst=bestLwstScr2ExclYn==='Y'.

CS 반환 허용 목록 (`src/adapters/g2b/eval-api.ts`):
```ts
export interface EvalRaw {
  capturedAt: ISODate;
  open: { evlNo: string | null; epropoEvalYn: string | null; isNego: boolean | null };
  base: { evlNm: string | null; dmstUntyGrpNm: string | null; evlSeNm: string | null; techEvlMthdNm: string | null; techEvlAlptRt: number | null; evlPgstNm: string | null; evlEndDt: string | null; bestLwstScr2ExclYn: string | null; evlUseEvstCnt: number | null } | null;
  targets: Array<{ evlTrgtSqno: number; bzmnRegNo: string; etpsNm: string; prsntnOdr: number | null; evlExclYn: string | null }>;
  members: Array<{ elmbHashVal: string; elmbNo: string | null; evlExclYn: string | null; evlCmptnYn: string | null }>;
  items: Array<{ evstNo: string; evlPritmNo: string; upEvlPritmNo: string | null; evlPritmNoDepth1: string | null; evlPritmNoDepth2: string | null; evlPritmNoDepth3: string | null; evlPritmNoDepth4: string | null; evlPritmNmDepth1: string | null; evlPritmNmDepth2: string | null; evlPritmNmDepth3: string | null; evlPritmNmDepth4: string | null; alptScr: number | null; evlPritmRsltApprMthdNm: string | null }>;
  scores: Array<{ evlTrgtSqno: number; elmbHashVal: string; evlPritmNo: string; evlScr: number | null; rvsoEvlHistScr: number | null }>;
}
```
숫자 필드는 `Number()` 후 유한값이 아니면 null.

## 단계

### S1. 내부 API 호출부, CS 핸들러, SW 중계, 진단 카드
1. `src/core/types/evaluation.ts` 신설(위 타입 전부), `src/core/types/index.ts`에 재export.
2. `src/adapters/g2b/eval-api.ts` 신설: `EVAL_ENDPOINTS`(경로, menuInfo, submissionid, 본문 빌더), `EvalRaw`, `pickEvalRaw(responses): EvalRaw`(허용 목록만 복사), `parseG2bJson(text): {ok:true,json} | {ok:false,code}`.
3. `src/adapters/g2b/eval-fetch.ts` 신설: `fetchEvalRaw(ref: {noticeNo: string; round?: string}, ctx: {fetch: typeof fetch; timeoutMs?: number; signal?: AbortSignal}): Promise<EvalFetchResult>`.
   - 순서: ① 1번 → evlNo가 없거나 빈 문자열이면 `EVAL_NO_RESULT`. ② 2번(실패 시 base null + 경고, 계속 진행). ③ 3번. ④ 4번. ⑤ 5번. ⑥ 5번의 distinct evstNo마다 6번, scores 이어 붙임.
   - round 없으면 1번 본문에 `"000"`.
   - fetch 옵션 `method:'POST'`, `credentials:'same-origin'`, 헤더 Accept, Content-Type, Menu-Info, submissionid. Referer는 수동 설정하지 않는다.
   - 판정: `res.ok`가 아니거나 본문이 JSON이 아니면, 본문 앞 200자에 `<html` 또는 `login`(대소문자 무시)이 있으면 `EVAL_NOT_LOGGED_IN`, 아니면 `EVAL_API_ERROR`. JSON인데 `ErrorCode`가 0이 아니면 `EVAL_API_ERROR`(ErrorMsg 포함).
   - 호출당 15초, 전체 60초. 결과 `{ok:true; raw: EvalRaw; warnings: string[]} | {ok:false; error:{code; message; step: 1~6}}`.
4. `src/messaging/protocol.ts`에 추가:
   - `g2b/eval-fetch` (SW→CS) payload `{noticeNo; round?}` → `{raw: EvalRaw; warnings: string[]}`
   - `eval/collect` payload `{ref:{noticeNo; round?}}` → `EvalCollectResult {noticeId; entry: EvalIndexEntry; warnings: string[]}` (S1에서는 등록만, 저장은 S2)
   - `eval/save` (SW→offscreen) `{ref; raw: EvalRaw; serviceKey?: string}` → `EvalCollectResult`
   - `eval/list` → `EvalIndexEntry[]`, `eval/get {noticeId}` → `EvalRecord | null`, `eval/get-many {noticeIds?: string[]}` → `EvalRecord[]`, `eval/delete {noticeId}` → `{removed: boolean}` (S1은 타입만)
   - `eval/probe` (확장 페이지→SW) `{ref; withoutIdHeaders?: boolean}` → `{ok: boolean; counts?: {targets; members; items; scores; sheets}; code?: string; message?: string; step?: number; ms: number}`
   - `ui/open`의 page 유니언에 `'evaluation'`(S1은 타입만)
5. `src/entrypoints/g2b.content.ts`: `g2b/eval-fetch` 수신 → `fetchEvalRaw(ref, {fetch: window.fetch.bind(window)})`. 실패는 기존 방식대로 `BusError(code, message)`.
6. `src/background/eval-collector.ts` 신설, `src/entrypoints/background.ts`에서 등록.
   - 발신자 검사: `eval/*`는 extension 또는 g2b 발신자만, webmail/unknown은 `SENDER_FORBIDDEN`. `eval/probe`, `eval/list|get|get-many|delete`는 extension만.
   - ref 검증: noticeNo `/^R\d{2}[A-Z]{2}\d{8}$/`, round `/^\d{3}$/`(없으면 `'000'`으로 채움).
   - `acquireG2bTab(sender)`: g2b 발신자면 그 탭(닫지 않음). 아니면 `tabs.query({url:'https://www.g2b.go.kr/*'})` 첫 탭 재사용(닫지 않음), 없으면 `tabs.create({url:'https://www.g2b.go.kr/', active:false})` 후 로드 완료 대기(기존 compose-relay의 waitComplete 재사용), 끝나면 닫음. `sendToTab`이 수신자 없음이면 700ms 간격 최대 15초 재시도.
   - `EVAL_NOT_LOGGED_IN`이면 생성한 탭을 닫지 않고 활성화한다.
   - 동시 1개 FIFO(detail-reader와 같은 방식).
   - `eval/probe`: fetch까지만 하고 저장하지 않으며 카운트만 반환(원문을 UI로 보내지 않음). `withoutIdHeaders`면 Menu-Info와 submissionid를 빼고 호출(CS payload에 플래그 전달).
   - `eval/collect`: S1에서는 `NOT_IMPLEMENTED` 오류 반환(S2에서 연결).
7. `src/entrypoints/dashboard/DiagnosticsPage.tsx`: "평가 API 시험" 카드. 공고번호 입력(`R26BK01631407` 또는 `R26BK01631407-000`), 체크박스 "식별 헤더 없이", [시험] → `eval/probe` → 카운트 또는 오류 코드, 단계, 메시지, 소요 ms 표시. 기존 카드 스타일을 따른다.
8. 테스트(합성 데이터만, HAR 내용 복사 금지):
   - `tests/g2b/eval-fetch.test.ts`: fake fetch로 호출 순서와 본문, evlNo 없음 → EVAL_NO_RESULT, HTML 응답 → EVAL_NOT_LOGGED_IN, ErrorCode≠0 → EVAL_API_ERROR, 2번 실패 시 base null + 경고, evstNo 2종이면 6번 2회, `withoutIdHeaders` 시 헤더 없음.
   - `pickEvalRaw` 키 집합 검사: 금지 키(위 목록)를 응답에 넣어도 결과 JSON 문자열에 포함되지 않음.
   - `tests/background/eval-collector.test.ts`: 발신자 종류별 허용/거부, 탭 재사용/생성/닫기, NO_RECEIVER 재시도, FIFO 순서, 로그인 오류 시 생성 탭 유지.

완료 조건: 타입체크, 관련 테스트 통과, 빌드 통과. 사용자가 진단 카드로 샘플 공고를 시험해 targets 2, members 8, items 24, scores 384, sheets 1을 확인.

S1 뒤 사용자 실측(결과를 decisions.md에 기록):
1. 로그아웃 상태 응답 형태(로그인 판정 서명 확정)
2. 우리 회사가 참여하지 않은 개찰완료 협상 공고 접근 가능 여부
3. "식별 헤더 없이" 성공 여부(성공하면 상수에서 제거)
4. 물품/공사 협상 공고에서 `prcmBsneSeCd "03"` 고정으로 되는지
5. 나라장터 첫 화면 탭에서 호출되는지(대시보드 트리거 전제)
6. evstNo가 2종인 공고가 있는지
7. elmbNo 공고 간 동일성(누적 화면에서 같은 키가 나올 때 사람이 대조)

### S2. 매퍼, 공개 API, 저장소 (offscreen)
1. `src/core/evaluation/map.ts`: `mapEvalRaw(raw, ref, nowIso): {ok:true; record} | {ok:false; code:'EVAL_PARSE'; message}`. elmbHashVal → index 맵은 지역 변수로만 쓰고 버린다. 맵에 없는 hash 행은 버리고 경고 1회, evlScr 숫자 아니면 버림. bizNo 10자리 아니면 경고. 검증: bidders, judges, leaf items, scores 각각 1개 이상 아니면 EVAL_PARSE. `scores.length !== bidders × judges × leafItems`면 경고. 중복 키 (b,j,i)는 뒤 값 버리고 경고.
2. `src/adapters/g2b/open-result-api.ts`: `fetchOfficialResult(noticeNo, ctx)`, `mapOfficialRows(items)`. 기존 `openapi.ts`의 `fetchJsonOp` 재사용(에러 코드, 키 가리기 동일). bizNo 숫자만.
3. `src/engine/evaluation/eval-store.ts`: `EvalStore(store: IFileStore)` — `save(record)`(파일 쓰기 → `evaluations/index.json` 락으로 read-modify-write, 기존 파일의 firstCollectedAt 승계), `loadIndex()`(없거나 손상이면 `evaluations/*.json` 스캔으로 재생성, `*.crswap`과 `index.json` 제외), `get`, `getMany(ids?)`, `remove`. `entryOf(record)`.
4. `src/engine/evaluation/eval-api.ts`: `saveEval(fileStore, {ref, raw, serviceKey}, now)` = map → official(15초, 실패는 warnings + official null) → save.
5. offscreen에 `eval/save|list|get|get-many|delete` 등록. SW의 `eval/collect`를 fetch → save로 연결(secrets.g2bServiceKey 사용). 진단 카드에 [저장까지] 버튼.
6. 테스트: fixture `tests/fixtures/eval-raw-sample.json`은 메인이 만든다(elmbNo는 가짜 값). `tests/core/eval-map.test.ts`(위원별 합계가 위 샘플 검증값과 일치, leaf, r, 칸 수 경고), `tests/engine/eval-store.test.ts`, `tests/g2b/open-result-api.test.ts`.

### S3. 우리 회사 설정, 분석 순수 함수
- `Settings.company: {bizNo: string; name?: string}`, 기본값 `{bizNo:''}`. `src/core/evaluation/company.ts`: normalizeBizNo, isOurs.
- `src/core/evaluation/analyze.ts`: bidderTotals(평균, 중앙값, 최소, 최대, 표준편차, 최고최저 1개씩 제외 평균(위원 3명 미만 null), 위원 제외 옵션), rankOf(동점 1,2,2,4), judgeProfiles(bias, spread, topSeq, agreesWithConsensus, ourDelta), itemGaps(우리 평균 − 최고 경쟁사 평균, 격차율, 오름차순), leaveOneOut, officialCompare, sheetGroups, cumulative(timeline, itemWeakness(depth1 이름 정확 일치), judges(key 있는 위원만), competitors 전적). null 칸은 평균에서 제외.
- `CompanyCard.tsx`를 설정 페이지에 배치.

### S4. 단일 공고 화면 (2026-10-20 사용자 승인 목업 기준)
화면 참고 목업(대화형): `/private/tmp/claude-501/-Users-seungjoochoi-workspace-bidMate/f2781bc3-7b80-41c5-a068-a7e6a7b1bde2/scratchpad/evalmock/project/Main.dc.html` (DC 템플릿 + 계산 스크립트. 배치, 문구, 색 규칙의 기준이며 코드는 React로 새로 작성한다. 목업 안의 계산은 참고일 뿐이고 계산은 반드시 analyze.ts 함수를 쓴다).

목적: "무슨 일이 있었나"가 아니라 "무엇을 바꾸면 이기나"에 답한다. 모든 지표는 정해진 계산과 규칙이며 AI를 쓰지 않는다. 점수 공식에 기대는 지표는 공고마다 공개 API 값으로 자기 검증하고, 검증에 실패하면 그 지표를 숨기고 이유를 한 줄 표시한다.

#### S4a. analyze.ts 추가 함수 (순수, 테스트 필수)
- `itemGaps(rec, ourBizNo, opts?: {excludeJudges?: Set<number>})`: 기존 함수에 위원 제외 옵션 추가(판정 방식은 bidderTotals와 동일).
- `priceWeightOf(rec)`: techWeight가 숫자면 `100 - techWeight`, 아니면 null.
- `verifyPriceFormula(rec): {ok: boolean; reason?: string}`: official 행 2개 이상, 모든 행에 bidAmount와 priceScore가 있고, 각 행에서 `priceWeight × 최저 bidAmount ÷ bidAmount`와 priceScore의 차가 0.0005 이하이면 ok.
- `verifyTechAdjust(rec): {ok: boolean; reason?: string}`: 모든 행에 techRaw와 techScore가 있고, 각 행에서 `techRaw + (techWeight − 최대 techRaw)`와 techScore의 차가 0.0005 이하이면 ok(차등보정 = 1위를 기술 만점으로 올리고 전원 같은 폭만큼 이동).
- `pickDuel(rec, ourBizNo): {lead: number; chase: number; basis: 'official'|'judges'} | null`: 업체 2개 미만이면 null. official 순위가 있으면 그것, 없으면 위원 평균 순위(bidder.excluded 제외). 우리 회사가 있으면 우리와 상대(우리가 1위면 lead=우리, chase=2위 / 아니면 lead=1위, chase=우리), 없으면 1위와 2위. 값은 bidder seq.
- `decompose(rec, duel): {totalDiff; techDiff; priceDiff; bidCutPct; priceFormulaOk; techAdjustOk; chaserPriceMaxed; cutNeededPct} | null`: lead와 chase 모두 official 행이 있어야 함(없으면 null). diff는 lead − chase(q 정규화). bidCutPct = (1 − chase 투찰가 ÷ lead 투찰가) × 100. chaserPriceMaxed = chase priceScore ≥ priceWeight − 0.0005. cutNeededPct = priceFormulaOk일 때만 techDiff ÷ priceWeight × 100, 아니면 null.
- `reversalDistance(rec, duel, opts?: {excludeJudges?})`: 유효 위원만 사용. `gapSum` = Σ(lead 위원 합계 − chase 위원 합계), `behindCount` = leaf 항목 중 lead 평균 > chase 평균인 수, `top3Recovery` = 항목별 Σ_j max(0, lead − chase) 상위 3개의 합, `top3Ratio` = min(top3Recovery ÷ gapSum, 1)(gapSum ≤ 0이면 null), `local` = top3Recovery ≥ gapSum, 등급 관련 값은 모든 leaf 항목의 method가 '등급'일 때만: `maxItemScore`(leaf 최대 배점), `stepsNeeded` = ceil(gapSum ÷ (0.1 × maxItemScore)), `cellsOfMax` = 배점이 maxItemScore인 leaf 수 × 유효 위원 수. 아니면 세 값 null.
- `gradeDistribution(rec, seq, opts?: {excludeJudges?}): Array<{group: string; maxScore: number; counts: [number, number, number, number]}>`: depth1 이름별, 유효 위원 × leaf 칸을 점수 ÷ 배점 비율로 [≥0.995, ≥0.895, ≥0.795, 그 미만]으로 셈.
- 위 수치는 모두 q 정규화. 테스트: fixture + 샘플 공식 결과(엑스코어 1위 291990000, 9.7949, 90, 99.7949, 85.245 / 웹프라자 2위 286000000, 10, 84.135, 94.135, 79.38)로 verifyPriceFormula ok, verifyTechAdjust ok, ourBizNo=1198633696일 때 decompose techDiff 5.865, priceDiff −0.2051, chaserPriceMaxed true, cutNeededPct 58.65, reversalDistance gapSum 46.2, local false, stepsNeeded 77, cellsOfMax 40. 공식이 맞지 않는 합성 사례에서 ok false.

#### S4b. 화면
- 라우트 `#/evaluations`(S5 전까지는 간단한 목록 또는 안내), `#/evaluations/<noticeId>`, nav "평가분석"(공고 다음), `ui/open` page 'evaluation' 처리(대시보드 탭 재사용 규칙 동일).
- `EvaluationDetailPage.tsx` 블록 순서와 내용(목업과 동일):
  1. 머리: 경로, 공고명, 칩(기관, 평가 종료일, 기술배점, 평가방식, 업체/위원/세부항목 수, 확정/임시), [우리 회사 기준 | 전체 업체] 세그먼트(회사 미설정 또는 미참여면 전체만, 안내 한 줄), [다시 가져오기](eval/collect 후 재조회).
  2. 승부 분해(pickDuel 기준): ① 종합점수 차이와 기술/가격 분해 막대(chase 입장 부호), 투찰가 인하율 설명 ② 교환비(투찰가 1% = 가격 priceWeight÷100점, 최대 배점 항목 위원 1명 1등급 = 0.1×maxItemScore÷유효 위원 수 점, 그 둘의 비율) 와 판정 상자(chaserPriceMaxed면 "가격으로는 이길 수 없던 공고", cutNeededPct 표시) ③ 역전 거리(local이면 "국지적 열세", 아니면 "전반적 열세", behindCount, top3 문구, stepsNeeded와 cellsOfMax, 판정별 고정 조언 한 줄). verify 실패 시 ①의 분해는 표시하되 ②는 "이 공고는 점수 공식이 달라 교환비를 계산하지 않았습니다"로 대체. official 없으면 승부 분해 전체를 "공식 결과가 없어 분해할 수 없습니다"로 대체하고 ③만 위원 평균 기준으로 표시.
  3. 업체 × 평가위원 합계: 위원 머리 버튼으로 제외 토글(aria-pressed), 열 최고값 굵게, 평균, 최고최저 제외, 편차, 순위. 우리 회사 행 강조(왼쪽 파란 띠 + 배지). 제외 중이면 하단 안내와 [모두 포함].
  4. 세부항목별 격차(왼쪽)와 히트맵(오른쪽), 넓으면 나란히 좁으면 쌓임. 격차는 [손실 큰 순 | 항목 순] 정렬(기본 손실 큰 순, 우리 회사 기준에서만), 격차 값과 가운데 기준 막대(진 쪽 주황, 이긴 쪽 파랑, 배점 대비 비율). 전체 보기는 업체별 평균 열. 히트맵은 업체 탭, 칸 색 4단계(100%, 90%, 80%, 그 미만), 상대보다 낮은 칸 주황 테두리, 제외 위원 열 흐리게, 범례.
  5. 대항목별 등급 분포: gradeDistribution을 우리와 상대(전체 보기면 전 업체) 막대로, 만점 비율 숫자.
  6. 평가위원별 성향: 우리/상대 합계와 격차(전체 보기면 업체별 합계), 후한 정도, 변별폭(막대), 이 위원의 1위, 빼면(leaveOneOut 결과 문구).
  7. 공식 개찰 결과 표(officialCompare) + techRaw와 위원 평균 차이 안내 한 줄.
- 위원 제외와 보기 전환은 페이지 상태, 보기 기본값은 localStorage `bidmate.evalView`(회사 설정 있으면 ours). 수정 이력 점수(r)는 히트맵 칸에 점 표시와 title.
- 색은 기존 테마 토큰만 사용(진 쪽 warn 계열, 이긴 쪽 primary 계열). 차트 라이브러리 금지.
- 표시 포맷은 `src/entrypoints/dashboard/evaluations/eval-view.ts` 순수 함수(부호 문자 −/+, 소수 자리) + 테스트.
- 플로팅 패널 [평가점수 가져오기] 버튼(Fable 설계 5.1): 공고 감지 상태에서 노출, 성공 시 `ui/open {page:'evaluation', noticeId}`, 실패 문구는 코드별.

### S5. 목록과 누적 분석
- `EvaluationsPage.tsx` 목록 탭, 누적 탭(get-many 상한 500), 삭제. 공고 목록 행에 [평가점수].

### S6(선택). 수집 공고 일괄 가져오기

## 보고 형식
결론, 변경 파일 경로(줄 범위), 테스트 결과, 명세와 다르게 한 점과 이유, 실패 항목. 한국어, 가운뎃점(·) 사용 금지.
