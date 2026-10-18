import type { ReactNode } from 'react';

export interface StatCardProps {
  label: string;
  value: number;
  sub?: ReactNode;
  tone?: 'default' | 'warn' | 'danger';
  href?: string;
}

const TONE = { default: 'text-ink', warn: 'text-warn', danger: 'text-danger' } as const;

export function StatCard({ label, value, sub, tone = 'default', href = '#/notices' }: StatCardProps) {
  return (
    <a
      href={href}
      className="block rounded-card border border-line bg-surface px-5 py-4 shadow-card transition-[box-shadow,border-color] hover:border-line-strong hover:shadow-raised motion-reduce:transition-none"
    >
      <div className="text-sm text-muted">{label}</div>
      <div className={`mt-1 font-mono text-2xl font-bold tabular-nums ${TONE[tone]}`}>{value}</div>
      <div className="mt-0.5 min-h-5 text-sm text-muted">{sub}</div>
    </a>
  );
}
