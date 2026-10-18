import { describe, expect, it } from 'vitest';
import { normalizeExtraction } from '../../src/core/model/extraction-compat';
import { emptyNotice, fillMissingFields } from '../../src/core/model/notice-fields';
import { missing } from '../../src/core/types/common';
import { EXTRACTION_KEYS, type Extraction, type ExtractedItem } from '../../src/core/types/extraction';

const mk = (omit: string[], version: number): Extraction => ({
  schemaVersion: version as 2, noticeId: 'n', jobId: 'j', extractedAt: 't', rulesVersion: '1', status: 'verified',
  items: Object.fromEntries(EXTRACTION_KEYS.filter((k) => !omit.includes(k)).map((k) => [k, { value: 1, status: 'verified' } as ExtractedItem<unknown>])) as Extraction['items'],
  extras: {}, files: [], warnings: [],
});

describe('normalizeExtraction', () => {
  it('옛 스키마의 빠진 항목은 not_run, 다른 필드는 같은 참조', () => {
    const x = mk(['managementScore'], 1);
    const cred = x.items.credibilityScore;
    const out = normalizeExtraction(x);
    expect(out).toBe(x);
    expect(out.items.managementScore).toEqual({ value: null, status: 'not_run' });
    expect(out.schemaVersion).toBe(2);
    expect(out.items.credibilityScore).toBe(cred);
  });
  it('모든 키가 있으면 변화 없음(schemaVersion만 2)', () => {
    const x = mk([], 1);
    const before = { ...x.items };
    normalizeExtraction(x);
    expect(x.schemaVersion).toBe(2);
    for (const k of EXTRACTION_KEYS) expect(x.items[k]).toBe(before[k]);
  });
});

describe('fillMissingFields', () => {
  it('빠진 managementScore는 missing(), 있는 필드는 같은 참조', () => {
    const n = emptyNotice('n', { noticeNo: 'a', origin: 'g2b' } as never, 'f', 't');
    const cred = n.evaluation.credibilityScore;
    delete (n.evaluation as unknown as Record<string, unknown>).managementScore;
    const out = fillMissingFields(n);
    expect(out.evaluation.managementScore).toEqual(missing());
    expect(out.evaluation.credibilityScore).toBe(cred);
  });
});
