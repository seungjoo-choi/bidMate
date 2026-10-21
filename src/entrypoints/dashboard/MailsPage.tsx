import { AlarmClock, ArrowRight, Check, Mail, PenLine, Search, Send, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { IndexEntry } from '../../core/types/index-file';
import type { MailStatus } from '../../core/types/notice';
import { send } from '../../messaging/bus';
import { Button, EmptyState, useToast } from '../../ui/components';
import { inputClass } from '../../ui/components/Field';
import { dDayLevel, formatDDay, formatDateTime, isDueSoon, isPast } from '../../ui/review/format';
import { FsErrorAlert } from './FsErrorAlert';
import { PageTitle } from './menu';
import { mailsHash, type MailsTab } from './route';
import { SentHistoryPage } from './SentHistoryPage';

type DraftStatus = Extract<MailStatus, 'drafting' | 'ready_for_review'>;
type DraftEntry = IndexEntry & { mailStatus: DraftStatus };
type Filter = 'all' | DraftStatus | 'due';
type FsError = { code?: string; message: string };

const isDraft = (e: IndexEntry): e is DraftEntry => e.mailStatus === 'drafting' || e.mailStatus === 'ready_for_review';

/** 마감이 가까운 순, 마감 없는 공고는 최근 작성순으로 뒤에 */
function byClose(a: IndexEntry, b: IndexEntry): number {
  const ta = a.bidCloseAt ? Date.parse(a.bidCloseAt) : NaN;
  const tb = b.bidCloseAt ? Date.parse(b.bidCloseAt) : NaN;
  if (Number.isNaN(ta) && Number.isNaN(tb)) return (b.lastComposedAt ?? '').localeCompare(a.lastComposedAt ?? '');
  if (Number.isNaN(ta)) return 1;
  if (Number.isNaN(tb)) return -1;
  return ta - tb;
}

const mailHref = (id: string) => `#/mail/${encodeURIComponent(id)}?from=mails`;
const toFsError = (e: unknown): FsError => ({ code: (e as { code?: string }).code, message: e instanceof Error ? e.message : String(e) });

export function MailsPage({ tab }: { tab: MailsTab }) {
  const [drafts, setDrafts] = useState<DraftEntry[] | null>(null);
  const [error, setError] = useState<FsError | null>(null);

  const load = useCallback(async () => {
    try {
      setDrafts((await send('notice/list', undefined)).filter(isDraft).sort(byClose));
      setError(null);
    } catch (e) {
      setError(toFsError(e));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const tabs: Array<{ id: MailsTab; label: string; Icon: LucideIcon; count?: number }> = [
    { id: 'drafts', label: '작성 중인 메일', Icon: PenLine, count: drafts?.length },
    { id: 'sent', label: '발송 이력', Icon: Send },
  ];

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <PageTitle page="mails" />
        <p className="text-sm text-muted">작성 중인 메일을 마저 쓰고, 보낸 메일은 발송 완료로 기록합니다. 기록한 메일은 발송 이력 탭에 모입니다.</p>
      </div>

      {/* 밑줄 탭(공고 상세 TabBar와 같은 모양) */}
      <div role="tablist" aria-label="메일 관리" className="flex max-w-full gap-7 overflow-x-auto shadow-[inset_0_-1px_0_var(--color-line)]">
        {tabs.map(({ id, label, Icon, count }) => {
          const on = tab === id;
          return (
            <a
              key={id}
              role="tab"
              href={mailsHash(id)}
              aria-selected={on}
              className={`inline-flex shrink-0 items-center gap-1.5 border-b-2 pt-1 pb-2.5 text-sm whitespace-nowrap transition-colors motion-reduce:transition-none ${
                on ? 'border-ink font-bold text-ink' : 'border-transparent font-medium text-muted hover:text-ink'
              }`}
            >
              <Icon className="size-4" aria-hidden />
              {label}
              {count !== undefined && (
                <span className="text-xs text-faint tabular-nums">{count}</span>
              )}
            </a>
          );
        })}
      </div>

      {tab === 'drafts' ? <DraftsPanel list={drafts} error={error} reload={load} /> : <SentHistoryPage />}
    </div>
  );
}

const TONE = {
  default: { chip: 'bg-sunken text-muted', value: 'text-ink' },
  warn: { chip: 'bg-warn-wash text-warn', value: 'text-warn' },
  danger: { chip: 'bg-danger-wash text-danger', value: 'text-danger' },
} as const;

/** 홈 StatCard와 같은 모양. 누르면 아래 목록을 그 조건으로 거른다 */
function SummaryCard({ label, sub, value, Icon, tone, active, onClick }: {
  label: string; sub: string; value: number; Icon: LucideIcon; tone: keyof typeof TONE; active: boolean; onClick: () => void;
}) {
  const t = TONE[value === 0 ? 'default' : tone];
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex flex-col rounded-card border bg-surface p-5 text-left shadow-card transition-[box-shadow,border-color] motion-reduce:transition-none ${
        active ? 'border-ink ring-1 ring-ink' : 'border-line hover:border-line-strong hover:shadow-raised'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-muted">{label}</span>
        <span className={`grid size-8 shrink-0 place-items-center rounded-btn ${t.chip}`}><Icon className="size-4" aria-hidden /></span>
      </div>
      <div className="mt-3 flex items-baseline gap-1">
        <span className={`font-mono text-[1.75rem] leading-none font-bold tracking-tight tabular-nums ${t.value}`}>{value}</span>
        <span className="text-sm text-muted">건</span>
      </div>
      <div className="mt-2 truncate text-xs text-faint">{sub}</div>
    </button>
  );
}

const STATUS: Record<DraftStatus, { label: string; Icon: LucideIcon; chip: string; text: string }> = {
  drafting: { label: '초안 작성됨', Icon: PenLine, chip: 'bg-sunken text-muted', text: 'text-muted' },
  ready_for_review: { label: '웹메일 작성됨', Icon: Send, chip: 'bg-warn-wash text-warn', text: 'text-warn' },
};

const FILTER_LABEL: Record<Filter, string> = { all: '작성 중', drafting: '초안 작성됨', ready_for_review: '웹메일 작성됨', due: '마감 3일 이내' };

function DraftsPanel({ list, error, reload }: { list: DraftEntry[] | null; error: FsError | null; reload: () => Promise<void> }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<FsError | null>(null);
  const toast = useToast();
  const now = new Date();

  const counts = useMemo(() => {
    const all = list ?? [];
    const t = new Date();
    return {
      all: all.length,
      drafting: all.filter((e) => e.mailStatus === 'drafting').length,
      ready_for_review: all.filter((e) => e.mailStatus === 'ready_for_review').length,
      due: all.filter((e) => isDueSoon(e.bidCloseAt, t)).length,
    };
  }, [list]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const t = new Date();
    return (list ?? []).filter((e) =>
      (filter === 'all' || (filter === 'due' ? isDueSoon(e.bidCloseAt, t) : e.mailStatus === filter))
      && (!q || [e.title, e.noticeNo, e.orderingOrg].some((v) => v?.toLowerCase().includes(q))));
  }, [list, query, filter]);

  /** 같은 카드를 다시 누르면 전체로 돌아간다 */
  const pick = (f: Filter) => setFilter((cur) => (cur === f ? 'all' : f));
  const go = (id: string) => { location.hash = mailHref(id); };

  const recordSent = async (e: DraftEntry) => {
    setBusy(e.noticeId);
    setActionError(null);
    try {
      await send('mail/sent-add', { noticeId: e.noticeId });
      void send('deadline/refresh', { reason: 'manual' }).catch(() => undefined);
      toast.show('발송 이력에 기록했습니다');
      await reload();
    } catch (err) {
      setActionError(toFsError(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <FsErrorAlert error={error ?? actionError} onRetry={reload} />

      {list && list.length === 0 && (
        <EmptyState title="작성 중인 메일이 없습니다" hint="공고 상세에서 메일 작성 준비를 누르면 여기에 모입니다. 발송 완료로 기록한 메일은 발송 이력 탭에 있습니다." />
      )}

      {list && list.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <SummaryCard label="작성 중" sub="아직 보내지 않은 메일 전체" value={counts.all} Icon={Mail} tone="default" active={filter === 'all'} onClick={() => setFilter('all')} />
            <SummaryCard label="초안 작성됨" sub="마저 쓰고 웹메일로 작성" value={counts.drafting} Icon={PenLine} tone="default" active={filter === 'drafting'} onClick={() => pick('drafting')} />
            <SummaryCard label="웹메일 작성됨" sub="보냈다면 발송 완료로 기록" value={counts.ready_for_review} Icon={Send} tone="warn" active={filter === 'ready_for_review'} onClick={() => pick('ready_for_review')} />
            <SummaryCard label="마감 3일 이내" sub="먼저 처리할 메일" value={counts.due} Icon={AlarmClock} tone="danger" active={filter === 'due'} onClick={() => pick('due')} />
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-muted">
                <span className="font-semibold text-ink">{FILTER_LABEL[filter]}</span>
                <span className="ml-1.5 font-mono font-semibold text-ink tabular-nums">{rows.length}</span>건
                {filter !== 'all' && <button type="button" className="ml-3 text-accent hover:underline" onClick={() => setFilter('all')}>전체 보기</button>}
              </div>
              <div className="relative w-full max-w-sm">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" aria-hidden />
                <input type="search" aria-label="검색" className={`${inputClass} pl-9`} placeholder="공고명, 번호, 기관 검색" value={query} onChange={(ev) => setQuery(ev.target.value)} />
              </div>
            </div>

            <ul className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
              {rows.length === 0 && <li><EmptyState size="sm" className="!py-10" title="조건에 맞는 메일이 없습니다." /></li>}
              {rows.map((e) => {
                const st = STATUS[e.mailStatus];
                const past = isPast(e.bidCloseAt, now);
                const dday = formatDDay(e.bidCloseAt, now);
                const level = dDayLevel(dday);
                const pill = past ? 'bg-sunken text-faint' : level === 'urgent' ? 'bg-danger-wash text-danger' : level === 'soon' ? 'bg-warn-wash text-warn' : 'bg-sunken text-muted';
                return (
                  <li key={e.noticeId} className={`flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-line px-5 py-4 transition-colors first:border-t-0 hover:bg-sunken/60 motion-reduce:transition-none ${past ? 'opacity-60' : ''}`}>
                    <span className={`grid size-10 shrink-0 place-items-center rounded-btn ${st.chip}`} title={st.label}><st.Icon className="size-[18px]" aria-hidden /></span>

                    <a href={mailHref(e.noticeId)} className="group min-w-0 flex-1">
                      <div className="truncate font-semibold text-ink group-hover:underline" title={e.title}>{e.title}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
                        <span className={`font-semibold ${st.text}`}>{st.label}</span>
                        <span className="font-mono">{e.noticeNo}-{e.round}</span>
                        {e.orderingOrg && <span className="truncate">{e.orderingOrg}</span>}
                        {e.lastComposedAt && <span>웹메일 작성 <span className="font-mono tabular-nums">{formatDateTime(e.lastComposedAt)}</span></span>}
                      </div>
                    </a>

                    <div className="w-36 shrink-0 text-right">
                      {e.bidCloseAt ? (
                        <>
                          <span className={`inline-block rounded-full px-2.5 py-0.5 font-mono text-xs font-bold tabular-nums ${pill}`}>{past ? '마감' : (dday ?? '마감 전')}</span>
                          <div className="mt-1 font-mono text-xs text-faint tabular-nums">{formatDateTime(e.bidCloseAt)}</div>
                        </>
                      ) : <span className="text-xs text-faint">마감일 없음</span>}
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {e.mailStatus === 'ready_for_review' ? (
                        <>
                          <Button variant="secondary" onClick={() => go(e.noticeId)}>열기</Button>
                          <Button icon={<Check />} loading={busy === e.noticeId} disabled={busy !== null && busy !== e.noticeId} onClick={() => void recordSent(e)}>발송 완료로 기록</Button>
                        </>
                      ) : (
                        <Button variant="secondary" icon={<ArrowRight />} onClick={() => go(e.noticeId)}>이어 쓰기</Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
      {toast.node}
    </div>
  );
}
