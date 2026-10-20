import { Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { filterSent, rangeOf, type SentPreset as Preset } from '../../core/dashboard/sent-filter';
import { PROVIDER_LABEL } from '../../core/model/mail-provider';
import type { SendSource, SentIndexEntry } from '../../core/types/compose';
import { send } from '../../messaging/bus';
import { EmptyState, Select, StatusBadge } from '../../ui/components';
import { inputClass } from '../../ui/components/Field';
import { formatDateTime } from '../../ui/review/format';
import { FsErrorAlert } from './FsErrorAlert';
import { PageTitle } from './menu';
import { noticeHash } from './route';

const PRESETS: Array<{ value: Preset; label: string }> = [
  { value: '7d', label: '최근 7일' }, { value: '30d', label: '최근 30일' }, { value: 'month', label: '이번 달' }, { value: 'all', label: '전체 기간' }, { value: 'custom', label: '기간 직접 입력' },
];

const SOURCE_OPTIONS: Array<{ value: SendSource | 'all'; label: string }> = [
  { value: 'all', label: '자동·수동 모두' }, { value: 'auto', label: '자동 기록만' }, { value: 'manual', label: '수동 기록만' },
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

  return (
    <div className="space-y-6">
      <PageTitle page="sent" />
      <FsErrorAlert error={error} onRetry={load} />

      {list && list.length === 0 && <EmptyState title="기록된 발송이 없습니다" />}

      {list && list.length > 0 && (
        <>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-60 flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
                <input aria-label="검색" className={`${inputClass} pl-9`} placeholder="공고명, 번호, 제목, 기관 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <Select className="w-40 shrink-0" aria-label="기간" value={preset} options={PRESETS} onChange={(v) => setPreset(v as Preset)} searchable={false} />
              {preset === 'custom' && (
                <div className="flex items-center gap-2 text-sm text-muted">
                  <input type="date" aria-label="시작일" className={`${inputClass} !w-40`} value={fromStr} onChange={(e) => setFromStr(e.target.value)} />
                  <span>~</span>
                  <input type="date" aria-label="종료일" className={`${inputClass} !w-40`} value={toStr} onChange={(e) => setToStr(e.target.value)} />
                </div>
              )}
              <Select className="w-40 shrink-0" aria-label="출처" value={source} options={SOURCE_OPTIONS} onChange={(v) => setSource(v as SendSource | 'all')} searchable={false} />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted">총 <span className="font-semibold text-ink tabular-nums">{rows.length}</span>건</span>
              <label className="flex cursor-pointer items-center gap-2 text-muted hover:text-ink">
                <input type="checkbox" checked={includeVoided} onChange={(e) => setIncludeVoided(e.target.checked)} />
                취소된 발송 포함
              </label>
            </div>

            <div className="max-h-[max(16rem,calc(100vh-22rem))] overflow-y-auto rounded-card border border-line bg-surface shadow-card">
              <table className="w-full table-fixed text-left text-sm">
                <colgroup>
                  <col className="w-14" /><col className="w-32" /><col /><col className="w-[30%]" /><col className="w-28" /><col className="w-40" /><col className="w-24" />
                </colgroup>
                <thead className="sticky top-0 z-10 bg-sunken text-muted">
                  <tr>
                    <th scope="col" className={`${TH} text-right`}>No.</th>
                    <th scope="col" className={TH}>발송 시각</th>
                    <th scope="col" className={TH}>공고</th>
                    <th scope="col" className={TH}>메일 제목</th>
                    <th scope="col" className={`${TH} text-right`}>수신 · 첨부</th>
                    <th scope="col" className={TH}>상태</th>
                    <th scope="col" className={TH}>서비스</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr><td colSpan={7} className="border-t border-line"><EmptyState size="sm" className="!py-10" title="조건에 맞는 발송이 없습니다." /></td></tr>
                  )}
                  {rows.map((r, i) => {
                    const voided = !!r.voidedAt;
                    const strike = voided ? 'line-through text-faint' : '';
                    return (
                      <tr
                        key={r.id}
                        onClick={() => open(r.noticeId)}
                        className="cursor-pointer border-t border-line align-middle transition-colors hover:bg-sunken motion-reduce:transition-none"
                      >
                        <td className="px-4 py-3 text-right font-mono text-faint tabular-nums">{rows.length - i}</td>
                        <td className={`px-4 py-3 font-mono whitespace-nowrap tabular-nums ${strike}`}>
                          <a href={noticeHash(r.noticeId, 'history')} onClick={(e) => e.stopPropagation()} className="text-accent hover:underline">{formatDateTime(r.sentAt)}</a>
                        </td>
                        <td className={`px-4 py-3 ${strike}`}>
                          <div className="truncate font-semibold text-ink" title={r.title}>{r.title}</div>
                          <div className="mt-0.5 truncate text-xs text-muted">
                            <span className="font-mono">{r.noticeNo}-{r.round}</span>
                            {r.orderingOrg && <span> · {r.orderingOrg}</span>}
                          </div>
                        </td>
                        <td className={`truncate px-4 py-3 ${strike}`} title={r.subject}>{r.subject}</td>
                        <td className={`px-4 py-3 text-right whitespace-nowrap tabular-nums ${strike}`}>
                          {r.toCount}<span className="text-muted">명</span>
                          <span className="mx-1.5 text-faint">·</span>
                          {r.attachmentCount}<span className="text-muted">개</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className={`text-sm ${voided ? 'text-faint' : 'text-muted'}`}>{r.source === 'auto' ? '자동' : '수동'}</span>
                            {voided
                              ? <StatusBadge status="idle">취소됨</StatusBadge>
                              : r.source === 'auto' && (r.confirmed ? <StatusBadge status="ok">확인됨</StatusBadge> : <StatusBadge status="warn">확인 없음</StatusBadge>)}
                          </div>
                        </td>
                        <td className={`truncate px-4 py-3 ${strike}`}>{r.provider ? PROVIDER_LABEL[r.provider] : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
