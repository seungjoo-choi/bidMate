import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, ChevronRight, Files, Inbox, MailPlus, TriangleAlert } from 'lucide-react';
import type { IndexEntry } from '../../core/types/index-file';
import { computeHomeStats } from '../../core/dashboard/stats';
import { scheduleBoard } from '../../core/dashboard/schedule-board';
import { send } from '../../messaging/bus';
import { FsErrorAlert } from './FsErrorAlert';
import { noticeHash } from './route';
import { kindOf, noticeLabel } from '../../core/model/ids';
import { Card, EmptyState, StatusBadge } from '../../ui/components';
import { formatDate } from '../../ui/review/format';
import { StatCard } from './home/StatCard';
import { MonthlyBars } from './home/MonthlyBars';
import { ScheduleBoard } from './home/ScheduleBoard';
import { ResultSummaryStrip } from './stats/ResultSummaryStrip';
import { PageTitle } from './menu';

const open = (id: string) => { location.hash = noticeHash(id); };

function Row({ n, right }: { n: IndexEntry; right: React.ReactNode }) {
  return (
    <li
      role="link"
      tabIndex={0}
      onClick={() => open(n.noticeId)}
      onKeyDown={(e) => { if (e.key === 'Enter') open(n.noticeId); }}
      className="flex cursor-pointer items-center gap-4 border-t border-line px-6 py-3 transition-colors first:border-t-0 hover:bg-sunken motion-reduce:transition-none"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-semibold">{n.title}</div>
        <div className="mt-0.5 flex items-center gap-2 text-sm text-muted">
          <span className="truncate"><span className="font-mono">{noticeLabel(n)}</span>, {n.orderingOrg}</span>
          {kindOf(n) === 'prespec' && <span className="shrink-0"><StatusBadge status="idle">사전규격</StatusBadge></span>}
        </div>
      </div>
      {right}
    </li>
  );
}

/** 카드 오른쪽 위 "전체 보기" 링크 */
function MoreLink({ href }: { href: string }) {
  return (
    <a href={href} className="inline-flex items-center gap-0.5 rounded-ctl text-sm font-medium text-muted transition-colors hover:text-ink">
      전체 보기
      <ChevronRight className="size-4" aria-hidden />
    </a>
  );
}

export function HomePage() {
  const [list, setList] = useState<IndexEntry[] | null>(null);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await send('notice/list', undefined));
      void send('deadline/refresh', { reason: 'list' }).catch(() => undefined);
      setError(null);
    } catch (e) {
      setError({ code: (e as { code?: string }).code, message: e instanceof Error ? e.message : String(e) });
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const now = useMemo(() => new Date(), [list]);
  const stats = useMemo(() => (list ? computeHomeStats(list, now) : null), [list, now]);
  const board = useMemo(() => (list ? scheduleBoard(list, now) : []), [list, now]);

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
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
            <StatCard icon={Files} label="전체 공고" value={stats.total} sub="수집한 공고 전체" />
            <StatCard icon={Inbox} label="최근 수집" value={stats.recent.count} sub="지난 7일" />
            <StatCard
              icon={MailPlus}
              label="메일 작성 대기"
              value={stats.mailPending.count}
              tone={stats.mailPending.count > 0 ? 'warn' : 'default'}
              sub="작성 전, 작성 중"
            />
            <StatCard
              icon={TriangleAlert}
              label="수집 실패"
              value={stats.collectFailed.failed}
              tone={stats.collectFailed.failed > 0 ? 'danger' : 'default'}
              sub={stats.collectFailed.partial > 0 ? `일부 누락 ${stats.collectFailed.partial}건` : '실패 없음'}
            />
            <StatCard
              icon={CalendarClock}
              label="입찰마감 임박"
              value={stats.dueSoon.count}
              tone={stats.dueSoon.count > 0 ? 'warn' : 'default'}
              sub="7일 안에 마감"
            />
          </div>
          <ResultSummaryStrip list={list} />

          <Card title="마감 일정" description="14일 안의 일정. 종 표시는 마감 알림 대상(메일 전달 완료 또는 팔로우)" action={<MoreLink href="#/notices" />}>
            <ScheduleBoard rows={board} now={now} />
          </Card>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
            <div className="xl:col-span-3 [&>section]:h-full">
              <Card title="최근 수집" description="지난 7일 동안 수집한 공고" action={<MoreLink href="#/notices" />}>
                {stats.recent.items.length === 0
                  ? <EmptyState size="sm" title="최근 7일 안에 수집한 공고가 없습니다." />
                  : (
                    <ul className="-mx-6 -my-5">
                      {stats.recent.items.map((n) => (
                        <Row key={n.noticeId} n={n} right={<span className="shrink-0 font-mono text-sm text-muted tabular-nums">{formatDate(n.collectedAt)}</span>} />
                      ))}
                    </ul>
                  )}
              </Card>
            </div>
            <div className="xl:col-span-2 [&>section]:h-full">
              <Card title="월별 수집" description="최근 6개월, 막대에 마우스를 올리면 세부 숫자">
                <MonthlyBars monthly={stats.monthly} />
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
