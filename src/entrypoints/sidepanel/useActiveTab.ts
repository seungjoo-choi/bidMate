import { useCallback, useEffect, useState } from 'react';

export interface TabInfo { id: number; url: string; host: string; windowId: number }

function hostOf(url: string): string {
  try { return new URL(url).hostname; } catch { return ''; }
}

/** 마지막으로 포커스된 창의 활성 탭. 탭 전환/이동/로드 완료 때마다 갱신한다. */
export function useActiveTab(): { tab: TabInfo | null; refresh: () => Promise<void> } {
  const [tab, setTab] = useState<TabInfo | null>(null);

  const refresh = useCallback(async () => {
    const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    setTab(t?.id && t.url ? { id: t.id, url: t.url, host: hostOf(t.url), windowId: t.windowId } : null);
  }, []);

  useEffect(() => {
    void refresh();
    const onActivated = () => void refresh();
    const onUpdated = (_id: number, change: chrome.tabs.OnUpdatedInfo) => { if (change.url || change.status === 'complete') void refresh(); };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.windows.onFocusChanged.addListener(onActivated);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.windows.onFocusChanged.removeListener(onActivated);
    };
  }, [refresh]);

  return { tab, refresh };
}
