import { describe, expect, it } from 'vitest';
import { gmailV1 } from '../../src/adapters/gmail/selectors/gmail-v1';
import { naverworksV1 } from '../../src/adapters/naverworks/selectors/naverworks-v1';
import { SELECTOR_SETS } from '../../src/adapters/naverworks/selectors';
import { defaultSettings } from '../../src/core/model/default-settings';
import type { MailDraft } from '../../src/core/types/mail';
import { planCompose } from '../../src/engine/mail/compose-plan';

const draft = (over: Partial<MailDraft> = {}): MailDraft => ({
  schemaVersion: 1, noticeId: 'n', preparedAt: '2026-01-01T00:00:00Z', templateId: 't',
  to: ['a@x.com'], cc: [], subject: '제목', html: '<p>본문</p>', text: '본문',
  attachments: [], skippedAttachments: [], unresolved: [], unknownVars: [], warnings: [], ...over,
});

describe('planCompose', () => {
  it('naverworks unverified: 수동, selector 없음', () => {
    const p = planCompose(defaultSettings(), draft(), SELECTOR_SETS);
    expect(p).toMatchObject({ provider: 'naverworks', host: 'mail.worksmobile.com', url: 'https://mail.worksmobile.com/', prefilled: [], omitted: [], needsUserOpen: true });
    expect(p.selector).toBeUndefined();
  });
  it('naverworks verified: selector 포함', () => {
    const s = defaultSettings();
    s.sites.naverworks.composePath = '/mail/';
    const p = planCompose(s, draft(), { 'naverworks-v1': { ...naverworksV1, status: 'verified' } });
    expect(p.url).toBe('https://mail.worksmobile.com/mail/');
    expect(p.selector?.config).toEqual({ selectorSetId: 'naverworks-v1', selectorOverrides: undefined });
    expect(p.selector?.set.status).toBe('verified');
  });
  it('gmail unverified: prefilled 4개, needsUserOpen false', () => {
    const s = defaultSettings();
    s.mail.provider = 'gmail';
    const p = planCompose(s, draft(), SELECTOR_SETS);
    expect(p.provider).toBe('gmail');
    expect(p.host).toBe('mail.google.com');
    expect(p.url.startsWith('https://mail.google.com/mail/u/0/?fs=1&tf=cm')).toBe(true);
    expect(p.prefilled).toEqual(['to', 'cc', 'subject', 'body']);
    expect(p.omitted).toEqual([]);
    expect(p.needsUserOpen).toBe(false);
    expect(p.selector).toBeUndefined();
  });
  it('gmail 긴 본문: body는 omitted', () => {
    const s = defaultSettings();
    s.mail.provider = 'gmail';
    const p = planCompose(s, draft({ text: 'a'.repeat(9000) }), { 'gmail-v1': gmailV1 });
    expect(p.prefilled).toEqual(['to', 'cc', 'subject']);
    expect(p.omitted).toEqual([{ field: 'body', reason: 'URL_TOO_LONG' }]);
  });
  it('없는 selectorSetId면 selector undefined', () => {
    const s = defaultSettings();
    s.sites.naverworks.selectorSetId = 'none';
    expect(planCompose(s, draft(), SELECTOR_SETS).selector).toBeUndefined();
  });

  const gmailVerified = { ...gmailV1, status: 'verified' as const, attach: { ...gmailV1.attach, limits: { perFileBytes: 100, totalBytes: 200 } } };
  it('fillFields: naverworks는 4필드 전부, detectTimeoutMs 없음', () => {
    const p = planCompose(defaultSettings(), draft(), SELECTOR_SETS);
    expect(p.fillFields).toEqual(['to', 'cc', 'subject', 'body']);
    expect(p.detectTimeoutMs).toBeUndefined();
    expect(p.attachLimits).toBeUndefined();
  });
  it('fillFields: gmail은 prefilled와 omitted를 뺀다(본문 포함 시 빈 배열, 본문 생략 시도 빈 배열)', () => {
    const s = defaultSettings();
    s.mail.provider = 'gmail';
    expect(planCompose(s, draft(), { 'gmail-v1': gmailVerified }).fillFields).toEqual([]);
    expect(planCompose(s, draft({ text: 'a'.repeat(9000) }), { 'gmail-v1': gmailVerified }).fillFields).toEqual([]);
  });
  it('gmail: detectTimeoutMs 30000, attachLimits는 셀렉터셋 limits 복사', () => {
    const s = defaultSettings();
    s.mail.provider = 'gmail';
    const p = planCompose(s, draft(), { 'gmail-v1': gmailVerified });
    expect(p.detectTimeoutMs).toBe(30_000);
    expect(p.attachLimits).toEqual({ perFileBytes: 100, totalBytes: 200 });
    expect(p.attachLimits).not.toBe(gmailVerified.attach.limits);
  });
});
