import { mergeSelectorSet } from '../../adapters/naverworks/selectors';
import type { ComposeSelectorSet, SendWatchConfig } from '../../adapters/naverworks/types';
import { buildGmailComposeUrl } from '../../adapters/gmail/compose-url';
import { buildNaverworksComposeUrl } from '../../adapters/naverworks/compose-url';
import { composeProvider, providerHost } from '../../core/model/mail-provider';
import type { MailDraft } from '../../core/types/mail';
import type { MailProvider, Settings } from '../../core/types/settings';
import type { ComposeSelectorConfig } from '../../messaging/protocol';

export type ComposeField = 'to' | 'cc' | 'subject' | 'body';
const FIELDS: ComposeField[] = ['to', 'cc', 'subject', 'body'];
export interface ComposePlan {
  provider: MailProvider;
  host: string;
  url: string;
  prefilled: ComposeField[];
  omitted: Array<{ field: ComposeField; reason: 'URL_TOO_LONG' }>;
  needsUserOpen: boolean;
  fillFields: ComposeField[];   // prefilled도 omitted도 아닌 필드(FIELDS 순서)
  attachLimits?: { perFileBytes?: number; totalBytes?: number };
  detectTimeoutMs?: number;     // 사용자 조작이 없는 서비스만 짧게
  sendWatch?: SendWatchConfig;  // 셀렉터 검증 여부와 무관하게 발송 관찰용으로 항상 포함
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
    const n = buildNaverworksComposeUrl(url, { to: draft.to, cc: draft.cc, subject: draft.subject });
    if (n) { url = n; prefilled = ['to', 'cc', 'subject']; }
  }

  const base = selectorSets[site.selectorSetId];
  const set = base ? mergeSelectorSet(base, site.selectorOverrides) : undefined;
  const selector = set && set.status === 'verified'
    ? { set, config: { selectorSetId: site.selectorSetId, selectorOverrides: site.selectorOverrides } }
    : undefined;

  const needsUserOpen = provider !== 'gmail';
  const fillFields = FIELDS.filter((f) => !prefilled.includes(f) && !omitted.some((o) => o.field === f));
  const limits = set?.attach.limits;
  return {
    provider, host, url, prefilled, omitted, needsUserOpen, fillFields, selector,
    ...(set?.sendWatch ? { sendWatch: set.sendWatch } : {}),
    ...(limits ? { attachLimits: { ...limits } } : {}),
    ...(needsUserOpen ? {} : { detectTimeoutMs: 30_000 }),
  };
}
