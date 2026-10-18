import { useEffect, useState } from 'react';
import type { Job } from '../../core/types/job';

/** storage.session의 `jobs.<id>`를 구독해 최신순으로 반환한다. */
export function useJobs(): Job[] {
  const [jobs, setJobs] = useState<Job[]>([]);

  useEffect(() => {
    const load = async () => {
      const all = await chrome.storage.session.get(null);
      const list = Object.entries(all)
        .filter(([k]) => k.startsWith('jobs.'))
        .map(([, v]) => v as Job)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setJobs(list);
    };
    void load();
    const onChanged = (_c: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'session') void load();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  return jobs;
}
