import { mergeSelectorSet } from '../../adapters/naverworks/selectors';
import type { ComposeSelectorSet } from '../../adapters/naverworks/types';
import { buildGmailComposeUrl } from '../../adapters/gmail/compose-url';
import { composeProvider, providerHost } from '../../core/model/mail-provider';
import type { MailDraft } from '../../core/types/mail';
import type { MailProvider, Settings } from '../../core/types/settings';
import type { ComposeSelectorConfig } from '../../messaging/protocol';

export type ComposeField = 'to' | 'cc' | 'subject' | 'body';
export interface ComposePlan {
  provider: MailProvider;
  host: string;
  url: string;
  prefilled: ComposeField[];
  omitted: Array<{ field: ComposeField; reason: 'URL_TOO_LONG' }>;
  needsUserOpen: boolean;
  selector?: { set: ComposeSelectorSet; config: ComposeSelectorConfig };   // verified일 때만
}

/** 메일 서비스별 작성 계획. provider 분기는 이 함수 한 곳에서만 한다. */
export function planCompose(settings: Settings, draft: MailDraft, selectorSets: Record<string, ComposeSelectorSet>): ComposePlan {
  const provider = composeProvider(settings);
  const host = providerHost(settings, provider);
  const site = provider === 'gmail' ? settings.sites.gmail : settings.sites.naverworks;

  let url: string;
  let prefilled: ComposeField[] = [];
  const omitted: ComposePlan['omitted'] = [];
  if (provider === 'gmail') {
    const g = buildGmailComposeUrl({ accountIndex: settings.sites.gmail.accountIndex, to: draft.to, cc: draft.cc, subject: draft.subject, bodyText: draft.text });
    url = g.url;
    prefilled = ['to', 'cc', 'subject'];
    if (g.bodyIncluded) prefilled.push('body');
    else if (draft.text) omitted.push({ field: 'body', reason: 'URL_TOO_LONG' });
  } else {
    url = `https://${host}${settings.sites.naverworks.composePath ?? '/'}`;
  }

  const base = selectorSets[site.selectorSetId];
  const set = base ? mergeSelectorSet(base, site.selectorOverrides) : undefined;
  const selector = set && set.status === 'verified'
    ? { set, config: { selectorSetId: site.selectorSetId, selectorOverrides: site.selectorOverrides } }
    : undefined;

  return { provider, host, url, prefilled, omitted, needsUserOpen: provider !== 'gmail', selector };
}
