import type { IndexEntry } from '../../../core/types/index-file';
import type { Notice } from '../../../core/types/notice';
import { Card } from '../../../ui/components';
import { overviewGroups, overviewStats, scheduleTimeline } from '../../../ui/notice-detail/view';
import { DetailList, StatStrip, Timeline } from './parts';

export function OverviewTab({ notice, index }: { notice: Notice; index: IndexEntry[] }) {
  const groups = overviewGroups(notice, index);
  const schedule = groups.find((g) => g.id === 'schedule');
  const paired = groups.filter((g) => g.id === 'overview' || g.id === 'money');
  const wide = groups.filter((g) => g.id !== 'schedule' && g.id !== 'overview' && g.id !== 'money');
  const points = schedule ? scheduleTimeline(notice) : [];
  const period = notice.schedule.proposalPeriod.value;

  return (
    <div className="space-y-6">
      <StatStrip items={overviewStats(notice)} />

      {schedule && (
        <Card title="일정">
          {points.length > 0
            ? <Timeline points={points} />
            : <p className="text-sm text-muted">공고정보에 일정이 없습니다</p>}
          {period && (
            <p className="border-t border-line pt-4 text-sm text-muted">
              제안서 제출기간 <span className="ml-2 font-mono text-ink tabular-nums">{period}</span>
            </p>
          )}
        </Card>
      )}

      {paired.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-2">
          {paired.map((g) => (
            <Card key={g.id} title={g.title} description={g.description}>
              <DetailList rows={g.rows} />
            </Card>
          ))}
        </div>
      )}

      {wide.map((g) => (
        <Card key={g.id} title={g.title} description={g.description}>
          <DetailList rows={g.rows} columns={g.rows.length > 4 ? 2 : 1} />
        </Card>
      ))}
    </div>
  );
}
