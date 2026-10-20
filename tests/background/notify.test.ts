import { describe, expect, it, vi } from 'vitest';
import { clipTitle, openNoticeFromNotification, showNotification, type NotifyDeps } from '../../src/background/notify';

function make(over: Partial<NotifyDeps> = {}) {
  const create = vi.fn(async () => 'id');
  const clear = vi.fn(async () => true);
  const openDashboard = vi.fn(async () => undefined);
  const d = {
    notifications: { create, clear } as unknown as NotifyDeps['notifications'],
    openDashboard,
    getURL: (p: string) => `chrome-extension://x/${p}`,
    ...over,
  } satisfies NotifyDeps;
  return { d, create, clear, openDashboard };
}

describe('showNotification', () => {
  it('create 인자가 정확히 일치한다', async () => {
    const { d, create } = make();
    await showNotification({ id: 'a:1', title: '제목', message: '본문' }, d);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith('a:1', { type: 'basic', iconUrl: 'chrome-extension://x/icon/128.png', title: '제목', message: '본문' });
  });

  it('create가 throw해도 resolve한다', async () => {
    const { d, create } = make();
    create.mockRejectedValueOnce(new Error('fail'));
    await expect(showNotification({ id: 'a', title: 't', message: 'm' }, d)).resolves.toBeUndefined();
  });
});

describe('openNoticeFromNotification', () => {
  it('encodeURIComponent된 해시로 열고 알림을 지운다', async () => {
    const { d, openDashboard, clear } = make();
    await openNoticeFromNotification('R26BK/1 000', 'nid', d);
    expect(openDashboard).toHaveBeenCalledWith(`#/notices/${encodeURIComponent('R26BK/1 000')}/overview`);
    expect(clear).toHaveBeenCalledWith('nid');
    expect(openDashboard.mock.invocationCallOrder[0]!).toBeLessThan(clear.mock.invocationCallOrder[0]!);
  });

  it('openDashboard가 throw여도 clear를 호출한다', async () => {
    const { d, openDashboard, clear } = make();
    openDashboard.mockRejectedValueOnce(new Error('fail'));
    await expect(openNoticeFromNotification('N1', 'nid', d)).resolves.toBeUndefined();
    expect(clear).toHaveBeenCalledWith('nid');
  });
});

describe('clipTitle', () => {
  it('60자는 그대로, 61자는 60자 + 말줄임표', () => {
    expect(clipTitle('가'.repeat(60))).toBe('가'.repeat(60));
    expect(clipTitle('가'.repeat(61))).toBe(`${'가'.repeat(60)}…`);
  });
});
