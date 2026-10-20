import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/messaging/bus', () => ({ listen: vi.fn(), send: vi.fn() }));
vi.mock('../../src/background/offscreen-manager', () => ({ ensureOffscreen: vi.fn() }));
vi.mock('../../src/background/dashboard-tabs', () => ({ openDashboard: vi.fn() }));

import { AI_SUBMIT_MAX_CHARS, EXTENSION_ONLY_TYPES, registerRouter } from '../../src/background/router';
import { listen, send } from '../../src/messaging/bus';
import { ensureOffscreen } from '../../src/background/offscreen-manager';
import { defaultSettings } from '../../src/core/model/default-settings';

const RID = 'abcdefghijklmnop';
const KEY = 'sk-ant-SECRET-4242';
const tabSender = { id: RID, url: 'https://www.g2b.go.kr/', tab: { id: 1 } };
const dash = { id: RID, url: `chrome-extension://${RID}/dashboard.html` };
const offscreen = { id: RID, url: `chrome-extension://${RID}/offscreen.html` };
type H = (payload: unknown, sender: unknown) => Promise<unknown>;
const handlerOf = (type: string): H => {
  const call = vi.mocked(listen).mock.calls.find((c) => c[0] === type && c[2] === 'sw');
  if (!call) throw new Error(`핸들러 없음: ${type}`);
  return call[1] as unknown as H;
};

function stubChrome(o: { mode?: 'api' | 'manual'; key?: string | undefined; models?: Record<string, string>; granted?: boolean } = {}) {
  const s = defaultSettings();
  s.ai.mode = o.mode ?? 'api';
  s.ai.provider = 'claude';
  if (o.models) s.ai.models = o.models;
  const sessionSet = vi.fn().mockResolvedValue(undefined);
  const contains = vi.fn().mockResolvedValue(o.granted ?? true);
  const secrets = 'key' in o ? (o.key === undefined ? {} : { ai: { claude: o.key } }) : { ai: { claude: KEY } };
  vi.stubGlobal('chrome', {
    runtime: { id: RID },
    storage: { local: { get: vi.fn().mockResolvedValue({ secrets, settingsCache: s }) }, session: { set: sessionSet } },
    permissions: { contains },
  });
  return { sessionSet, contains };
}

