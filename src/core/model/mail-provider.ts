import type { MailProvider, Settings } from '../types/settings';
import { DEFAULT_WEBMAIL_HOST, GMAIL_HOST } from './default-settings';

export { GMAIL_HOST };

export const PROVIDER_LABEL: Record<MailProvider, string> = { naverworks: '네이버웍스', gmail: 'Gmail' };

export function providerHost(s: Settings, p: MailProvider): string {
  return p === 'gmail' ? GMAIL_HOST : s.sites.naverworks.host || DEFAULT_WEBMAIL_HOST;
}
export function composeProvider(s: Settings): MailProvider { return s.mail.provider; }
export function composeHost(s: Settings): string { return providerHost(s, composeProvider(s)); }
export function inboxProvider(s: Settings): MailProvider { return s.sites.trackerbot.provider; }
export function inboxHost(s: Settings): string { return providerHost(s, inboxProvider(s)); }
export const originOf = (host: string) => `https://${host}/*`;
