import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/messaging/bus', () => ({ listen: vi.fn(), send: vi.fn() }));
vi.mock('../../src/background/offscreen-manager', () => ({ ensureOffscreen: vi.fn() }));
vi.mock('../../src/background/dashboard-tabs', () => ({ openDashboard: vi.fn() }));

import { ASK_FIELD_DOC_MAX_CHARS, EXTENSION_ONLY_TYPES, registerRouter } from '../../src/background/router';
import { listen, send } from '../../src/messaging/bus';
import { ensureOffscreen } from '../../src/background/offscreen-manager';
import { defaultSettings } from '../../src/core/model/default-settings';

const RID = 'abcdefghijklmnop';
const KEY = 'AQ.SECRET-gemini-4242';
const tabSender = { id: RID, url: 'https://www.g2b.go.kr/', tab: { id: 1 } };
const dash = { id: RID, url: `chrome-extension://${RID}/dashboard.html` };
type H = (payload: unknown, sender: unknown) => Promise<unknown>;
const handlerOf = (type: string): H => {
  const call = vi.mocked(listen).mock.calls.find((c) => c[0] === type && c[2] === 'sw');
  if (!call) throw new Error(`핸들러 없음: ${type}`);
  return call[1] as unknown as H;
};

function stubChrome(o: { mode?: 'api' | 'manual'; key?: string | undefined; models?: Record<string, string>; granted?: boolean } = {}) {
  const s = defaultSettings();
  s.ai.mode = o.mode ?? 'api';
  s.ai.provider = 'gemini';
  if (o.models) s.ai.models = o.models;
  const secrets = 'key' in o ? (o.key === undefined ? {} : { ai: { gemini: o.key } }) : { ai: { gemini: KEY } };
  vi.stubGlobal('chrome', {
    runtime: { id: RID },
    storage: { local: { get: vi.fn().mockResolvedValue({ secrets, settingsCache: s }) }, session: { set: vi.fn() } },
    permissions: { contains: vi.fn().mockResolvedValue(o.granted ?? true) },
  });
}
const ASK_ID = '3f2b8c1e-5a7d-4e9f-8b21-0c4d6e7f8a90';
const payload = (o: object = {}) => ({ noticeId: 'n', askId: ASK_ID, question: '사업 기간은?', fieldDocText: '[기본]', ...o });

describe('검색 질문 라우터', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubChrome();
    registerRouter();
  });

  it('search/ask-exec는 SW에 등록하지 않고(offscreen 전용), ask-cancel·asks-get은 EXTENSION_ONLY에 있다', () => {
    const registered = vi.mocked(listen).mock.calls.filter((c) => c[2] === 'sw').map((c) => c[0] as string);
    expect(registered).not.toContain('search/ask-exec');
    expect(EXTENSION_ONLY_TYPES as readonly string[]).not.toContain('search/ask-exec');
    expect(EXTENSION_ONLY_TYPES as readonly string[]).not.toContain('search/ask');
    for (const t of ['search/ask-cancel', 'search/asks-get']) {
      expect(EXTENSION_ONLY_TYPES as readonly string[]).toContain(t);
      expect(registered).toContain(t);
    }
    expect(registered).toContain('search/ask');
  });

  it('확장 밖 발신자는 거부한다(search/ask, search/ask-cancel)', async () => {
    await expect(handlerOf('search/ask')(payload(), tabSender)).rejects.toMatchObject({ code: 'SENDER_FORBIDDEN' });
    await expect(handlerOf('search/ask-cancel')({ noticeId: 'n', askId: 'a' }, tabSender)).rejects.toMatchObject({ code: 'SENDER_FORBIDDEN' });
    expect(send).not.toHaveBeenCalled();
  });

  it('키가 없으면 AI_KEY_MISSING이고 offscreen을 띄우지 않는다', async () => {
    stubChrome({ key: undefined });
    await expect(handlerOf('search/ask')(payload(), dash)).rejects.toMatchObject({ code: 'AI_KEY_MISSING' });
    stubChrome();
    await expect(handlerOf('search/ask')(payload({ provider: 'openai' }), dash)).rejects.toMatchObject({ code: 'AI_KEY_MISSING' });
    expect(ensureOffscreen).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('payload에는 키가 없고, mode가 manual이어도 offscreen 요청에는 키·모델이 주입된다', async () => {
    stubChrome({ mode: 'manual' });
    vi.mocked(send).mockResolvedValue({ id: ASK_ID, status: 'done' } as never);
    const p = payload({ contextMode: 'full' });
    expect(JSON.stringify(p)).not.toContain(KEY);
    expect(await handlerOf('search/ask')(p, dash)).toEqual({ id: ASK_ID, status: 'done' });
    const [type, body, opts] = vi.mocked(send).mock.calls[0]!;
    expect(type).toBe('search/ask-exec');
    expect(body).toMatchObject({ noticeId: 'n', askId: ASK_ID, provider: 'gemini', contextMode: 'full', api: { key: KEY, model: expect.any(String) } });
    expect(opts).toMatchObject({ target: 'offscreen', timeoutMs: 150_000 });
  });

  it('question 500자 초과, fieldDocText 상한 초과는 PAYLOAD_TOO_LARGE', async () => {
    await expect(handlerOf('search/ask')(payload({ question: 'a'.repeat(501) }), dash)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    await expect(handlerOf('search/ask')(payload({ fieldDocText: 'a'.repeat(ASK_FIELD_DOC_MAX_CHARS + 1) }), dash)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    expect(send).not.toHaveBeenCalled();
  });

  it('askId·noticeId·contextMode 형식이 틀리면 SEARCH_BAD_REF로 거절하고 키 해석·offscreen에 가지 않는다', async () => {
    for (const bad of [{ askId: '../x' }, { askId: 'a/b' }, { askId: 'ask1' }, { askId: 7 }, { noticeId: '' }, { noticeId: 5 }, { contextMode: 'all' }]) {
      await expect(handlerOf('search/ask')(payload(bad), dash)).rejects.toMatchObject({ code: 'SEARCH_BAD_REF' });
    }
    expect(ensureOffscreen).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('offscreen 오류 메시지의 키는 가려서 던진다', async () => {
    vi.mocked(send).mockRejectedValue(Object.assign(new Error(`boom ${KEY}`), { code: 'AI_HTTP' }));
    const e = await handlerOf('search/ask')(payload(), dash).catch((x: Error) => x);
    expect(e).toMatchObject({ code: 'AI_HTTP' });
    expect((e as Error).message).not.toContain(KEY);
  });
});
