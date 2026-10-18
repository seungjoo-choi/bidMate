import type { HomeStats } from '../../../core/dashboard/stats';

/** 막대 영역 높이(px). 합계 글자는 이 위에 따로 놓인다. */
const PLOT = 140;

const monthLabel = (key: string): string => `${Number(key.slice(5))}월`;

/**
 * 월별 수집 세로 막대. 정상 수집(먹색) 위에 실패(붉은색)를 2px 틈을 두고 쌓는다.
 * 막대 위는 합계, 아래는 월과 전달 수. 마우스를 올리거나 포커스하면 세부 숫자를 띄운다.
 */
export function MonthlyBars({ monthly }: { monthly: HomeStats['monthly'] }) {
  const max = Math.max(1, ...monthly.map((m) => m.collected));
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4 text-sm text-muted">
        <span className="flex items-center gap-1.5">
          <i className="size-2.5 rounded-sm bg-ink/75" />
          정상 수집
        </span>
        <span className="flex items-center gap-1.5">
          <i className="size-2.5 rounded-sm bg-danger" />
          실패
        </span>
      </div>
      <ul className="grid grid-cols-6 gap-2 border-b border-line">
        {monthly.map((m) => {
          const ok = m.collected - m.failed;
          const okH = (ok / max) * PLOT;
          const failH = (m.failed / max) * PLOT;
          return (
            <li
              key={m.month}
              tabIndex={0}
              aria-label={`${monthLabel(m.month)} 수집 ${m.collected}건, 실패 ${m.failed}건, 전달 ${m.delivered}건`}
              className="group relative flex flex-col items-center justify-end rounded-ctl pt-6 outline-offset-0 hover:bg-sunken focus-visible:bg-sunken"
              style={{ height: PLOT + 24 }}
            >
              <span className="mb-1 font-mono text-sm font-semibold tabular-nums">{m.collected}</span>
              <div className="flex w-full max-w-10 flex-col items-stretch gap-0.5">
                {m.failed > 0 && <div className="rounded-t-[4px] bg-danger" style={{ height: Math.max(2, failH) }} />}
                {ok > 0 && (
                  <div
                    className={`bg-ink/75 ${m.failed > 0 ? '' : 'rounded-t-[4px]'}`}
                    style={{ height: Math.max(2, okH) }}
                  />
                )}
              </div>
              <div
                role="tooltip"
                className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded-ctl bg-btn px-3 py-2 text-xs whitespace-nowrap text-btn-ink shadow-raised group-hover:block group-focus-visible:block"
              >
                <div className="font-semibold">{m.month.replace('-', '년 ')}월</div>
                <div className="font-mono tabular-nums">
                  수집 {m.collected}, 실패 {m.failed}, 전달 {m.delivered}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <ul className="grid grid-cols-6 gap-2 text-center">
        {monthly.map((m) => (
          <li key={m.month} className="leading-tight">
            <div className="text-sm font-medium">{monthLabel(m.month)}</div>
            <div className="font-mono text-xs text-faint tabular-nums">전달 {m.delivered}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
