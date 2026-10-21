import { Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cumulative, type Cumulative } from '../../../core/evaluation/analyze';
import { normalizeBizNo } from '../../../core/evaluation/company';
import type { EvalIndexEntry } from '../../../core/types/evaluation';
import { send } from '../../../messaging/bus';
import { EmptyState, Select, StatusBadge } from '../../../ui/components';
import { inputClass } from '../../../ui/components/Field';
import { useSettings } from '../../../ui/hooks/useSettings';
import { FsErrorAlert } from '../FsErrorAlert';
import { evaluationHash } from '../route';
import { offerEvalAuto, useEvalAuto } from './EvalAutoDock';
import { dateOnly } from './eval-view';
import { StatsStrip } from './StatsStrip';
import { PageTitle } from '../menu';
import { orgOptions } from '../org-filter';
import { SortHeader, useSort, type SortValue } from '../table-sort';

const GRID = 'grid grid-cols-[40px_minmax(0,1fr)_160px_64px_72px_100px_64px] items-center gap-6 px-5';

type SortKey = 'title' | 'org' | 'bidders' | 'evaluatedAt' | 'status';
const SORT_BY: Record<SortKey, (e: EvalIndexEntry) => SortValue> = {
  title: (e) => e.title,
  org: (e) => e.orgName || undefined,
  bidders: (e) => e.bidders.length,
  evaluatedAt: (e) => e.evaluatedAt ?? e.collectedAt,
  status: (e) => (e.status === 'final' ? '확정' : '임시'),
};

