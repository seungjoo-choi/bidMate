import { listen, send } from '../messaging/bus';
import { NOTICE_DELETE_MAX } from '../messaging/protocol';
import { AI_RUN_SESSION_PREFIX } from '../core/types/ai';
import { assertExtensionSender } from './job-coordinator';
import { ensureOffscreen } from './offscreen-manager';
import { dequeueByNotice } from './auto-compose';
import { refreshDeadlines } from './deadline-scheduler';

const err = (code: string, message: string) => Object.assign(new Error(message), { code });

/** 공고 삭제: 검증 후 offscreen에 위임하고, 끝나면 SW 쪽 잔여 상태(자동작성 대기열·AI 세션 키·마감 알람)를 정리한다. */
export function registerNoticeDelete(): void {
  listen('notice/delete', async (payload, sender) => {
    assertExtensionSender(sender);
    const ids = payload?.noticeIds;
    if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string' || !x)) throw err('INVALID_VALUE', 'noticeIds가 올바르지 않습니다.');
    const noticeIds = [...new Set(ids)];
    if (noticeIds.length === 0) throw err('INVALID_VALUE', '삭제할 공고가 없습니다.');
    if (noticeIds.length > NOTICE_DELETE_MAX) throw err('PAYLOAD_TOO_LARGE', `한 번에 ${NOTICE_DELETE_MAX}건까지 삭제할 수 있습니다.`);
    await ensureOffscreen();
    const r = await send('notice/delete', { noticeIds }, { target: 'offscreen', timeoutMs: Math.min(600_000, 30_000 + 5_000 * noticeIds.length) });
    if (r.deleted.length > 0) {
      void dequeueByNotice(r.deleted).catch(() => undefined);
      void Promise.resolve(chrome.storage.session.remove(r.deleted.map((id) => `${AI_RUN_SESSION_PREFIX}${id}`))).catch(() => undefined);
    }
    void refreshDeadlines('manual').catch(() => undefined);
    return r;
  }, 'sw');
}
