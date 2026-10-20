import { describe, expect, it } from 'vitest';
import { AI_KEYS, aiKindOf, isAiKey, isDocAiKey } from '../../src/core/ai/keys';
import { REVIEW_LEAF_KEYS } from '../../src/core/extraction/review-rows';

describe('AI_KEYS', () => {
  it('16개, REVIEW_LEAF_KEYS와 같은 순서', () => {
    expect(AI_KEYS).toHaveLength(16);
    expect([...AI_KEYS]).toEqual(REVIEW_LEAF_KEYS);
    expect(AI_KEYS[0]).toBe('postedAt');
    expect(AI_KEYS[15]).toBe('priceMethod');
  });
  it('isDocAiKey는 문서 잎 7개', () => {
    expect(AI_KEYS.filter((k) => isDocAiKey(k))).toHaveLength(7);
    expect(isDocAiKey('postedAt')).toBe(false);
    expect(isDocAiKey('managementScore')).toBe(true);
  });
  it('isAiKey와 aiKindOf', () => {
    expect(isAiKey('postedAt')).toBe(true);
    expect(isAiKey('noticeNo')).toBe(false);
    expect(isAiKey(3)).toBe(false);
    expect(aiKindOf('jointVentureAllowed')).toBe('joint');
    expect(aiKindOf('budgetAmount')).toBe('amount');
  });
});