/** 평가분석 목록. 탭과 누적 분석은 이후 단계에서 붙인다. */
export function EvaluationsPage() {
  const [list, setList] = useState<EvalIndexEntry[] | null>(null);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const [query, setQuery] = useState('');
  const [org, setOrg] = useState('');
  const load = useCallback(async () => {
    try {
      setList(await send('eval/list', undefined));
      setError(null);
    } catch (e) {
      setError({ code: (e as { code?: string }).code, message: e instanceof Error ? e.message : String(e) });
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // 진입 시 우리 회사 참여 공고 중 아직 없는 평가점수가 있으면 오른쪽 아래에서 묻는다(진행은 화면을 옮겨도 이어짐)
  const offered = useRef(false);
  useEffect(() => {
    if (!list || offered.current) return;
    offered.current = true;
    void offerEvalAuto(new Set(list.map((e) => e.noticeId)));
  }, [list]);
  const auto = useEvalAuto();
  const autoOk = auto.kind === 'run' ? auto.state.ok : 0;
  useEffect(() => { if (autoOk > 0) void load(); }, [autoOk, load]);

  // 상단 누적 요약과 우리 순위 열. 전체 기록을 읽어야 해서 목록과 따로 불러오고, 실패하면 요약만 생략한다
  const { settings } = useSettings();
  const ourBiz = normalizeBizNo(settings?.company.bizNo ?? '');
  const hasCompany = ourBiz.length === 10;
  const [cum, setCum] = useState<Cumulative | null>(null);
  useEffect(() => {
    if (!list || list.length === 0 || !settings) return;
    let alive = true;
    send('eval/get-many', {})
      .then((recs) => { if (alive) setCum(cumulative(recs, hasCompany ? ourBiz : null)); })
      .catch(() => { if (alive) setCum(null); });
    return () => { alive = false; };
  }, [list, settings, hasCompany, ourBiz]);
  const ourRankOf = useMemo(() => new Map((cum?.timeline ?? []).map((t) => [t.noticeId, t.ourRank] as const)), [cum]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (list ?? [])
      .filter((e) => !org || e.orgName.trim() === org)
      .filter((e) => !q || `${e.title} ${e.noticeNo} ${e.orgName} ${e.bidders.map((b) => b.name).join(' ')}`.toLowerCase().includes(q));
  }, [list, query, org]);
  const orgs = useMemo(() => orgOptions(list ?? [], (e) => e.orgName), [list]);
  const { sorted: rows, sort, toggle } = useSort<EvalIndexEntry, SortKey>(filtered, SORT_BY, { key: 'evaluatedAt', dir: 'desc' }, { bidders: 'desc', evaluatedAt: 'desc' });

  return (
    <div className="space-y-6">
      <PageTitle page="evaluations" />
      <FsErrorAlert error={error} onRetry={load} />
      {list && list.length === 0 && (
        <EmptyState title="가져온 평가점수 없음" hint="우리 회사가 참여한 공고는 개찰 결과가 확인되면 이 화면에 들어올 때 자동으로 가져옴. 다른 공고는 공고 화면에서 [평가점수 가져오기]" />
      )}
      {list && list.length > 0 && (
        <div className="space-y-3">
        {cum && <StatsStrip cum={cum} list={list} hasCompany={hasCompany} />}
        <div className="flex items-center justify-between gap-4 pt-2">
          <span className="text-sm text-muted">{query.trim() || org ? `${rows.length} / ${list.length}건` : `${list.length}건`}</span>
        <div className="flex items-center gap-2.5">
        <Select className="w-56" aria-label="기관" placeholder="전체 기관" value={org} options={orgs} onChange={setOrg} clearable />
        <div className="relative w-80">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
          <input className={`${inputClass} pl-9`} placeholder="공고명, 번호, 기관, 업체 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        </div>
        </div>
        <div className="max-h-[max(16rem,calc(100vh-20rem))] overflow-y-auto rounded-card border border-line bg-surface shadow-card">
          <div className={`${GRID} sticky top-0 z-10 bg-sunken py-3 text-sm text-muted`}>
            <div className="text-right">순번</div>
            <SortHeader label="공고명" k="title" sort={sort} onSort={toggle} />
            <SortHeader label="기관" k="org" sort={sort} onSort={toggle} />
            <SortHeader label="업체" k="bidders" sort={sort} onSort={toggle} />
            <div>우리 순위</div>
            <SortHeader label="평가 종료" k="evaluatedAt" sort={sort} onSort={toggle} />
            <SortHeader label="상태" k="status" sort={sort} onSort={toggle} />
          </div>
          {rows.length === 0 && <EmptyState size="sm" className="border-t border-line px-4 !py-10" title="조건에 맞는 평가가 없습니다." />}
          {rows.map((e, i) => (
            <a key={e.noticeId} href={evaluationHash(e.noticeId)} className={`${GRID} border-t border-line py-4 transition-colors hover:bg-sunken motion-reduce:transition-none`}>
              <div className="text-right font-mono text-sm text-muted tabular-nums">{i + 1}</div>
              <div className="min-w-0">
                <div className="truncate text-base font-semibold">{e.title}</div>
                <div className="mt-0.5 truncate text-sm text-muted"><span className="font-mono">{e.noticeNo}-{e.round}</span></div>
              </div>
              <div className="truncate text-sm text-muted" title={e.orgName}>{e.orgName || '—'}</div>
              <div className="font-mono text-sm text-muted tabular-nums">{e.bidders.length}</div>
              <OurRank rank={ourRankOf.get(e.noticeId)} known={cum !== null && hasCompany} />
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

/** 위원 평균 기준 우리 순위. 1위는 강조, 미참여는 흐리게 */
function OurRank({ rank, known }: { rank: number | null | undefined; known: boolean }) {
  if (!known || rank === undefined) return <div className="text-sm text-faint">—</div>;
  if (rank === null) return <div className="text-sm text-faint">미참여</div>;
  // 숫자만 고정폭 글꼴. '위'까지 mono로 두면 한글이 대체 글꼴로 떨어져 모양이 어긋난다
  return (
    <div className={`text-sm ${rank === 1 ? 'font-bold text-primary' : 'text-muted'}`}>
      <span className="font-mono tabular-nums">{rank}</span>위
    </div>
  );
}
