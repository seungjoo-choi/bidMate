# 정량평가 표 기반 "해당 없음"(not_applicable) 판정

## 목표
정량평가 표를 완결된 형태로 찾았는데 그 안에 실적/신인도/경영상태 행이 없으면, 해당 항목을 "확인 필요" 대신 "해당 없음"으로 판정한다. 숫자는 만들지 않는다(value는 항상 null).

사례: 공고 R26BK01631407-000 연계 사전규격 제안요청서(`/Users/seungjoochoi/Documents/bidmate/notices/2026/R26BK01631407-000_전자출하시스템 활성화 및 유지보수 사업/source/text/2_(붙임2) 제안요청서(전자출하시스템 활성화 및 유지보수 사업).hwp.txt` 2472~2517행). "2) 정량평가(10점)" 표119에 경영상태 10점 한 행뿐. 기대 결과: managementScore 10 verified, performanceScore/performancePeriod/performanceMinAmount/performanceCondition/credibilityScore 해당 없음, extraction.status verified, reviewCountOf 0. (perf.period 규칙은 이미 "제시" 문장과 하수급인 실적을 제외하도록 고쳐져 있어 performancePeriod는 not_found에서 해당 없음이 된다.)

## 핵심 결정
| # | 결정 |
|---|---|
| D1 | 새 전략 `quant-table`이 정량평가 표를 찾아 `extras.quantTable`에 두고, `decide()` 후처리 `applyQuantTable`이 항목을 바꾼다(bonus-table/no_total과 같은 구조). 전략은 items를 건드리지 않는다 |
| D2 | 표 완결성: 합계 배점 N이 있고 범위 안 숫자 배점 행의 합이 N과 같아야 한다. 잘린 표(`t.rows > g.rows`)는 탈락 |
| D3 | 범주 판정은 배점 열 왼쪽의 모든 칸(길이 제한 없음) 부분 일치. 안전 방향(있다고 봄) |
| D4 | 표현: `status: 'verified'`, `value: null`, `reason: 'not_applicable'`, evidence는 정량표, raw는 표 요약. 새 status 값은 만들지 않는다 |
| D5 | `ReviewState`/`LeafState`에 `'not_applicable'` 추가. itemReviewState에서 userEdited 다음, verified 앞에 판정 |
| D6 | 해당 없음 항목은 REVIEW_GROUPS 충족 근거가 아니다(`satisfiedItem`에서 제외) |
| D7 | 항목이 `needs_review` + `not_found`일 때만 적용. conflict/multi/low_confidence/no_total/no_documents/verified/userEdited는 건드리지 않음 |
| D8 | 신인도 추가 조건: `extras.bonusTable` 값 없음, `extras.quantEvalDoc` 문장에 "신인도" 없음. 실적 추가 조건: quantEvalDoc에 "실적" 없음. 경영상태: quantEvalDoc에 "경영|신용" 없음 |
| D9 | 실적 하위 3항목(기간, 금액, 조건)은 performanceScore가 해당 없음이 될 때 not_found인 것만 함께 해당 없음. 값이 있으면 유지 |
| D10 | 정량표 규칙 `docKinds: ['eval_criteria','notice','rfp']`, conflictPolicy 기본(strict). 표가 여러 장이고 범주가 다르면 conflict → 적용 안 함 |
| D11 | 사전규격 첨부에만 정량표가 있으면 그 표로 판정(decideOne의 bid 우선 규칙이 extras에도 적용됨) |
| D12 | 적격 판정(judge) verdict 로직 불변, 사유 문구만 "해당 없음(정량평가에 실적 항목 없음)" |
| D13 | 스키마 버전 유지, 마이그레이션 없음, 규칙 버전 1.3.0 → 1.4.0, 기존 공고는 "다시 추출"로 적용 |

## 1단계: 추출 코어 (implementer A, 순서대로)

