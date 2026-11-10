import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerProcessRelay } from '../../src/background/process-relay';

const RID = 'abcdefghijklmnopabcdefghijklmnop';
type MsgFn = (msg: unknown, sender: unknown, reply: (r: unknown) => void) => boolean;
const payload = { noticeId: 'R26BK01470335-000' };

describe('process-relay process/get', () => {
  const messageFns: MsgFn[] = [];
  beforeEach(() => {
    messageFns.length = 0;
    vi.stubGlobal('chrome', { runtime: { id: RID, onMessage: { addListener: (f: MsgFn) => { messageFns.push(f); } } } });
  });
  afterEach(() => { vi.unstubAllGlobals(); });
  const call = (sender: unknown, body: unknown = payload) => new Promise<{ ok: boolean; data?: unknown; error?: { code: string; message?: string } }>((res) => {
    for (const fn of messageFns) if (fn({ id: '1', type: 'process/get', payload: body, ts: 0, target: 'sw' }, sender, res as (r: unknown) => void)) break;
  });
  const dashboard = { id: RID, url: `chrome-extension://${RID}/dashboard.html` };

  it('확장 페이지가 아닌 발신자는 거부한다', async () => {
    const toOffscreen = vi.fn();
    registerProcessRelay({ getKey: async () => 'K', toOffscreen: toOffscreen as never });
    const r = await call({ id: RID, tab: { id: 1 }, url: 'https://www.g2b.go.kr/' });
    expect(r).toMatchObject({ ok: false, error: { code: 'SENDER_FORBIDDEN' } });
    expect(toOffscreen).not.toHaveBeenCalled();
  });

  it('서비스키가 없으면 serviceKey 빈 문자열로 offscreen에 전달한다', async () => {
    const toOffscreen = vi.fn(async () => ({ file: null, fromCache: false }));
    registerProcessRelay({ getKey: async () => undefined, toOffscreen: toOffscreen as never });
    expect((await call(dashboard, { ...payload, force: true })).ok).toBe(true);
    expect(toOffscreen).toHaveBeenCalledWith('process/fetch', { noticeId: 'R26BK01470335-000', force: true, serviceKey: '' }, 65_000);
  });

  it('offscreen 예외 메시지의 키를 마스킹한다', async () => {
    const toOffscreen = vi.fn(async () => { throw new Error('요청 실패 serviceKey=SECRETKEY123'); });
    registerProcessRelay({ getKey: async () => 'SECRETKEY123', toOffscreen: toOffscreen as never });
    const r = await call(dashboard);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain('SECRETKEY123');
  });
});
