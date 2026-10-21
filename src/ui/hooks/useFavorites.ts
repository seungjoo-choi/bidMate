import { useCallback, useEffect, useState } from 'react';

/** chrome.storage.local 키. 즐겨찾기한 공고 ID 목록(알림 없는 표시용, 팔로우와 별개). */
const STORAGE_KEY = 'favoriteNotices';

async function read(): Promise<string[]> {
  try {
    const got = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
    return Array.isArray(got) ? got.filter((id): id is string => typeof id === 'string') : [];
  } catch { return []; }
}

/** 즐겨찾기 공고 집합과 토글. 다른 탭에서 바꿔도 storage 변경으로 따라간다. */
export function useFavorites() {
  const [ids, setIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    let alive = true;
    void read().then((xs) => { if (alive) setIds(new Set(xs)); });
    const onChanged = (c: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && c[STORAGE_KEY]) void read().then((xs) => { if (alive) setIds(new Set(xs)); });
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => { alive = false; chrome.storage.onChanged.removeListener(onChanged); };
  }, []);

  /** 켜고 끈다. 저장 직전에 다시 읽어 다른 탭의 변경을 덮어쓰지 않는다. 실패하면 false. */
  const toggle = useCallback(async (noticeId: string): Promise<boolean> => {
    const cur = new Set(await read());
    if (cur.has(noticeId)) cur.delete(noticeId); else cur.add(noticeId);
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: [...cur] });
      setIds(cur);
      return true;
    } catch { return false; }
  }, []);

  return { ids, has: (id: string) => ids.has(id), toggle };
}
