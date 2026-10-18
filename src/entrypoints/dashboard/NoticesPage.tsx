import { Inbox, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CollectStatus } from '../../core/types/notice';
import type { ExtractionStatus } from '../../core/types/extraction';
import type { IndexEntry } from '../../core/types/index-file';
import { send } from '../../messaging/bus';
import { FsErrorAlert } from './FsErrorAlert';
import { Button, StatusBadge } from '../../ui/components';
import type { BadgeStatus } from '../../ui/components';
import { inputClass } from '../../ui/components/Field';
import { dDayLevel, formatDDay, formatDate, formatDateTime, isDueSoon, isPast } from '../../ui/review/format';

type Filter = 'all' | 'review' | 'due';
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: '전체' }, { id: 'review', label: '확인 필요' }, { id: 'due', label: '마감 임박' },
];

const COLLECT_BADGE: Record<CollectStatus, { tone: BadgeStatus; text: string }> = {
  collected: { tone: 'ok', text: '수집 완료' }, partial: { tone: 'warn', text: '일부 누락' }, failed: { tone: 'error', text: '수집 실패' },
};
const EXTRACT_BADGE: Record<ExtractionStatus, { tone: BadgeStatus; text: string }> = {
  verified: { tone: 'ok', text: '확인 완료' }, needs_review: { tone: 'warn', text: '확인 필요' },
  unsupported: { tone: 'idle', text: '분석 불가' }, failed: { tone: 'error', text: '추출 실패' }, not_run: { tone: 'idle', text: '미분석' },
};

const GRID = 'grid grid-cols-[minmax(0,1fr)_180px_110px_110px_64px] items-center gap-6 px-5';

export function NoticesPage() {
  const [list, setList] = useState<IndexEntry[] | null>(null);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    try {
      setList(await send('notice/list', undefined));
      setError(null);
    } catch (e) {
      setError({ code: (e as { code?: string }).code, message: e instanceof Error ? e.message : String(e) });
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => {
    const now = new Date();
    const all = list ?? [];
    return {
      all: all.length,
      review: all.filter((n) => n.extractionStatus === 'needs_review').length,
      due: all.filter((n) => isDueSoon(n.bidCloseAt, now)).length,
    };
  }, [list]);

  const rows = useMemo(() => {
    const now = new Date();
    const q = query.trim().toLowerCase();
    return (list ?? [])
      .filter((n) => filter === 'all' || (filter === 'review' ? n.extractionStatus === 'needs_review' : isDueSoon(n.bidCloseAt, now)))
      .filter((n) => !q || `${n.title} ${n.noticeNo} ${n.orderingOrg}`.toLowerCase().includes(q))
      .sort((a, b) => b.collectedAt.localeCompare(a.collectedAt));
  }, [list, filter, query]);

  const open = (id: string) => { location.hash = `#/review/${encodeURIComponent(id)}`; };
  const now = new Date();

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <h1 className="title-mark text-2xl font-bold tracking-tight">공고</h1>
        {list && list.length > 0 && (
          <div className="relative w-80">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
            <input className={`${inputClass} pl-9`} placeholder="공고명, 번호, 기관 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        )}
      </div>
      <FsErrorAlert error={error} onRetry={load} />

      {list && list.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-line-strong py-20 text-center text-muted">
          <Inbox className="size-9 text-faint" strokeWidth={1.5} />
          <p className="font-semibold text-ink">아직 수집한 공고가 없습니다</p>
          <p className="text-sm">나라장터 공고 화면에서 [공고 수집]을 누르면 여기에 쌓입니다.</p>
        </div>
      )}

      {list && list.length > 0 && (
        <>
          <div role="tablist" className="flex gap-7 border-b border-line">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                role="tab"
                aria-selected={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={`-mb-px border-b-2 pb-3 transition-colors motion-reduce:transition-none ${
                  filter === f.id ? 'border-ink font-semibold text-ink' : 'border-transparent font-medium text-muted hover:text-ink'
                }`}
              >
                {f.label}<span className="ml-1.5 font-mono text-sm font-normal text-faint tabular-nums">{counts[f.id]}</span>
              </button>
            ))}
          </div>
          <div className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
            <div className={`${GRID} bg-sunken py-3 text-sm text-muted`}>
              <div>공고명</div><div>입찰마감</div><div>수집</div><div>평가정보</div><div>수집일</div>
            </div>
            {rows.length === 0 && <div className="border-t border-line px-4 py-10 text-center text-muted">조건에 맞는 공고가 없습니다.</div>}
            {rows.map((n) => {
              const past = isPast(n.bidCloseAt, now);
              const dday = formatDDay(n.bidCloseAt, now);
              const level = dDayLevel(dday);
              const ddayTone = past ? 'font-medium' : level === 'urgent' ? 'text-danger' : level === 'soon' ? 'text-warn' : 'font-medium text-muted';
              const cb = COLLECT_BADGE[n.collectStatus];
              const eb = EXTRACT_BADGE[n.extractionStatus ?? 'not_run'] ?? EXTRACT_BADGE.not_run;
              return (
                <div
                  key={n.noticeId}
                  role="link"
                  tabIndex={0}
                  onClick={() => open(n.noticeId)}
                  onKeyDown={(e) => { if (e.key === 'Enter') open(n.noticeId); }}
                  className={`${GRID} cursor-pointer border-t border-line py-4 transition-colors hover:bg-sunken motion-reduce:transition-none ${past ? 'text-faint' : ''}`}
                >
                  <div className="min-w-0">
                    <div className="truncate text-base font-semibold">{n.title}</div>
                    <div className={`mt-0.5 truncate text-sm ${past ? '' : 'text-muted'}`}>
                      <span className="font-mono">{n.noticeNo}-{n.round}</span>, {n.orderingOrg}
                    </div>
                  </div>
                  <div className="flex items-baseline gap-2.5 font-mono text-sm tabular-nums">
                    {dday && (
                      <span className={`min-w-11 font-bold ${ddayTone}`}>{dday}</span>
                    )}
                    <span className={past ? '' : 'text-muted'}>{formatDateTime(n.bidCloseAt)}</span>
                  </div>
                  <div><StatusBadge status={cb.tone}>{cb.text}</StatusBadge></div>
                  <div><StatusBadge status={eb.tone}>{eb.text}</StatusBadge></div>
                  <div className={`font-mono text-sm tabular-nums ${past ? '' : 'text-muted'}`}>{formatDate(n.collectedAt)}</div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
