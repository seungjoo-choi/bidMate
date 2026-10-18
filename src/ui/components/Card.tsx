import type { ReactNode } from 'react';

export interface CardProps {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}

export function Card({ title, description, action, children }: CardProps) {
  return (
    <section className="rounded-card border border-line bg-surface shadow-card">
      <header className={`flex items-start justify-between gap-4 px-6 ${children ? 'pt-5 pb-4 border-b border-line' : 'py-5'}`}>
        <div className="min-w-0">
          <h2 className="title-mark text-lg font-semibold text-ink">{title}</h2>
          {description && <p className="mt-1 pl-[11.5px] text-sm text-muted">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      {children && <div className="space-y-4 px-6 py-5">{children}</div>}
    </section>
  );
}
