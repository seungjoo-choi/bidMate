import { useEffect, useState } from 'react';
import type { Job } from '../../core/types/job';

/** storage.session의 `jobs.<id>`를 구독해 최신순으로 반환한다. */
export function useJobs(): Job[] {
  const [jobs, setJobs] = useState<Job[]>([]);

  useEffect(() => {
    const load = async () => {
      const ids = ((await chrome.storage.session.get('jobIds')).jobIds as string[] | undefined) ?? [];
      const got = await chrome.storage.session.get(ids.map((id) => `jobs.${id}`));
      const list = ids
        .map((id) => got[`jobs.${id}`] as Job | undefined)
        .filter((j): j is Job => !!j)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setJobs(list);
    };
    void load();
    const onChanged = (c: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'session' && Object.keys(c).some((k) => k === 'jobIds' || k.startsWith('jobs.'))) void load();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  return jobs;
}
