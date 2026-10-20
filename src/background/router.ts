import { listen, send } from '../messaging/bus';
import { AI_RUN_SESSION_PREFIX } from '../core/types/ai';
import type { AiProvider, AiRunState } from '../core/types/ai';
import { withDefaults } from '../core/model/default-settings';
import type { Settings } from '../core/types/settings';
import { PROVIDERS } from '../engine/ai/providers';
import { redactKey } from '../adapters/g2b/openapi';
import { SIDEPANEL_FOCUS_KEY, type Envelope, type MsgType, type PayloadOf, type ResponseOf } from '../messaging/protocol';
import { openDashboard } from './dashboard-tabs';
import { assertExtensionSender, isOffscreenSender } from './job-coordinator';
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
  'notice/list', 'notice/get', 'extraction/edit', 'notice/field-edit', 'extraction/text',
  'recipients/list', 'recipients/save', 'recipients/import', 'recipients/delete', 'groups/save', 'groups/delete', 'groups/set-default',
  'templates/list', 'templates/save', 'templates/delete', 'templates/set-default',
  'mail/prepare', 'mail/draft-get', 'mail/edits-get', 'mail/sent-list', 'mail/sent-get', 'mail/sent-add', 'mail/sent-void', 'config/repair',
  'ai/get', 'ai/prepare', 'ai/prompt-get', 'ai/submit', 'ai/apply', 'ai/dismiss', 'ai/cancel',
] as const;
type ExtensionOnlyType = (typeof EXTENSION_ONLY_TYPES)[number];

/** 확장 페이지가 보낸 notice, extraction, 수신자/템플릿/메일 요청만 offscreen으로 중계한다. */
const SLOW_TYPES = new Set<string>(['ai/prepare', 'ai/submit']);
/** 별도 릴레이를 두는 타입(EXTENSION_ONLY_TYPES에는 포함) */
const CUSTOM_RELAY = new Set<string>(['ai/prepare']);
/** 반자동 답변 붙여넣기 상한 */
export const AI_SUBMIT_MAX_CHARS = 200_000;
const err = (code: string, message: string) => Object.assign(new Error(message), { code });
/** 원본 키와 trim한 키 둘 다로 가린다. */
const maskKey = (text: string, key?: string): string => redactKey(redactKey(text, key), key?.trim() || undefined);

function relayExtensionOnly<T extends ExtensionOnlyType>(type: T): void {
  listen(
    type,
    async (payload: PayloadOf<T>, sender): Promise<ResponseOf<T>> => {
      assertExtensionSender(sender);
      if (type === 'ai/submit') {
        const t = (payload as PayloadOf<'ai/submit'>)?.text;
        if (typeof t !== 'string' || t.length > AI_SUBMIT_MAX_CHARS) throw err('PAYLOAD_TOO_LARGE', 'AI 답변이 너무 깁니다(200KB 이하).');
      }
      await ensureOffscreen();
      return send(type, payload, { target: 'offscreen', timeoutMs: SLOW_TYPES.has(type) ? 30_000 : 25_000 });
    },
    'sw',
  );
}

async function readAiSettings(): Promise<{ settings: Settings; keys: Partial<Record<AiProvider, string>> }> {
  const { secrets, settingsCache } = await chrome.storage.local.get(['secrets', 'settingsCache']);
  return {
    settings: withDefaults(settingsCache as Settings | undefined),
    keys: ((secrets as { ai?: Partial<Record<AiProvider, string>> } | undefined)?.ai) ?? {},
  };
}

/** 키·권한을 확인하고 (adapter, key)를 돌려준다. 키가 없으면 AI_KEY_MISSING, 호스트 권한이 없으면 AI_PERMISSION_MISSING. */
async function requireAiAccess(provider: AiProvider, keys: Partial<Record<AiProvider, string>>) {
  const key = keys[provider]?.trim();
  if (!key) throw err('AI_KEY_MISSING', 'API 키가 없습니다. 설정에서 저장하세요.');
  const adapter = PROVIDERS[provider];
  if (!(await chrome.permissions.contains({ origins: [`${adapter.apiOrigin}/*`] }))) throw err('AI_PERMISSION_MISSING', `${adapter.label} 접근 권한이 필요합니다.`);
  return { key, adapter };
}

/** AI 재검토 릴레이. 키는 SW가 storage에서 읽어 offscreen에 주입한다(대시보드 payload에는 키가 없다). */
function relayAi(): void {
  listen(
    'ai/run',
    async (payload, sender) => {
      assertExtensionSender(sender);
      const { settings, keys } = await readAiSettings();
      const provider = payload.provider ?? settings.ai.provider;
      // ai/run 자체가 API 실행이다(설정 mode가 manual이어도 "이번만 API"를 허용한다).
      if (!keys[provider]?.trim()) throw err('AI_KEY_MISSING', 'API 키가 없습니다. 설정에서 저장하세요.');
      const model = settings.ai.models[provider]?.trim();
      if (!model) throw err('AI_MODEL_MISSING', '모델이 설정되지 않았습니다.');
      const { key } = await requireAiAccess(provider, keys);
      await ensureOffscreen();
      try {
        return await send('ai/exec', { noticeId: payload.noticeId, scope: payload.scope, provider, ...(payload.files ? { files: payload.files } : {}), api: { key, model } }, { target: 'offscreen', timeoutMs: 60_000 });
      } catch (e) {
        throw Object.assign(new Error(maskKey(e instanceof Error ? e.message : String(e), keys[provider])), { code: (e as { code?: string }).code });
      }
    },
    'sw',
  );
  listen(
    'ai/prepare',
    async (payload, sender) => {
      assertExtensionSender(sender);
      const { settings } = await readAiSettings();
      await ensureOffscreen();
      return send('ai/prepare', { ...payload, provider: payload.provider ?? settings.ai.provider }, { target: 'offscreen', timeoutMs: 30_000 });
    },
    'sw',
  );
  listen(
    'ai/test',
    async ({ provider }, sender) => {
      assertExtensionSender(sender);
      const { keys } = await readAiSettings();
      const fail = (code: string, message: string) => ({ ok: false, error: { code, message: maskKey(message, keys[provider]) } });
      try {
        const { key } = await requireAiAccess(provider, keys);
        await ensureOffscreen();
        const r = await send('ai/models', { provider, apiKey: key }, { target: 'offscreen', timeoutMs: 30_000 });
        return { ok: true, models: r.models };
      } catch (e) {
        return fail((e as { code?: string }).code ?? 'AI_HTTP', e instanceof Error ? e.message : String(e));
      }
    },
    'sw',
  );
  // offscreen.html만 상태를 기록할 수 있다.
  listen(
    'ai/status',
    async (state: AiRunState, sender) => {
      if (!isOffscreenSender(sender)) throw err('SENDER_FORBIDDEN', '허용되지 않은 발신자입니다.');
      await chrome.storage.session.set({ [`${AI_RUN_SESSION_PREFIX}${state.noticeId}`]: state });
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
        const known = section === 'storage' || section === 'mail-service' || section === 'auto-compose' || section === 'g2b' || section === 'ai';
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
  relayAi();
  for (const t of EXTENSION_ONLY_TYPES) if (!CUSTOM_RELAY.has(t)) relayExtensionOnly(t);
  relayToOffscreen('fs/status');
  relayToOffscreen('fs/root-updated');
  relayToOffscreen('fs/smoke-test');
}
