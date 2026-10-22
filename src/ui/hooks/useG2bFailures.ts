import { useEffect, useState } from 'react';
import { G2B_FAILURES_KEY, type G2bFailure, type G2bFailureFile } from '../../core/diagnostics/g2b-failure';

const itemsOf = (v: unknown): G2bFailure[] => {
  const f = v as G2bFailureFile | undefined;
  return f && f.v === 1 && Array.isArray(f.items) ? f.items : [];
};

/** storage.local의 `g2bFailures` 키를 읽기만 한다(쓰기·지우기는 SW 메시지). 최신 먼저. */
export function useG2bFailures(): G2bFailure[] {
  const [items, setItems] = useState<G2bFailure[]>([]);

  useEffect(() => {
    let alive = true;
    void chrome.storage.local.get(G2B_FAILURES_KEY).then((r) => { if (alive) setItems(itemsOf(r[G2B_FAILURES_KEY])); });
    const onChanged = (c: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && G2B_FAILURES_KEY in c) setItems(itemsOf(c[G2B_FAILURES_KEY]?.newValue));
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => { alive = false; chrome.storage.onChanged.removeListener(onChanged); };
  }, []);

  return items;
}
