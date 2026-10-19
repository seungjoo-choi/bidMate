import type { NoticeTab } from '../route';
import { noticeHash } from '../route';

export function TabBar({ noticeId, tabs, active, query }: {
  noticeId: string;
  query?: Record<string, string>;
  tabs: Array<{ id: NoticeTab; label: string; count?: number }>;
  active: NoticeTab;
}) {
  return (
    <div role="tablist" className="flex gap-7 border-b border-line">
      {tabs.map((t) => (
        <a
          key={t.id}
          role="tab"
          href={noticeHash(noticeId, t.id, query)}
          aria-selected={active === t.id}
          className={`-mb-px border-b-2 pb-3 transition-colors motion-reduce:transition-none ${
            active === t.id ? 'border-ink font-semibold text-ink' : 'border-transparent font-medium text-muted hover:text-ink'
          }`}
        >
          {t.label}{t.count !== undefined && <span className="ml-1.5 font-mono text-sm font-normal text-faint tabular-nums">{t.count}</span>}
        </a>
      ))}
    </div>
  );
}
