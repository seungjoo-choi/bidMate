export interface NotifyDeps {
  notifications: Pick<typeof chrome.notifications, 'create' | 'clear'>;
  openDashboard: (hash: string) => Promise<unknown>;
  getURL: (path: string) => string;
}

export interface NotificationSpec { id: string; title: string; message: string }

export { NOTIFY_TITLE_MAX, clipTitle } from '../core/model/notify-text';

/** 기본 알림 한 건을 보낸다. 실패는 삼킨다. */
export async function showNotification(spec: NotificationSpec, d: NotifyDeps): Promise<void> {
  try {
    await d.notifications.create(spec.id, { type: 'basic', iconUrl: d.getURL('icon/128.png'), title: spec.title, message: spec.message });
  } catch { /* 알림 실패는 무시 */ }
}

/** 공고 상세 overview를 열고 알림을 지운다. 둘 다 실패를 삼킨다. */
export async function openNoticeFromNotification(noticeId: string, notificationId: string, d: NotifyDeps): Promise<void> {
  try { await d.openDashboard(`#/notices/${encodeURIComponent(noticeId)}/overview`); } catch { /* 열기 실패는 무시 */ }
  try { await d.notifications.clear(notificationId); } catch { /* 이미 사라짐 */ }
}
