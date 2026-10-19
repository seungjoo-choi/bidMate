import { describe, expect, it } from 'vitest';
import { DEFAULT_WEBMAIL_HOST, defaultSettings, withDefaults } from '../../src/core/model/default-settings';

describe('autoCompose 기본값', () => {
  it('defaultSettings', () => {
    expect(defaultSettings().autoCompose).toEqual({ enabled: false, afterCollect: 'ask', recipients: { mode: 'default' }, reviewGate: 'conflicts' });
  });
  it('withDefaults: autoCompose가 없는 저장본은 기본값으로 채운다', () => {
    const { autoCompose: _omit, ...rest } = defaultSettings();
    const s = withDefaults(rest as unknown as ReturnType<typeof defaultSettings>);
    expect(s.autoCompose.enabled).toBe(false);
    expect(s.autoCompose.reviewGate).toBe('conflicts');
  });
  it('withDefaults: 저장된 값이 기본값을 덮어쓴다', () => {
    const d = defaultSettings();
    const s = withDefaults({ ...d, autoCompose: { enabled: true, afterCollect: 'dashboard', recipients: { mode: 'group', groupId: 'g' }, reviewGate: 'any_review' } });
    expect(s.autoCompose).toEqual({ enabled: true, afterCollect: 'dashboard', recipients: { mode: 'group', groupId: 'g' }, reviewGate: 'any_review' });
  });
});

describe('메일 서비스 기본값과 보정', () => {
  const legacy = () => {
    const d = defaultSettings();
    const { provider: _a, ...tb } = d.sites.trackerbot;
    const { gmail: _g, ...sites } = d.sites;
    const { provider: _b, ...mail } = d.mail;
    return { ...d, sites: { ...sites, trackerbot: tb }, mail } as unknown as ReturnType<typeof defaultSettings>;
  };
  it('옛 저장본은 provider naverworks와 gmail 기본값으로 읽고 naverworks.host를 보존한다', () => {
    const old = legacy();
    old.sites.naverworks.host = 'mail.example.com';
    const s = withDefaults(old);
    expect(s.mail.provider).toBe('naverworks');
    expect(s.sites.trackerbot.provider).toBe('naverworks');
    expect(s.sites.gmail).toEqual({ accountIndex: 0, selectorSetId: 'gmail-v1' });
    expect(s.sites.naverworks.host).toBe('mail.example.com');
  });
  it('호스트가 mail.google.com인 실험 저장본은 gmail로 보정한다(멱등)', () => {
    const old = legacy();
    old.sites.naverworks.host = 'mail.google.com';
    const s = withDefaults(old);
    expect(s.mail.provider).toBe('gmail');
    expect(s.sites.trackerbot.provider).toBe('gmail');
    expect(s.sites.naverworks.host).toBe(DEFAULT_WEBMAIL_HOST);
    expect(withDefaults(s)).toEqual(s);
  });
  it('mail.provider가 저장돼 있으면 보정하지 않는다', () => {
    const d = defaultSettings();
    d.sites.naverworks.host = 'mail.google.com';
    const s = withDefaults(d);
    expect(s.mail.provider).toBe('naverworks');
    expect(s.sites.trackerbot.provider).toBe('naverworks');
    expect(s.sites.naverworks.host).toBe('mail.google.com');
  });
  it('gmail.accountIndex를 보존한다', () => {
    const d = defaultSettings();
    d.sites.gmail.accountIndex = 2;
    expect(withDefaults(d).sites.gmail.accountIndex).toBe(2);
  });
});
