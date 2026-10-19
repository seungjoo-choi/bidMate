import { describe, expect, it } from 'vitest';
import { buildNaverworksComposeUrl } from '../../src/adapters/naverworks/compose-url';

const BASE = 'https://mail.worksmobile.com/write/popup?srvid=mail&to=&orderType=new&memo=false';
const input = (over: Partial<{ to: string[]; cc: string[]; subject: string }> = {}) => ({ to: ['a@x.com'], cc: [], subject: '', ...over });

describe('buildNaverworksComposeUrl', () => {
  it('기본 경로: to 2명, cc 1명, 한글 제목', () => {
    expect(buildNaverworksComposeUrl(BASE, { to: ['a@x.com', 'b@x.com'], cc: ['c@x.com'], subject: '견적 요청' }))
      .toBe(`https://mail.worksmobile.com/write/popup?srvid=mail&to=a@x.com,b@x.com&cc=c@x.com&subject=${encodeURIComponent('견적 요청')}&orderType=new&memo=false`);
  });
  it('cc와 제목이 비면 해당 파라미터 없음', () => {
    const u = buildNaverworksComposeUrl(BASE, input())!;
    expect(u).toBe('https://mail.worksmobile.com/write/popup?srvid=mail&to=a@x.com&orderType=new&memo=false');
    expect(u).not.toContain('cc=');
    expect(u).not.toContain('subject=');
  });
  it('중복, 대소문자, 공백 제거', () => {
    const u = buildNaverworksComposeUrl(BASE, input({ to: [' a@x.com ', 'A@X.com', '', 'b@x.com'], cc: ['b@x.com', 'B@x.com '] }))!;
    expect(u).toContain('to=a@x.com,b@x.com&');
    expect(u).toContain('cc=b@x.com&');
  });
  it('특수문자 이메일은 인코딩하되 @는 유지', () => {
    const u = buildNaverworksComposeUrl(BASE, input({ to: ['a+b@x.com'] }))!;
    expect(u).toContain('to=a%2Bb@x.com&');
  });
  it('다른 경로 또는 잘못된 URL이면 null', () => {
    expect(buildNaverworksComposeUrl('https://mail.worksmobile.com/', input())).toBeNull();
    expect(buildNaverworksComposeUrl('not a url', input())).toBeNull();
  });
  it('to 없는 popup 주소면 끝에 붙음', () => {
    expect(buildNaverworksComposeUrl('https://mail.worksmobile.com/write/popup?srvid=mail', input({ subject: 's' })))
      .toBe('https://mail.worksmobile.com/write/popup?srvid=mail&to=a@x.com&subject=s');
  });
  it('기존 cc, subject 제거', () => {
    const u = buildNaverworksComposeUrl('https://mail.worksmobile.com/write/popup?cc=old@x.com&to=&subject=old&memo=false', input())!;
    expect(u).toBe('https://mail.worksmobile.com/write/popup?to=a@x.com&memo=false');
  });
});
