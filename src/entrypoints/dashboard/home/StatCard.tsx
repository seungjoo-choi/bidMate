import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export interface StatCardProps {
  label: string;
  value: number;
  icon: LucideIcon;
  sub?: ReactNode;
  tone?: 'default' | 'warn' | 'danger';
  href?: string;
}

const VALUE = { default: 'text-ink', warn: 'text-warn', danger: 'text-danger' } as const;
/** 아이콘 칩. 값이 0이면 tone이 default로 들어오므로 회색 칩이 된다. */
const CHIP = { default: 'bg-sunken text-muted', warn: 'bg-warn-wash text-warn', danger: 'bg-danger-wash text-danger' } as const;

export function StatCard({ label, value, icon: Icon, sub, tone = 'default', href = '#/notices' }: StatCardProps) {
  return (
    <a
      href={href}
      className="group flex flex-col rounded-card border border-line bg-surface p-5 shadow-card transition-[box-shadow,border-color] hover:border-line-strong hover:shadow-raised motion-reduce:transition-none"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-muted">{label}</span>
        <span className={`grid size-8 shrink-0 place-items-center rounded-btn ${CHIP[tone]}`}>
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
      <div className="mt-3 flex items-baseline gap-1">
        <span className={`font-mono text-[1.75rem] leading-none font-bold tracking-tight tabular-nums ${VALUE[tone]}`}>{value}</span>
        <span className="text-sm text-muted">건</span>
      </div>
      <div className="mt-2 min-h-5 truncate text-xs text-faint">{sub}</div>
    </a>
  );
}
