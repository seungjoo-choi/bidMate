import type { Settings } from '../types/settings';

export const DEFAULT_WEBMAIL_HOST = 'mail.worksmobile.com';
export const NAVERWORKS_COMPOSE_PATH = '/write/popup?srvid=mail&to=&orderType=new&memo=false';
/** mail-provider에서 다시 내보낸다(순환 import를 피하려고 여기에 둔다). */
export const GMAIL_HOST = 'mail.google.com';

export function defaultSettings(): Settings {
  return {
    schemaVersion: 1,
    g2b: { apiBaseUrl: '', detailUrlPatterns: [] },
    sites: {
      trackerbot: { urlPatterns: [], provider: 'naverworks' },
      // 작성 화면 경로는 사용자 실측(2026-10-19): [메일쓰기] 클릭 시 주소
      naverworks: { host: DEFAULT_WEBMAIL_HOST, composePath: NAVERWORKS_COMPOSE_PATH, selectorSetId: 'naverworks-v1' },
      gmail: { accountIndex: 0, selectorSetId: 'gmail-v1' },
    },
    download: { concurrency: 3, maxRetries: 3, backoffMs: 1000, maxFileMB: 100 },
    extraction: { budgetMs: 90000, fileTimeoutMs: 20000, maxParseMB: 50 },
    autoCompose: { enabled: false, afterCollect: 'ask', recipients: { mode: 'default' }, reviewGate: 'conflicts' },
    mail: { provider: 'naverworks' },
    customFields: [],
    company: { bizNo: '' },
    updatedAt: new Date().toISOString(),
  };
}

/** 저장된 설정에 없는 키(예: 이후 추가된 extraction)를 기본값으로 채운다. */
export function withDefaults(stored: Settings | undefined): Settings {
  const d = defaultSettings();
  if (!stored) return d;
  // 실험 저장본 보정: 웹메일 호스트를 mail.google.com으로 바꿔 쓰던 상태를 Gmail 설정으로 읽는다(멱등).
  const legacyGmail = !stored.mail?.provider && stored.sites?.naverworks?.host?.trim().toLowerCase() === GMAIL_HOST;
  const sites = {
    ...stored.sites,
    trackerbot: { ...d.sites.trackerbot, ...stored.sites?.trackerbot, ...(legacyGmail ? { provider: 'gmail' as const } : {}) },
    naverworks: { ...d.sites.naverworks, ...stored.sites?.naverworks, ...(legacyGmail ? { host: DEFAULT_WEBMAIL_HOST } : {}) },
    gmail: { ...d.sites.gmail, ...stored.sites?.gmail },
  };
  return {
    ...stored,
    sites,
    extraction: { ...d.extraction, ...stored.extraction },
    autoCompose: { ...d.autoCompose, ...stored.autoCompose },
    company: { ...d.company, ...stored.company },
    mail: { ...d.mail, ...stored.mail, ...(legacyGmail ? { provider: 'gmail' as const } : {}) },
  };
}
