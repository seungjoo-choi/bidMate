import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/messaging/bus', async (orig) => ({ ...(await orig<typeof import('../../src/messaging/bus')>()), listen: vi.fn() }));
vi.mock('../../src/background/job-coordinator', () => ({ assertExtensionSender: vi.fn() }));
vi.mock('../../src/background/compose-relay', () => ({ waitComplete: vi.fn() }));

import { registerNaverworksContacts } from '../../src/background/naverworks-contacts';
import { waitComplete } from '../../src/background/compose-relay';
import { assertExtensionSender } from '../../src/background/job-coordinator';
import { listen } from '../../src/messaging/bus';

type H = (payload: unknown, sender: unknown) => Promise<{ domainId: string; users: unknown[]; totalCount: number; tabReused: boolean }>;
const handler = (): H => {
  const call = vi.mocked(listen).mock.calls.find((c) => c[0] === 'contacts/naverworks-fetch' && c[2] === 'sw');
  if (!call) throw new Error('핸들러 없음');
  return call[1] as unknown as H;
};
const OK = { ok: true, totalCount: 2, results: [{ id: 1 }, { id: 2 }], pages: 1 };
const URL_D = 'https://contact.worksmobile.com/p/web/domain/133918';

function setup(o: { permitted?: boolean; existing?: Array<{ id: number; url: string }>; getUrl?: string | string[]; exec?: unknown; execReject?: boolean } = {}) {
  const getUrls = Array.isArray(o.getUrl) ? [...o.getUrl] : [o.getUrl ?? URL_D];
  const tabs = {
    query: vi.fn().mockResolvedValue(o.existing ?? []),
    create: vi.fn().mockResolvedValue({ id: 7 }),
    get: vi.fn().mockImplementation(async () => ({ id: 7, url: getUrls.length > 1 ? getUrls.shift() : getUrls[0] })),
    update: vi.fn().mockResolvedValue({}),
    remove: vi.fn().mockResolvedValue(undefined),
  };
  const scripting = {
    executeScript: o.execReject ? vi.fn().mockRejectedValue(new Error('denied')) : vi.fn().mockResolvedValue([{ result: o.exec ?? OK }]),
  };
  const permissions = { contains: vi.fn().mockResolvedValue(o.permitted ?? true) };
  registerNaverworksContacts({ tabs, scripting, permissions } as never);
  return { tabs, scripting, permissions };
}

describe('naverworks-contacts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(waitComplete).mockResolvedValue(true);
  });

  it('권한이 없으면 NEEDS_SITE_PERMISSION', async () => {
    const m = setup({ permitted: false });
    await expect(handler()({}, {})).rejects.toMatchObject({ code: 'NEEDS_SITE_PERMISSION' });
    expect(m.permissions.contains).toHaveBeenCalledWith({ origins: ['https://contact.worksmobile.com/*'] });
    expect(m.tabs.query).not.toHaveBeenCalled();
  });
  it('기존 탭을 재사용하고 닫지 않는다', async () => {
    const m = setup({ existing: [{ id: 7, url: URL_D }] });
    const r = await handler()({}, {});
    expect(r).toMatchObject({ domainId: '133918', totalCount: 2, tabReused: true });
    expect(m.tabs.create).not.toHaveBeenCalled();
    expect(m.tabs.remove).not.toHaveBeenCalled();
    expect(m.scripting.executeScript).toHaveBeenCalledWith(expect.objectContaining({ target: { tabId: 7 }, args: ['133918', 100, 50] }));
  });
  it('탭을 생성해 성공하면 remove 한다', async () => {
    const m = setup();
    const r = await handler()({ domainId: '133918' }, {});
    expect(r.tabReused).toBe(false);
    expect(m.tabs.create).toHaveBeenCalledWith({ url: URL_D, active: false });
    expect(m.tabs.remove).toHaveBeenCalledWith(7);
  });
  it('로그인 페이지로 이동하면 NOT_LOGGED_IN, 탭을 활성화하고 닫지 않는다', async () => {
    const m = setup({ getUrl: 'https://auth.worksmobile.com/login' });
    await expect(handler()({}, {})).rejects.toMatchObject({ code: 'NW_NOT_LOGGED_IN' });
    expect(m.tabs.update).toHaveBeenCalledWith(7, { active: true });
    expect(m.tabs.remove).not.toHaveBeenCalled();
    expect(m.scripting.executeScript).not.toHaveBeenCalled();
  });
  it('payload domainId가 URL보다 우선한다', async () => {
    const m = setup({ existing: [{ id: 7, url: URL_D }] });
    const r = await handler()({ domainId: '999' }, {});
    expect(r.domainId).toBe('999');
    expect(m.scripting.executeScript).toHaveBeenCalledWith(expect.objectContaining({ args: ['999', 100, 50] }));
  });
  it('payload가 없으면 탭 URL에서 domainId를 추출한다', async () => {
    setup({ existing: [{ id: 7, url: URL_D }] });
    expect((await handler()({}, {})).domainId).toBe('133918');
  });
  it('domainId 없을 때 URL에 domainId가 있는 두 번째 탭을 고른다', async () => {
    const m = setup({ existing: [{ id: 5, url: 'https://contact.worksmobile.com/' }, { id: 7, url: URL_D }] });
    await handler()({}, {});
    expect(m.scripting.executeScript).toHaveBeenCalledWith(expect.objectContaining({ target: { tabId: 7 } }));
  });
  it('domainId를 못 찾으면 NW_NO_DOMAIN_ID, 생성 탭은 닫는다', async () => {
    vi.useFakeTimers();
    try {
      const m = setup({ getUrl: 'https://contact.worksmobile.com/' });
      const p = handler()({}, {});
      const assertion = expect(p).rejects.toMatchObject({ code: 'NW_NO_DOMAIN_ID' });
      await vi.advanceTimersByTimeAsync(6_000);
      await assertion;
      expect(m.tabs.remove).toHaveBeenCalledWith(7);
      expect(m.scripting.executeScript).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it('executeScript가 거부되면 NW_INJECT_FAILED, 생성 탭은 닫는다', async () => {
    const m = setup({ execReject: true });
    await expect(handler()({ domainId: '133918' }, {})).rejects.toMatchObject({ code: 'NW_INJECT_FAILED' });
    expect(m.tabs.remove).toHaveBeenCalledWith(7);
  });
  it('외부 sender는 거부한다', async () => {
    setup();
    vi.mocked(assertExtensionSender).mockImplementationOnce(() => { throw Object.assign(new Error('x'), { code: 'SENDER_FORBIDDEN' }); });
    await expect(Promise.resolve().then(() => handler()({}, { id: 'evil' }))).rejects.toMatchObject({ code: 'SENDER_FORBIDDEN' });
  });
});
