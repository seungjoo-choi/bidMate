import type { NoticeTab } from '../route';
import { noticeHash } from '../route';

export function TabBar({ noticeId, tabs, active, query }: {
  noticeId: string;
  query?: Record<string, string>;
  tabs: Array<{ id: NoticeTab; label: string; count?: number }>;
  active: NoticeTab;
}) {
  return (
    // 밑줄 탭: 아래 구분선 위에 고른 탭만 본문색 굵은 글자+2px 밑줄
    <div role="tablist" className="flex max-w-full gap-7 overflow-x-auto shadow-[inset_0_-1px_0_var(--color-line)]">
      {tabs.map((t) => {
        const on = active === t.id;
        return (
          <a
            key={t.id}
            role="tab"
            href={noticeHash(noticeId, t.id, query)}
            aria-selected={on}
            className={`inline-flex shrink-0 items-center gap-1.5 border-b-2 pt-1 pb-2.5 text-sm whitespace-nowrap transition-colors motion-reduce:transition-none ${
              on ? 'border-ink font-bold text-ink' : 'border-transparent font-medium text-muted hover:text-ink'
            }`}
          >
            {t.label}
            {t.count !== undefined && (
              <span className="text-xs text-faint tabular-nums">{t.count}</span>
            )}
          </a>
        );
      })}
    </div>
  );
}
