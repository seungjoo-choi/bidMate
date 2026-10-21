import type { ReactNode } from 'react';

type Side = 'prev' | 'next';

export const SIDE_NAME: Record<Side, string> = { prev: '비교 대상', next: '기준' };

/** 비교 대상(회색 ○)·기준(primary ●)을 구분하는 알약형 칩. 모든 라벨 위치에서 공통으로 쓴다. */
export function SideChip({ side, children, className = '' }: { side: Side; children?: ReactNode; className?: string }) {
  const cls = side === 'next' ? 'bg-btn-pri-wash text-btn-pri-ink' : 'bg-sunken text-muted';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 text-[0.8125rem] leading-[26px] font-bold whitespace-nowrap ${cls} ${className}`}>
      <span aria-hidden>{side === 'next' ? '●' : '○'}</span>
      {children ?? SIDE_NAME[side]}
    </span>
  );
}
