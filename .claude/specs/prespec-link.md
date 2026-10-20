# 입찰공고 수집 시 연계 사전규격 첨부 동반 수집과 중복 배제

## 목표
입찰공고(bid)를 수집할 때 API 응답의 `bfSpecRgstNo`로 연계 사전규격을 조회해, 그 첨부(제안요청서 등)를 같은 공고의 첨부로 함께 받는다. 입찰공고 첨부와 같은 파일은 첨부하지 않는다(행은 남기되 파일은 지우고 "건너뜀"). 추출은 입찰공고 첨부 값을 우선하고, 입찰공고 첨부에 없을 때만 사전규격 값을 쓴다.

배경: 공고 R26BK01631407-000은 첨부가 공고서 hwpx/pdf뿐이라 배점표(제안요청서에 있음)를 못 찾았다. 제안요청서는 사전규격 R26BD00246532에만 있다.

## 실측 사실(확정)
- 사전규격 API 응답 item에 `specDocFileUrl1..N`이 온다. 파일명 필드(`specDocFileNm*`)는 **없다**. 현재 `listPrespecAttachments`(src/adapters/g2b/prespec-api.ts:98)는 이름을 `규격서${i}`로 채운다.
- 사전규격 첨부 URL 예: `https://www.g2b.go.kr/pn/pnz/pnza/UntyAtchFile/downloadFile.do?bfSpecRegNo=...&fileType=BFDTL&fileSeq=2`. 로그인 없이 200, `content-type: application/octet-stream`, `content-disposition: attachment;filename=2.%20%EC%84%B8...%29.hwp;` (퍼센트 인코딩 UTF-8, 따옴표 없음, 끝에 세미콜론).
- manifest host_permissions에 `https://www.g2b.go.kr/*`가 있어 확장에서 이 헤더를 읽을 수 있다.
- 따라서 파일명은 다운로드 전에는 알 수 없다. 중복 판정은 전부 다운로드 후에 한다.

## 데이터 모델 (선택 필드만 추가, 스키마 버전 유지)
`src/core/types/notice.ts`
```ts
export type AttachmentOrigin = 'bid' | 'prespec';   // 없음 = bid
// Attachment에 추가
origin?: AttachmentOrigin;      // 없음=bid. 연계 사전규격에서 가져온 첨부면 'prespec'
duplicateOf?: string;           // 입찰공고 첨부와 중복이라 파일을 지운 경우 그 bid 첨부 id
// 새 타입, Notice에 linkedPrespec?: LinkedPrespec 추가
export interface LinkedPrespec {
  regNo: string;
  status: 'linked' | 'not_found' | 'failed';
  fetchedAt: ISODate;
  attachmentCount: number;      // linked일 때 사전규격 첨부 수(중복 포함)
  error?: string;
}
```
`src/core/types/extraction.ts`: `EvidenceRef.origin?: AttachmentOrigin`, `ExtractionFile.origin?: AttachmentOrigin`.
`src/engine/jobs/attachments.ts`: `NewAttachment.origin?`. `matchAttachments`는 origin을 복사하고 `duplicateOf`는 복사하지 않는다(매번 재판정).

## 단계

### S1. 타입과 순수 로직 (implementer A)
1. 위 데이터 모델 추가.
2. 신규 `src/core/model/attachment-dedupe.ts`
   - `attachmentNameKey(name: string): string`: NFC 정규화, 소문자, 공백과 괄호류(`()[]（）`) 제거, 확장자 포함.
3. `src/core/extraction/classify.ts` `planFiles`
   - `attachment.duplicateOf`가 있으면 `skip('duplicate')`(not_saved 판정보다 앞).
   - hwp/pdf 쌍둥이 판정 키를 `${origin ?? 'bid'}|${twinKey(name)}`로 바꿔 같은 origin 안에서만 쌍둥이로 본다.
4. `src/core/extraction/run-rules.ts`: `RuleDocInput.origin?`, EvidenceRef 생성 시 `...(inp.origin ? { origin: inp.origin } : {})`.
5. `src/core/extraction/decide.ts` `decideOne` 맨 앞:
   ```ts
   const hasBid = cands.some((c) => c.evidence.origin !== 'prespec');
   const main = hasBid ? cands.filter((c) => c.evidence.origin !== 'prespec') : cands;
   const dropped = hasBid ? cands.filter((c) => c.evidence.origin === 'prespec') : [];
   ```
   이후 기존 로직(정렬, 충돌, isMultiCondition 등)은 `main`으로 수행하고, 결과 item의 `candidates` 뒤에 `dropped`를 붙인다(값이 같아도 붙임). `dropped`는 conflict를 만들지 않는다. 정렬 tie-break에 origin(bid 0, prespec 1)을 priority 다음에 넣는다.

