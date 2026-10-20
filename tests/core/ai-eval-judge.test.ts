import { describe, expect, it } from 'vitest';
import { judge } from '../helpers/ai-eval';

describe('judge: variants 비교', () => {
  const ans = { expected: null, evidenceLines: [] as never[], variants: [{ condition: '단독', value: '5억원' }, { condition: '공동', value: '3억원' }] };
  const v = (...vals: unknown[]) => vals.map((value, i) => ({ condition: `다른조건${i}`, value }));
  it('조건 문자열은 무시하고 값 집합이 같으면 correct(순서·표기 무관)', () => {
    expect(judge('performanceMinAmount', ans, { value: null, variants: v('3억원', 500_000_000) })).toBe('correct');
  });
  it('일부만 일치하면 partial, 하나도 없으면 wrong', () => {
    expect(judge('performanceMinAmount', ans, { value: null, variants: v('5억원') })).toBe('partial');
    expect(judge('performanceMinAmount', ans, { value: null, variants: v('5억원', '3억원', '1억원') })).toBe('partial');
    expect(judge('performanceMinAmount', ans, { value: null, variants: v('9억원') })).toBe('wrong');
  });
  it('AI variants가 없으면 기존 note 기반 규칙', () => {
    expect(judge('performanceMinAmount', ans, { value: null, note: '단독 5억원, 공동 3억원' })).toBe('partial');
    expect(judge('performanceMinAmount', ans, { value: null, note: '' })).toBe('wrong');
  });
});
