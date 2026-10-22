import { describe, expect, it } from 'vitest';
import { estimateRows, normalizeEstimate, validateScore } from '../../src/core/estimate/estimate';
import type { EstimateFile } from '../../src/core/types/estimate';
import type { Extraction, ExtractedItem } from '../../src/core/types/extraction';
import type { FieldValue } from '../../src/core/types/common';
import type { Notice } from '../../src/core/types/notice';

type Ev = { managementScore?: FieldValue<number>; credibilityScore?: FieldValue<number>; performanceScore?: FieldValue<number> };
const miss: FieldValue<number> = { value: null, status: 'missing' };
const ok = (v: number | null): FieldValue<number> => ({ value: v, status: 'verified' });
const review = (v: number): FieldValue<number> => ({ value: v, status: 'needs_review' });
const mkNotice = (e: Ev): Notice => ({ evaluation: { managementScore: miss, credibilityScore: miss, performanceScore: miss, ...e } }) as unknown as Notice;
const company = { bizNo: '' };
const file = (items: EstimateFile['items']): EstimateFile => ({ schemaVersion: 1, noticeId: 'n1', items, updatedAt: '2026-01-01T00:00:00Z' });
const entry = (score: number) => ({ score, updatedAt: '2026-01-01T00:00:00Z' });

describe('estimateRows maxState', () => {
  it('verified 숫자 known / verified null not_applicable / 숫자지만 미확인 review / 값 없음 missing', () => {
    const s = estimateRows(mkNotice({ managementScore: ok(5), credibilityScore: ok(null), performanceScore: review(10) }), null, null, company);
    expect(s.rows.map((r) => r.maxState)).toEqual(['known', 'not_applicable', 'review']);
    expect(s.rows[2]!.max).toBe(10);
    expect(estimateRows(mkNotice({}), null, null, company).rows.map((r) => r.maxState)).toEqual(['missing', 'missing', 'missing']);
  });
  it('extraction userEdited가 notice 값보다 우선', () => {
    const items = { managementScore: { value: 5, status: 'verified', userEdited: { value: 7, editedAt: 'x' } } as ExtractedItem<unknown> };
    const x = { items } as unknown as Extraction;
    const s = estimateRows(mkNotice({ managementScore: ok(5) }), x, null, company);
    expect(s.rows[0]).toMatchObject({ max: 7, maxState: 'known' });
    const items2 = { managementScore: { value: null, status: 'needs_review', userEdited: { value: null, editedAt: 'x' } } as ExtractedItem<unknown> };
    const s2 = estimateRows(mkNotice({ managementScore: review(5) }), { items: items2 } as unknown as Extraction, null, company);
    expect(s2.rows[0]!.maxState).toBe('not_applicable');
  });
  it('notice user_edited 값 우선, 근거는 extraction evidence', () => {
    const ev = { sourceFile: 'a.hwp', location: '3쪽', evidence: '경영상태 5점' };
    const x = { items: { managementScore: { value: 5, status: 'verified', evidence: ev } } } as unknown as Extraction;
    const s = estimateRows(mkNotice({ managementScore: { value: 8, status: 'user_edited' } }), x, null, company);
    expect(s.rows[0]).toMatchObject({ max: 8, maxState: 'known', evidence: { file: 'a.hwp', location: '3쪽', text: '경영상태 5점' } });
    expect(s.rows[1]!.evidence).toBeNull();
  });
});

describe('estimateRows 합계', () => {
  it('total·maxTotal·applicable·allKnown', () => {
    const n = mkNotice({ managementScore: ok(5), credibilityScore: ok(2), performanceScore: ok(null) });
    const s = estimateRows(n, null, file({ management: entry(3.5), credibility: entry(1.1), performance: entry(9) }), company);
    expect(s.total).toBe(4.6);
    expect(s.maxTotal).toBe(7);
    expect(s.applicable).toBe(2);
    expect(s.filled).toBe(2);
    expect(s.allKnown).toBe(true);
    expect(s.rows[2]!.score).toBeNull();
  });
  it('review/missing가 있으면 allKnown false, 합계는 known 배점만', () => {
    const s = estimateRows(mkNotice({ managementScore: ok(5), credibilityScore: review(2) }), null, null, company);
    expect(s.allKnown).toBe(false);
    expect(s.maxTotal).toBe(5);
  });
  it('입력 0건이면 total null, known 0건이면 maxTotal null', () => {
    const s = estimateRows(mkNotice({}), null, null, company);
    expect(s.total).toBeNull();
    expect(s.maxTotal).toBeNull();
    expect(s.filled).toBe(0);
  });
  it('overMax', () => {
    const s = estimateRows(mkNotice({ managementScore: ok(5) }), null, file({ management: entry(6) }), company);
    expect(s.rows[0]!.overMax).toBe(true);
    expect(s.rows[1]!.overMax).toBe(false);
  });
});

describe('estimateRows hint', () => {
  it('경영상태는 있는 신용평가 종류만 쉼표로, 대외신인도는 가점 항목, 수행실적 null', () => {
    const c = { bizNo: '', credit: { corporate: { grade: 'BBB+', evaluatedAt: '2026-03-01' }, cp: { grade: 'A3' } }, attributes: ['여성기업', '벤처기업'] };
    const s = estimateRows(mkNotice({}), null, null, c);
    expect(s.rows[0]!.hint).toBe('기업신용평가등급 BBB+ (2026-03-01), 기업어음등급 A3');
    expect(s.rows[1]!.hint).toBe('여성기업, 벤처기업');
    expect(s.rows[2]!.hint).toBeNull();
  });
  it('값이 없으면 null', () => {
    const s = estimateRows(mkNotice({}), null, null, company);
    expect(s.rows[0]!.hint).toBeNull();
    expect(s.rows[1]!.hint).toBeNull();
  });
});

describe('validateScore', () => {
  it('소수 3자리는 2자리로 반올림', () => {
    expect(validateScore(1.236, null)).toBe(1.24);
    expect(validateScore(0, 5)).toBe(0);
    expect(validateScore(5, 5)).toBe(5);
  });
  it('음수·NaN·max 초과·비숫자는 INVALID_VALUE', () => {
    for (const [v, m] of [[-1, null], [NaN, null], [Infinity, null], ['3', null], [5.01, 5]] as const) {
      expect(() => validateScore(v, m)).toThrow(expect.objectContaining({ code: 'INVALID_VALUE' }));
    }
  });
});

describe('normalizeEstimate', () => {
  it('정상 파일은 유지', () => {
    const f = normalizeEstimate(file({ management: { score: 3, note: '메모', updatedAt: 'u' } }), 'n1');
    expect(f.items.management).toEqual({ score: 3, note: '메모', updatedAt: 'u' });
  });
  it('손상 입력은 빈 파일', () => {
    for (const raw of [null, 'x', 1, {}, { schemaVersion: 2, items: {} }, { schemaVersion: 1, items: 'a' }]) {
      const f = normalizeEstimate(raw, 'n9');
      expect(f).toMatchObject({ schemaVersion: 1, noticeId: 'n9', items: {} });
    }
  });
  it('손상된 항목만 버린다', () => {
    const f = normalizeEstimate({ schemaVersion: 1, items: { management: { score: -1, updatedAt: 'u' }, credibility: { score: 2, updatedAt: 'u' } } }, 'n1');
    expect(f.items).toEqual({ credibility: { score: 2, updatedAt: 'u' } });
  });
});