describe('AI 라우터', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubChrome();
    registerRouter();
  });

  it('ai/exec·ai/models는 SW에 등록하지 않고(offscreen 전용), 나머지 7종은 EXTENSION_ONLY에 있다', () => {
    const registered = vi.mocked(listen).mock.calls.filter((c) => c[2] === 'sw').map((c) => c[0] as string);
    expect(registered).not.toContain('ai/exec');
    expect(registered).not.toContain('ai/models');
    for (const t of ['ai/get', 'ai/prepare', 'ai/prompt-get', 'ai/submit', 'ai/apply', 'ai/dismiss', 'ai/cancel']) {
      expect(EXTENSION_ONLY_TYPES as readonly string[]).toContain(t);
      expect(registered).toContain(t);
    }
    for (const t of ['ai/run', 'ai/test', 'ai/status']) expect(registered).toContain(t);
  });

  it('ai/run: 탭 발신은 거부, mode가 manual이어도 키·모델·권한이 있으면 ai/exec로 간다', async () => {
    await expect(handlerOf('ai/run')({ noticeId: 'n', scope: 'all' }, tabSender)).rejects.toMatchObject({ code: 'SENDER_FORBIDDEN' });
    stubChrome({ mode: 'manual' });
    vi.mocked(send).mockResolvedValue({ runId: 'r9' } as never);
    expect(await handlerOf('ai/run')({ noticeId: 'n', scope: 'all' }, dash)).toEqual({ runId: 'r9' });
    expect(vi.mocked(send)).toHaveBeenCalledWith('ai/exec', expect.objectContaining({ api: { key: KEY, model: 'claude-sonnet-5-5', sendFullText: true } }), expect.objectContaining({ target: 'offscreen' }));
  });

  it('ai/run: 키·모델·권한이 없으면 각각 코드로 거부하고 offscreen을 띄우지 않는다', async () => {
    stubChrome({ key: undefined });
    await expect(handlerOf('ai/run')({ noticeId: 'n', scope: 'all' }, dash)).rejects.toMatchObject({ code: 'AI_KEY_MISSING' });
    stubChrome({ models: { claude: '' } });
    await expect(handlerOf('ai/run')({ noticeId: 'n', scope: 'all' }, dash)).rejects.toMatchObject({ code: 'AI_MODEL_MISSING' });
    const { contains } = stubChrome({ granted: false });
    await expect(handlerOf('ai/run')({ noticeId: 'n', scope: 'all' }, dash)).rejects.toMatchObject({ code: 'AI_PERMISSION_MISSING' });
    expect(contains).toHaveBeenCalledWith({ origins: ['https://api.anthropic.com/*'] });
    await expect(handlerOf('ai/run')({ noticeId: 'n', scope: 'all', provider: 'openai' }, dash)).rejects.toMatchObject({ code: 'AI_KEY_MISSING' });
    expect(ensureOffscreen).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('ai/run 성공: 키·모델을 ai/exec로 주입하고 runId를 돌려준다', async () => {
    vi.mocked(send).mockResolvedValue({ runId: 'r1' } as never);
    const r = await handlerOf('ai/run')({ noticeId: 'n', scope: 'pending', files: ['a'] }, dash);
    expect(r).toEqual({ runId: 'r1' });
    expect(vi.mocked(send)).toHaveBeenCalledWith('ai/exec', { noticeId: 'n', scope: 'pending', provider: 'claude', files: ['a'], api: { key: KEY, model: 'claude-sonnet-5-5', sendFullText: true } }, expect.objectContaining({ target: 'offscreen' }));
  });

  it('ai/run: offscreen 오류 메시지의 키는 가려서 던진다', async () => {
    vi.mocked(send).mockRejectedValue(Object.assign(new Error(`boom ${KEY}`), { code: 'AI_HTTP' }));
    const e = await handlerOf('ai/run')({ noticeId: 'n', scope: 'all' }, dash).catch((x: Error) => x);
    expect(e).toMatchObject({ code: 'AI_HTTP' });
    expect((e as Error).message).not.toContain(KEY);
    // 공백이 붙은 키도 trim한 값과 원본 둘 다 가려진다
    stubChrome({ key: `  ${KEY}  ` });
    vi.mocked(send).mockRejectedValue(new Error(`boom ${KEY} and   ${KEY}  `));
    const e2 = await handlerOf('ai/run')({ noticeId: 'n', scope: 'all' }, dash).catch((x: Error) => x);
    expect((e2 as Error).message).not.toContain(KEY);
    expect(vi.mocked(send)).toHaveBeenLastCalledWith('ai/exec', expect.anything(), expect.objectContaining({ timeoutMs: 60_000 }));
  });

  it('ai/test: 키 없으면 ok:false, 있으면 모델 목록(키는 offscreen에만 전달)', async () => {
    stubChrome({ key: undefined });
    expect(await handlerOf('ai/test')({ provider: 'claude' }, dash)).toMatchObject({ ok: false, error: { code: 'AI_KEY_MISSING' } });
    stubChrome();
    vi.mocked(send).mockResolvedValue({ models: [{ id: 'm1' }] } as never);
    expect(await handlerOf('ai/test')({ provider: 'claude' }, dash)).toEqual({ ok: true, models: [{ id: 'm1' }] });
    expect(vi.mocked(send)).toHaveBeenLastCalledWith('ai/models', { provider: 'claude', apiKey: KEY }, expect.objectContaining({ target: 'offscreen' }));
    vi.mocked(send).mockRejectedValue(new Error(`fail ${KEY}`));
    const r = (await handlerOf('ai/test')({ provider: 'claude' }, dash)) as { error: { message: string } };
    expect(r.error.message).not.toContain(KEY);
  });

  it('ai/status: offscreen.html만 수용하고 storage.session에 기록, 대시보드·탭은 거부', async () => {
    const { sessionSet } = stubChrome();
    const state = { noticeId: 'n1', runId: 'r1', provider: 'claude', status: 'requesting', label: 'x', at: 't' };
    await expect(handlerOf('ai/status')(state, dash)).rejects.toMatchObject({ code: 'SENDER_FORBIDDEN' });
    await expect(handlerOf('ai/status')(state, tabSender)).rejects.toMatchObject({ code: 'SENDER_FORBIDDEN' });
    expect(sessionSet).not.toHaveBeenCalled();
    await handlerOf('ai/status')(state, offscreen);
    expect(sessionSet).toHaveBeenCalledWith({ 'aiRun.n1': state });
  });

  it('ai/submit은 200KB를 넘으면 거부, ai/prepare는 설정 공급자를 채워 offscreen에 전달', async () => {
    await expect(handlerOf('ai/submit')({ noticeId: 'n', runId: 'r', text: 'x'.repeat(AI_SUBMIT_MAX_CHARS + 1) }, dash)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    await expect(handlerOf('ai/submit')({ noticeId: 'n', runId: 'r', text: 'ok' }, tabSender)).rejects.toMatchObject({ code: 'SENDER_FORBIDDEN' });
    vi.mocked(send).mockResolvedValue({ runId: 'r' } as never);
    await handlerOf('ai/prepare')({ noticeId: 'n', scope: 'all' }, dash);
    expect(vi.mocked(send)).toHaveBeenLastCalledWith('ai/prepare', { noticeId: 'n', scope: 'all', provider: 'claude' }, expect.objectContaining({ target: 'offscreen' }));
    await expect(handlerOf('ai/prepare')({ noticeId: 'n', scope: 'all' }, tabSender)).rejects.toMatchObject({ code: 'SENDER_FORBIDDEN' });
  });

  it('ai/run·ai/prepare 릴레이가 scope와 keys를 그대로 전달한다', async () => {
    vi.mocked(send).mockResolvedValue({ runId: 'r1' } as never);
    await handlerOf('ai/run')({ noticeId: 'n', scope: 'keys', keys: ['credibilityScore'] }, dash);
    expect(vi.mocked(send)).toHaveBeenLastCalledWith('ai/exec', { noticeId: 'n', scope: 'keys', keys: ['credibilityScore'], provider: 'claude', api: { key: KEY, model: 'claude-sonnet-5-5', sendFullText: true } }, expect.anything());
    await handlerOf('ai/run')({ noticeId: 'n', scope: 'auto' }, dash);
    expect(vi.mocked(send).mock.calls.at(-1)![1]).toMatchObject({ scope: 'auto' });
    expect(vi.mocked(send).mock.calls.at(-1)![1]).not.toHaveProperty('keys');
    await handlerOf('ai/prepare')({ noticeId: 'n', scope: 'keys', keys: ['performancePeriod'] }, dash);
    expect(vi.mocked(send)).toHaveBeenLastCalledWith('ai/prepare', { noticeId: 'n', scope: 'keys', keys: ['performancePeriod'], provider: 'claude' }, expect.anything());
  });
});
