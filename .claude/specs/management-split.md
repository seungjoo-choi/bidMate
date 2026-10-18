# 경영상태 배점 항목 분리 (Fable 설계, 2026-10-17)

## 목표
대외신인도(credibilityScore)와 경영상태(신용평가등급)를 별도 추출 항목으로 나눈다. 저장 파일은 고쳐 쓰지 않고 읽을 때 메모리에서만 보정한다.

## 결정 요약
- 새 키 `managementScore`(라벨 "경영상태 배점", kind score). `ExtractionKey`, `EXTRACTION_KEYS`, `EVALUATION_KEYS`, `NoticeEvaluation`에서 모두 `credibilityScore` 바로 뒤.
- 동의어: credibility = ["대외신인도", "신인도"], management = ["경영상태", "신용평가등급", "신용평가", "신용도"].
- 마이그레이션 금지. 옛 extraction.json의 빠진 항목은 읽을 때 `{ value: null, status: 'not_run' }`. 옛 credibilityScore 값과 userEdited는 옮기지 않는다.
- Extraction schemaVersion 2(쓰기 2, 읽기는 1 허용). Notice schemaVersion은 1 유지.
- 사용자 규칙에서 동의어가 두 target에 겹치면 경고만 남긴다(버리지 않음).
- 한쪽만 있는 공고는 다른 쪽이 not_found(확인 필요)가 되는 것이 정상이다.

## 1단계: 타입, 규칙, 검증, 화면 라벨
1. `src/core/types/extraction.ts`: `ExtractionKey`와 `EXTRACTION_KEYS`에 `'managementScore'`를 `'credibilityScore'` 바로 뒤에 추가. `Extraction.schemaVersion: 2`. `export const EXTRACTION_SCHEMA_VERSION = 2 as const;`
2. `src/core/types/notice.ts` `NoticeEvaluation`에 `managementScore: FieldValue<number>;`(credibilityScore 뒤).
3. `src/core/model/notice-fields.ts` `EVALUATION_KEYS`에 `'managementScore'`(credibilityScore 뒤).
4. `src/core/extraction/rules/default-rules.json`
   - `"version": "1.1.0"`
   - `synonyms.credibility` = `["대외신인도", "신인도"]`, 새 `synonyms.management` = `["경영상태", "신용평가등급", "신용평가", "신용도"]`(credibility 바로 뒤)
   - `cred.table` 뒤에 `{ "id": "mgmt.table", "target": "managementScore", "strategy": "table-score", "label": "management", "scoreHeader": "scoreHeader", "weight": 1 }`
   - `cred.inline` 뒤에 `{ "id": "mgmt.inline", "target": "managementScore", "strategy": "inline-score", "label": "management", "maxGap": 20, "weight": 0.3 }`
   - JSON의 다른 규칙과 패턴 문자열은 절대 바꾸지 말 것(문자열 치환으로 해당 부분만 편집).
5. `src/core/extraction/rules/load.ts` `loadRules` 끝(version 조립 전)에 겹침 검사: `base.rules` 중 strategy가 `table-score`/`inline-score`이고 `label`이 `base.synonyms`의 키인 규칙을 target별로 모아 동의어(공백 제거) Set을 만든다. 서로 다른 target 쌍에 공통 항목이 있으면 항목마다 `동의어 겹침: ${a}/${b}에 '${term}'이 모두 있어 같은 값이 두 항목에 들어갈 수 있음`을 `base.warnings`에 넣는다. 규칙/동의어는 버리지 않는다. 기본 규칙만으로는 경고 0개.
6. `src/adapters/g2b/html-parse.ts` `NUMBER_KEYS`에 `'managementScore'`.
7. `src/engine/notices/notice-api.ts` `VALUE_CHECK`에 `managementScore: (v) => finite(v) && v >= 0 && v <= 1000`.
8. `src/ui/review/view.ts`: `ITEM_LABEL.managementScore = '경영상태 배점'`, `ITEM_KIND.managementScore = 'score'`. `export const NOT_RUN_TEXT = '이전 버전 결과, 다시 추출 필요'`. `buildCard`의 reason을 `badge === 'needs_review' ? (item.status === 'not_run' ? NOT_RUN_TEXT : reasonText(item.reason)) : undefined`로.
9. `src/engine/extraction/extract-step.ts`: schemaVersion에 `EXTRACTION_SCHEMA_VERSION`. `transplantEdits(items, prior)`가 경고 문자열 배열을 반환하도록 바꾸고, prior가 있고 `(!prior.items?.managementScore || prior.items.managementScore.status === 'not_run')`이며 `prior.items?.credibilityScore?.userEdited`가 있으면 `'이전 버전에서 직접 수정한 대외신인도 값은 경영상태 배점이었을 수 있습니다. 두 항목을 확인해 주세요.'`를 반환. 호출부에서 warnings에 넣는다.
- ItemCard.tsx, ReviewPage.tsx, NoticesPage.tsx, decide.ts, merge.ts는 키 목록을 순회하므로 수정 불필요(확인만).
- 완료 조건: `tsc --noEmit`이 `Record<ExtractionKey, …>` 누락을 모두 잡고 통과.

