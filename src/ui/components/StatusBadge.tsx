import type { ReactNode } from 'react';
import { statusTone } from '../theme';

export type BadgeStatus = 'ok' | 'warn' | 'error' | 'idle';

/** 배경 없이 작은 사각 기호와 글자색으로 상태를 표시한다. idle은 속이 빈 사각형. */
export function StatusBadge({ status, children }: { status: BadgeStatus; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-2 whitespace-nowrap text-sm ${statusTone[status]}`}>
      <span aria-hidden className={`size-2 shrink-0 rounded-[1.5px] ${status === 'idle' ? 'border-[1.5px] border-current' : 'bg-current'}`} />
      {children}
    </span>
  );
}
