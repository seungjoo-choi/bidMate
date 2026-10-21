import type { ReactNode } from 'react';

/** 표 머리와 칸 공통 클래스. 숫자와 라벨은 줄바꿈하지 않는다 */
export const TH = 'px-3 py-2.5 text-[0.8125rem] font-semibold whitespace-nowrap text-muted';
export const TD = 'px-3 py-2.5 whitespace-nowrap';
export const HEAD_ROW = 'bg-sunken';
export const ROW = 'border-t border-line transition-colors hover:bg-sunken/60 motion-reduce:transition-none';
export const OURS_ROW = 'bg-info-wash shadow-[inset_3px_0_0_var(--color-primary)] hover:bg-info-wash';

/** 평가분석 블록 공통 틀 */
export function Section({ title, sub, action, children, className = '' }: { title: string; sub?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 overflow-hidden rounded-card border border-line bg-surface shadow-card ${className}`}>
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-6 pt-4.5 pb-3.5">
        <div className="min-w-0 flex-1 basis-60">
          <h2 className="text-base font-bold whitespace-nowrap">{title}</h2>
          {sub && <p className="mt-0.5 truncate text-[0.8125rem] text-muted" title={sub}>{sub}</p>}
        </div>
        {/* 업체 탭이 많아 넓어지면 제목 아래로 내려가고, 그래도 넘치면 가로 스크롤 */}
        {action && <div className="max-w-full overflow-x-auto">{action}</div>}
      </header>
      {children}
    </section>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: Array<{ id: T; label: string; disabled?: boolean }>; onChange: (v: T) => void; label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex w-max rounded-btn bg-select p-[3px]">
      {options.map((o) => (
        <button
          key={o.id} type="button" disabled={o.disabled} aria-pressed={value === o.id} onClick={() => onChange(o.id)}
          className={`min-h-8 rounded-ctl px-3.5 text-sm font-semibold whitespace-nowrap transition-colors disabled:opacity-40 motion-reduce:transition-none ${value === o.id ? 'bg-surface text-ink shadow-btn' : 'text-muted hover:text-ink'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 가운데 기준 막대. 진 쪽은 왼쪽 warn, 이긴 쪽은 오른쪽 primary */
export function CenterBar({ side, widthPct, h = 'h-2' }: { side: 'win' | 'lose' | 'none'; widthPct: number; h?: string }) {
  return (
    <div className={`relative ${h} rounded-full bg-sunken`} aria-hidden>
      <div className="absolute inset-y-[-3px] left-1/2 w-px bg-line-strong" />
      {side !== 'none' && (
        <div className={`absolute inset-y-0 rounded-full ${side === 'lose' ? 'right-1/2 bg-warn' : 'left-1/2 bg-primary'}`} style={{ width: `${widthPct}%` }} />
      )}
    </div>
  );
}

/** 작은 라벨 + 내용 묶음(승부 분해 칸 등) */
export function Label({ children }: { children: ReactNode }) {
  return <div className="text-[0.8125rem] font-semibold whitespace-nowrap text-muted">{children}</div>;
}
