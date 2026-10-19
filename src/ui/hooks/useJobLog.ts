import { useEffect, useState } from 'react';
import type { JobLog } from '../../core/types/job';

/** storage.session의 `jobLog.<jobId>` 한 키만 구독한다. */
export function useJobLog(jobId: string | null): JobLog | null {
  const [log, setLog] = useState<JobLog | null>(null);

  useEffect(() => {
    setLog(null); // 잡이 바뀌면 이전 잡의 기록을 바로 지운다
    if (!jobId) return;
    const key = `jobLog.${jobId}`;
    let alive = true;
    void chrome.storage.session.get(key).then((r) => { if (alive) setLog((r[key] as JobLog | undefined) ?? null); });
    const onChanged = (c: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'session' && key in c) setLog((c[key]?.newValue as JobLog | undefined) ?? null);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => { alive = false; chrome.storage.onChanged.removeListener(onChanged); };
  }, [jobId]);

  return log;
}
