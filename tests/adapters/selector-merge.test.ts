import { describe, expect, it } from 'vitest';
import { mergeSelectorSet, SELECTOR_SETS } from '../../src/adapters/naverworks/selectors';

describe('mergeSelectorSet', () => {
  const base = SELECTOR_SETS['naverworks-v1']!;
  it('중첩 객체를 deep merge한다', () => {
    const m = mergeSelectorSet(base, { subject: { input: '#s' }, to: { input: '#to' } as never });
    expect(m.subject.input).toBe('#s');
    expect(m.to.input).toBe('#to');
    expect(m.to.chip).toBe(base.to.chip);
    expect(m.id).toBe('naverworks-v1');
  });
  it('배열은 교체한다', () => {
    const m = mergeSelectorSet(base, { forbidden: { textPatterns: ['X'] } as never });
    expect(m.forbidden.textPatterns).toEqual(['X']);
    expect(m.forbidden.send).toEqual(base.forbidden.send);
  });
  it('overrides가 없으면 원본 값을 유지하고 원본을 변경하지 않는다', () => {
    const m = mergeSelectorSet(base, undefined);
    expect(m).toEqual(base);
    mergeSelectorSet(base, { subject: { input: '#z' } });
    expect(base.subject.input).toBe('');
  });
});
