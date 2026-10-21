import { describe, expect, it } from 'vitest';
import type { EvidenceRef, Extraction, ExtractionFile, ExtractedItem, ExtractionKey } from '../../src/core/types/extraction';
import { EXTRACTION_KEYS } from '../../src/core/types/extraction';
import { NOT_RUN_TEXT, buildCard, evidenceMeta, buildCards, fileDisplayName, fileRemark, summarize } from '../../src/ui/review/view';

const ev = (text = '원문'): EvidenceRef => ({ attachmentId: 'a', sourceFile: '공고.hwp', location: '표1 r1c1', evidence: text, ruleId: 'r', docKind: 'notice' });
const item = (o: Partial<ExtractedItem<unknown>>): ExtractedItem<unknown> => ({ value: null, status: 'verified', ...o });
const make = (over: Partial<Record<ExtractionKey, ExtractedItem<unknown>>>): Extraction => ({
  schemaVersion: 2, noticeId: 'n', jobId: 'j', extractedAt: '2026-10-17T00:00:00Z', rulesVersion: '1', status: 'needs_review',
  items: Object.fromEntries(EXTRACTION_KEYS.map((k) => [k, over[k] ?? item({ value: 1 })])) as Extraction['items'],
  extras: {}, files: [], warnings: [],
});

describe('evidenceMeta', () => {
  it('prespec이면 사전규격 첨부 접두, 아니면 그대로', () => {
    expect(evidenceMeta(ev())).toBe('공고.hwp, 표 2, 2행 2열');
    expect(evidenceMeta({ ...ev(), origin: 'prespec' })).toBe('사전규격 첨부: 공고.hwp, 표 2, 2행 2열');
    const c = buildCard('deadline' as ExtractionKey, item({ value: 1, candidates: [{ value: 1, evidence: ev() }, { value: 2, evidence: { ...ev(), origin: 'prespec' } }] }));
    expect(c.candidates[1]!.sourceText).toBe('사전규격 첨부: 공고.hwp, 표 2, 2행 2열');
  });
});

describe('카드 모델', () => {
  it('buildCards 3인자: others가 비어 있지 않을 때만 aiOthers 설정', () => {
    const o = { suggestion: { key: 'credibilityScore', value: 1, quote: 'q', verdict: 'new', baseline: null, valueInQuote: true }, run: { id: 'r' } } as never;
    const cards = buildCards(make({}), undefined, { credibilityScore: [o], managementScore: [] });
    expect(cards.find((c) => c.key === 'credibilityScore')!.aiOthers).toHaveLength(1);
    expect(cards.find((c) => c.key === 'managementScore')!.aiOthers).toBeUndefined();
    expect('aiOthers' in buildCards(make({}))[0]!).toBe(false);
  });
  it('확인 필요가 먼저 온다', () => {
    const ex = make({ performanceScore: item({ status: 'needs_review', reason: 'not_found' }), differentialScoring: item({ status: 'needs_review', reason: 'conflict' }) });
    const keys = buildCards(ex).map((c) => c.key);
    expect(keys.slice(0, 2)).toEqual(['performanceScore', 'differentialScoring']);
    expect(keys).toHaveLength(7);
  });
  it('reason 문구 3종', () => {
    expect(buildCard('performanceScore', item({ status: 'needs_review', reason: 'not_found' })).reason).toBe('문서에서 찾지 못함');
    expect(buildCard('performanceScore', item({ status: 'needs_review', reason: 'conflict' })).reason).toBe('문서 간 값 다름');
    expect(buildCard('performanceScore', item({ status: 'needs_review', reason: 'low_confidence' })).reason).toBe('질의답변에만 있음');
    expect(buildCard('credibilityScore', item({ status: 'needs_review', reason: 'no_total' })).reason).toBe('가감점 표만 있음, 합계 배점 없음');
  });
  it('경영상태 배점 카드는 대외신인도 바로 뒤, not_run은 다시 추출 안내', () => {
    const keys = buildCards(make({})).map((c) => c.key);
    expect(keys.indexOf('managementScore')).toBe(keys.indexOf('credibilityScore') + 1);
    const c = buildCard('managementScore', { value: null, status: 'not_run' });
    expect(c.badge).toBe('needs_review');
    expect(c.reason).toBe(NOT_RUN_TEXT);
    expect(c.valueText).toBe('—');
  });
  it('후보는 2개 이상일 때만, 직접 수정 값 우선', () => {
    const c = { value: 5, evidence: ev() };
    expect(buildCard('credibilityScore', item({ candidates: [c] })).candidates).toHaveLength(0);
    expect(buildCard('credibilityScore', item({ candidates: [c, { value: 6, evidence: ev() }] })).candidates).toHaveLength(2);
    const e = buildCard('performanceMinAmount', item({ value: 1, userEdited: { value: 500_000_000, editedAt: 'x' } }));
    expect(e.badge).toBe('userEdited');
    expect(e.valueText).toBe('5억 원 (500,000,000원)');
  });
  it('요약 카운트', () => {
    const ex = make({ performanceScore: item({ status: 'needs_review' }), credibilityScore: item({ userEdited: { value: 3, editedAt: 'x' } }) });
    expect(summarize(ex)).toEqual({ verified: 5, needsReview: 1, edited: 1, covered: 0, notApplicable: 0 });
  });
  it('그룹 충족(covered) 카드: 뱃지, 이유, 정렬, 요약', () => {
    const ex = make({
      managementScore: item({ value: 4 }), credibilityScore: item({ status: 'needs_review', reason: 'no_total' }),
      performanceScore: item({ status: 'needs_review', reason: 'not_found' }),
    });
    const c = buildCard('credibilityScore', ex.items.credibilityScore, ex.items);
    expect(c.badge).toBe('covered');
    expect(c.reason).toBe('문서에 없음 (경영상태 배점 항목으로 충족)');
    expect(buildCards(ex).map((x) => x.badge).slice(0, 2)).toEqual(['needs_review', 'covered']);
    expect(summarize(ex)).toEqual({ verified: 5, needsReview: 1, edited: 0, covered: 1, notApplicable: 0 });
  });
});

describe('파일 행', () => {
  const f = (o: Partial<ExtractionFile>): ExtractionFile => ({ attachmentId: 'a', name: 'a.zip', docKind: 'other', priority: 1, status: 'skipped', ...o });
  it('skipReason 문구', () => {
    expect(fileRemark(f({ skipReason: 'duplicate' }))).toBe('PDF 사본(같은 HWP 분석)');
    expect(fileRemark(f({ skipReason: 'excluded' }))).toBe('양식/참고자료');
    expect(fileRemark(f({ skipReason: 'budget' }))).toBe('시간 예산 초과');
    expect(fileRemark(f({ skipReason: 'too_large' }))).toBe('크기 초과');
    expect(fileRemark(f({ skipReason: 'not_saved' }))).toBe('다운로드 안 됨');
    expect(fileRemark(f({ skipReason: 'unsupported_ext' }))).toBe('지원하지 않는 형식');
  });
  it('status/error 문구와 이름', () => {
    expect(fileRemark(f({ status: 'scanned' }))).toBe('스캔 문서(글자 없음)');
    expect(fileRemark(f({ status: 'drm' }))).toBe('암호/배포용 문서');
    expect(fileRemark(f({ status: 'failed', error: 'boom' }))).toBe('boom');
    expect(fileDisplayName(f({ innerPath: 'x/y.hwp' }))).toBe('a.zip › x/y.hwp');
  });
});
