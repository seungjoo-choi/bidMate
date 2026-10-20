import { Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { filterSent, rangeOf, type SentPreset as Preset } from '../../core/dashboard/sent-filter';
import { PROVIDER_LABEL } from '../../core/model/mail-provider';
import type { SendSource, SentIndexEntry } from '../../core/types/compose';
import { send } from '../../messaging/bus';
import { EmptyState, StatusBadge } from '../../ui/components';
import { inputClass } from '../../ui/components/Field';
import { formatDateTime } from '../../ui/review/format';
import { FsErrorAlert } from './FsErrorAlert';
import { PageTitle } from './menu';
import { noticeHash } from './route';

const PRESETS: Array<{ id: Preset; label: string }> = [
  { id: '7d', label: '7일' }, { id: '30d', label: '30일' }, { id: 'month', label: '이번 달' }, { id: 'all', label: '전체' }, { id: 'custom', label: '직접 입력' },
];

const SOURCE_OPTIONS: Array<{ id: SendSource | 'all'; label: string }> = [
  { id: 'all', label: '전체' }, { id: 'auto', label: '자동' }, { id: 'manual', label: '수동' },
];

const TH = 'px-4 py-3 font-medium whitespace-nowrap';

export function SentHistoryPage() {
  const [list, setList] = useState<SentIndexEntry[] | null>(null);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const [preset, setPreset] = useState<Preset>('30d');
  const [fromStr, setFromStr] = useState('');
  const [toStr, setToStr] = useState('');
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<SendSource | 'all'>('all');
  const [includeVoided, setIncludeVoided] = useState(false);

  const load = useCallback(async () => {
    try {
      setList(await send('mail/sent-list', undefined));
      setError(null);
    } catch (e) {
      setError({ code: (e as { code?: string }).code, message: e instanceof Error ? e.message : String(e) });
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(
    () => filterSent(list ?? [], { ...rangeOf(preset, fromStr, toStr, new Date()), query, source, includeVoided }),
    [list, preset, fromStr, toStr, query, source, includeVoided],
  );

  const open = (id: string) => { location.hash = noticeHash(id, 'history'); };
  const chip = (active: boolean) =>
    `rounded-ctl px-3 py-1.5 text-sm transition-colors motion-reduce:transition-none ${active ? 'bg-select font-semibold text-ink' : 'font-medium text-muted hover:bg-sunken hover:text-ink'}`;

  return (
    <div className="space-y-6">
      <PageTitle page="sent" />
      <FsErrorAlert error={error} onRetry={load} />

      {list && list.length === 0 && <EmptyState title="기록된 발송이 없습니다" />}

      {list && list.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex items-center gap-1" role="group" aria-label="기간">
              {PRESETS.map((p) => (
                <button key={p.id} type="button" aria-pressed={preset === p.id} onClick={() => setPreset(p.id)} className={chip(preset === p.id)}>{p.label}</button>
              ))}
            </div>
            {preset === 'custom' && (
              <div className="flex items-center gap-2 text-sm text-muted">
                <input type="date" aria-label="시작일" className={`${inputClass} !w-40`} value={fromStr} onChange={(e) => setFromStr(e.target.value)} />
                <span>~</span>
                <input type="date" aria-label="종료일" className={`${inputClass} !w-40`} value={toStr} onChange={(e) => setToStr(e.target.value)} />
              </div>
            )}
            <div className="flex items-center gap-1" role="group" aria-label="출처">
              {SOURCE_OPTIONS.map((o) => (
                <button key={o.id} type="button" aria-pressed={source === o.id} onClick={() => setSource(o.id)} className={chip(source === o.id)}>{o.label}</button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={includeVoided} onChange={(e) => setIncludeVoided(e.target.checked)} />
              취소 포함
            </label>
            <div className="relative ml-auto w-80">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
              <input aria-label="검색" className={`${inputClass} pl-9`} placeholder="공고명, 번호, 제목, 기관 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          </div>

          <div className="max-h-[max(16rem,calc(100vh-20rem))] overflow-auto rounded-card border border-line bg-surface shadow-card">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 z-10 bg-sunken text-muted">
                <tr>
                  <th scope="col" className={TH}>발송 시각</th><th scope="col" className={TH}>공고번호</th><th scope="col" className={TH}>공고명</th><th scope="col" className={TH}>기관</th><th scope="col" className={TH}>제목</th>
                  <th scope="col" className={`${TH} text-right`}>받는 사람</th><th scope="col" className={`${TH} text-right`}>첨부</th><th scope="col" className={TH}>출처</th><th scope="col" className={TH}>확인</th><th scope="col" className={TH}>서비스</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={10} className="border-t border-line"><EmptyState size="sm" className="!py-10" title="조건에 맞는 발송이 없습니다." /></td></tr>
                )}
                {rows.map((r) => {
                  const voided = !!r.voidedAt;
                  const strike = voided ? 'line-through text-faint' : '';
                  return (
                    <tr
                      key={r.id}
                      onClick={() => open(r.noticeId)}
                      className="cursor-pointer border-t border-line transition-colors hover:bg-sunken motion-reduce:transition-none"
                    >
                      <td className={`px-4 py-3 font-mono whitespace-nowrap tabular-nums ${strike}`}>
                        <a href={noticeHash(r.noticeId, 'history')} onClick={(e) => e.stopPropagation()} className="text-accent hover:underline">{formatDateTime(r.sentAt)}</a>
                      </td>
                      <td className={`px-4 py-3 font-mono whitespace-nowrap ${strike}`}>{r.noticeNo}-{r.round}</td>
                      <td className={`max-w-64 truncate px-4 py-3 font-semibold ${strike}`}>{r.title}</td>
                      <td className={`max-w-40 truncate px-4 py-3 ${strike}`}>{r.orderingOrg}</td>
                      <td className={`max-w-64 truncate px-4 py-3 ${strike}`}>{r.subject}</td>
                      <td className={`px-4 py-3 text-right font-mono whitespace-nowrap tabular-nums ${strike}`}>{r.toCount}</td>
                      <td className={`px-4 py-3 text-right font-mono whitespace-nowrap tabular-nums ${strike}`}>{r.attachmentCount}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={strike}>{r.source === 'auto' ? '자동' : '수동'}</span>
                        {voided && <span className="ml-2 align-middle"><StatusBadge status="idle">취소됨</StatusBadge></span>}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {r.source === 'auto' ? (r.confirmed ? <StatusBadge status="ok">확인됨</StatusBadge> : <StatusBadge status="warn">완료 확인 없음</StatusBadge>) : <span className="text-muted">—</span>}
                      </td>
                      <td className={`px-4 py-3 whitespace-nowrap ${strike}`}>{r.provider ? PROVIDER_LABEL[r.provider] : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
