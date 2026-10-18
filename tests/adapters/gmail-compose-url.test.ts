import { describe, expect, it } from 'vitest';
import { buildGmailComposeUrl, GMAIL_URL_MAX } from '../../src/adapters/gmail/compose-url';

const base = { accountIndex: 0, to: ['a@x.com'], cc: [] as string[], subject: '제목', bodyText: '본문' };
const parse = (url: string) => new URL(url).searchParams;

describe('buildGmailComposeUrl', () => {
  it('키는 fs, tf, to, cc, su, body만 쓴다', () => {
    const { url } = buildGmailComposeUrl({ ...base, cc: ['c@x.com'] });
    expect(url.startsWith('https://mail.google.com/mail/u/0/?fs=1&tf=cm')).toBe(true);
    expect([...parse(url).keys()]).toEqual(['fs', 'tf', 'to', 'cc', 'su', 'body']);
  });
  it('to/cc는 trim, 빈 값 제거, 대소문자 무시 중복 제거 후 쉼표로 결합', () => {
    const { url } = buildGmailComposeUrl({ ...base, to: [' A@x.com ', 'a@x.com', '', 'b@x.com'], cc: ['c@x.com', 'C@x.com'] });
    expect(parse(url).get('to')).toBe('A@x.com,b@x.com');
    expect(parse(url).get('cc')).toBe('c@x.com');
  });
  it('빈 cc는 생략한다', () => {
    expect(parse(buildGmailComposeUrl(base).url).has('cc')).toBe(false);
  });
  it('한글, 줄바꿈, +, &가 왕복된다', () => {
    const bodyText = '안녕\r\n1+1=2 & 3\n끝';
    const { url, bodyIncluded } = buildGmailComposeUrl({ ...base, subject: 'A+B & 한글', bodyText });
    expect(bodyIncluded).toBe(true);
    expect(parse(url).get('su')).toBe('A+B & 한글');
    expect(parse(url).get('body')).toBe('안녕\n1+1=2 & 3\n끝');
  });
  it('accountIndex 음수/소수는 0', () => {
    expect(buildGmailComposeUrl({ ...base, accountIndex: -1 }).url).toContain('/u/0/');
    expect(buildGmailComposeUrl({ ...base, accountIndex: 1.5 }).url).toContain('/u/0/');
    expect(buildGmailComposeUrl({ ...base, accountIndex: 2 }).url).toContain('/u/2/');
  });
  it('한도를 넘으면 body를 통째로 뺀다', () => {
    const r = buildGmailComposeUrl({ ...base, bodyText: 'a'.repeat(GMAIL_URL_MAX) });
    expect(r.bodyIncluded).toBe(false);
    expect(r.url).not.toContain('body=');
    expect(r.url.length).toBeLessThanOrEqual(GMAIL_URL_MAX);
  });
  it('body 없이도 한도를 넘으면 그대로 반환', () => {
    const r = buildGmailComposeUrl({ ...base, subject: 'b'.repeat(GMAIL_URL_MAX) });
    expect(r.bodyIncluded).toBe(false);
    expect(r.url.length).toBeGreaterThan(GMAIL_URL_MAX);
  });
  it('경계값: 길이가 한도와 같으면 포함, 1 넘으면 제외', () => {
    const noBody = buildGmailComposeUrl({ ...base, bodyText: '' }).url;
    const fit = GMAIL_URL_MAX - noBody.length - '&body='.length;
    const ok = buildGmailComposeUrl({ ...base, bodyText: 'a'.repeat(fit) });
    expect(ok.bodyIncluded).toBe(true);
    expect(ok.url.length).toBe(GMAIL_URL_MAX);
    expect(buildGmailComposeUrl({ ...base, bodyText: 'a'.repeat(fit + 1) }).bodyIncluded).toBe(false);
  });
});
