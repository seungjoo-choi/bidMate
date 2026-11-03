import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BusError, isOffscreenAllowedSender, listen, send, toErrorReply } from '../../src/messaging/bus';

const RID = 'abcdefghijklmnop';
const SW_SENDER = { id: RID, url: `chrome-extension://${RID}/background.js` };
const TAB_SENDER = { id: RID, url: 'https://www.g2b.go.kr/', tab: { id: 3 } };

describe('isOffscreenAllowedSender', () => {
  it('같은 확장 id이고 탭이 없으면 허용한다', () => {
    expect(isOffscreenAllowedSender({ id: RID }, RID)).toBe(true);
  });
  it('탭에서 보낸 메시지는 거부한다', () => {
    expect(isOffscreenAllowedSender({ id: RID, tab: { id: 1 } as chrome.tabs.Tab }, RID)).toBe(false);
  });
  it('다른 확장 id는 거부한다', () => {
    expect(isOffscreenAllowedSender({ id: 'other' }, RID)).toBe(false);
  });
  it('발신자 id가 없으면 거부한다', () => {
    expect(isOffscreenAllowedSender({}, RID)).toBe(false);
  });
  it('runtimeId를 알 수 없으면 거부한다', () => {
    expect(isOffscreenAllowedSender({ id: RID }, undefined)).toBe(false);
  });
});

describe('listen offscreen target', () => {
  const addListener = vi.fn();
  type Fn = (env: unknown, sender: unknown, sendResponse: (r: unknown) => void) => boolean;
  const env = (type: string, target: string, payload: unknown = { file: 'recipients' }) => ({ id: 'x', type, payload, ts: 0, target });
  const getFn = () => addListener.mock.calls[0]![0] as Fn;
  const tick = () => new Promise((r) => setTimeout(r, 0));

  beforeEach(() => {
    addListener.mockReset();
    vi.stubGlobal('chrome', { runtime: { id: RID, onMessage: { addListener, removeListener: vi.fn() } } });
  });

  it('SW 발신은 허용하고 핸들러 결과를 응답한다', async () => {
    const handler = vi.fn().mockResolvedValue({ done: true });
    listen('config/repair' as never, handler, 'offscreen');
    const sendResponse = vi.fn();
    expect(getFn()(env('config/repair', 'offscreen'), SW_SENDER, sendResponse)).toBe(true);
    await tick();
    expect(handler).toHaveBeenCalledWith({ file: 'recipients' }, SW_SENDER);
    expect(sendResponse).toHaveBeenCalledWith({ ok: true, data: { done: true } });
  });

  it.each([
    ['탭 발신', TAB_SENDER],
    ['다른 확장 id', { id: 'other' }],
    ['대시보드 탭 직접 발신', { id: RID, url: `chrome-extension://${RID}/dashboard.html`, tab: { id: 5 } }],
  ])('%s는 SENDER_FORBIDDEN으로 거부한다', (_n, sender) => {
    const handler = vi.fn();
    listen('config/repair' as never, handler, 'offscreen');
    const sendResponse = vi.fn();
    expect(getFn()(env('config/repair', 'offscreen'), sender, sendResponse)).toBe(true);
    expect(handler).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: { code: 'SENDER_FORBIDDEN', message: expect.any(String) } });
  });

  it('type이 다르면 처리하지 않는다', () => {
    listen('config/repair' as never, vi.fn(), 'offscreen');
    const sendResponse = vi.fn();
    expect(getFn()(env('notice/list', 'offscreen'), SW_SENDER, sendResponse)).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it('target이 다르면 처리하지 않는다', () => {
    listen('config/repair' as never, vi.fn(), 'offscreen');
    const sendResponse = vi.fn();
    expect(getFn()(env('config/repair', 'sw'), SW_SENDER, sendResponse)).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it('sw target은 발신자 검사를 하지 않는다', async () => {
    const handler = vi.fn().mockResolvedValue({ found: false });
    listen('notice/lookup' as never, handler, 'sw');
    const sendResponse = vi.fn();
    getFn()(env('notice/lookup', 'sw'), TAB_SENDER, sendResponse);
    await tick();
    expect(handler).toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ ok: true, data: { found: false } });
  });

  it('핸들러 오류의 code와 path를 응답에 보존한다', async () => {
    const handler = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { code: 'CONFIG_CORRUPT', path: 'config/recipients.json' }));
    listen('config/repair' as never, handler, 'offscreen');
    const sendResponse = vi.fn();
    getFn()(env('config/repair', 'offscreen'), SW_SENDER, sendResponse);
    await tick();
    expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: { code: 'CONFIG_CORRUPT', message: 'x', path: 'config/recipients.json' } });
  });
});

describe('toErrorReply detail', () => {
  it('평범한 객체 detail은 포함한다', () => {
    expect(toErrorReply(new BusError('C', 'm', undefined, { step: 1 }))).toEqual({ ok: false, error: { code: 'C', message: 'm', detail: { step: 1 } } });
  });
  it.each([
    ['배열', [1]],
    ['문자열', 'x'],
    ['2KB 초과', { a: 'x'.repeat(2001) }],
  ])('%s detail은 키 자체가 없다', (_n, detail) => {
    const r = toErrorReply(new BusError('C', 'm', undefined, detail as never));
    expect(r).toEqual({ ok: false, error: { code: 'C', message: 'm' } });
    expect('detail' in (r as { error: object }).error).toBe(false);
  });
  it('send가 detail을 BusError.detail로 복원한다', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'u' });
    vi.stubGlobal('chrome', { runtime: { id: RID, sendMessage: vi.fn().mockResolvedValue({ ok: false, error: { code: 'C', message: 'm', detail: { step: 2 } } }) } });
    await expect(send('diag/g2b-failures-clear', undefined)).rejects.toMatchObject({ code: 'C', detail: { step: 2 } });
  });
});
