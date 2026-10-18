import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDashboard, setDashboardTabDeps } from '../../src/background/dashboard-tabs';

const BASE = 'chrome-extension://ext/dashboard.html';
const tabs = { query: vi.fn(), update: vi.fn(), create: vi.fn(), get: vi.fn() };
const windows = { update: vi.fn(), getLastFocused: vi.fn() };

beforeEach(() => {
  for (const f of [...Object.values(tabs), ...Object.values(windows)]) f.mockReset();
  tabs.query.mockResolvedValue([]);
  tabs.update.mockResolvedValue({});
  tabs.create.mockResolvedValue({ id: 50 });
  tabs.get.mockResolvedValue({ windowId: 2 });
  windows.update.mockResolvedValue({});
  windows.getLastFocused.mockResolvedValue({ id: 7 });
  setDashboardTabDeps({ tabs: tabs as never, windows: windows as never, getURL: (p) => `chrome-extension://ext/${p}` });
});

describe('openDashboard', () => {
  it('열린 대시보드 탭을 재사용하고 같은 창을 우선한다', async () => {
    tabs.query.mockResolvedValue([{ id: 1, windowId: 1, url: `${BASE}#/home` }, { id: 2, windowId: 2, url: `${BASE}#/home` }]);
    expect(await openDashboard('#/mail/x', { nearTabId: 9 })).toBe(2);
    expect(tabs.query).toHaveBeenCalledWith({ url: `${BASE}*` });
    expect(tabs.update).toHaveBeenCalledWith(2, { url: `${BASE}#/mail/x`, active: true });
    expect(windows.update).toHaveBeenCalledWith(2, { focused: true });
    expect(tabs.create).not.toHaveBeenCalled();
  });
  it('#/grant 탭은 제외한다', async () => {
    tabs.query.mockResolvedValue([{ id: 1, windowId: 1, url: `${BASE}#/grant` }]);
    expect(await openDashboard('#/settings')).toBe(50);
    expect(tabs.update).not.toHaveBeenCalled();
  });
  it('없으면 nearTabId의 창에 만들고, nearTabId가 없으면 마지막 포커스 창에 만든다', async () => {
    await openDashboard('#/settings', { nearTabId: 9 });
    expect(tabs.create).toHaveBeenLastCalledWith({ url: `${BASE}#/settings`, active: true, windowId: 2 });
    await openDashboard('#/settings');
    expect(tabs.create).toHaveBeenLastCalledWith({ url: `${BASE}#/settings`, active: true, windowId: 7 });
  });
  it('chrome 오류는 삼키고 undefined', async () => {
    tabs.query.mockRejectedValue(new Error('x'));
    expect(await openDashboard('#/home')).toBeUndefined();
  });
});
