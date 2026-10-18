import { describe, expect, it } from 'vitest';
import { maskStr, truncateMasked } from '../../src/core/privacy/mask';
import { normalizePath } from '../../src/core/model/path';

describe('mask', () => {
  it('일반 이메일', () => {
    expect(maskStr('a hong.gd@naver.com b')).toBe('a ***@naver.com b');
  });
  it('URL 인코딩 이메일', () => {
    expect(maskStr('?to=foo%40bar.com')).toBe('?to=***%40bar.com');
    expect(maskStr('x%40Y.CO.KR')).toBe('***%40Y.CO.KR');
    expect(maskStr('x%40y.co.kr')).toBe('***%40y.co.kr');
  });
  it('퍼센트 인코딩 로컬파트/이중 인코딩 구분자', () => {
    expect(maskStr('a.b%2Bc%40x.com')).toBe('***%40x.com');
    expect(maskStr('u%2540x.com')).toBe('***%2540x.com');
  });
  it('300자 경계의 이메일에서 로컬파트가 남지 않는다', () => {
    const s = 'a'.repeat(290) + ' secretlocal@naver.com';
    const out = truncateMasked(s, 300);
    expect(out).not.toContain('secretlocal');
    expect(out.length).toBeLessThanOrEqual(303);
  });
  it('잘린 부분 이메일은 마스킹한다', () => {
    expect(truncateMasked('x abc@nav', 100)).toBe('x ***@nav');
    expect(truncateMasked('...abc@nav', 100)).toBe('...***@nav');
  });
});

describe('normalizePath', () => {
  it('정규화', () => {
    expect(normalizePath('a//b/')).toBe('a/b');
    expect(normalizePath('a\\b')).toBe('a/b');
  });
  it('. .. 는 오류', () => {
    expect(() => normalizePath('../x')).toThrow(expect.objectContaining({ code: 'INVALID_PATH' }));
    expect(() => normalizePath('a/./b')).toThrow(expect.objectContaining({ code: 'INVALID_PATH' }));
  });
});
