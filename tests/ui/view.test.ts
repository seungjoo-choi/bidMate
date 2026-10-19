import { describe, expect, it } from 'vitest';
import type { EvidenceRef, Extraction, ExtractionFile, ExtractedItem, ExtractionKey } from '../../src/core/types/extraction';
import { EXTRACTION_KEYS } from '../../src/core/types/extraction';
import { NOT_RUN_TEXT, buildCard, buildCards, fileDisplayName, fileRemark, summarize } from '../../src/ui/review/view';

const ev = (text = '원문'): EvidenceRef => ({ attachmentId: 'a', sourceFile: '공고.hwp', location: '표1 r1c1', evidence: text, ruleId: 'r', docKind: 'notice' });
const item = (o: Partial<ExtractedItem<unknown>>): ExtractedItem<unknown> => ({ value: null, status: 'verified', ...o });
const make = (over: Partial<Record<ExtractionKey, ExtractedItem<unknown>>>): Extraction => ({
  schemaVersion: 2, noticeId: 'n', jobId: 'j', extractedAt: '2026-10-17T00:00:00Z', rulesVersion: '1', status: 'needs_review',
  items: Object.fromEntries(EXTRACTION_KEYS.map((k) => [k, over[k] ?? item({ value: 1 })])) as Extraction['items'],
  extras: {}, files: [], warnings: [],
});

describe('카드 모델', () => {
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
    expect(summarize(ex)).toEqual({ verified: 5, needsReview: 1, edited: 1 });
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
