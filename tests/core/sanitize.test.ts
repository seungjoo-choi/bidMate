import { describe, expect, it } from 'vitest';
import { sanitizeSegment } from '../../src/core/model/sanitize';

describe('sanitizeSegment', () => {
  it('금지 문자를 제거한다', () => {
    expect(sanitizeSegment('a<b>:c', 40)).toBe('abc');
  });
  it('Windows 예약어 뒤에 _를 붙인다', () => {
    expect(sanitizeSegment('CON', 40)).toBe('CON_');
    expect(sanitizeSegment('con.txt', 40)).toBe('con.txt_');
  });
  it('끝의 점과 공백을 제거한다', () => {
    expect(sanitizeSegment('abc. ', 40)).toBe('abc');
  });
  it('코드포인트 기준으로 maxLen에 맞춰 자른다', () => {
    expect(Array.from(sanitizeSegment('가'.repeat(50), 40)).length).toBe(40);
  });
  it('빈 결과는 _', () => {
    expect(sanitizeSegment('', 40)).toBe('_');
  });
});
