import { Bell } from 'lucide-react';
import { BOARD_COLUMNS, type BoardRow } from '../../../core/dashboard/schedule-board';
import { noticeLabel } from '../../../core/model/ids';
import type { ISODate } from '../../../core/types/common';
import { EmptyState } from '../../../ui/components';
import { dDayLevel, formatDDay, formatDateTime } from '../../../ui/review/format';
import { noticeHash } from '../route';

function Cell({ iso, strong, now }: { iso: ISODate | null; strong: boolean; now: Date }) {
  if (!iso) return <span className="text-faint">—</span>;
  const dday = formatDDay(iso, now);
  const past = dday === '마감';
  const level = dDayLevel(dday);
  const tone = past ? 'text-faint' : level === 'urgent' ? 'text-danger' : level === 'soon' ? 'text-warn' : 'text-muted';
  return (
    <div className={strong ? 'font-semibold' : undefined}>
      <div className="font-mono text-sm tabular-nums">{formatDateTime(iso)}</div>
      <div className={`font-mono text-xs tabular-nums ${tone}`}>{past ? '지남' : dday}</div>
    </div>
  );
}

export function ScheduleBoard({ rows, now }: { rows: BoardRow[]; now: Date }) {
  if (rows.length === 0) return <EmptyState size="sm" title="14일 안에 예정된 일정이 없습니다." />;
  const open = (id: string) => { location.hash = noticeHash(id); };
  return (
    <div className="-mx-6 -my-5 overflow-x-auto">
      <table className="w-full min-w-[720px] text-left">
        <thead>
          <tr className="bg-sunken text-xs text-muted">
            <th className="py-2.5 pr-4 pl-6 font-medium">공고</th>
            {BOARD_COLUMNS.map((c, i) => <th key={c.key} className={`py-2.5 font-medium ${i === BOARD_COLUMNS.length - 1 ? 'pr-6' : 'pr-4'}`}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.entry.noticeId}
              role="link"
              tabIndex={0}
              onClick={() => open(r.entry.noticeId)}
              onKeyDown={(e) => { if (e.key === 'Enter') open(r.entry.noticeId); }}
              className="cursor-pointer border-t border-line align-top transition-colors hover:bg-sunken motion-reduce:transition-none"
            >
              <td className="max-w-0 w-[32%] py-3.5 pr-4 pl-6">
                <div className="flex items-center gap-1.5 text-base font-semibold">
                  {r.notifyTarget && <span title="마감 알림 대상" className="shrink-0"><Bell className="size-3.5" aria-label="마감 알림 대상" /></span>}
                  <span className="truncate">{r.entry.title}</span>
                </div>
                <div className="mt-0.5 truncate text-xs text-muted">
                  <span className="font-mono">{noticeLabel(r.entry)}</span>, {r.entry.orderingOrg}
                </div>
              </td>
              {BOARD_COLUMNS.map((c, i) => (
                <td key={c.key} className={`py-3.5 ${i === BOARD_COLUMNS.length - 1 ? 'pr-6' : 'pr-4'}`}><Cell iso={r.cells[c.key]} strong={r.nextColumn === c.key} now={now} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
