import { Check } from 'lucide-react';
import type { RfpPairStatus } from '../../../core/types/rfp';

export const STATUS_LABEL: Record<RfpPairStatus, string> = { changed: '변경', added: '신규', removed: '삭제', same: '동일' };
export const STATUS_DOT: Record<RfpPairStatus, string> = { changed: 'bg-warn', added: 'bg-ok', removed: 'bg-danger', same: 'bg-line-strong' };
const SUB: Record<RfpPairStatus, string> = { changed: '내용이 바뀐 요구사항', added: '기준에만 있음', removed: '비교 대상에만 있음', same: '그대로' };
const ON_BORDER: Record<RfpPairStatus, string> = {
  changed: 'border-warn/45', added: 'border-ok/45', removed: 'border-danger/45', same: 'border-line',
};
const ON_CHECK: Record<RfpPairStatus, string> = { changed: 'bg-warn border-warn', added: 'bg-ok border-ok', removed: 'bg-danger border-danger', same: 'bg-muted border-muted' };
const ORDER: RfpPairStatus[] = ['changed', 'added', 'removed', 'same'];

export function SummaryStrip({ counts, shown, onToggle, done, total, onNext }: {
  counts: Record<RfpPairStatus, number>;
  shown: Record<RfpPairStatus, boolean>;
  onToggle: (s: RfpPairStatus) => void;
  done: number; total: number;
  onNext: () => void;
}) {
  const pct = total ? Math.round((done / total) * 100) : 100;
  const left = total - done;
  return (
    <div className="mt-5 grid grid-cols-[repeat(4,minmax(0,1fr))_240px] gap-3">
      {ORDER.map((s) => {
        const on = shown[s];
        return (
          <button
            key={s} type="button" aria-pressed={on} onClick={() => onToggle(s)}
            className={`relative rounded-card border px-4 pb-3 pt-3.5 text-left transition-colors motion-reduce:transition-none ${on ? `bg-surface shadow-card ${ON_BORDER[s]}` : 'border-line bg-transparent'}`}
          >
            <span className={`absolute right-3 top-3 grid size-5 place-items-center rounded-md border-[1.5px] ${on ? `${ON_CHECK[s]} text-white` : 'border-line-strong text-transparent'}`}>
              <Check className="size-3 stroke-[3]" />
            </span>
            <div className={`flex items-center gap-1.5 text-sm font-semibold ${on ? 'text-muted' : 'text-faint'}`}>
              <span className={`size-[9px] rounded-[3px] ${STATUS_DOT[s]}`} />{STATUS_LABEL[s]}
            </div>
            <div className={`mt-0.5 text-[1.75rem] leading-9 font-bold tracking-tight tabular-nums ${on ? 'text-ink' : 'text-faint'}`}>{counts[s]}</div>
            <div className="text-xs text-faint">{SUB[s]}</div>
          </button>
        );
      })}
      <div className="flex min-w-0 flex-col rounded-card border border-line bg-surface px-4 pb-3 pt-3.5 shadow-card">
        <div className="flex items-center justify-between text-sm font-semibold text-muted">
          <span>검토</span>
          <span className={`tabular-nums ${left === 0 ? 'text-ok' : ''}`}>{pct}%</span>
        </div>
        <div className="mt-0.5 flex items-baseline gap-1 tabular-nums">
          <span className="text-[1.75rem] leading-9 font-bold tracking-tight text-ink">{done}</span>
          <span className="text-sm font-semibold text-faint">/ {total}</span>
        </div>
        <div
          role="progressbar" aria-label="검토 진행" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}
          className="h-1.5 overflow-hidden rounded-full bg-sunken"
        >
          <div className="h-full rounded-full bg-ok transition-[width] motion-reduce:transition-none" style={{ width: `${pct}%` }} />
        </div>
        {left > 0 ? (
          <button
            type="button" onClick={onNext}
            className="mt-2.5 flex h-8 w-full items-center justify-between gap-2 whitespace-nowrap rounded-btn border border-line-strong bg-surface pl-3 pr-1.5 text-xs font-semibold shadow-btn hover:bg-sunken"
          >
            <span>다음 미확인 <span className="tabular-nums text-muted">· {left}개 남음</span></span>
            <kbd className="rounded border border-b-2 border-line-strong px-1.5 font-mono text-[11px] text-muted">N</kbd>
          </button>
        ) : (
          <div className="mt-2.5 flex h-8 items-center gap-1.5 text-xs font-semibold text-ok">
            <Check className="size-3.5 stroke-[3]" />달라진 항목을 모두 확인했어요
          </div>
        )}
      </div>
    </div>
  );
}
