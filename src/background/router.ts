import { listen, send } from '../messaging/bus';
import { SIDEPANEL_FOCUS_KEY, type Envelope, type MsgType, type PayloadOf, type ResponseOf } from '../messaging/protocol';
import { openDashboard } from './dashboard-tabs';
import { assertExtensionSender } from './job-coordinator';
import { getInboxHost } from './site-registry';
import { ensureOffscreen } from './offscreen-manager';
import { closeSidePanel, isSidePanelOpen, setShownNotice, shownNoticeOf } from './sidepanel-ports';

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
    async (payload, sender) => {
      assertExtensionSender(sender);
      const { secrets } = await chrome.storage.local.get('secrets');
      await ensureOffscreen();
      return send('g2b/test', { serviceKey: (secrets as { g2bServiceKey?: string } | undefined)?.g2bServiceKey, ...(payload?.kind ? { kind: payload.kind } : {}) },{ target: 'offscreen', timeoutMs: 25_000 });
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
  'recipients/list', 'recipients/save', 'recipients/import', 'recipients/delete', 'groups/save', 'groups/delete', 'groups/set-default',
  'templates/list', 'templates/save', 'templates/delete', 'templates/set-default',
  'mail/prepare', 'mail/draft-get', 'mail/edits-get', 'mail/sent-list', 'mail/sent-get', 'mail/sent-add', 'mail/sent-void', 'config/repair',
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
    async ({ page, noticeId, section }, sender) => {
      // 사용자 제스처가 살아 있을 때 불러야 하므로 어떤 await보다 먼저 연다. 그 탭에 고정되도록 tabId로 연다.
      if (page === 'sidepanel') {
        const tabId = sender.tab?.id;
        if (tabId === undefined) throw Object.assign(new Error('탭 정보가 없습니다.'), { code: 'NO_TAB' });
        const win = sender.tab?.windowId;
        // 이미 열려 있으면: 같은 공고(또는 공고 지정 없는 나라장터 칩)는 닫고, 다른 공고면 그 공고로 바꾼다
        if (win !== undefined && isSidePanelOpen(win)) {
          if (!noticeId || noticeId === shownNoticeOf(win)) { closeSidePanel(win); return; }
          setShownNotice(win, noticeId);
          await chrome.storage.session.set({ [SIDEPANEL_FOCUS_KEY]: { noticeId, tabId, at: new Date().toISOString() } });
          return;
        }
        if (win !== undefined) setShownNotice(win, noticeId);
        const p = chrome.sidePanel.open({ tabId });
        try {
          if (noticeId) await chrome.storage.session.set({ [SIDEPANEL_FOCUS_KEY]: { noticeId, tabId, at: new Date().toISOString() } });
        } finally {
          await p;
        }
        return;
      }
      const near = sender.tab?.id;
      const enc = noticeId ? encodeURIComponent(noticeId) : undefined;
      if (page === 'grant') {
        await chrome.windows.create({ url: chrome.runtime.getURL('dashboard.html#/grant'), type: 'popup', width: 420, height: 300 });
      } else if (page === 'review' && enc) {
        await openDashboard(`#/review/${enc}`, { nearTabId: near });
      } else if (page === 'mail' && enc) {
        await openDashboard(`#/mail/${enc}`, { nearTabId: near });
      } else if (page === 'evaluation') {
        await openDashboard(enc ? `#/evaluations/${enc}` : '#/evaluations', { nearTabId: near });
      } else if (page === 'recipients') {
        await openDashboard('#/recipients', { nearTabId: near });
      } else {
        // 같은 카드로 다시 보내도 hashchange가 나도록 시각을 붙인다
        const known = section === 'storage' || section === 'mail-service' || section === 'auto-compose' || section === 'g2b';
        await openDashboard(known ? `#/settings?section=${section}&t=${Date.now()}` : '#/settings', { nearTabId: near });
      }
    },
    'sw',
  );
  // 폴더 접근이 허용되면 열려 있는 나라장터 탭의 패널과 웹메일 탭에 알린다.
  listen(
    'fs/permission-granted',
    async (_, sender) => {
      assertExtensionSender(sender);
      const host = await getInboxHost();
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
