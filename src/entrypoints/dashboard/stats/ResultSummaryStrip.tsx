import { ArrowRight } from 'lucide-react';
import { useMemo } from 'react';
import type { IndexEntry } from '../../../core/types/index-file';
import { computeResultStats, defaultPeriod } from '../../../core/results/stats';
import { formatPercent, formatWonShort } from '../../../ui/notices/result-view';

const Dot = () => <i className="size-[3px] shrink-0 rounded-full bg-faint" aria-hidden />;

/** 홈과 공고목록 위에 놓는 한 줄 실적 요약. 기본 기간에 투찰이 없으면 렌더하지 않는다. */
export function ResultSummaryStrip({ list }: { list: IndexEntry[] }) {
  const stats = useMemo(() => {
    const now = new Date();
    return computeResultStats({ entries: list, period: defaultPeriod(list, now), now });
  }, [list]);
  const { bids, won, winRate } = stats.counts;
  if (bids === 0) return null;
  return (
    <a
      href="#/stats"
      className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1 rounded-btn border border-line bg-sunken px-4 py-2 text-sm text-muted transition-colors hover:border-line-strong motion-reduce:transition-none"
    >
      <span className="font-semibold text-ink">{stats.period === 'all' ? '전체' : `${stats.period}년`}</span>
      <span>투찰 <b className="font-mono text-base text-ink tabular-nums">{bids}</b>건</span>
      <Dot />
      <span>
        낙찰 <b className="font-mono text-base text-ok tabular-nums">{won}</b>건
        {winRate !== null && <span className="ml-1 font-mono tabular-nums">({formatPercent(winRate)})</span>}
      </span>
      {stats.amounts.bidTotal > 0 && (
        <>
          <Dot />
          <span>투찰금액 <b className="font-mono text-base text-ink tabular-nums">{formatWonShort(stats.amounts.bidTotal)}</b></span>
        </>
      )}
      {stats.amounts.wonTotal > 0 && (
        <>
          <Dot />
          <span>낙찰금액 <b className="font-mono text-base text-ink tabular-nums">{formatWonShort(stats.amounts.wonTotal)}</b></span>
        </>
      )}
      <span className="ml-auto inline-flex items-center gap-1 font-medium text-primary">
        실적 보기
        <ArrowRight className="size-4" aria-hidden />
      </span>
    </a>
  );
}
