import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/messaging/bus', async (orig) => ({ ...(await orig<typeof import('../../src/messaging/bus')>()), listen: vi.fn(), sendToTab: vi.fn() }));
vi.mock('../../src/background/job-coordinator', () => ({
  getJob: vi.fn(), setComposeTab: vi.fn(), isOffscreenSender: vi.fn(),
}));

vi.mock('../../src/background/site-registry', () => ({ getSettingsCache: vi.fn().mockResolvedValue(undefined) }));

import { registerComposeRelay } from '../../src/background/compose-relay';
import { getJob, isOffscreenSender } from '../../src/background/job-coordinator';
import { listen, sendToTab } from '../../src/messaging/bus';

type H = (payload: unknown, sender: unknown) => Promise<unknown>;
const handlerOf = (type: string): H => {
  const call = vi.mocked(listen).mock.calls.find((c) => c[0] === type && c[2] === 'sw');
  if (!call) throw new Error(`핸들러 없음: ${type}`);
  return call[1] as unknown as H;
};
const TYPES = ['compose/open', 'compose/detect', 'compose/bind', 'compose/focus', 'compose/abort', 'compose/fill',
  'compose/attach-begin', 'file/chunk', 'file/end', 'compose/attach-status', 'compose/verify'];
const sender = { id: 'x', url: 'chrome-extension://x/offscreen.html' };

describe('compose-relay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isOffscreenSender).mockReturnValue(true);
    vi.stubGlobal('chrome', { permissions: { contains: vi.fn().mockResolvedValue(false) } });
    registerComposeRelay();
  });

  it('11개 type을 sw에 등록한다', () => {
    const registered = vi.mocked(listen).mock.calls.filter((c) => c[2] === 'sw').map((c) => c[0] as string);
    for (const t of TYPES) expect(registered).toContain(t);
  });
  it('offscreen이 아닌 발신자는 모든 핸들러에서 SENDER_FORBIDDEN', async () => {
    vi.mocked(isOffscreenSender).mockReturnValue(false);
    for (const t of TYPES) await expect((async () => handlerOf(t)({ jobId: 'j' }, {}))()).rejects.toMatchObject({ code: 'SENDER_FORBIDDEN' });
  });
  it('open: 사이트 권한이 없으면 NEEDS_SITE_PERMISSION', async () => {
    await expect(handlerOf('compose/open')({ jobId: 'j', host: 'mail.worksmobile.com', selector: { selectorSetId: 's' } }, sender))
      .rejects.toMatchObject({ code: 'NEEDS_SITE_PERMISSION' });
  });
  it('open: 탭 생성 후 주입이 실패해도 tabId를 반환한다', async () => {
    vi.stubGlobal('chrome', {
      permissions: { contains: vi.fn().mockResolvedValue(true) },
      windows: { getLastFocused: vi.fn().mockResolvedValue({ id: 1 }) },
      tabs: {
        create: vi.fn().mockResolvedValue({ id: 9 }),
        onUpdated: {
          addListener: vi.fn((fn: (id: number, info: { status?: string }) => void) => { fn(9, { status: 'complete' }); }),
          removeListener: vi.fn(),
        },
      },
      scripting: { executeScript: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    await expect(handlerOf('compose/open')({ jobId: 'j', host: 'mail.worksmobile.com', selector: { selectorSetId: 's' } }, sender))
      .resolves.toEqual({ tabId: 9 });
  });
  it('릴레이: ledger에 탭이 없으면 COMPOSE_TAB_CLOSED', async () => {
    vi.mocked(getJob).mockResolvedValue({ id: 'j' } as never);
    await expect(handlerOf('compose/fill')({ jobId: 'j' }, sender)).rejects.toMatchObject({ code: 'COMPOSE_TAB_CLOSED' });
    expect(sendToTab).not.toHaveBeenCalled();
  });
  it('릴레이: sendToTab에 frameId를 전달하고, 수신자 없음은 COMPOSE_CS_UNREACHABLE', async () => {
    vi.mocked(getJob).mockResolvedValue({ id: 'j', composeTabId: 4, composeFrameId: 2 } as never);
    vi.mocked(sendToTab).mockResolvedValueOnce([] as never);
    await handlerOf('compose/fill')({ jobId: 'j' }, sender);
    expect(vi.mocked(sendToTab).mock.calls[0]?.[0]).toBe(4);
    expect(vi.mocked(sendToTab).mock.calls[0]?.[1]).toBe('compose/fill');
    expect(vi.mocked(sendToTab).mock.calls[0]?.[3]).toMatchObject({ frameId: 2 });
    vi.mocked(sendToTab).mockRejectedValueOnce(new Error('Could not establish connection. Receiving end does not exist.'));
    await expect(handlerOf('compose/verify')({ jobId: 'j' }, sender)).rejects.toMatchObject({ code: 'COMPOSE_CS_UNREACHABLE' });
  });
});

describe('sendToTab', () => {
  it('frameId 지정 시 sendMessage 3번째 인자로 전달하고, 미지정이면 기존 호출과 동일', async () => {
    const { sendToTab: real } = await vi.importActual<typeof import('../../src/messaging/bus')>('../../src/messaging/bus');
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, data: 1 });
    vi.stubGlobal('chrome', { tabs: { sendMessage } });
    await real(1, 'compose/verify', { jobId: 'j' }, { frameId: 3 });
    expect(sendMessage.mock.calls[0]?.[2]).toEqual({ frameId: 3 });
    await real(1, 'compose/verify', { jobId: 'j' });
    expect(sendMessage.mock.calls[1]).toHaveLength(2);
  });
});
