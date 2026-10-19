import { fetchContactsInPage } from '../adapters/naverworks/contacts-fetch';
import type { NwPageFetchResult } from '../adapters/naverworks/contacts-types';
import { NW_CONTACT_HOST, NW_CONTACT_ORIGIN, domainIdFrom } from '../core/recipients/naverworks-contacts';
import { BusError, listen } from '../messaging/bus';
import { waitComplete } from './compose-relay';
import { assertExtensionSender } from './job-coordinator';

const LOAD_WAIT_MS = 20_000;
const DOMAIN_RETRY_MS = 500;
const DOMAIN_RETRY_MAX = 10;   // 500ms x 10 = 5초
const PAGE_SIZE = 100;
const MAX_PAGES = 50;

export interface NwContactsDeps {
  tabs: Pick<typeof chrome.tabs, 'query' | 'create' | 'get' | 'update' | 'remove'>;
  scripting: Pick<typeof chrome.scripting, 'executeScript'>;
  permissions: Pick<typeof chrome.permissions, 'contains'>;
}

let injected: Partial<NwContactsDeps> = {};

function deps(): NwContactsDeps {
  return {
    tabs: injected.tabs ?? chrome.tabs,
    scripting: injected.scripting ?? chrome.scripting,
    permissions: injected.permissions ?? chrome.permissions,
  };
}

const err = (code: string, message: string) => new BusError(code, message);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const hostOf = (url: string | undefined): string => { try { return new URL(url ?? '').hostname; } catch { return ''; } };

async function fetchContacts(p: { domainId?: string }) {
  const d = deps();
  if (!(await d.permissions.contains({ origins: [NW_CONTACT_ORIGIN] }))) throw err('NEEDS_SITE_PERMISSION', `${NW_CONTACT_HOST} 접근 권한이 필요합니다.`);

  let tabId: number;
  let created = false;
  const existing = await d.tabs.query({ url: NW_CONTACT_ORIGIN });
  if (existing.length > 0) {
    const dom = (t: { url?: string }) => domainIdFrom(t.url ?? '');
    const pick = (p.domainId ? existing.find((t) => dom(t) === p.domainId) : existing.find((t) => dom(t) !== null)) ?? existing[0]!;
    tabId = pick.id as number;
  } else {
    const url = p.domainId ? `https://${NW_CONTACT_HOST}/p/web/domain/${p.domainId}` : `https://${NW_CONTACT_HOST}/`;
    const tab = await d.tabs.create({ url, active: false });
    tabId = tab.id as number;
    created = true;
  }
  const closeIfCreated = async () => { if (created) { try { await d.tabs.remove(tabId); } catch { /* 이미 닫힘 */ } } };
  const activate = async () => { try { await d.tabs.update(tabId, { active: true }); } catch { /* 무시 */ } };

  let tab = await d.tabs.get(tabId);
  if (tab.status !== 'complete' && !(await waitComplete(tabId, LOAD_WAIT_MS))) {
    await closeIfCreated();
    throw err('NW_TAB_TIMEOUT', '네이버웍스 탭 로딩이 지연되었습니다.');
  }
  tab = await d.tabs.get(tabId);
  if (hostOf(tab.url) !== NW_CONTACT_HOST) {   // 로그인 페이지 등으로 이동됨: 사용자가 로그인할 수 있게 탭을 남긴다
    await activate();
    throw err('NW_NOT_LOGGED_IN', '네이버웍스에 로그인되어 있지 않습니다.');
  }

  let domainId = p.domainId || domainIdFrom(tab.url ?? '');
  for (let i = 0; !domainId && i < DOMAIN_RETRY_MAX; i++) {
    await sleep(DOMAIN_RETRY_MS);
    tab = await d.tabs.get(tabId);
    domainId = domainIdFrom(tab.url ?? '');
  }
  if (!domainId) {
    await closeIfCreated();
    throw err('NW_NO_DOMAIN_ID', '도메인 ID를 찾을 수 없습니다.');
  }

  let result: NwPageFetchResult | undefined;
  try {
    const res = await d.scripting.executeScript({ target: { tabId }, func: fetchContactsInPage, args: [domainId, PAGE_SIZE, MAX_PAGES] });
    result = res?.[0]?.result as NwPageFetchResult | undefined;
  } catch (e) {
    await closeIfCreated();
    throw err('NW_INJECT_FAILED', e instanceof Error ? e.message : String(e));
  }
  if (!result) {
    await closeIfCreated();
    throw err('NW_INJECT_FAILED', '페이지 스크립트 결과가 없습니다.');
  }
  if (!result.ok) {
    if (result.code === 'NW_NOT_LOGGED_IN') await activate();
    else await closeIfCreated();
    throw err(result.code, result.detail ?? (result.status ? `HTTP ${result.status}` : result.code));
  }
  await closeIfCreated();
  return { domainId, users: result.results, totalCount: result.totalCount, tabReused: !created };
}

export function registerNaverworksContacts(d: Partial<NwContactsDeps> = {}): void {
  injected = d;
  listen('contacts/naverworks-fetch', (p, sender) => { assertExtensionSender(sender); return fetchContacts(p); }, 'sw');
}
