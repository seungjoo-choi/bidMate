import { Bell } from 'lucide-react';
import type { Extraction } from '../../../core/types/extraction';
import type { IndexEntry } from '../../../core/types/index-file';
import type { Notice } from '../../../core/types/notice';
import { Card } from '../../../ui/components';
import { deadlineNoticeView, overviewGroups, overviewStats, resultMilestones, scheduleTimeline } from '../../../ui/notice-detail/view';
import { FOLLOW_TARGET_LABEL, formatCheckAt } from '../../../ui/notices/result-view';
import { useSettings } from '../../../ui/hooks/useSettings';
import { DetailList, StatStrip, Timeline } from './parts';
import { EstimateCard } from './EstimateCard';
import { ProcessCard } from './ProcessCard';
import { PriceSimulatorCard } from './PriceSimulatorCard';
import { QualificationCard } from './QualificationCard';
import { kindOf } from '../../../core/model/ids';

export function OverviewTab({ notice, index, extraction }: { notice: Notice; index: IndexEntry[]; extraction: Extraction | null }) {
  const groups = overviewGroups(notice, index, extraction);
  const schedule = groups.find((g) => g.id === 'schedule');
  const paired = groups.filter((g) => g.id === 'overview' || g.id === 'money');
  const wide = groups.filter((g) => g.id !== 'schedule' && g.id !== 'overview' && g.id !== 'money');
  const base = schedule ? scheduleTimeline(notice) : [];
  const entry = index.find((e) => e.noticeId === notice.id);
  const points = [...base, ...resultMilestones(entry, base)];
  const nextCheck = entry?.following && entry.result?.nextCheckAt ? formatCheckAt(entry.result.nextCheckAt) : '';
  const tracking = entry?.following ? (
    <div className="flex items-center gap-3 text-xs text-muted">
      <span className="rounded-full border border-line px-2 py-0.5">{FOLLOW_TARGET_LABEL[entry.following]} 팔로우</span>
      {nextCheck && <span>다음 결과 확인 <b className="font-mono font-semibold text-ink tabular-nums">{nextCheck}</b></span>}
    </div>
  ) : undefined;
  const period = notice.schedule.proposalPeriod.value;
  const { settings } = useSettings();
  const alarm = schedule && settings ? deadlineNoticeView(notice, index, settings) : null;

  return (
    <div className="space-y-6">
      <StatStrip items={overviewStats(notice)} />

      {schedule && (
        <Card title="일정" action={tracking}>
          {points.length > 0
            ? <Timeline points={points} />
            : <p className="text-sm text-muted">공고정보에 일정이 없습니다</p>}
          {period && (
            <p className="border-t border-line pt-4 text-sm text-muted">
              제안서 제출기간 <span className="ml-2 font-mono text-ink tabular-nums">{period}</span>
            </p>
          )}
          {alarm && (
            <div className="flex gap-2.5 border-t border-line pt-4 text-sm">
              <Bell className={`mt-0.5 size-4 shrink-0 ${alarm.state === 'target' ? 'text-ink' : 'text-faint'}`} aria-hidden />
              <div className="min-w-0 space-y-1">
              {alarm.state === 'off' && (
                <p className="text-muted">마감 알림이 꺼져 있습니다. <a className="text-primary underline" href="#/settings?section=notify">설정에서 켜기</a></p>
              )}
              {alarm.state === 'not_target' && <p className="text-muted">마감 알림 없음. {alarm.reason}</p>}
              {alarm.state === 'target' && alarm.lines.length === 0 && <p className="text-muted">마감 알림: 예정된 알림이 없습니다</p>}
              {alarm.state === 'target' && alarm.lines.length > 0 && (
                <>
                  <p className="text-muted">마감 알림</p>
                  {alarm.lines.map((l) => (
                    <p key={l.label}>{l.label}: <span className="font-mono tabular-nums">{l.times.join(', ')}</span></p>
                  ))}
                </>
              )}
              </div>
            </div>
          )}
        </Card>
      )}

      <ProcessCard noticeId={notice.id} />

      {kindOf(notice.ref) !== 'prespec' && <QualificationCard notice={notice} extraction={extraction} />}

      {kindOf(notice.ref) !== 'prespec' && <EstimateCard notice={notice} extraction={extraction} />}

      {kindOf(notice.ref) !== 'prespec' && <PriceSimulatorCard notice={notice} />}

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