## 2단계: 읽기 보정
1. 새 파일 `src/core/model/extraction-compat.ts`: `export function normalizeExtraction(x: Extraction): Extraction`. items가 없으면 `{}`. `EXTRACTION_KEYS` 중 `Object.hasOwn(x.items, k)`가 아닌 키를 `{ value: null, status: 'not_run' }`로 채우고 `x.schemaVersion = EXTRACTION_SCHEMA_VERSION`. status, extras, files, warnings는 손대지 않고 같은 객체를 반환.
2. `src/core/model/notice-fields.ts`에 `export function fillMissingFields(n: Notice): Notice`: `ALL_FIELD_KEYS`를 돌며 그룹의 키가 undefined면 `missing()`. 그룹 객체가 없으면 `{}`로 만든 뒤 채움. 있는 값은 그대로.
3. `src/engine/notices/notice-store.ts`: `loadExtraction`은 `normalizeExtraction(...)`, `loadNotice`는 `fillMissingFields(...)`로 감싼다. 저장 경로에서는 변환하지 않는다.

## 3단계: 테스트
- `tests/extraction/rules.test.ts`
  1. f1+f3: managementScore 4 verified(evidence 표{quant.index} r1c3, f3), credibilityScore `{ value: null, status: 'needs_review', reason: 'not_found' }`, 나머지 불변.
  2. f1+f3+f6: 같은 변경. "전 항목 verified" 문구/단언을 "credibilityScore 제외 verified"로.
  3. 합성 표 `[['구분','평가항목','배점'],['정량','경영상태(신용평가등급)','10'],['정량','대외신인도','4']]` → managementScore 10, credibilityScore 4, 각각 verified.
  4. 라벨 "신용평가등급" 단독 행 → managementScore 후보만.
  5. inline: '대외 신인도 평가는 5점으로 한다' → credibilityScore 5만, '경영상태 평가 10점' → managementScore 10만.
  6. 전체 status 케이스의 ok 목록에 managementScore 후보 추가.
  7. 로더: 기본 규칙 warnings 빈 배열. 사용자 `synonyms: { credibility: ['대외신인도', '경영상태'] }` → warnings에 "동의어 겹침"과 '경영상태', 규칙 수 불변.
- `tests/engine/extract-flow.test.ts`
  8. 실문서 수집: managementScore 4 verified, credibilityScore not_found, x.status 'needs_review', reviewCount 1, schemaVersion 2. notice.evaluation 출처 확인 목록에서 credibilityScore를 managementScore로.
  9. "병합 충돌" describe의 html 필드 키를 managementScore로 바꿔 기존 두 케이스 유지.
- `tests/core/extraction-compat.test.ts`(신규)
  10. schemaVersion 1, managementScore 없음 → not_run 채움, schemaVersion 2, 다른 필드 동일 참조.
  11. 모든 키가 있으면 변화 없음(schemaVersion만 2).
  12. fillMissingFields: 빠진 managementScore를 missing()으로, 있는 필드는 동일 참조.
- `tests/engine/extract-job.test.ts` 추가
  13. 옛 스키마 extraction.json(managementScore 없음, credibilityScore userEdited 4) → getNotice 시 managementScore not_run. editExtraction('managementScore', 10) 성공, 저장 파일 schemaVersion 2, credibilityScore.userEdited 보존.
  14. 같은 옛 데이터를 prior로 재추출(경영상태 10점 문서) → warnings에 "이전 버전에서 직접 수정한 대외신인도" 포함, credibilityScore.userEdited 4 유지, managementScore 10 verified. prior가 새 스키마면 경고 없음.
  15. editExtraction('managementScore', 1001)과 '4'는 INVALID_VALUE.
- `tests/ui/view.test.ts`
  16. buildCards 길이 7, managementScore가 credibilityScore 바로 뒤, 요약 카운트 갱신.
  17. buildCard('managementScore', { value: null, status: 'not_run' }) → badge needs_review, reason NOT_RUN_TEXT, valueText '—'.

## 제약
- 기존 저장 파일을 고쳐 쓰는 코드 금지. 보정은 읽기 경로에서만.
- 이 명세 밖의 구조 변경이 필요하면 멈추고 보고.
- 문구, 주석에 가운뎃점(·) 금지.
