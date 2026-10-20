import type { ResultStats } from '../../../core/results/stats';
import { formatWonShort } from '../../../ui/notices/result-view';

/** 막대 영역 높이(px). 숫자 라벨은 이 위에 따로 놓인다. */
const PLOT = 180;

/** 억 단위 소수 1자리(막대 위 라벨용). 0이면 '0', 0.1억 미만이면 '<0.1'(막대는 그려지므로 0으로 보이지 않게) */
const eok = (n: number): string => (n === 0 ? '0' : n < 5_000_000 ? '<0.1' : String(Math.round(n / 10_000_000) / 10));

/**
 * 월별(또는 연도별) 투찰과 낙찰 막대. 투찰(회색)과 낙찰(초록)을 나란히 세운다.
 * mode가 amount면 금액 기준, 막대 위 숫자는 억 단위. 마우스를 올리거나 포커스하면 세부 숫자를 띄운다.
 */
export function ResultBars({ monthly, mode, year, currentKey }: {
  monthly: ResultStats['monthly'];
  mode: 'count' | 'amount';
  year: number | null;
  currentKey?: string;
}) {
  const a = (m: ResultStats['monthly'][number]) => (mode === 'count' ? m.bids : m.bidAmount);
  const w = (m: ResultStats['monthly'][number]) => (mode === 'count' ? m.won : m.wonAmount);
  const max = Math.max(1, ...monthly.map(a));
  const cols = { gridTemplateColumns: `repeat(${monthly.length}, minmax(0, 1fr))` };
  return (
    <div className="space-y-2">
      <ul className="grid gap-2 border-b border-line" style={cols}>
        {monthly.map((m) => {
          const all = a(m);
          const won = w(m);
          const tip = `${year ? `${year}년 ` : ''}${m.label}, 투찰 ${m.bids}건${m.bidAmount ? ` ${formatWonShort(m.bidAmount)}` : ''}, 낙찰 ${m.won}건${m.wonAmount ? ` ${formatWonShort(m.wonAmount)}` : ''}`;
          return (
            <li
              key={m.key}
              tabIndex={0}
              aria-label={tip}
              className="group relative flex flex-col items-center justify-end rounded-t-ctl pt-6 outline-offset-0 hover:bg-sunken focus-visible:bg-sunken"
              style={{ height: PLOT + 28 }}
            >
              <span className={`mb-1 font-mono text-xs whitespace-nowrap tabular-nums ${all ? 'text-muted' : 'text-faint'}`}>
                {all === 0 ? '' : (
                  <>
                    {mode === 'count' ? all : eok(all)}
                    <span className="text-faint">/</span>
                    <b className="font-semibold text-ok">{mode === 'count' ? won : eok(won)}</b>
                  </>
                )}
              </span>
              <div className="flex w-full items-end justify-center gap-[3px]">
                <div className="w-[40%] max-w-[18px] rounded-t-[3px] bg-faint/50" style={{ height: all ? Math.max(2, (all / max) * PLOT) : 0 }} />
                <div className="w-[40%] max-w-[18px] rounded-t-[3px] bg-ok" style={{ height: won ? Math.max(2, (won / max) * PLOT) : 0 }} />
              </div>
              <div
                role="tooltip"
                className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded-ctl bg-btn px-3 py-2 text-xs whitespace-nowrap text-btn-ink shadow-raised group-hover:block group-focus-visible:block"
              >
                {tip}
              </div>
            </li>
          );
        })}
      </ul>
      <ul className="grid gap-2 text-center text-sm" style={cols}>
        {monthly.map((m) => (
          <li key={m.key} className={m.key === currentKey ? 'font-semibold text-ink' : 'text-muted'}>{m.label}</li>
        ))}
      </ul>
    </div>
  );
}
