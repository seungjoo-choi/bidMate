import { describe, expect, it } from 'vitest';
import { maxText, overMaxText, parseScoreInput, scoreInputText, totalBadge } from '../../src/ui/notice-detail/estimate-view';

describe('estimate-view', () => {
  it('배점 표시', () => {
    expect(maxText({ max: 20, maxState: 'known' })).toBe('20점');
    expect(maxText({ max: 20, maxState: 'review' })).toBe('20점 (확인 필요)');
    expect(maxText({ max: null, maxState: 'missing' })).toBe('—');
    expect(maxText({ max: null, maxState: 'not_applicable' })).toBe('해당 없음');
  });
  it('합계 배지', () => {
    expect(totalBadge({ total: null, maxTotal: null, allKnown: true })).toEqual([{ status: 'idle', text: '미입력' }]);
    expect(totalBadge({ total: 25.5, maxTotal: 30, allKnown: false })).toEqual([
      { status: 'ok', text: '총 25.5 / 30점' },
      { status: 'warn', text: '배점 확인 필요' },
    ]);
  });
  it('입력 해석', () => {
    expect(parseScoreInput('')).toBeNull();
    expect(parseScoreInput(' 3.5 ')).toBe(3.5);
    expect(parseScoreInput('abc')).toBeUndefined();
    expect(scoreInputText(null)).toBe('');
    expect(scoreInputText(7)).toBe('7');
    expect(overMaxText(10)).toBe('배점 10점을 넘습니다');
  });
});