완료 조건: 타입체크 통과, 아래 테스트 1~5 통과.

### S2. 어댑터와 엔진 (implementer A, S1 뒤)
1. `src/adapters/g2b/openapi.ts` `mapApiItem`: `specRegNo ← bfSpecRgstNo`(text). 사전규격 응답의 `mapPrespecItem`은 bid 공고에 적용하지 않는다(제목, 기관 등을 덮어씀).
2. `src/adapters/g2b/source.ts`: `NoticeSource.linkedPrespecNo?(item: ApiItem): string | null`, bidSource만 구현(`bfSpecRgstNo` trim, 빈 값이면 null).
3. `src/engine/notices/notice-store.ts` `saveNotice(n, raw?)`: raw를 배열로도 받아 각각 `source/api-${operation}.json`으로 저장. 사전규격 raw는 operation `prespec-<실제 operation>`.
4. `src/engine/downloader/downloader.ts` 서버 파일명 반영
   - `attempt`에서 응답 헤더를 받은 직후, `a.originalName`에 확장자가 없고(`extOf`가 빈 값) `content-disposition`에서 파일명을 얻으면: `originalName`을 그 이름으로 바꾸고, `savedName`을 `uniqueName(safeFileName(새 이름), taken)`으로 다시 정하고(옛 savedName은 taken에서 제거, 새 이름 추가), 저장 경로를 새 savedName 기준으로 계산한 뒤 쓴다.
   - 파싱: `filename*=UTF-8''...` 우선, 없으면 `filename=`(따옴표 있거나 없음, 끝 세미콜론 허용), 퍼센트 디코딩(실패 시 원문), `+`는 그대로. 경로 구분자 제거. 순수 함수 `fileNameFromDisposition(header: string | null): string | null`로 분리해 테스트.
   - 확장자가 있는 기존 bid 첨부 이름은 바꾸지 않는다.
5. 신규 `src/engine/jobs/prespec-dedupe.ts`
   ```ts
   export async function sha256Hex(bytes: Uint8Array): Promise<string>;   // crypto.subtle.digest
   /** 다운로드 후 중복 판정. 변경 여부 반환 */
   export async function dedupePrespec(notice: Notice, store: IFileStore): Promise<boolean>;
   ```
   - 대상: `origin==='prespec' && status==='saved'`인 첨부 p.
   - 비교 대상: `origin!=='prespec' && status==='saved'`인 bid 첨부 b.
   - 중복 조건: `attachmentNameKey(p.originalName) === attachmentNameKey(b.originalName)`, 또는 `p.savedSize === b.savedSize`이고 sha256이 같음. 해시는 크기가 같은 쌍에만 계산하고 `att.sha256`에 캐시.
   - 이름이 같고 내용이 달라도 중복으로 본다(입찰공고판이 최종본).
   - 중복이면 `store.remove(${folder}/attachments/${p.savedName})`, `p.status='skipped'`, `p.duplicateOf=b.id`, `p.savedSize=null`, `p.savedAt=undefined`, `p.note='입찰공고 첨부와 중복(사전규격)'`. savedName은 유지.
   - 읽기/해시/삭제 실패는 중복 아님으로 두고 로그만 남긴다.
6. `src/engine/jobs/collect-job.ts`
   - fetch_basic(bid, 재시도로 이미 done이면 건너뜀): 기존 조회 성공 뒤 `regNo = src.linkedPrespecNo?.(item)`. 있으면 진행 라벨 '연계 사전규격 조회 중'으로 `prespecSource.fetch({ kind:'prespec', noticeNo: regNo, ... })`.
     - 취소 → 기존 cancelled 처리.
     - `G2B_NOT_FOUND` → `linkedPrespec.status='not_found'`, 오류 아님.
     - 그 외 실패 → `status='failed'`, `JobError { code:'PRESPEC_FETCH_FAILED', step:'fetch_basic', retryable:true }`를 모아 두었다가 collect.errors에 합치고 partial 판정에 포함.
     - 성공 → `prespecSource.attachments(pitem)`에 `origin:'prespec'`를 붙인다.
   - `notice.attachments = matchAttachments(old, [...bid첨부, ...사전규격첨부], id)`(bid가 앞).
   - `notice.linkedPrespec` 설정(regNo 없으면 삭제), raw 두 개 저장.
   - download_attachments: 다운로드 루프가 끝난 뒤(실패 목록 계산 전) `dedupePrespec` 호출, 변경 있으면 saveNotice.
   - fetch_basic 완료 라벨: linked면 `공고정보 조회 완료, 사전규격 첨부 N건`.
7. `src/engine/extraction/extract-step.ts`: 파일 순서를 priority, origin(bid 먼저), index 순으로. `RuleDocInput`과 `ExtractionFile`에 origin 전달.
8. 메일: 사전규격 첨부도 기존대로 첨부에 포함(변경 없음, 확인만).

