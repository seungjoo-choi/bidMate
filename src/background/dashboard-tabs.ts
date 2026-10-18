interface DashboardTabDeps {
  tabs: Pick<typeof chrome.tabs, 'query' | 'update' | 'create' | 'get'>;
  windows: Pick<typeof chrome.windows, 'update' | 'getLastFocused'>;
  getURL: (path: string) => string;
}

let injected: Partial<DashboardTabDeps> = {};
/** 테스트용 의존성 주입. */
export function setDashboardTabDeps(d: Partial<DashboardTabDeps>): void {
  injected = d;
}
const deps = (): DashboardTabDeps => ({
  tabs: injected.tabs ?? chrome.tabs,
  windows: injected.windows ?? chrome.windows,
  getURL: injected.getURL ?? ((p) => chrome.runtime.getURL(p)),
});

/**
 * 대시보드를 hash로 연다. 열린 대시보드 탭이 있으면 재사용(#/grant 탭 제외, nearTabId와 같은 창 우선)하고,
 * 없으면 새 탭을 만든다. 성공하면 탭 id, chrome 오류는 삼키고 undefined.
 */
export async function openDashboard(hash: string, opts: { nearTabId?: number } = {}): Promise<number | undefined> {
  try {
    const d = deps();
    const base = d.getURL('dashboard.html');
    let nearWindowId: number | undefined;
    if (opts.nearTabId !== undefined) {
      try { nearWindowId = (await d.tabs.get(opts.nearTabId)).windowId; } catch { /* 탭이 닫혔으면 무시 */ }
    }
    const found = (await d.tabs.query({ url: `${base}*` })).filter((t) => t.id !== undefined && !(t.url ?? '').includes('#/grant'));
    const target = found.find((t) => nearWindowId !== undefined && t.windowId === nearWindowId) ?? found[0];
    const url = base + hash;
    if (target?.id !== undefined) {
      await d.tabs.update(target.id, { url, active: true });
      if (target.windowId !== undefined) await d.windows.update(target.windowId, { focused: true });
      return target.id;
    }
    let windowId = nearWindowId;
    if (windowId === undefined) {
      try { windowId = (await d.windows.getLastFocused()).id; } catch { /* 창 정보 없음 */ }
    }
    const created = await d.tabs.create({ url, active: true, ...(windowId !== undefined ? { windowId } : {}) });
    return created.id;
  } catch {
    return undefined;
  }
}