1. `src/core/types/extraction.ts`: `ExtractedItem.reason` 유니언에 `'not_applicable'`.
2. 신규 `src/core/extraction/quant-table.ts`: `QUANT_TABLE_EXTRA = 'quantTable'`, `type QuantCat = 'perf'|'cred'|'mgmt'|'other'`, `formatQuantValue({ total, cats })` → `"<N>:<정렬된 cats 쉼표 연결>"`(예 `"10:mgmt"`), `parseQuantValue(v: unknown): { total: number; cats: Set<QuantCat> } | null`. 값을 문자열로 두는 이유: valueKey가 객체를 뭉개므로 같은 범주 집합이면 같은 값(verified), 다르면 conflict가 되게.
3. 신규 `src/core/extraction/strategies/quant-table.ts`: `export function quantTable(p: Prepared, rule: R, syn: Synonyms): RawHit[]`. 모든 표(table-score.ts, bonus-table.ts의 표 순회 방식을 참고)마다 아래를 모두 만족하면 RawHit 1개.
   1. 배점 열: 머리글 행 칸 중 `scoreHeader` 동의어(배점/배점한도/점수)에 compact 부분 일치하는 첫 칸의 열 `sc`. 없으면 탈락.
   2. 정량 식별(둘 다면 B 우선):
      - 양식 A(제목): `t.caption` compact가 `title`(`정량(?:적)?평가`)에 일치하고 `/자가진단|서식|별지|증빙|제출|기준표|등급/`에 불일치. 범위 행 = 머리글 다음 행부터 끝. 단, 범위 행 0열 칸에 `/정성평가|기술평가|가격평가/`가 있으면 결합 표이므로 양식 B로만 처리.
      - 양식 B(라벨 칸): 0열 칸 중 compact가 `^` + title에 일치하는 칸 L. 범위 행 = `[L.r, L.r + L.rowSpan)`.
      - 둘 다 아니면 탈락.
   3. 합계 N: 제목(A) 또는 L 칸(B) compact에서 `/정량(?:적)?평가[^\d]{0,12}(\d+(?:\.\d+)?)점/`. 없으면 범위 행 중 첫 비어 있지 않은 칸이 `^(합계|계|소계|총계)$`인 행의 배점 칸. 그래도 없으면 탈락.
   4. 행 배점 합: 범위 행마다 배점 칸(rowSpan 반복 셀은 한 번만, 합계 행 제외)을 table-score와 같은 정규식 `^(\d+(?:\.\d+)?)점?(?:\(.{0,10}\)|만점)?$`로 파싱해 합산. 파싱 안 되는 칸("±2", "배점의 100%", 빈 칸)은 합에서 빼되 탈락시키지 않음. 숫자 행 0개이거나 합 ≠ N이면 탈락. 잘린 표면 탈락.
   5. 범주: 범위 행의 `c < sc`인 모든 칸(중복 셀 제거) compact 텍스트에 `perfLabel`/`credLabel`/`mgmtLabel` 동의어 부분 일치 → cats. 어느 것도 아닌 짧은 라벨 칸(30자 이하, 머리글 제외)이 하나라도 있으면 `other` 추가.
   6. 출력: value = formatQuantValue, raw = `"정량평가 10점: 경영상태주1) 10"`(범위 행마다 첫 짧은 라벨 + 배점, 300자 제한), evidence = raw, context = 머리글 행 + 범위 행 텍스트(400자), location = `표${t.index} r${첫 범위 행}c${sc}`, line/page = 첫 범위 행 배점 칸 위치.
4. `src/core/extraction/rules/schema.ts`: Rule 변형 `{ strategy: 'quant-table'; scoreHeader: string; title: string; perfLabel: string; credLabel: string; mgmtLabel: string }`, validateRule에 해당 terms 검사.
5. `src/core/extraction/run-rules.ts`: switch에 `case 'quant-table'`.
6. `src/core/extraction/rules/default-rules.json`: version "1.4.0", 동의어 `quantPerf: ["실적","경험","건수"]`, `quantCred: ["신인도","가점","감점","가산","감산","제재","부정당","벌점"]`, `quantMgmt: ["경영","신용","재무","부채"]`("이행"은 넣지 않음), 규칙 `{ "id": "eval.quantTable", "target": "extras.quantTable", "strategy": "quant-table", "scoreHeader": "scoreHeader", "title": "정량(?:적)?평가", "perfLabel": "quantPerf", "credLabel": "quantCred", "mgmtLabel": "quantMgmt", "docKinds": ["eval_criteria","notice","rfp"], "weight": 1 }`(scoreHeader 동의어 키가 없으면 기존 동의어 체계에 맞게 추가).
7. `src/core/extraction/review-count.ts`: 상수 `NA_NOTE = '정량평가 표에 해당 항목 없음'`, `NA_VALUE_TEXT = '해당 없음'`, `isNotApplicable(it?)` = `status==='verified' && reason==='not_applicable'`, `isNotApplicableField(f?: FieldValue)` = `status==='verified' && value===null && note===NA_NOTE`. ReviewState에 `'not_applicable'`. `itemReviewState` 순서: userEdited → NA → verified → covered → needs_review. `fieldReviewState`: user_edited → (isNotApplicableField(f) 또는 x의 item NA) → verified → covered → f.status. `satisfiedItem`: `status==='verified' && !isNotApplicable(it)` 또는 userEdited. coveringKey/pendingKeys/reviewCountOf/conflictCountOf는 변경 없음.
8. `src/core/extraction/decide.ts`: `applyQuantTable(items, extras)`를 applyBonusTable 다음에 호출. 의사코드:
   ```
   qt = extras.quantTable; if (!qt || qt.status !== 'verified' || !qt.evidence) return;
   parsed = parseQuantValue(qt.value); if (!parsed) return;
   doc = extras.quantEvalDoc이 verified이고 string이면 그 값, 아니면 ''
   isNF(k) = items[k].status === 'needs_review' && items[k].reason === 'not_found'
   na(k) = items[k] = { value: null, status: 'verified', reason: 'not_applicable', raw: qt.raw, evidence: qt.evidence }
   if (!cats.has('perf') && !/실적/.test(doc) && isNF('performanceScore')) { na('performanceScore'); for k of [performancePeriod, performanceMinAmount, performanceCondition] if (isNF(k)) na(k); }
   if (!cats.has('cred') && !/신인도/.test(doc) && isNF('credibilityScore') && (extras.bonusTable?.value ?? null) === null) na('credibilityScore');
   if (!cats.has('mgmt') && !/경영|신용/.test(doc) && isNF('managementScore')) na('managementScore');
   ```
   `computeStatus` ok 집합에 `'not_applicable'` 추가.
