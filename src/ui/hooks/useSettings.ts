import { useCallback, useEffect, useState } from 'react';
import { withDefaults } from '../../core/model/default-settings';
import type { Settings } from '../../core/types/settings';

/** chrome.storage.local.settingsCache를 구독한다. 저장 시 updatedAt을 갱신한다. */
export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [stored, setStored] = useState(false);

  useEffect(() => {
    const load = async () => {
      const { settingsCache } = await chrome.storage.local.get('settingsCache');
      setStored(settingsCache !== undefined);
      setSettings(withDefaults(settingsCache as Settings | undefined));
    };
    void load();
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes.settingsCache) void load();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  const save = useCallback(async (next: Settings) => {
    const withTs = { ...next, updatedAt: new Date().toISOString() };
    await chrome.storage.local.set({ settingsCache: withTs });
    setSettings(withTs);
    setStored(true);
  }, []);

  return { settings, stored, save };
}
