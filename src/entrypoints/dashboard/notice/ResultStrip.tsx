import type { IndexEntry } from '../../../core/types/index-file';
import { formatWon } from '../../../ui/notices/result-view';

/** 낙찰 확정 카드. 낙찰일과 낙찰금액은 있을 때만. */
export function WonCard({ result }: { result: NonNullable<IndexEntry['result']> }) {
  const at = result.awardedAt ? result.awardedAt.slice(0, 10).replace(/-/g, '.') : null;
  return (
    <section className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-card border border-line bg-surface px-5 py-4">
      <div className="min-w-0">
        <div className="text-lg font-bold">낙찰되었습니다</div>
        <div className="text-sm text-muted">나라장터 낙찰정보 기준</div>
      </div>
      {(at || result.amount !== undefined) && (
        <dl className="ml-auto flex gap-8 text-sm">
          {at && <div><dt className="text-xs text-muted">낙찰일</dt><dd className="font-mono font-semibold tabular-nums">{at}</dd></div>}
          {result.amount !== undefined && <div><dt className="text-xs text-muted">낙찰금액</dt><dd className="font-mono font-semibold tabular-nums">{formatWon(result.amount)}</dd></div>}
        </dl>
      )}
    </section>
  );
}
