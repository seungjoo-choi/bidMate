import type { SettingsSection } from '../../messaging/protocol';

export type Page = 'home' | 'notices' | 'recipients' | 'templates' | 'settings' | 'diagnostics';
export type Route =
  | { page: 'grant' }
  | { page: 'review'; noticeId: string; query: Record<string, string> }
  | { page: 'mail'; noticeId: string; query: Record<string, string> }
  | { page: 'template'; id: string }
  | { page: Page };

/** `?` 뒤를 query로 분리한다. */
function splitQuery(rest: string): { path: string; query: Record<string, string> } {
  const i = rest.indexOf('?');
  if (i < 0) return { path: rest, query: {} };
  const query: Record<string, string> = {};
  new URLSearchParams(rest.slice(i + 1)).forEach((v, k) => { query[k] = v; });
  return { path: rest.slice(0, i), query };
}

/** `#/settings?section=...`에서 바로 보여 줄 카드를 꺼낸다. */
export function settingsSectionOf(hash: string): SettingsSection | undefined {
  if (!hash.startsWith('#/settings?')) return undefined;
  const s = splitQuery(hash.slice('#/settings'.length)).query.section;
  return s === 'storage' || s === 'mail-service' || s === 'auto-compose' || s === 'g2b' ? s : undefined;
}

export function parseRoute(hash: string): Route {
  if (hash === '#/grant') return { page: 'grant' };
  if (hash.startsWith('#/review/')) {
    const { path, query } = splitQuery(hash.slice('#/review/'.length));
    try { return { page: 'review', noticeId: decodeURIComponent(path), query }; } catch { /* 잘못된 인코딩은 목록으로 */ }
  }
  if (hash.startsWith('#/mail/')) {
    const { path, query } = splitQuery(hash.slice('#/mail/'.length));
    try { return { page: 'mail', noticeId: decodeURIComponent(path), query }; } catch { /* 잘못된 인코딩은 목록으로 */ }
  }
  if (hash.startsWith('#/templates/')) {
    try { return { page: 'template', id: decodeURIComponent(hash.slice('#/templates/'.length)) }; } catch { /* 잘못된 인코딩은 목록으로 */ }
  }
  if (hash === '#/home' || hash === '' || hash === '#' || hash === '#/') return { page: 'home' };
  if (hash === '#/notices') return { page: 'notices' };
  if (hash === '#/recipients') return { page: 'recipients' };
  if (hash === '#/templates') return { page: 'templates' };
  if (hash === '#/settings' || hash.startsWith('#/settings?')) return { page: 'settings' };
  if (hash === '#/diagnostics' || hash === '#diagnostics') return { page: 'diagnostics' };
  return { page: 'home' };
}

