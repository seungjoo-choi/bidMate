import { describe, expect, it } from 'vitest';
import { withDefaults } from '../../src/core/model/default-settings';
import type { Settings } from '../../src/core/types/settings';
import { originsToRequest } from '../../src/entrypoints/dashboard/mail-service-logic';

const make = (compose: 'naverworks' | 'gmail', inbox: 'naverworks' | 'gmail', host = 'mail.worksmobile.com'): Settings => {
  const s = withDefaults(undefined);
  return {
    ...s, mail: { ...s.mail, provider: compose },
    sites: { ...s.sites, trackerbot: { ...s.sites.trackerbot, provider: inbox }, naverworks: { ...s.sites.naverworks, host } },
  };
};

describe('originsToRequest', () => {
  it('둘 다 같은 서비스면 하나', () => {
    expect(originsToRequest(make('naverworks', 'naverworks'))).toEqual(['https://mail.worksmobile.com/*']);
    expect(originsToRequest(make('gmail', 'gmail'))).toEqual(['https://mail.google.com/*']);
  });
  it('서비스가 다르면 둘 다', () => {
    expect(originsToRequest(make('gmail', 'naverworks', 'mail.example.com'))).toEqual(['https://mail.google.com/*', 'https://mail.example.com/*']);
  });
});
