import { describe, expect, it } from 'vitest';
import { conflictCountOf } from '../../src/engine/extraction/extract-step';
import { EXTRACTION_KEYS, type Extraction, type ExtractedItem } from '../../src/core/types/extraction';

function make(over: Record<string, Partial<ExtractedItem<unknown>>>): Extraction {
  const items = {} as Extraction['items'];
  for (const k of EXTRACTION_KEYS) items[k] = { value: 1, status: 'verified', ...(over[k] ?? {}) } as ExtractedItem<unknown>;
  return { items } as unknown as Extraction;
}

describe('conflictCountOf', () => {
  it('conflict/low_confidence만 센다 (not_found 제외)', () => {
    const x = make({
      [EXTRACTION_KEYS[0]!]: { status: 'needs_review', reason: 'conflict' },
      [EXTRACTION_KEYS[1]!]: { status: 'needs_review', reason: 'low_confidence' },
      [EXTRACTION_KEYS[2]!]: { status: 'needs_review', reason: 'not_found' },
    });
    expect(conflictCountOf(x)).toBe(2);
  });
  it('userEdited가 있으면 제외, verified는 제외', () => {
    const x = make({
      [EXTRACTION_KEYS[0]!]: { status: 'needs_review', reason: 'conflict', userEdited: { value: 3 } as never },
      [EXTRACTION_KEYS[1]!]: { status: 'verified', reason: 'conflict' },
    });
    expect(conflictCountOf(x)).toBe(0);
  });
});
