import { describe, expect, it } from 'vitest';
import { isValidEmail, normalizeEmail } from '../../src/core/recipients/email';

describe('normalizeEmail', () => {
  it('공백 제거와 소문자 변환', () => {
    expect(normalizeEmail('  Foo@Bar.COM \n')).toBe('foo@bar.com');
  });
});

describe('isValidEmail', () => {
  it('정상 형식 통과', () => {
    expect(isValidEmail('a@b.co')).toBe(true);
    expect(isValidEmail('  A@B.CO ')).toBe(true);
  });
  it('잘못된 형식 거부', () => {
    expect(isValidEmail('a@b')).toBe(false);
    expect(isValidEmail('a b@c.com')).toBe(false);
    expect(isValidEmail('')).toBe(false);
  });
  it('255자 거부, 254자 허용', () => {
    const make = (n: number) => 'a'.repeat(n - 5) + '@b.co';
    expect(isValidEmail(make(254))).toBe(true);
    expect(isValidEmail(make(255))).toBe(false);
  });
});
