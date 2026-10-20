import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { IndexEntry } from '../../../core/types/index-file';
import { computeResultStats, defaultPeriod, type ResultStats, type StatsPeriod } from '../../../core/results/stats';
import { kindOf } from '../../../core/model/ids';
import { send } from '../../../messaging/bus';
import { Button, Card, EmptyState, InlineAlert, Select, useToast } from '../../../ui/components';
import { useSettings } from '../../../ui/hooks/useSettings';
import { formatPercent, formatWon, formatWonShort } from '../../../ui/notices/result-view';
import { FsErrorAlert } from '../FsErrorAlert';
import { PageTitle } from '../menu';
import { ResultBars } from './ResultBars';

/** "8.2억원" → ['8.2', '억원']. KPI에서 숫자와 단위를 다른 크기로 쓰기 위함 */
const splitUnit = (s: string): [string, string] => {
  const m = /^(.*?)(억원|만원|원)$/.exec(s);
  return m ? [m[1]!, m[2]!] : [s, ''];
};

function Segmented<T extends string | number>({ items, value, onChange, size = 'md', label }: {
  items: Array<{ id: T; label: string }>; value: T; onChange: (v: T) => void; size?: 'sm' | 'md'; label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-btn border border-line bg-sunken p-[3px]">
      {items.map((it) => {
        const on = it.id === value;
        return (
          <button
            key={String(it.id)}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(it.id)}
            className={`rounded-ctl transition-colors motion-reduce:transition-none ${size === 'sm' ? 'px-2.5 py-0.5 text-xs' : 'px-3.5 py-1 text-sm'} ${on ? 'bg-surface font-semibold text-ink shadow-card' : 'text-muted hover:text-ink'}`}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

function Meter({ ratio }: { ratio: number | null }) {
  return (
    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line">
      <i className="block h-full rounded-full bg-ok" style={{ width: `${Math.round((ratio ?? 0) * 100)}%` }} />
    </div>
  );
}

function Kpi({ label, value, unit, sub, win, meter }: { label: string; value: string; unit: string; sub: ReactNode; win?: boolean; meter?: number | null }) {
  return (
    <div className={`flex flex-col rounded-card border p-5 shadow-card ${win ? 'border-ok-line bg-linear-to-br from-ok-wash to-surface to-70%' : 'border-line bg-surface'}`}>
      <span className="text-sm font-medium text-muted">{label}</span>
      <div className="mt-2 flex items-baseline gap-0.5">
        <span className={`font-mono text-[1.875rem] leading-none font-bold tracking-tight tabular-nums ${win ? 'text-ok' : 'text-ink'}`}>{value}</span>
        <span className="text-base font-medium text-muted">{unit}</span>
      </div>
      {meter !== undefined && <Meter ratio={meter} />}
      <div className="mt-2 text-xs text-muted">{sub}</div>
    </div>
  );
}

const RANK_STYLE = [
  { key: 'first', label: '1위', cls: 'bg-ok' },
  { key: 'second', label: '2위', cls: 'bg-faint/50' },
  { key: 'thirdOrBelow', label: '3위 이하', cls: 'bg-line-strong' },
  { key: 'unknown', label: '순위 없음', cls: 'border border-dashed border-line-strong' },
] as const;

function RankDistribution({ ranks, total }: { ranks: ResultStats['ranks']; total: number }) {
  const rows = RANK_STYLE.map((r) => ({ ...r, n: ranks[r.key] })).filter((r) => r.key !== 'unknown' || r.n > 0);
  return (
    <div>
      <div className="flex h-7 gap-0.5 overflow-hidden rounded-ctl" aria-hidden>
        {rows.filter((r) => r.n > 0).map((r) => <i key={r.key} className={`block h-full ${r.cls}`} style={{ width: `${(r.n / total) * 100}%` }} />)}
      </div>
      <ul className="mt-4 space-y-2.5">
        {rows.map((r) => (
          <li key={r.key} className="grid grid-cols-[12px_1fr_auto_3rem] items-center gap-2.5 text-sm">
            <i className={`size-3 rounded-[3px] ${r.cls}`} aria-hidden />
            <span>{r.label}</span>
            <span className="font-mono font-semibold tabular-nums">{r.n}건</span>
            <span className="text-right font-mono text-xs text-muted tabular-nums">{Math.round((r.n / total) * 100)}%</span>
          </li>
        ))}
      </ul>
      <div className="mt-5 flex items-baseline justify-between border-t border-line pt-4 text-sm text-muted">
        <span>평균 참여업체</span>
        <span><b className="font-mono text-base text-ink tabular-nums">{ranks.avgBidders === null ? '—' : ranks.avgBidders.toFixed(1)}</b> 개사</span>
      </div>
    </div>
  );
}

function OrgTable({ rows }: { rows: ResultStats['byOrg'] }) {
  const zero = <span className="text-faint">0</span>;
  return (
    <div className="-mx-6 -my-5 max-h-[24rem] overflow-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted">
            {['기관', '투찰', '낙찰', '낙찰률', '투찰금액', '낙찰금액'].map((h, i) => (
              <th key={h} className={`sticky top-0 bg-sunken px-3.5 py-2.5 font-medium whitespace-nowrap ${i === 0 ? 'pl-6 text-left' : 'text-right'} ${i === 5 ? 'pr-6' : ''}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="font-mono tabular-nums">
          {rows.map((o) => (
            <tr key={o.org} className="border-t border-line hover:bg-sunken">
              <td className="max-w-[14rem] py-2.5 pr-3.5 pl-6 font-sans font-medium">{o.org}</td>
              <td className="px-3.5 text-right">{o.bids}</td>
              <td className="px-3.5 text-right">{o.won ? <b className="text-ok">{o.won}</b> : zero}</td>
              <td className="px-3.5 text-right">
                <span className="inline-flex items-center gap-2">
                  {formatPercent(o.winRate)}
                  <span className="h-[5px] w-11 overflow-hidden rounded-full bg-line">
                    <i className="block h-full bg-ok" style={{ width: `${Math.round((o.winRate ?? 0) * 100)}%` }} />
                  </span>
                </span>
              </td>
              <td className="px-3.5 text-right whitespace-nowrap">{o.bidAmount ? formatWon(o.bidAmount) : zero}</td>
              <td className="py-2.5 pr-6 pl-3.5 text-right whitespace-nowrap">{o.wonAmount ? formatWon(o.wonAmount) : zero}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StatsPage() {
  const [list, setList] = useState<IndexEntry[] | null>(null);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const [period, setPeriod] = useState<StatsPeriod | null>(null);
  const [mode, setMode] = useState<'count' | 'amount'>('count');
  const [refreshing, setRefreshing] = useState(false);
  const { settings } = useSettings();
  const [hasG2bKey, setHasG2bKey] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await send('notice/list', undefined));
      setError(null);
    } catch (e) {
      setError({ code: (e as { code?: string }).code, message: e instanceof Error ? e.message : String(e) });
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  // 들어올 때 결과를 한 번 확인한다(투찰금액 백필 포함, SW가 10분 스로틀). 바뀐 게 있으면 다시 불러온다.
  useEffect(() => {
    void send('result/refresh', { reason: 'list' }, { timeoutMs: 150_000 })
      .then((r) => { if (r.updated > 0) void load(); })
      .catch(() => undefined);
  }, [load]);
  useEffect(() => {
    void chrome.storage.local.get('secrets')
      .then(({ secrets }) => setHasG2bKey(!!(secrets as { g2bServiceKey?: string } | undefined)?.g2bServiceKey))
      .catch(() => setHasG2bKey(null));
  }, []);

  const now = useMemo(() => new Date(), []);
  const active: StatsPeriod | null = list ? (period ?? defaultPeriod(list, now)) : null;
  const stats = useMemo(() => (list && active !== null ? computeResultStats({ entries: list, period: active, now }) : null), [list, active, now]);

  const toast = useToast();
  const recheck = async () => {
    setRefreshing(true);
    try {
      const r = await send('result/refresh', { reason: 'manual' }, { timeoutMs: 150_000 });
      if (r.updated > 0) await load();
      if (r.skipped === 'BUSY') toast.show('이미 결과를 확인하는 중입니다. 잠시 뒤 다시 눌러 주세요.');
      else if (r.skipped === 'NO_KEY' || r.skipped === 'KEY_INVALID') toast.show('나라장터 서비스키를 확인해 주세요.');
      else if (r.skipped === 'NO_BIZNO') toast.show('설정에서 사업자등록번호를 확인해 주세요.');
      else if (r.skipped === 'THROTTLED') toast.show('방금 확인했습니다. 몇 분 뒤 다시 눌러 주세요.');
      else if (r.updated === 0) toast.show('새로 확인된 투찰금액이 없습니다.');
    } catch { toast.show('결과 확인에 실패했습니다. 잠시 뒤 다시 시도해 주세요.'); } finally {
      setRefreshing(false);
    }
  };

  const missingKey = hasG2bKey === false;
  const missingBiz = !!settings && !settings.company.bizNo;
  const needsSetup = (missingKey || missingBiz) && (list ?? []).some((n) => kindOf(n) !== 'prespec');
  const setupWhat = missingKey && missingBiz ? '나라장터 서비스키와 사업자등록번호를' : missingKey ? '나라장터 서비스키를' : '사업자등록번호를';
  const openSetup = () => { void send('ui/open', { page: 'settings', section: missingKey ? 'g2b' : 'company' }).catch(() => undefined); };

  const periodItems = stats ? [...stats.years.map((y) => ({ id: y as StatsPeriod, label: String(y) })), { id: 'all' as StatsPeriod, label: '전체' }] : [];
  const c = stats?.counts;
  const a = stats?.amounts;
  const [wonV, wonU] = splitUnit(formatWonShort(a?.wonTotal ?? 0));
  const [bidV, bidU] = splitUnit(formatWonShort(a?.bidTotal ?? 0));
  const currentKey = active === now.getFullYear() ? `${active}-${String(now.getMonth() + 1).padStart(2, '0')}` : active === 'all' ? String(now.getFullYear()) : undefined;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1.5">
          <PageTitle page="stats" />
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            앱에 등록해 결과를 추적한 공고만 집계합니다.
            {a && a.missingBid > 0 && (
              <>
                <span className="inline-flex items-center gap-1.5 text-ink">
                  <i className="size-1.5 rounded-full bg-faint" aria-hidden />
                  투찰금액 미확인 {a.missingBid}건
                </span>
                <Button
                  variant="secondary" className="!h-7 !px-2.5 !text-xs" onClick={() => void recheck()} disabled={refreshing}
                  icon={<RefreshCw className={refreshing ? 'animate-spin' : ''} aria-hidden />}
                >
                  {refreshing ? '확인 중' : '결과 다시 확인'}
                </Button>
              </>
            )}
          </p>
        </div>
        {stats && active !== null && (
          <Select
            className="w-32 shrink-0" aria-label="기간" searchable={false}
            value={String(active)}
            options={periodItems.map((p) => ({ value: String(p.id), label: p.id === 'all' ? p.label : `${p.label}년` }))}
            onChange={(v) => setPeriod(v === 'all' ? 'all' : Number(v))}
          />
        )}
      </div>

      <FsErrorAlert error={error} onRetry={load} />
      {needsSetup && (
        <InlineAlert>
          <span className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <span>낙찰 결과를 집계하려면 설정에서 {setupWhat} 저장하세요.</span>
            <Button variant="secondary" className="!h-8 !px-3" onClick={openSetup}>설정 열기</Button>
          </span>
        </InlineAlert>
      )}
      {!list && !error && <p className="text-muted">불러오는 중...</p>}

      {stats && c && a && c.bids === 0 && (
        <EmptyState title="아직 집계할 결과가 없습니다" hint="공고를 수집하고 개찰이 끝나면 여기에 쌓입니다." />
      )}

      {stats && c && a && c.bids > 0 && (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
            <Kpi label="투찰" value={String(c.bids)} unit="건" sub={c.pending > 0 ? `결과 대기 ${c.pending}건 포함` : '모두 결과 확정'} />
            <Kpi label="낙찰" value={String(c.won)} unit="건" win sub={`탈락 ${c.lost}건`} />
            <Kpi
              label="낙찰률" value={formatPercent(c.winRate).replace('%', '')} unit={c.winRate === null ? '' : '%'}
              meter={c.winRate} sub={`결과 확정 ${c.won + c.lost}건 기준`}
            />
            <Kpi
              label="투찰금액" value={a.bidTotal > 0 ? bidV : '-'} unit={a.bidTotal > 0 ? bidU : ''}
              sub={a.bidTotal === 0 ? '투찰금액 확인 전' : a.missingBid > 0 ? `미확인 ${a.missingBid}건 제외한 합계` : `투찰 ${c.bids}건 합계`}
            />
            <Kpi
              label="낙찰금액" value={wonV} unit={wonU} meter={a.amountWinRate}
              sub={a.bidTotal > 0 ? `투찰 ${formatWonShort(a.bidTotal)}${a.amountWinRate === null ? '' : `의 ${formatPercent(a.amountWinRate)}`}` : '투찰금액 확인 전'}
            />
          </div>

          <Card
            title={active === 'all' ? '연도별 투찰과 낙찰' : '월별 투찰과 낙찰'}
            action={
              <div className="flex items-center gap-4">
                <span className="hidden items-center gap-3.5 text-xs text-muted sm:flex">
                  <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-faint/50" />투찰</span>
                  <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-ok" />낙찰</span>
                </span>
                <Segmented label="막대 기준" size="sm" items={[{ id: 'count' as const, label: '건수' }, { id: 'amount' as const, label: '금액' }]} value={mode} onChange={setMode} />
              </div>
            }
          >
            <ResultBars monthly={stats.monthly} mode={mode} year={typeof active === 'number' ? active : null} currentKey={currentKey} />
            {mode === 'amount' && <p className="text-xs text-faint">막대 위 숫자는 억원 단위입니다.</p>}
          </Card>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_3fr]">
            <Card title="순위 분포" description={`투찰 ${c.bids}건`}>
              <RankDistribution ranks={stats.ranks} total={c.bids} />
            </Card>
            <Card title="발주기관별" description={`${stats.byOrg.length}개 기관`}>
              <OrgTable rows={stats.byOrg} />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
