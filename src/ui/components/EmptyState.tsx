import type { ReactNode } from 'react';
import { Mascot } from '../mascot';

/** 빈 목록 안내. lg는 점선 상자 안내, sm은 한 줄 안내. 마스코트는 장식이다. */
export function EmptyState({ title, hint, size = 'lg', children, className = '' }: {
  title: string;
  hint?: ReactNode;
  size?: 'lg' | 'sm';
  children?: ReactNode;
  className?: string;
}) {
  if (size === 'sm') {
    return (
      <div className={`flex items-center justify-center gap-2.5 py-6 text-sm text-muted ${className}`}>
        <Mascot variant="face" size={28} />
        <span>{title}</span>
        {children}
      </div>
    );
  }
  return (
    <div className={`flex flex-col items-center gap-3 rounded-card border border-dashed border-line-strong py-20 text-center text-muted ${className}`}>
      {/* 다크 모드에서만 뒤에 은은한 빛, 발밑에 그림자를 깔아 바닥에 붙여 보이게 한다 */}
      <span className="relative grid place-items-center dark:before:absolute dark:before:-inset-2.5 dark:before:rounded-full dark:before:bg-[radial-gradient(closest-side,rgba(96,140,220,0.24),transparent)] dark:after:absolute dark:after:-bottom-0.5 dark:after:left-1/2 dark:after:h-2 dark:after:w-14 dark:after:-translate-x-1/2 dark:after:rounded-full dark:after:bg-black/45 dark:after:blur-[2px]">
        <Mascot mood="guide" size={88} className="relative z-[1]" />
      </span>
      <p className="font-semibold text-ink">{title}</p>
      {hint && <p className="text-sm">{hint}</p>}
      {children}
    </div>
  );
}
