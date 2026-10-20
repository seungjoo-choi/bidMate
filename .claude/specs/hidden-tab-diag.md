# 숨김 탭 상세화면 읽기 진단(I1) 명세

작성 2026-10-20. Fable 설계. 사용자 결정: 탭을 보이지 않게 유지(C). 원인 확정 전이라 1단계는 진단 로그만 넣는다. shim(I2)은 진단 결과를 보고 별도 명세로 진행.

## 배경
`src/background/detail-reader.ts`가 `tabs.create({active:false})`로 나라장터 상세 페이지를 열고 g2b CS(`src/entrypoints/g2b.content.ts`, `g2b/read-html`)를 700ms 폴링한다. 사용자가 그 탭을 클릭해야 값이 채워진다. 유력 원인은 WebSquare가 숨김 탭에서 오지 않는 requestAnimationFrame/Observer에 의존하는 것(추정). 진단으로 확정한다.

## 작업
1. `src/messaging/protocol.ts`: `g2b/read-html` response에 추가
```ts
diag: { visibility: DocumentVisibilityState; readyState: DocumentReadyState; mainFrame: boolean; inputs: number;
        noticeInputAny: boolean; noticeInputVisible: boolean; rafFiredSinceLast: boolean; timerSkewMs: number | null; url: string }
```
2. `src/entrypoints/g2b.content.ts` read-html 리스너:
   - `mainFrame`: `document.querySelector(MAIN_FRAME_SELECTOR) !== null`(detail-page.ts export 사용). `inputs`: 메인 프레임 안 `input[title], textarea[title]` 개수.
   - `noticeInputAny`: `detectDetail(document,{url: location.href, isVisible: () => true}) !== null`. `noticeInputVisible`: 기본 isVisible로 detectDetail 성공 여부.
   - 모듈 스코프 `let rafFlag = false; let timerSkew: number | null = null;`. 요청마다 현재 값을 보고한 뒤 `rafFlag=false; requestAnimationFrame(() => { rafFlag = true; })` 1개, `const t0 = performance.now(); setTimeout(() => { timerSkew = performance.now() - t0 - 100; }, 100)` 1개를 다시 건다. 상시 루프 금지.
   - `url: location.href`, `visibility: document.visibilityState`.
3. `src/background/detail-reader.ts`:
   - `DetailReaderDeps.log?: (...a: unknown[]) => void`(기본 `console.info`).
   - 틱마다 `{ t: now()-start, tabStatus: cur.status, discarded: cur.discarded, url, result: 'NO_RECEIVER' | 'TIMEOUT' | { match, fieldKeys: Object.keys(html?.fields ?? {}), diag } }`를 trace 배열에 push(최대 120개, 초과 시 앞부분 버림)하고 `log('[detail-reader]', jobId, tick)`.
   - 종료(성공·실패 모두, finally) 시 `log('[detail-reader] trace', jobId, JSON.stringify(trace))`.
   - sendToTab 오류는 메시지/코드로 'NO_RECEIVER'(수신자 없음)와 'TIMEOUT'을 구분, 그 외는 'NO_RECEIVER'로.
   - `g2b/read-detail` 응답 형식은 바꾸지 않는다.
4. 테스트 `tests/background/detail-reader.test.ts`: 틱마다 log 1회, 종료 시 trace log 1회이고 trace 길이 = 틱 수, 120 상한 초과 시 앞부분 버림, NO_RECEIVER 틱도 기록. 기존 테스트의 sendToTab 모의 응답에 diag가 없어도 동작하게(옵셔널 접근).

## 하지 말 것
- shim·MAIN world 스크립트 추가, setTimeout 패치, isVisible 변경(이번 범위 아님).
- 사용자 탭에 상시 rAF 루프.

## 완료 조건
`cd C:/workspace/bidMate && npx tsc --noEmit`, `npm test` 전체 통과(반드시 대문자 C: 경로).

## 보고 (한국어)
변경 파일:줄범위, 테스트 결과(개수), 의심 사항.