9. `src/engine/extraction/extract-step.ts` `fieldOfItem`: NA 분기 `{ value: null, status: 'verified', note: NA_NOTE, raw: it.raw, source: docSourceOf(evidence) }`. 기존 verified 분기(`it.value !== null`)는 느슨하게 하지 않는다.

완료 조건: tsc 통과, 테스트 1~4, 6 통과.

## 2단계: 표시와 메일 (implementer B, 1단계 뒤)
10. `src/core/extraction/review-rows.ts`: LeafState에 추가, leafReviewState에서 NA면 reason = NA_NOTE, ROW_PRIORITY에서 covered 다음 verified 앞.
11. `src/ui/review/view.ts`: CardBadge `'notApplicable'`, REASON_TEXT에 `not_applicable: NA_NOTE`, buildCard 배지/valueText("해당 없음")/reason, 정렬 순위, SummaryCounts.notApplicable(그리는 곳은 `summarize(` 사용처를 찾아 "해당 없음 N" 표시).
12. `src/ui/review/rows.ts` 배지 매핑과 valueText, `src/entrypoints/dashboard/review/ReviewRows.tsx` CELL(covered와 같은 `bg-ok`), 상태 글자, rowTone `{ tone: 'idle', text: '해당 없음' }`. 버튼은 기존 "직접 수정" 분기 그대로.
13. `src/ui/notice-detail/view.ts` `evalRow`: fieldReviewState가 not_applicable이면 `{ value: '해당 없음', hint: f.note }`, 확인 필요 표시와 검토 링크 없음.
14. `src/core/model/notice-summary.ts` EvalFactItem에 `notApplicable?: true`(needsCheck false), `src/entrypoints/sidepanel/summary-view.ts`와 `history-view.ts` 행 값이 "해당 없음".
15. `src/core/templates/values.ts` resolveValue: 6개 키(performanceScore, performancePeriod, performanceMinAmount, performanceCondition, credibilityScore, managementScore)에서 `isNotApplicableField(fv)`면 `{ text: '해당 없음', status: 'ok', raw: null }`, fieldCoveringKey 검사보다 앞. `src/core/templates/composites.ts`: performanceEval은 performanceScore가 NA면 "해당 없음". credibilityEval은 두 필드 모두 NA면 "해당 없음", 한쪽만 NA면 기존대로.
16. `src/core/qualification/judge.ts`: criteriaFromItem에서 NA면 `{ value: null, state: 'unknown', status, note: NA_NOTE }`, reasons 문구를 "인정기간: 해당 없음(정량평가에 실적 항목 없음)"/"인정금액: …"로. verdict 로직 불변.
메일 자동작성 게이트(handoff.ts), AI 재검토(ai-review-api.ts)는 변경 없음(reviewCount가 0으로 수렴).

완료 조건: tsc 통과, 테스트 5~7 통과, 기존 전체 테스트 통과.

