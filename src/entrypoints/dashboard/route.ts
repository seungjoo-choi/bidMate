import type { SettingsSection } from '../../messaging/protocol';

export type Page = 'home' | 'notices' | 'mails' | 'evaluations' | 'stats' | 'recipients' | 'templates' | 'settings' | 'diagnostics';
export const NOTICE_TABS = ['overview', 'files', 'history', 'review'] as const;
export type NoticeTab = (typeof NOTICE_TABS)[number];
export type MailsTab = 'drafts' | 'sent';
export type Route =
  | { page: 'grant' }
  | { page: 'notice'; noticeId: string; tab: NoticeTab; query: Record<string, string> }
  | { page: 'mail'; noticeId: string; query: Record<string, string> }
  | { page: 'template'; id: string }
  | { page: 'evaluation'; noticeId: string }
  | { page: 'mails'; tab: MailsTab }
  | { page: Exclude<Page, 'mails'> };

/** `?` 뒤를 query로 분리한다. */
function splitQuery(rest: string): { path: string; query: Record<string, string> } {
  const i = rest.indexOf('?');
  if (i < 0) return { path: rest, query: {} };
  const query: Record<string, string> = {};
  new URLSearchParams(rest.slice(i + 1)).forEach((v, k) => { query[k] = v; });
  return { path: rest.slice(0, i), query };
}

/** 상세 화면 해시. tab 생략 또는 'overview'면 `#/notices/<enc>` */
export function noticeHash(noticeId: string, tab?: NoticeTab, query?: Record<string, string>): string {
  const base = `#/notices/${encodeURIComponent(noticeId)}`;
  const path = tab && tab !== 'overview' ? `${base}/${tab}` : base;
  const qs = query && Object.keys(query).length > 0 ? new URLSearchParams(query).toString() : '';
  return qs ? `${path}?${qs}` : path;
}

/** 메일 관리 해시. 초안 탭이 기본 */
export const mailsHash = (tab: MailsTab = 'drafts'): string => (tab === 'sent' ? '#/mails/sent' : '#/mails');

/** 평가분석 상세 해시 */
export const evaluationHash = (noticeId: string): string => `#/evaluations/${encodeURIComponent(noticeId)}`;

/** `#/settings?section=...`에서 바로 보여 줄 카드를 꺼낸다. */
export function settingsSectionOf(hash: string): SettingsSection | undefined {
  if (!hash.startsWith('#/settings?')) return undefined;
  const s = splitQuery(hash.slice('#/settings'.length)).query.section;
  return s === 'storage' || s === 'mail-service' || s === 'auto-compose' || s === 'g2b' || s === 'company' || s === 'performances' || s === 'ai' || s === 'notify' ? s : undefined;
}

export function parseRoute(hash: string): Route {
  if (hash === '#/grant') return { page: 'grant' };
  if (hash.startsWith('#/notices/')) {
    const { path, query } = splitQuery(hash.slice('#/notices/'.length));
    const [rawId = '', rawTab = ''] = path.split('/');
    try {
      const noticeId = decodeURIComponent(rawId);
      if (!noticeId) return { page: 'home' };
      const tab = (NOTICE_TABS as readonly string[]).includes(rawTab) ? (rawTab as NoticeTab) : 'overview';
      return { page: 'notice', noticeId, tab, query };
    } catch { /* 잘못된 인코딩은 목록으로 */ }
  }
  if (hash.startsWith('#/review/')) {
    const { path, query } = splitQuery(hash.slice('#/review/'.length));
    try { return { page: 'notice', noticeId: decodeURIComponent(path), tab: 'review', query }; } catch { /* 잘못된 인코딩은 목록으로 */ }
  }
  if (hash.startsWith('#/mail/')) {
    const { path, query } = splitQuery(hash.slice('#/mail/'.length));
    try { return { page: 'mail', noticeId: decodeURIComponent(path), query }; } catch { /* 잘못된 인코딩은 목록으로 */ }
  }
  if (hash.startsWith('#/templates/')) {
    try { return { page: 'template', id: decodeURIComponent(hash.slice('#/templates/'.length)) }; } catch { /* 잘못된 인코딩은 목록으로 */ }
  }
  if (hash.startsWith('#/evaluations/')) {
    try {
      const noticeId = decodeURIComponent(hash.slice('#/evaluations/'.length));
      if (noticeId) return { page: 'evaluation', noticeId };
    } catch { /* 잘못된 인코딩은 목록으로 */ }
    return { page: 'evaluations' };
  }
  if (hash === '#/evaluations') return { page: 'evaluations' };
  if (hash === '#/home' || hash === '' || hash === '#' || hash === '#/') return { page: 'home' };
  if (hash === '#/notices') return { page: 'notices' };
  if (hash === '#/mails') return { page: 'mails', tab: 'drafts' };
  if (hash === '#/mails/sent' || hash === '#/sent') return { page: 'mails', tab: 'sent' };
  if (hash === '#/stats') return { page: 'stats' };
  if (hash === '#/recipients') return { page: 'recipients' };
  if (hash === '#/templates') return { page: 'templates' };
  if (hash === '#/settings' || hash.startsWith('#/settings?')) return { page: 'settings' };
  if (hash === '#/diagnostics' || hash === '#diagnostics') return { page: 'diagnostics' };
  return { page: 'home' };
}

