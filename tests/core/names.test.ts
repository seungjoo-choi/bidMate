import { describe, expect, it } from 'vitest';
import { uniqueName } from '../../src/core/model/names';
import { noticeId } from '../../src/core/model/ids';

describe('uniqueName', () => {
  it('충돌 시 (2)를 붙인다', () => {
    expect(uniqueName('a.pdf', new Set(['a.pdf']))).toBe('a (2).pdf');
  });
  it('대소문자 무시하고 다음 번호를 쓴다', () => {
    expect(uniqueName('a.pdf', new Set(['a.pdf', 'A (2).pdf']))).toBe('a (3).pdf');
  });
  it('확장자가 없어도 동작한다', () => {
    expect(uniqueName('readme', new Set(['readme']))).toBe('readme (2)');
  });
});

describe('noticeId', () => {
  it('round 없으면 00', () => {
    expect(noticeId('R26BK1', undefined)).toBe('R26BK1-00');
  });
});
