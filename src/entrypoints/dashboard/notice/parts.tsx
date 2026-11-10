import type { DetailRow, Milestone, StatItem } from '../../../ui/notice-detail/view';

const TONE: Record<NonNullable<StatItem['tone']>, string> = { danger: 'text-danger', warn: 'text-warn', muted: 'text-faint' };

/** 핵심 숫자를 가로로 나란히 보여주는 띠. */
export function StatStrip({ items }: { items: StatItem[] }) {
  return (
    <div
      className="grid divide-x divide-line overflow-hidden rounded-card border border-line bg-surface shadow-card"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      {items.map((s) => (
        <div key={s.label} className="min-w-0 px-6 py-5">
          <div className="text-sm text-muted">{s.label}</div>
          <div className={`mt-1.5 truncate text-2xl font-bold tracking-tight tabular-nums ${s.tone ? TONE[s.tone] : 'text-ink'}`}>{s.value}</div>
          <div className="mt-1 truncate font-mono text-xs text-faint tabular-nums">{s.sub ?? ' '}</div>
        </div>
      ))}
    </div>
  );
}

function Mark({ mark }: { mark?: DetailRow['mark'] }) {
  if (mark === 'needs_review') return <span className="ml-2 text-xs font-medium text-warn">확인 필요</span>;
  if (mark === 'user_edited') return <span className="ml-2 text-xs font-medium text-muted">수정됨</span>;
  return null;
}

/** 라벨/값 목록. 행 사이 옅은 구분선. columns=2면 카드 안에서 2열로 나눈다. */
export function DetailList({ rows, columns = 1 }: { rows: DetailRow[]; columns?: 1 | 2 }) {
  return (
    <dl className={`-my-2.5 text-sm ${columns === 2 ? 'grid gap-x-10 lg:grid-cols-2' : ''}`}>
      {rows.map((r, i) => (
        <div
          key={r.label}
          className={`grid grid-cols-[7.5rem_minmax(0,1fr)] gap-4 py-2.5 ${i === 0 || (columns === 2 && i === 1) ? 'lg:border-t-0' : ''} ${i === 0 ? 'border-t-0' : 'border-t border-line'}`}
        >
          <dt className="text-muted">{r.label}</dt>
          <dd className={`min-w-0 break-words ${r.value === '—' ? 'text-faint' : ''} ${r.pre ? 'whitespace-pre-wrap' : ''}`}>
            {r.href ? <a href={r.href} className="text-accent hover:underline">{r.value}</a> : r.value}
            <Mark mark={r.mark} />
            {r.hint && <div className="mt-0.5 text-xs text-muted">{r.hint}</div>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const DOT: Record<Milestone['state'], string> = {
  done: 'border-ink bg-ink',
  next: 'border-accent bg-accent ring-4 ring-accent/20',
  upcoming: 'border-line-strong bg-surface',
};

/** 일정 가로 타임라인. 지난 구간은 진하게, 다음 지점은 강조. */
export function Timeline({ points }: { points: Milestone[] }) {
  return (
    <ol className="grid" style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}>
      {points.map((p, i) => (
        <li key={p.key} className="min-w-0">
          <div className="flex items-center">
            <span className={`size-3 shrink-0 rounded-full border-2 ${DOT[p.state]}`} />
            {i < points.length - 1 && <span className={`h-0.5 flex-1 ${p.state === 'done' ? 'bg-ink' : 'bg-line'}`} />}
          </div>
          <div className={`mt-3 pr-3 text-sm font-medium ${p.state === 'done' ? 'text-muted' : 'text-ink'}`}>
            {p.label}<Mark mark={p.mark} />
          </div>
          <div className={`mt-0.5 font-mono text-sm tabular-nums ${p.state === 'done' ? 'text-faint' : 'text-muted'}`}>{p.when}</div>
          {p.sub && <div className="mt-0.5 truncate font-mono text-xs text-faint tabular-nums">{p.sub}</div>}
          {p.state === 'next' && p.dday && <div className="mt-1 font-mono text-xs font-bold text-accent">{p.dday}</div>}
        </li>
      ))}
    </ol>
  );
}
