import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../../src/core/model/default-settings';
import { composeHost, composeProvider, GMAIL_HOST, inboxHost, inboxProvider, originOf, providerHost } from '../../src/core/model/mail-provider';

describe('mail-provider', () => {
  it('providerHost', () => {
    const s = defaultSettings();
    s.sites.naverworks.host = 'mail.example.com';
    expect(providerHost(s, 'naverworks')).toBe('mail.example.com');
    expect(providerHost(s, 'gmail')).toBe(GMAIL_HOST);
    expect(originOf(GMAIL_HOST)).toBe('https://mail.google.com/*');
  });
  it('naverworks 호스트가 비어 있으면 기본값', () => {
    const s = defaultSettings();
    s.sites.naverworks.host = '';
    expect(providerHost(s, 'naverworks')).toBe('mail.worksmobile.com');
  });
  it('작성과 수신 provider를 분리한다', () => {
    const s = defaultSettings();
    s.mail.provider = 'gmail';
    s.sites.trackerbot.provider = 'naverworks';
    expect(composeProvider(s)).toBe('gmail');
    expect(composeHost(s)).toBe(GMAIL_HOST);
    expect(inboxProvider(s)).toBe('naverworks');
    expect(inboxHost(s)).toBe('mail.worksmobile.com');
  });
});
