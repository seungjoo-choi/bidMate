import type { NoticeTab } from '../route';
import { noticeHash } from '../route';

export function TabBar({ noticeId, tabs, active, query }: {
  noticeId: string;
  query?: Record<string, string>;
  tabs: Array<{ id: NoticeTab; label: string; count?: number }>;
  active: NoticeTab;
}) {
  return (
    <div role="tablist" className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-ctl border border-line bg-sunken p-1">
      {tabs.map((t) => {
        const on = active === t.id;
        return (
          <a
            key={t.id}
            role="tab"
            href={noticeHash(noticeId, t.id, query)}
            aria-selected={on}
            className={`inline-flex shrink-0 items-center gap-2 rounded-btn px-4 py-2 text-sm whitespace-nowrap transition-colors motion-reduce:transition-none ${
              on ? 'bg-ink font-bold text-surface shadow-sm' : 'font-medium text-muted hover:bg-surface hover:text-ink'
            }`}
          >
            {t.label}
            {t.count !== undefined && (
              <span className={`min-w-5 rounded-full px-1.5 text-center font-mono text-xs tabular-nums ${on ? 'bg-surface/20 text-surface' : 'bg-surface text-faint'}`}>{t.count}</span>
            )}
          </a>
        );
      })}
    </div>
  );
}