## 하지 말 것
- 표 없이 "경영상태가 있으니 실적은 해당 없음"으로 추론 금지.
- NA 항목에 0점 등 숫자 넣기 금지.
- verified + value null을 "확인 완료"로 그리지 말 것(반드시 isNotApplicable로 분기).
- NA를 그룹 충족 근거로 쓰지 말 것.
- 범주 동의어에 "이행" 넣지 말 것, 범주 판정 범위를 라벨 길이로 좁히지 말 것.
- 정량표 conflict를 prefer_priority로 풀지 말 것.
- 범위 밖 구조 변경이 필요하면 중단하고 보고.

## 테스트 케이스
1. `tests/extraction/quant-table.test.ts`(합성 DocModel):
   - 양식 A: caption "2) 정량평가(10점)", 머리글 대항목|중항목|평가요소|배점기준, 행 "관리부문\n(10)"|"경영상태주1)"|"- 신용 평가기관의 신용도"|"10" → "10:mgmt".
   - 양식 B: 머리글 구분|평가부문|평가항목|배점, 0열 rowSpan 2 "정량평가\n(10점)", 경영상태 4, "회사 유사사업\n수행 실적" 6 → "10:mgmt,perf".
   - 합 불일치(합계 10, 행 4만) → 없음. 합계 없음 → 없음, 합계 행 "합계|10" 있으면 → 있음.
   - caption "정량평가 자가진단표" → 없음. 등급표(머리글 신용평가등급|평점, caption 없음) → 없음.
   - caption 정량평가인데 0열에 "정성평가(90점)"만 있고 정량 라벨 없음 → 없음.
   - "신인도|±2" + 경영상태 10, 합계 10 → "10:cred,mgmt".
   - 잘린 표 → 없음.
2. `tests/extraction/not-applicable.test.ts`(decide 단위):
   - quantTable "10:mgmt" + managementScore 10 + 나머지 후보 없음 → 실적 4개와 신인도 NA(evidence가 quantTable evidence), mgmt verified, computeStatus 'verified', reviewCountOf 0, conflictCountOf 0.
   - performancePeriod "3년" 후보 추가 → "3년" verified 유지, 나머지 NA.
   - performanceScore inline 후보 1개 → NA 아님.
   - bonusTable 값 있음 → credibility NA 아님.
   - quantEvalDoc "정량평가 : 조달청(경영상태, 수행실적)" → perf NA 아님.
   - quantTable 두 문서 "10:mgmt" vs "10:mgmt,perf" → conflict, NA 없음.
   - credibilityScore conflict → NA 아님.
   - quantTable "10:mgmt,cred"에서 mgmt 후보 없음 → mgmt needs_review 유지, cred NA가 그룹 충족 안 함.
   - docKind form/qna 문서의 정량표는 후보가 안 나옴.
3. 실제 문서: 사례 공고 attachments 폴더의 `(붙임2) 제안요청서(전자출하시스템 활성화 및 유지보수 사업).hwp`를 `tests/fixtures/docs/R26BK01631407/`로 복사해 기존 실제 문서 테스트 방식(tests/extraction/rules.test.ts)으로: managementScore 10 verified, performanceScore NA이고 evidence.location이 `표119`로 시작(실제 표 번호가 다르면 실제 값으로), credibilityScore NA, performancePeriod NA, computeStatus 'verified', reviewCountOf 0. 기존 KOICA 등 실제 문서 테스트에서 reason 'not_applicable'이 생기지 않음.
4. review-count: itemReviewState NA → 'not_applicable', userEdited 있으면 'user_edited', pendingKeys 제외, satisfiedItem 제외.
5. UI 순수 함수: buildCard(배지 notApplicable, valueText '해당 없음', reason NA_NOTE), leafReviewState, 행 상태 우선순위, evalRow → '해당 없음', summary-view 행 값 '해당 없음'이고 check false, resolveValue(performanceScore) → { text: '해당 없음', status: 'ok' }, performanceEval → '해당 없음', credibilityEval(mgmt 10 + cred NA) → 기존 경영상태 문장 ok.
6. extract-step fieldOfItem: NA 항목 → `{ value: null, status: 'verified', note: NA_NOTE, source }`. handoff: reviewCount 0이면 compose.
7. judge: NA → reasons에 "해당 없음(정량평가에 실적 항목 없음)", verdict 'review'.

## 보고 형식
결론, 변경 파일:줄범위, 실패 항목만 한국어로. 가운뎃점(·) 사용 금지(나열은 쉼표, 짝 개념은 슬래시).
