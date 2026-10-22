import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerOrgRelay } from '../../src/background/org-relay';

const RID = 'abcdefghijklmnopabcdefghijklmnop';
type MsgFn = (msg: unknown, sender: unknown, reply: (r: unknown) => void) => boolean;
const payload = { orgCode: 'Z004560', kind: 'Servc', from: '202609220000', to: '202610222359' };

describe('org-relay org/probe', () => {
  const messageFns: MsgFn[] = [];
  beforeEach(() => {
    messageFns.length = 0;
    vi.stubGlobal('chrome', { runtime: { id: RID, onMessage: { addListener: (f: MsgFn) => { messageFns.push(f); } } } });
  });
  afterEach(() => { vi.unstubAllGlobals(); });
  const call = (sender: unknown, body: unknown = payload) => new Promise<{ ok: boolean; data?: unknown; error?: { code: string } }>((res) => {
    for (const fn of messageFns) if (fn({ id: '1', type: 'org/probe', payload: body, ts: 0, target: 'sw' }, sender, res as (r: unknown) => void)) break;
  });
  const dashboard = { id: RID, url: `chrome-extension://${RID}/dashboard.html` };

  it('확장 페이지가 아닌 발신자는 거부한다', async () => {
    const toOffscreen = vi.fn();
    registerOrgRelay({ getKey: async () => 'K', toOffscreen: toOffscreen as never });
    const r = await call({ id: RID, tab: { id: 1 }, url: 'https://www.g2b.go.kr/' });
    expect(r).toMatchObject({ ok: false, error: { code: 'SENDER_FORBIDDEN' } });
    expect(toOffscreen).not.toHaveBeenCalled();
  });

  it('서비스키가 없으면 G2B_KEY_MISSING', async () => {
    const toOffscreen = vi.fn();
    registerOrgRelay({ getKey: async () => undefined, toOffscreen: toOffscreen as never });
    expect(await call(dashboard)).toMatchObject({ ok: false, error: { code: 'G2B_KEY_MISSING' } });
    expect(toOffscreen).not.toHaveBeenCalled();
  });

  it('시작이 종료보다 늦으면 ORG_BAD_REF', async () => {
    const toOffscreen = vi.fn();
    registerOrgRelay({ getKey: async () => 'K', toOffscreen: toOffscreen as never });
    expect(await call(dashboard, { ...payload, from: '202610222359', to: '202609220000' })).toMatchObject({ ok: false, error: { code: 'ORG_BAD_REF' } });
    expect(toOffscreen).not.toHaveBeenCalled();
  });

  it('키가 있으면 키를 주입해 offscreen으로 중계한다', async () => {
    const toOffscreen = vi.fn(async () => ({ notice: {}, award: {} }));
    registerOrgRelay({ getKey: async () => 'K', toOffscreen: toOffscreen as never });
    expect((await call(dashboard)).ok).toBe(true);
    expect(toOffscreen).toHaveBeenCalledWith('org/probe-run', expect.objectContaining({ orgCode: 'Z004560', serviceKey: 'K' }), 60_000);
  });
});
