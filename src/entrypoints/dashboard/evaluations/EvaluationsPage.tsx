import { Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EvalIndexEntry } from '../../../core/types/evaluation';
import { send } from '../../../messaging/bus';
import { EmptyState, StatusBadge } from '../../../ui/components';
import { inputClass } from '../../../ui/components/Field';
import { FsErrorAlert } from '../FsErrorAlert';
import { evaluationHash } from '../route';
import { dateOnly } from './eval-view';
import { PageTitle } from '../menu';
import { SortHeader, useSort, type SortValue } from '../table-sort';

const GRID = 'grid grid-cols-[40px_minmax(0,1fr)_64px_100px_64px] items-center gap-6 px-5';

type SortKey = 'title' | 'bidders' | 'evaluatedAt' | 'status';
const SORT_BY: Record<SortKey, (e: EvalIndexEntry) => SortValue> = {
  title: (e) => e.title,
  bidders: (e) => e.bidders.length,
  evaluatedAt: (e) => e.evaluatedAt ?? e.collectedAt,
  status: (e) => (e.status === 'final' ? '확정' : '임시'),
};

/** 평가분석 목록. 탭과 누적 분석은 이후 단계에서 붙인다. */
export function EvaluationsPage() {
  const [list, setList] = useState<EvalIndexEntry[] | null>(null);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const [query, setQuery] = useState('');
  const load = useCallback(async () => {
    try {
      setList(await send('eval/list', undefined));
      setError(null);
    } catch (e) {
      setError({ code: (e as { code?: string }).code, message: e instanceof Error ? e.message : String(e) });
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (list ?? []).filter((e) => !q || `${e.title} ${e.noticeNo} ${e.orgName} ${e.bidders.map((b) => b.name).join(' ')}`.toLowerCase().includes(q));
  }, [list, query]);
  const { sorted: rows, sort, toggle } = useSort<EvalIndexEntry, SortKey>(filtered, SORT_BY, { key: 'evaluatedAt', dir: 'desc' }, { bidders: 'desc', evaluatedAt: 'desc' });

  return (
    <div className="space-y-6">
      <PageTitle page="evaluations" />
      <FsErrorAlert error={error} onRetry={load} />
      {list && list.length === 0 && (
        <EmptyState title="가져온 평가점수 없음" hint="개찰이 끝난 협상 공고 화면에서 [평가점수 가져오기]를 누르면 여기에 쌓임" />
      )}
      {list && list.length > 0 && (
        <div className="space-y-3">
        <div className="relative ml-auto w-80">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
          <input className={`${inputClass} pl-9`} placeholder="공고명, 번호, 기관, 업체 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
          <div className={`${GRID} bg-sunken py-3 text-sm text-muted`}>
            <div className="text-right">순번</div>
            <SortHeader label="공고명" k="title" sort={sort} onSort={toggle} />
            <SortHeader label="업체" k="bidders" sort={sort} onSort={toggle} />
            <SortHeader label="평가 종료" k="evaluatedAt" sort={sort} onSort={toggle} />
            <SortHeader label="상태" k="status" sort={sort} onSort={toggle} />
          </div>
          {rows.length === 0 && <EmptyState size="sm" className="border-t border-line px-4 !py-10" title="조건에 맞는 평가가 없습니다." />}
          {rows.map((e, i) => (
            <a key={e.noticeId} href={evaluationHash(e.noticeId)} className={`${GRID} border-t border-line py-4 transition-colors hover:bg-sunken motion-reduce:transition-none`}>
              <div className="text-right font-mono text-sm text-muted tabular-nums">{i + 1}</div>
              <div className="min-w-0">
                <div className="truncate text-base font-semibold">{e.title}</div>
                <div className="mt-0.5 truncate text-sm text-muted"><span className="font-mono">{e.noticeNo}-{e.round}</span>, {e.orgName}</div>
              </div>
              <div className="font-mono text-sm text-muted tabular-nums">{e.bidders.length}</div>
              <div className="font-mono text-sm text-muted tabular-nums">{dateOnly(e.evaluatedAt) ?? '미상'}</div>
              <div><StatusBadge status={e.status === 'final' ? 'ok' : 'warn'}>{e.status === 'final' ? '확정' : '임시'}</StatusBadge></div>
            </a>
          ))}
        </div>
        </div>
      )}
    </div>
  );
}
