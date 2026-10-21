import { ChevronLeft, Loader2, Search, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { IndexEntry } from '../../../core/types/index-file';
import type { RfpDocCandidate } from '../../../core/types/rfp';
import { send } from '../../../messaging/bus';
import { Button, InlineAlert, Select } from '../../../ui/components';
import { formatDate } from '../../../ui/review/format';
import type { Side } from './DocSlot';
import { checkUploadFile, defaultCandidate, filterEntries, filterFacets, orgFacets, orgLabel, recommend, yearFacets, type Recommended } from './rfp-page-logic';

export interface PickerBase { noticeId: string; title: string; org: string }

interface Row { entry: IndexEntry; rec?: Recommended }

export function NoticePicker({ side, other, onClose, onSelect, onFile }: {
  side: Side;
  /** 다른 칸이 공고면 추천 기준 */
  other?: PickerBase;
  onClose: () => void;
  onSelect: (entry: IndexEntry, cands: RfpDocCandidate[], cand: RfpDocCandidate) => void;
  onFile: (file: File) => void;
}) {
  const [entries, setEntries] = useState<IndexEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [chosen, setChosen] = useState<IndexEntry | null>(null);
  const [cands, setCands] = useState<RfpDocCandidate[] | null>(null);
  const [candError, setCandError] = useState<string | null>(null);
  const [candIdx, setCandIdx] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const docsTok = useRef(0);
  const alive = useRef(true);
  // StrictMode 이중 마운트(정리 → 재마운트) 뒤에도 true로 되돌린다
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => {
    let alive = true;
    send('notice/list', undefined).then((l) => { if (alive) setEntries(l); }, (e) => { if (alive) setLoadError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, []);

  const [year, setYear] = useState('');
  const [org, setOrg] = useState('');
  const years = useMemo(() => yearFacets(entries ?? []), [entries]);
  const orgs = useMemo(() => orgFacets(entries ?? []), [entries]);

  const rows = useMemo<{ recs: Row[]; rest: Row[] }>(() => {
    const list = filterFacets(filterEntries(entries ?? [], query), { year, org });
    const recAll = recommend(list, other);
    const recIds = new Set(recAll.map((r) => r.entry.noticeId));
    return {
      recs: recAll.map((rec) => ({ entry: rec.entry, rec })),
      rest: list.filter((e) => !recIds.has(e.noticeId) && e.noticeId !== other?.noticeId).map((entry) => ({ entry })),
    };
  }, [entries, query, other, year, org]);
  const flat = useMemo(() => [...rows.recs, ...rows.rest], [rows]);

  useEffect(() => { setActive(0); }, [query, year, org]);
  useEffect(() => { activeRef.current?.scrollIntoView({ block: 'nearest' }); }, [active]);

  const choose = (entry: IndexEntry) => {
    setChosen(entry);
    setCands(null);
    setCandError(null);
    const t = ++docsTok.current;
    send('rfp/docs', { noticeId: entry.noticeId }, { timeoutMs: 40_000 }).then((list) => {
      if (!alive.current || docsTok.current !== t) return;
      setCands(list);
      const d = defaultCandidate(list.filter((c) => c.status !== 'unsupported'));
      setCandIdx(Math.max(0, d ? list.indexOf(d) : 0));
    }, (e) => { if (alive.current && docsTok.current === t) setCandError(e instanceof Error ? e.message : String(e)); });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Escape') { if (chosen) setChosen(null); else onClose(); return; }
      if (chosen) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, flat.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
      else if (e.key === 'Enter' && flat[active]) { e.preventDefault(); choose(flat[active].entry); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const pickFile = (f: File | undefined) => {
    if (!f) return;
    const c = checkUploadFile(f.name, f.size);
    if (!c.ok) { setLoadError(c.reason); return; }
    onFile(f);
    onClose();
  };

  const tagText = side === 'prev' ? '비교 대상' : '기준 문서';
  const sel = cands?.[candIdx];

  const renderRow = (row: Row, i: number) => {
    const { entry, rec } = row;
    return (
      <button
        key={`${rec ? 'r' : 'n'}-${entry.noticeId}`}
        ref={i === active ? activeRef : undefined}
        type="button"
        onMouseMove={() => setActive(i)}
        onClick={() => choose(entry)}
        className={`flex w-full items-start gap-3 rounded-ctl px-3 py-2.5 text-left ${i === active ? 'bg-select' : 'hover:bg-sunken'}`}
      >
        <div className="min-w-0 flex-1">
          <div className="text-[15px] leading-snug font-semibold [overflow-wrap:anywhere]">{entry.title}</div>
          <div className="mt-0.5 truncate text-[13px] text-muted">{orgLabel(entry)} · {entry.noticeNo} · {formatDate(entry.collectedAt)}</div>
        </div>
        {rec && (
          <div className="flex shrink-0 gap-1.5">
            {rec.sameName && <span className="rounded-[5px] bg-btn-pri-wash px-2 text-xs leading-5 font-semibold text-btn-pri-ink">같은 사업명</span>}
            {rec.sameOrg && <span className="rounded-[5px] bg-info-wash px-2 text-xs leading-5 font-semibold text-accent">같은 기관</span>}
            {!rec.sameName && rec.sim >= 0.3 && <span className="rounded-[5px] bg-sunken px-2 text-xs leading-5 font-semibold text-muted">이름 유사 {Math.round(rec.sim * 100)}%</span>}
          </div>
        )}
      </button>
    );
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-label={`${tagText} 고르기`} className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-card border border-line bg-surface shadow-overlay">
        <div className="space-y-3 border-b border-line px-5 pt-4 pb-3.5">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">{tagText} 고르기</h3>
            <Button variant="ghost" size="icon" aria-label="닫기" onClick={onClose}><X /></Button>
          </div>
          <div className="flex items-center gap-1.5 text-[13px] text-faint">
            <span className={chosen ? '' : 'font-semibold text-ink'}>1 공고 고르기</span>
            <span>›</span>
            <span className={chosen ? 'font-semibold text-ink' : ''}>2 문서 확인</span>
          </div>
          {!chosen && (
            <div className="flex gap-2">
              <div className="w-32 shrink-0">
                <Select aria-label="연도" value={year} onChange={setYear}
                  options={[{ value: '', label: '전체 연도' }, ...years.map((y) => ({ value: String(y.year), label: `${y.year}년`, hint: `${y.count}` }))]} />
              </div>
              <div className="w-44 shrink-0">
                <Select aria-label="기관" value={org} onChange={setOrg}
                  options={[{ value: '', label: '전체 기관' }, ...orgs.map((o) => ({ value: o.org, label: o.org, hint: `${o.count}` }))]} />
              </div>
              <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-ctl border border-line-strong bg-surface px-3 text-sm focus-within:border-primary">
                <Search className="size-4 text-faint" />
                <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="공고명, 공고번호, 기관명으로 검색" className="min-w-0 flex-1 bg-transparent outline-none" />
              </label>
            </div>
          )}
        </div>

        <div className="min-h-[280px] flex-1 overflow-auto px-3 py-3">
          {!chosen && (
            <>
              {loadError && <InlineAlert tone="error">{loadError}</InlineAlert>}
              {!entries && !loadError && <div className="flex items-center gap-2 px-3 py-6 text-sm text-muted"><Loader2 className="size-4 animate-spin" />공고를 불러오는 중…</div>}
              {entries && flat.length === 0 && <div className="px-3 py-10 text-center text-sm text-muted">맞는 공고가 없어요.</div>}
              {rows.recs.length > 0 && (
                <>
                  <div className="px-3 pt-1 pb-1.5 text-xs font-semibold text-muted">추천 · 사업명이 같거나 비슷하고, 같은 기관 공고를 위로 모았어요</div>
                  {rows.recs.map((r, i) => renderRow(r, i))}
                </>
              )}
              {rows.rest.length > 0 && (
                <>
                  {rows.recs.length > 0 && <div className="px-3 pt-3 pb-1.5 text-xs font-semibold text-muted">전체 공고</div>}
                  {rows.rest.map((r, i) => renderRow(r, rows.recs.length + i))}
                </>
              )}
            </>
          )}

          {chosen && (
            <div className="space-y-3 px-1">
              <button type="button" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink" onClick={() => setChosen(null)}>
                <ChevronLeft className="size-4" />다른 공고 고르기
              </button>
              <div>
                <div className="text-[15px] font-semibold">{chosen.title}</div>
                <div className="mt-0.5 text-[13px] text-muted">{orgLabel(chosen)} · {chosen.noticeNo}</div>
              </div>
              {candError && <InlineAlert tone="error">{candError}</InlineAlert>}
              {!cands && !candError && <div className="flex items-center gap-2 py-4 text-sm text-muted"><Loader2 className="size-4 animate-spin" />첨부 문서를 확인하는 중…</div>}
              {cands && cands.length === 0 && <InlineAlert tone="warn">이 공고에는 비교할 수 있는 첨부 문서가 없어요.</InlineAlert>}
              {cands && cands.length > 0 && (
                <div role="radiogroup" aria-label="비교할 문서" className="grid gap-1.5">
                  {cands.map((c, i) => {
                    const disabled = c.status === 'unsupported';
                    return (
                      <label key={`${c.ref.attachmentId}|${c.ref.innerPath ?? ''}`} className={`flex items-start gap-3 rounded-ctl border px-3 py-2.5 ${i === candIdx ? 'border-primary bg-btn-pri-wash' : 'border-line'} ${disabled ? 'opacity-40' : 'cursor-pointer hover:bg-sunken'}`}>
                        <input type="radio" name="rfp-cand" disabled={disabled} checked={i === candIdx} onChange={() => setCandIdx(i)} className="mt-[3px] accent-primary" />
                        {/* 파일명은 자르지 않고 줄바꿈해서 전부 보여 준다. 배지·상태는 아랫줄로 */}
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm leading-snug [overflow-wrap:anywhere]">{c.name}</span>
                          <span className="mt-1 flex flex-wrap items-center gap-2">
                            {c.docKind === 'rfp' && <span className="rounded-[5px] bg-sunken px-2 text-xs leading-5 font-semibold text-muted">제안요청서</span>}
                            <span className="text-xs text-faint">
                              {disabled ? '지원하지 않는 형식' : c.status === 'ready' ? `요구사항 ${c.itemCount ?? 0}개 · 분석됨` : '선택하면 분석해요'}
                            </span>
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3.5">
          <div className="text-[13px] text-muted">
            찾는 공고가 없나요?{' '}
            <button type="button" className="inline-flex items-center gap-1 font-semibold text-ink underline decoration-line-strong underline-offset-[3px]" onClick={() => fileRef.current?.click()}>
              <Upload className="size-3.5" />파일 올리기
            </button>
            <input ref={fileRef} type="file" accept=".hwp,.hwpx,.pdf,.docx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; pickFile(f); }} />
          </div>
          {chosen && <Button disabled={!sel || sel.status === 'unsupported'} onClick={() => { if (sel && cands) onSelect(chosen, cands, sel); }}>이 문서 사용</Button>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
