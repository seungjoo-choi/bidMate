import type { Settings } from '../types/settings';

export const DEFAULT_WEBMAIL_HOST = 'mail.worksmobile.com';

export function defaultSettings(): Settings {
  return {
    schemaVersion: 1,
    g2b: { apiBaseUrl: '', detailUrlPatterns: [] },
    sites: {
      trackerbot: { urlPatterns: [] },
      naverworks: { host: DEFAULT_WEBMAIL_HOST, selectorSetId: 'naverworks-v1' },
    },
    download: { concurrency: 3, maxRetries: 3, backoffMs: 1000, maxFileMB: 100 },
    extraction: { budgetMs: 90000, fileTimeoutMs: 20000, maxParseMB: 50 },
    autoCompose: { enabled: false, recipients: { mode: 'default' }, reviewGate: 'conflicts' },
    mail: {},
    customFields: [],
    updatedAt: new Date().toISOString(),
  };
}

/** 저장된 설정에 없는 키(예: 이후 추가된 extraction)를 기본값으로 채운다. */
export function withDefaults(stored: Settings | undefined): Settings {
  const d = defaultSettings();
  if (!stored) return d;
  return {
    ...stored,
    extraction: { ...d.extraction, ...stored.extraction },
    autoCompose: { ...d.autoCompose, ...stored.autoCompose },
  };
}
