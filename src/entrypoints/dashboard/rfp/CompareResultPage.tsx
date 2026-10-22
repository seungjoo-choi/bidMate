import { ArrowLeftRight, ChevronRight, FileSpreadsheet, FileText, Hash, Loader2, Search } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PREFIX_LABELS } from '../../../core/rfp/ids';
import type { RequirementItem, RfpPairStatus } from '../../../core/types/rfp';
import { send } from '../../../messaging/bus';
import { Button, EmptyState, InlineAlert, MenuButton, Select, useToast } from '../../../ui/components';
import { inputClass } from '../../../ui/components/Field';
import { TextDrawer } from '../review/TextDrawer';
import { ChangeList } from './ChangeList';
import {
  addPairOverride, addUnpairOverride, DEFAULT_FILTER, filterPairs, groupByPrefix, hiddenSameCount, nextSelectionAfterRemoval, nextUnreviewedKey, refItem,
  reviewedCount, reviewTotal, type CompareFilter,
} from './compare-view-logic';
import { buildCompareXlsx, exportFileName, XLSX_MIME, type ExportScope } from './export-xlsx';
import { PairDetail, type DetailView } from './PairDetail';
import { PairPicker } from './PairPicker';
import { SideChip } from './SideChip';
import { useSearchContext } from '../search/NoticeSearchProvider';
import { SearchButton } from '../search/SearchButton';
import { SummaryStrip } from './SummaryStrip';
import { useCompareSession } from './useCompareSession';

const goRfp = () => { window.location.hash = '#/rfp'; };
const BLOCK_KEYS_IN = 'input,textarea,select,[role=dialog],[role=listbox]';

interface Source { side: 'prev' | 'next'; line?: number }

