import { useCallback, useEffect, useMemo, useState } from 'react';
import type { IndexEntry } from '../../core/types/index-file';
import { computeHomeStats } from '../../core/dashboard/stats';
import { send } from '../../messaging/bus';
import { FsErrorAlert } from './FsErrorAlert';
import { noticeHash } from './route';
import { kindOf, noticeLabel } from '../../core/model/ids';
import { Card, EmptyState, StatusBadge } from '../../ui/components';
import { dDayLevel, formatDDay, formatDate } from '../../ui/review/format';
import { StatCard } from './home/StatCard';
import { MonthlyBars } from './home/MonthlyBars';
import { PageTitle } from './menu';

const open = (id: string) => { location.hash = noticeHash(id); };

function Row({ n, right }: { n: IndexEntry; right: React.ReactNode }) {
  return (
    <div
      role="link"
      tabIndex={0}
      onClick={() => open(n.noticeId)}
      onKeyDown={(e) => { if (e.key === 'Enter') open(n.noticeId); }}
      className="flex cursor-pointer items-center gap-4 border-t border-line py-3 transition-colors first:border-t-0 hover:bg-sunken motion-reduce:transition-none"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-semibold">{n.title}</div>
        <div className="mt-0.5 truncate text-sm text-muted">
          <span className="font-mono">{noticeLabel(n)}</span>, {n.orderingOrg}
          {kindOf(n) === 'prespec' &&<span className="ml-2 align-middle"><StatusBadge status="idle">사전규격</StatusBadge></span>}
        </div>
      </div>
      {right}
    </div>
  );
}

export function HomePage() {
  const [list, setList] = useState<IndexEntry[] | null>(null);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await send('notice/list', undefined));
      setError(null);
    } catch (e) {
      setError({ code: (e as { code?: string }).code, message: e instanceof Error ? e.message : String(e) });
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const now = useMemo(() => new Date(), [list]);
  const stats = useMemo(() => (list ? computeHomeStats(list, now) : null), [list, now]);

  return (
    <div className="space-y-6">
      <PageTitle page="home" />
      <FsErrorAlert error={error} onRetry={load} />
      {!list && !error && <p className="text-muted">불러오는 중...</p>}

      {list && list.length === 0 && (
        <EmptyState title="아직 수집한 공고가 없습니다" hint="나라장터 공고 화면에서 [공고 수집]을 누르면 여기에 쌓입니다." />
      )}

      {stats && list && list.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <StatCard label="전체 공고" value={stats.total} />
            <StatCard label="최근 수집 7일" value={stats.recent.count} />
            <StatCard label="메일 작성 대기" value={stats.mailPending.count} tone={stats.mailPending.count > 0 ? 'warn' : 'default'} />
            <StatCard
              label="수집 실패"
              value={stats.collectFailed.failed}
              tone={stats.collectFailed.failed > 0 ? 'danger' : 'default'}
              sub={stats.collectFailed.partial > 0 ? `일부 누락 ${stats.collectFailed.partial}건` : undefined}
            />
            <StatCard label="입찰마감 예정 7일" value={stats.dueSoon.count} tone={stats.dueSoon.count > 0 ? 'warn' : 'default'} />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card title="마감 예정">
              {stats.dueSoon.items.length === 0 && <EmptyState size="sm" title="7일 안에 마감되는 공고가 없습니다." />}
              <div>
                {stats.dueSoon.items.map((n) => {
                  const dday = formatDDay(n.bidCloseAt, now);
                  const level = dDayLevel(dday);
                  const tone = level === 'urgent' ? 'text-danger' : level === 'soon' ? 'text-warn' : 'text-muted';
                  return <Row key={n.noticeId} n={n} right={<span className={`min-w-11 font-mono text-sm font-bold tabular-nums ${tone}`}>{dday}</span>} />;
                })}
              </div>
            </Card>
            <Card title="최근 수집">
              {stats.recent.items.length === 0 && <EmptyState size="sm" title="최근 7일 안에 수집한 공고가 없습니다." />}
              <div>
                {stats.recent.items.map((n) => (
                  <Row key={n.noticeId} n={n} right={<span className="font-mono text-sm text-muted tabular-nums">{formatDate(n.collectedAt)}</span>} />
                ))}
              </div>
            </Card>
          </div>

          <Card title="월별 수집" description="최근 6개월, 막대에 마우스를 올리면 세부 숫자">
            <MonthlyBars monthly={stats.monthly} />
          </Card>
        </>
      )}
    </div>
  );
}
