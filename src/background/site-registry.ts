import { withDefaults } from '../core/model/default-settings';
import { composeHost, inboxHost } from '../core/model/mail-provider';
import type { Settings } from '../core/types/settings';

export async function getSettingsCache(): Promise<Settings | undefined> {
  const { settingsCache } = await chrome.storage.local.get('settingsCache');
  return settingsCache as Settings | undefined;
}

/** 트래커봇 메일을 받는 서비스의 호스트. 설정이 없으면 기본값. */
export async function getInboxHost(): Promise<string> {
  return inboxHost(withDefaults(await getSettingsCache()));
}

/** 메일을 작성하는 서비스의 호스트. 설정이 없으면 기본값. */
export async function getComposeHost(): Promise<string> {
  return composeHost(withDefaults(await getSettingsCache()));
}

export async function isWebmailUrl(url: string | undefined): Promise<boolean> {
  if (!url) return false;
  try {
    return new URL(url).hostname === (await getInboxHost());
  } catch {
    return false;
  }
}

// ---------- 트래커봇 메일 스크립트 등록 ----------
export const TRACKERBOT_SCRIPT_ID = 'bidmate-trackerbot-mail';
export const TRACKERBOT_SCRIPT_FILE = 'trackerbot-mail.js';

type SyncResult = 'registered' | 'unregistered' | 'unchanged';
interface RegistryDeps {
  scripting: Pick<typeof chrome.scripting, 'getRegisteredContentScripts' | 'registerContentScripts' | 'updateContentScripts' | 'unregisterContentScripts' | 'executeScript'>;
  permissions: Pick<typeof chrome.permissions, 'contains'>;
  tabs: Pick<typeof chrome.tabs, 'query'>;
  getHost: () => Promise<string>;
}

let injected: Partial<RegistryDeps> = {};
/** 테스트용 의존성 주입. */
export function setSiteRegistryDeps(d: Partial<RegistryDeps>): void {
  injected = d;
}
const deps = (): RegistryDeps => ({
  scripting: injected.scripting ?? chrome.scripting,
  permissions: injected.permissions ?? chrome.permissions,
  tabs: injected.tabs ?? chrome.tabs,
  getHost: injected.getHost ?? getInboxHost,
});

async function doSync(): Promise<SyncResult> {
  try {
    const d = deps();
    const pattern = `https://${await d.getHost()}/*`;
    const existing = (await d.scripting.getRegisteredContentScripts({ ids: [TRACKERBOT_SCRIPT_ID] }))[0];
    if (!(await d.permissions.contains({ origins: [pattern] }))) {
      if (!existing) return 'unchanged';
      await d.scripting.unregisterContentScripts({ ids: [TRACKERBOT_SCRIPT_ID] });
      return 'unregistered';
    }
    const script = {
      id: TRACKERBOT_SCRIPT_ID, js: [TRACKERBOT_SCRIPT_FILE], matches: [pattern],
      runAt: 'document_idle' as const, allFrames: false, persistAcrossSessions: true,
    };
    if (!existing) await d.scripting.registerContentScripts([script]);
    else if (existing.matches?.length === 1 && existing.matches[0] === pattern) return 'unchanged';
    else await d.scripting.updateContentScripts([script]);
    // 이미 열려 있는 탭에는 등록만으로 주입되지 않으므로 1회 주입을 시도한다.
    try {
      for (const t of await d.tabs.query({ url: pattern })) {
        if (t.id === undefined) continue;
        await d.scripting.executeScript({ target: { tabId: t.id }, files: [TRACKERBOT_SCRIPT_FILE] }).catch(() => undefined);
      }
    } catch { /* 주입 실패는 무시 */ }
    return 'registered';
  } catch {
    return 'unchanged'; // chrome API 오류는 삼킨다
  }
}

let syncChain: Promise<unknown> = Promise.resolve();
/** 설정 호스트와 권한 상태에 맞춰 스크립트 등록을 맞춘다. 동시 호출은 직렬화한다. */
export function syncTrackerbotScript(): Promise<SyncResult> {
  const run = syncChain.then(doSync);
  syncChain = run;
  return run;
}

export function registerSiteRegistry(): void {
  const sync = () => void syncTrackerbotScript();
  chrome.runtime.onInstalled.addListener(sync);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && 'settingsCache' in changes) sync();
  });
  chrome.permissions.onAdded.addListener(sync);
  chrome.permissions.onRemoved.addListener(sync);
}