export function CompareResultPage({ compareId }: { compareId: string }) {
  const { load, session, prevSet, nextSet, result, update, swapDirection, saveError, retrySave } = useCompareSession(compareId);
  const toast = useToast();
  const nextNoticeId = session?.next.ref.kind === 'notice' ? session.next.ref.noticeId : null;
  useSearchContext(nextNoticeId, session?.next.title);
  const [filter, setFilter] = useState<CompareFilter>(DEFAULT_FILTER);
  const [selKey, setSelKey] = useState<string | null>(null);
  const [view, setView] = useState<DetailView>('side');
  const [source, setSource] = useState<Source | null>(null);
  const [picking, setPicking] = useState(false);

  const reviewed = useMemo(() => new Set(session?.reviewed ?? []), [session?.reviewed]);
  const visible = useMemo(() => filterPairs(result.pairs, filter, reviewed), [result.pairs, filter, reviewed]);
  const groups = useMemo(() => groupByPrefix(visible, result.pairs), [visible, result.pairs]);
  const hiddenSame = useMemo(() => hiddenSameCount(result.pairs, filter), [result.pairs, filter]);
  const selected = visible.find((p) => p.key === selKey) ?? visible[0] ?? null;
  // 선택 항목이 필터에서 빠지면(예: 미확인만 + 확인) 맨 위로 튀지 않고 원래 위치 근처로 옮긴다
  const lastView = useRef<{ keys: string[]; sel: string | null }>({ keys: [], sel: null });
  useLayoutEffect(() => {
    const keys = visible.map((p) => p.key), prev = lastView.current;
    let sel = selected?.key ?? null;
    // 짝 맺기·풀기처럼 일부러 새 선택(selKey)을 정한 경우에는 옮기지 않는다
    if (prev.sel && !keys.includes(prev.sel) && !(selKey && keys.includes(selKey))) {
      const n = nextSelectionAfterRemoval(prev.keys, prev.sel, keys);
      if (n) { setSelKey(n); sel = n; }
    }
    lastView.current = { keys, sel };
  }, [visible, selected?.key, selKey]);
  const total = reviewTotal(result), done = reviewedCount(result, reviewed);

  useEffect(() => { if (saveError) toast.show('저장하지 못했어요'); }, [saveError]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (p: Partial<CompareFilter>) => setFilter((f) => ({ ...f, ...p }));
  const toggleStatus = (s: RfpPairStatus) => setFilter((f) => ({ ...f, status: { ...f.status, [s]: !f.status[s] } }));
  const toggleReviewed = useCallback((key: string) => {
    update((s) => ({ ...s, reviewed: s.reviewed.includes(key) ? s.reviewed.filter((k) => k !== key) : [...s.reviewed, key] }));
  }, [update]);
  const goNext = () => {
    const k = nextUnreviewedKey(visible, reviewed, selected?.key ?? null);
    if (k) setSelKey(k); else toast.show('달라진 항목을 모두 확인했어요');
  };

  const modalOpen = picking || !!source;
  useEffect(() => {
    if (load.kind !== 'ready' || modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      if ((e.target as HTMLElement | null)?.closest?.(BLOCK_KEYS_IN)) return;
      const i = selected ? visible.findIndex((p) => p.key === selected.key) : -1;
      if (e.key === 'ArrowDown' && i < visible.length - 1) { e.preventDefault(); setSelKey(visible[i + 1]!.key); }
      else if (e.key === 'ArrowUp' && i > 0) { e.preventDefault(); setSelKey(visible[i - 1]!.key); }
      else if (e.key === ' ' && selected && selected.status !== 'same') { e.preventDefault(); toggleReviewed(selected.key); }
      else if (e.key === 'n' || e.key === 'N') goNext();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  if (load.kind === 'loading') {
    return <div className="flex flex-col items-center gap-3 py-24 text-muted"><Loader2 className="size-6 animate-spin" /><p>{load.step}</p></div>;
  }
  if (load.kind === 'no-session') {
    return <EmptyState title="비교 기록을 찾을 수 없습니다" hint="삭제되었거나 주소가 잘못되었을 수 있어요."><Button onClick={goRfp}>RFP 비교로 가기</Button></EmptyState>;
  }
  if (load.kind === 'doc-missing') {
    const side = load.side === 'prev' ? '비교 대상' : '기준 문서';
    return (
      <EmptyState title={`${side}를 찾을 수 없습니다`} hint={<>문서가 지워졌거나 열 수 없어요. 비교 기록은 그대로 남아 있어요.<br /><span className="text-faint">{load.message}</span></>}>
        <Button onClick={goRfp}>문서 다시 고르기</Button>
      </EmptyState>
    );
  }
  if (!session) return null;

  const bothEmpty = !!prevSet && !!nextSet && prevSet.items.length === 0 && nextSet.items.length === 0;
  const diffTotal = result.counts.changed + result.counts.added + result.counts.removed;
  const prefixOptions = [{ value: 'all', label: '전체 분류' }, ...result.prefixes.map((p) => ({ value: p, label: PREFIX_LABELS[p] ? `${p} · ${PREFIX_LABELS[p]}` : p }))];

  const side = picking && selected ? (selected.prev ? 'next' as const : 'prev' as const) : null;
  const pool: RequirementItem[] = side && selected
    ? result.pairs.filter((p) => p.status === (side === 'next' ? 'added' : 'removed')).map((p) => p[side]!)
    : [];
  const pick = (item: RequirementItem) => {
    if (!selected) return;
    const prevKey = selected.prev?.key ?? item.key, nextKey = selected.next?.key ?? item.key;
    update((s) => ({ ...s, overrides: addPairOverride(s.overrides, prevKey, nextKey) }));
    setSelKey(`${prevKey}|${nextKey}`);
    setPicking(false);
    toast.show('짝을 맺었어요');
  };
  const unpair = () => {
    const p = selected;
    if (!p?.prev || !p.next) return;
    const prevKey = p.prev.key, nextKey = p.next.key;
    update((s) => ({ ...s, overrides: addUnpairOverride(s.overrides, prevKey, nextKey) }));
    setSelKey(`${prevKey}|-`);
    toast.show('짝을 풀었어요 — 두 항목이 각각 신규·삭제로 바뀌어요');
  };
  /** 나뉨·합쳐짐 링크 대상이 숨겨진 종류면 그 종류를 켜고 선택한다. */
  const jumpTo = (key: string) => {
    const t = result.pairs.find((p) => p.key === key);
    if (t && !filter.status[t.status]) patch({ status: { ...filter.status, [t.status]: true } });
    setSelKey(key);
  };
  const exportXlsx = (scope: ExportScope) => {
    try {
      const at = new Date();
      const bytes = buildCompareXlsx({ result, scope, prevTitle: session.prev.title, nextTitle: session.next.title, at });
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: XLSX_MIME }));
      const a = document.createElement('a');
      a.href = url; a.download = exportFileName(session.next.title, at);
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.show('엑셀 파일을 내려받았어요');
    } catch (e) {
      toast.show(`엑셀을 만들지 못했어요. ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const swap = () => { swapDirection(); setSelKey(null); toast.show('비교 대상과 기준을 바꿨어요'); };

  const chip = (on: boolean) => `inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[0.8125rem] font-medium ${on ? 'border-ink bg-ink text-surface' : 'border-line-strong bg-surface text-muted hover:text-ink'}`;
  const kbd = 'rounded border border-b-2 border-line-strong bg-surface px-1.5 font-mono text-[11px] text-muted';

  return (
    <div className="pb-10">
      <nav className="flex items-center gap-1.5 text-[0.8125rem] text-muted">
        <a href="#/rfp" className="hover:text-ink">RFP 비교</a><ChevronRight className="size-3" /><span>비교 결과</span>
      </nav>

      <div className="mt-2 flex items-start gap-5">
        <div className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-0.5">
          <SideChip side="prev" />
          <span className="[overflow-wrap:anywhere] text-[0.9375rem] text-muted" title={session.prev.title}>{session.prev.title}</span>
          <SideChip side="next" />
          <span className="[overflow-wrap:anywhere] text-[1.375rem] leading-8 font-bold tracking-tight" title={session.next.title}>{session.next.title}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <MenuButton
            icon={<FileSpreadsheet className="size-4" />} label="엑셀로 내보내기" hint="달라진 것만"
            title={`달라진 요구사항 ${diffTotal}개를 엑셀로 내보냅니다`} caretLabel="범위 골라 내보내기"
            onMain={() => exportXlsx('changed')}
            items={[
              { key: 'changed', label: `달라진 요구사항만 (${diffTotal}개)`, description: '변경·신규·삭제', onSelect: () => exportXlsx('changed') },
              { key: 'all', label: `전체 요구사항 (${result.pairs.length}개)`, description: '동일 항목은 회색으로 함께', onSelect: () => exportXlsx('all') },
            ]}
          />
          {nextNoticeId && <SearchButton variant="text" noticeId={nextNoticeId} title={session.next.title} />}
          <Button variant="secondary" icon={<FileText />} onClick={goRfp}>문서 바꾸기</Button>
          <Button variant="secondary" icon={<ArrowLeftRight />} onClick={swap}>방향 바꾸기</Button>
        </div>
      </div>

      {saveError && (
        <div className="mt-4">
          <InlineAlert tone="error"><span className="flex items-center gap-3">저장하지 못했어요: {saveError}<Button variant="secondary" onClick={() => void retrySave()}>다시 시도</Button></span></InlineAlert>
        </div>
      )}

      {bothEmpty ? (
        <EmptyState className="mt-6" title="두 문서 모두에서 요구사항을 찾지 못했어요" hint="요구사항 고유번호(예: SFR-001)가 있는 표를 찾지 못했어요. 원문을 직접 확인해 보세요.">
          <div className="flex gap-2">
            <Button variant="secondary" icon={<FileText />} onClick={() => setSource({ side: 'prev' })}>비교 대상 원문 보기</Button>
            <Button variant="secondary" icon={<FileText />} onClick={() => setSource({ side: 'next' })}>기준 원문 보기</Button>
          </div>
        </EmptyState>
      ) : (
        <>
          <SummaryStrip counts={result.counts} shown={filter.status} onToggle={toggleStatus} done={done} total={total} onNext={goNext} />

          <div className="mt-5 flex items-center gap-2">
            <div className="relative w-70">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
              <input className={`${inputClass} pl-9`} placeholder="번호·명칭 검색" value={filter.query} onChange={(e) => patch({ query: e.target.value })} />
            </div>
            <Select className="w-48" aria-label="분류" value={filter.prefix || 'all'} options={prefixOptions} onChange={(v) => patch({ prefix: v === 'all' ? '' : v })} />
            <button type="button" aria-pressed={filter.numericOnly} className={chip(filter.numericOnly)} onClick={() => patch({ numericOnly: !filter.numericOnly })}><Hash className="size-[13px]" />수치 바뀐 것만</button>
            <button type="button" aria-pressed={filter.todoOnly} className={chip(filter.todoOnly)} onClick={() => patch({ todoOnly: !filter.todoOnly })}>미확인만</button>
            <span className="flex-1" />
            <span className="flex items-center gap-2.5 text-xs text-faint">
              <span><kbd className={kbd}>↑</kbd> <kbd className={kbd}>↓</kbd> 이동</span>
              <span><kbd className={kbd}>Space</kbd> 확인</span>
              <span><kbd className={kbd}>N</kbd> 다음 미확인</span>
            </span>
          </div>

          {diffTotal === 0 && !filter.status.same ? (
            <EmptyState className="mt-3" title="달라진 요구사항이 없어요" hint={`동일 ${result.counts.same}개`}>
              <Button variant="secondary" icon={<Search />} onClick={() => patch({ status: { ...filter.status, same: true } })}>같은 항목 보기</Button>
            </EmptyState>
          ) : visible.length === 0 ? (
            <EmptyState className="mt-3" title="조건에 맞는 항목이 없어요" hint="위 칸을 눌러 보이는 종류를 바꿔 보세요" />
          ) : (
            <div className="mt-3 grid grid-cols-[minmax(260px,340px)_minmax(0,1fr)] items-start gap-4">
              <ChangeList
                groups={groups} selectedKey={selected?.key ?? null} reviewed={reviewed}
                onSelect={setSelKey} onToggleReviewed={toggleReviewed}
                hiddenSame={hiddenSame} onShowSame={() => patch({ status: { ...filter.status, same: true } })}
              />
              {selected && (
                <PairDetail
                  key={selected.key} pair={selected} result={result} view={view} onView={setView}
                  done={reviewed.has(selected.key)} onToggleDone={() => toggleReviewed(selected.key)}
                  onSelect={jumpTo}
                  onUnpair={unpair} onPair={() => setPicking(true)}
                  onOpenSource={(s) => setSource({ side: s, line: selected[s]!.loc.line + 1 })}
                />
              )}
            </div>
          )}
        </>
      )}

      {picking && side && selected && (
        <PairPicker base={refItem(selected)} side={side} pool={pool} onPick={pick} onClose={() => setPicking(false)} />
      )}
      {source && (
        <TextDrawer
          key={`${source.side}:${source.line ?? ''}`} noticeId=""
          target={{ textPath: '', line: source.line, title: `${source.side === 'prev' ? '비교 대상' : '기준'} · ${session[source.side].title}` }}
          load={() => send('rfp/text', { ref: session[source.side].ref }, { timeoutMs: 40_000 })}
          onClose={() => setSource(null)}
        />
      )}
      {toast.node}
    </div>
  );
}
