import { listen, send } from '../messaging/bus';
import type { Envelope, MsgType, PayloadOf, ResponseOf } from '../messaging/protocol';
import { openDashboard } from './dashboard-tabs';
import { assertExtensionSender } from './job-coordinator';
import { getWebmailHost } from './site-registry';
import { ensureOffscreen } from './offscreen-manager';

const MAX_LOOKUP_BATCH = 200;

function relayToOffscreen<T extends Extract<MsgType, `fs/${string}`>>(type: T): void {
  listen(
    type,
    async (payload: PayloadOf<T>, sender): Promise<ResponseOf<T>> => {
      assertExtensionSender(sender);
      await ensureOffscreen();
      return send(type, payload, { target: 'offscreen', timeoutMs: 25_000 });
    },
    'sw',
  );
}

/** 서비스키는 SW가 storage에서 읽어 offscreen에 전달한다(UI에는 노출하지 않는다). */
function relayG2bTest(): void {
  listen(
    'g2b/test',
    async (_, sender) => {
      assertExtensionSender(sender);
      const { secrets } = await chrome.storage.local.get('secrets');
      await ensureOffscreen();
      return send('g2b/test', { serviceKey: (secrets as { g2bServiceKey?: string } | undefined)?.g2bServiceKey }, { target: 'offscreen', timeoutMs: 25_000 });
    },
    'sw',
  );
}

/** 수집 여부 조회. 권한 없음/오류는 found:false로 처리한다. */
function relayNoticeLookup(): void {
  listen(
    'notice/lookup',
    async (payload) => {
      try {
        await ensureOffscreen();
        return await send('notice/lookup', payload, { target: 'offscreen', timeoutMs: 25_000 });
      } catch {
        return { found: false };
      }
    },
    'sw',
  );
}

/** 배치 수집 여부 조회. 입력 순서를 보존하고 오류는 모두 found:false로 처리한다. */
function relayNoticeLookupBatch(): void {
  listen(
    'notice/lookup-batch',
    async ({ refs }) => {
      const list = Array.isArray(refs) ? refs.slice(0, MAX_LOOKUP_BATCH) : [];
      try {
        await ensureOffscreen();
        return await send('notice/lookup-batch', { refs: list }, { target: 'offscreen', timeoutMs: 25_000 });
      } catch {
        return list.map(() => ({ found: false }));
      }
    },
    'sw',
  );
}

export const EXTENSION_ONLY_TYPES = [
  'notice/list', 'notice/get', 'extraction/edit', 'extraction/text',
  'recipients/list', 'recipients/save', 'recipients/delete', 'groups/save', 'groups/delete', 'groups/set-default',
  'templates/list', 'templates/save', 'templates/delete', 'templates/set-default',
  'mail/prepare', 'mail/draft-get', 'mail/set-status', 'config/repair',
] as const;
type ExtensionOnlyType = (typeof EXTENSION_ONLY_TYPES)[number];

/** 확장 페이지가 보낸 notice, extraction, 수신자/템플릿/메일 요청만 offscreen으로 중계한다. */
function relayExtensionOnly<T extends ExtensionOnlyType>(type: T): void {
  listen(
    type,
    async (payload: PayloadOf<T>, sender): Promise<ResponseOf<T>> => {
      assertExtensionSender(sender);
      await ensureOffscreen();
      return send(type, payload, { target: 'offscreen', timeoutMs: 25_000 });
    },
    'sw',
  );
}

function registerUiMessages(): void {
  listen(
    'ui/open',
    async ({ page, noticeId }, sender) => {
      const near = sender.tab?.id;
      const enc = noticeId ? encodeURIComponent(noticeId) : undefined;
      if (page === 'grant') {
        await chrome.windows.create({ url: chrome.runtime.getURL('dashboard.html#/grant'), type: 'popup', width: 420, height: 300 });
      } else if (page === 'review' && enc) {
        await openDashboard(`#/review/${enc}`, { nearTabId: near });
      } else if (page === 'mail' && enc) {
        await openDashboard(`#/mail/${enc}`, { nearTabId: near });
      } else {
        await openDashboard('#/settings', { nearTabId: near });
      }
    },
    'sw',
  );
  // 폴더 접근이 허용되면 열려 있는 나라장터 탭의 패널과 웹메일 탭에 알린다.
  listen(
    'fs/permission-granted',
    async (_, sender) => {
      assertExtensionSender(sender);
      const host = await getWebmailHost();
      const tabs = [
        ...(await chrome.tabs.query({ url: 'https://www.g2b.go.kr/*' })),
        ...(await chrome.tabs.query({ url: `https://${host}/*` })),
      ];
      for (const t of tabs) {
        if (t.id === undefined) continue;
        const env: Envelope = { id: crypto.randomUUID(), type: 'fs/permission-granted', payload: undefined, ts: Date.now(), target: 'content' };
        void chrome.tabs.sendMessage(t.id, env).catch(() => undefined);
      }
    },
    'sw',
  );
}

export function registerRouter(): void {
  relayNoticeLookup();
  relayNoticeLookupBatch();
  registerUiMessages();
  relayG2bTest();
  for (const t of EXTENSION_ONLY_TYPES) relayExtensionOnly(t);
  relayToOffscreen('fs/status');
  relayToOffscreen('fs/root-updated');
  relayToOffscreen('fs/smoke-test');
}
