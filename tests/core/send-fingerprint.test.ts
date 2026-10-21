import { describe, expect, it } from 'vitest';
import { draftFingerprint, sendFingerprint } from '../../src/core/mail/send-fingerprint';

const base = {
  to: ['a@x.com', 'b@x.com'], cc: ['c@x.com'], subject: '제목',
  attachments: [{ name: 'a.pdf', size: 10 }, { name: 'b.pdf', size: 20 }],
  body: '<p>본문</p>',
};

describe('sendFingerprint', () => {
  it('순서·대소문자·공백이 달라도 같은 값', () => {
    const v = sendFingerprint({
      to: [' B@X.com', 'a@x.com '], cc: ['C@x.com'], subject: '  제목 ',
      attachments: [{ name: 'b.pdf', size: 20 }, { name: 'a.pdf', size: 10 }],
      body: '<p>본문</p>',
    });
    expect(v).toBe(sendFingerprint(base));
  });
  it('첨부 크기가 다르면 다른 값', () => {
    expect(sendFingerprint({ ...base, attachments: [{ name: 'a.pdf', size: 11 }, { name: 'b.pdf', size: 20 }] })).not.toBe(sendFingerprint(base));
  });
  it('제목이 다르면 다른 값', () => {
    expect(sendFingerprint({ ...base, subject: '다른 제목' })).not.toBe(sendFingerprint(base));
  });
  it('본문이 다르면 다른 값', () => {
    expect(sendFingerprint({ ...base, body: '<p>다른 본문</p>' })).not.toBe(sendFingerprint(base));
  });
});

describe('draftFingerprint', () => {
  it('첨부 이름은 path basename 기준이라 디렉터리가 달라도 같은 값', () => {
    const mk = (path: string) => draftFingerprint({ to: ['a@x.com'], cc: [], subject: 's', html: '<p>h</p>', attachments: [{ path, size: 5 }] });
    expect(mk('a/b/x.pdf')).toBe(mk('c/x.pdf'));
  });
});
