import type { IndexEntry } from '../../../core/types/index-file';
import { Button } from '../../../ui/components';
import { formatWon } from '../../../ui/notices/result-view';

/** 낙찰 확정 카드. 낙찰일과 낙찰금액은 있을 때만. */
export function WonCard({ result }: { result: NonNullable<IndexEntry['result']> }) {
  const at = result.awardedAt ? result.awardedAt.slice(0, 10).replace(/-/g, '/') : null;
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

/** 재공고 연결 카드. 이 공고가 유찰되어 재공고가 확인됐거나, 이 공고가 재공고인 경우에 보인다. */
export function ReannounceCard({ entry, onCollect, busy }: { entry: IndexEntry; onCollect: (ref: { noticeNo: string; round: string }) => void; busy: boolean }) {
  const found = entry.result?.reannounce?.status === 'found' ? entry.result.reannounce : null;
  if (!found && !entry.reannounceOf) return null;
  const link = (id: string) => (
    <a className="text-sm font-medium text-primary hover:underline" href={`#/notices/${encodeURIComponent(id)}/overview`}>열기</a>
  );
  return (
    <>
      {found && (
        <section className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-card border border-line bg-surface px-5 py-4">
          <div className="min-w-0">
            <div className="text-lg font-bold">재공고</div>
            <div className="text-sm text-muted">{found.noticeNo}-{found.round} {found.title}</div>
          </div>
          <div className="ml-auto">
            {found.noticeId
              ? link(found.noticeId)
              : <Button variant="secondary" loading={busy} onClick={() => onCollect({ noticeNo: found.noticeNo ?? '', round: found.round ?? '000' })}>수집</Button>}
          </div>
        </section>
      )}
      {entry.reannounceOf && (
        <section className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-card border border-line bg-surface px-5 py-4">
          <div className="min-w-0">
            <div className="text-lg font-bold">원 공고</div>
            <div className="text-sm text-muted">{entry.reannounceOf}의 재공고</div>
          </div>
          {entry.reannounceOfId && <div className="ml-auto">{link(entry.reannounceOfId)}</div>}
        </section>
      )}
    </>
  );
}