완료 조건: 타입체크, 아래 테스트 6~13 통과, 기존 테스트 통과(fixture에 `bfSpecRgstNo`가 없으면 기존 경로 그대로).

### S3. 화면 (implementer B, S1 뒤, S2와 병렬)
1. `src/ui/notice-detail/view.ts` `attachmentRows`에 origin 전달.
2. `src/entrypoints/dashboard/notice/FilesTab.tsx`: origin이 prespec이면 종류 앞에 `사전규격` 표시(예: "사전규격 / 제안요청서"). 중복 행은 상태 "건너뜀"과 note가 보인다(기존 표시 그대로인지 확인).
3. `src/ui/review/view.ts` `evidenceMeta`와 후보 출처 문구: `origin==='prespec'`이면 `사전규격 첨부: ` 접두.
완료 조건: 타입체크, 테스트 14.

### S4. 결정 기록 (메인)
`.claude/specs/decisions.md`에 이 기능의 결정과 기각 대안 추가.

## 하지 말 것
- `attachments/prespec/` 같은 하위 폴더나 별도 첨부 배열 금지(경로 가정이 여러 곳에 있음).
- 새 StepId 추가 금지(fetch_basic 안에서 처리).
- `G2B_NOT_FOUND`를 partial로 만들지 말 것.
- 재시도(fetch_basic done)에서 사전규격 재조회 금지.
- decide에서 prespec 후보를 버리지 말 것(candidates에 남김).
- 범위 밖 구조 변경이 필요하면 중단하고 보고.

## 테스트 케이스
1. `attachmentNameKey`: "제안요청서 (최종).HWP"와 "제안요청서(최종).hwp" 같음, ".hwp"와 ".pdf" 다름, NFD/NFC 같음.
2. `matchAttachments`: origin 복사, old의 duplicateOf 미복사, bid 3개 뒤 prespec 2개면 id a0..a4.
3. `planFiles`: duplicateOf면 skip('duplicate'); bid pdf와 prespec hwpx 같은 이름이면 둘 다 parse; 같은 origin hwp/pdf는 기존대로 pdf duplicate.
4. `decideOne`: bid 30과 prespec 25 → verified 30, candidates에 prespec 25; prespec만 25 → verified 25, evidence.origin prespec; bid 30/25 충돌과 prespec 30 → conflict 유지, prespec은 candidates 뒤.
5. `run-rules`: origin이 EvidenceRef에 복사, 없으면 키 없음.
6. `fileNameFromDisposition`: 실측 헤더(`attachment;filename=2.%20%EC%84%B8%EB%B6%80%EC%82%AC%EC%96%91%EC%84%9C%28%EC%BD%94%ED%8A%B8%EB%94%94%EB%B6%80%EC%95%84%EB%A5%B4_Project%20Contractor%202%29.hwp;`) → "2. 세부사양서(코트디부아르_Project Contractor 2).hwp"; `filename*=UTF-8''...` 우선; 따옴표; null/빈 값 → null; 잘못된 퍼센트 인코딩 → 원문.
7. downloader: 확장자 없는 이름 + 헤더 파일명 → originalName, savedName, 실제 저장 경로가 새 이름; 확장자 있는 이름은 헤더가 있어도 유지; 새 이름이 기존 savedName과 겹치면 uniqueName으로 구분.
8. `dedupePrespec`: 이름 키 같음 → 파일 삭제, skipped, duplicateOf; 이름 다르고 크기와 내용 같음 → 동일 처리, sha256 기록; 크기 같고 내용 다름 → 유지; 크기 다름 → readBytes 호출 없음; 이미 sha256 있으면 재계산 없음.
9. collect-job: bid item에 bfSpecRgstNo + 사전규격 첨부 2개(하나는 bid 공고서와 같은 내용) → attachments 4행, 하나는 skipped+duplicateOf, 하나는 saved, linkedPrespec linked, attachmentCount 2, `source/api-prespec-<op>.json` 저장.
10. bfSpecRgstNo 없음 → 사전규격 조회 없음, linkedPrespec 없음.
11. 사전규격 미존재 → not_found, collect completed, errors 없음. HTTP 500 → failed, partial, PRESPEC_FETCH_FAILED retryable. 조회 중 abort → cancelled.
12. 재시도(fetch_basic done) → 사전규격 조회 없음.
13. `mapApiItem`: bfSpecRgstNo → specRegNo. extract-step: 같은 priority면 bid 파일 먼저, ExtractionFile.origin 기록.
14. 화면: attachmentRows origin 전달, evidenceMeta prespec 접두.

## 보고 형식
결론, 변경 파일:줄범위, 실패 항목만 한국어로. 가운뎃점(·) 사용 금지(나열은 쉼표, 짝 개념은 슬래시).
