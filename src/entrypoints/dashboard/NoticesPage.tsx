import { BellRing, Download, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CollectStatus } from '../../core/types/notice';
import type { ExtractionStatus } from '../../core/types/extraction';
import type { IndexEntry } from '../../core/types/index-file';
import { send } from '../../messaging/bus';
import { evalErrorText } from '../../core/evaluation/error-text';
import { EVAL_COLLECT_UI_TIMEOUT_MS } from '../../core/evaluation/limits';
import { FsErrorAlert } from './FsErrorAlert';
import { noticeHash } from './route';
import { kindOf, noticeLabel } from '../../core/model/ids';
import { PROVIDERS } from '../../engine/ai/providers';
import { Button, EmptyState, InlineAlert, ProviderIcon, StatusBadge, useToast } from '../../ui/components';
import type { BadgeStatus } from '../../ui/components';
import { inputClass } from '../../ui/components/Field';
import { useAiBatch } from '../../ui/hooks/useAiBatch';
import { useAiKeyPresence } from '../../ui/hooks/useAiRun';
import { useSettings } from '../../ui/hooks/useSettings';
import { batchActive, batchBlockReason, batchModeNote, headerToggle, needsPaidConfirm, paidConfirmText, selectableForAi } from '../../ui/review/ai-batch-view';
import { dDayLevel, formatDDay, formatDate, formatDateTime, isDueSoon, isPast } from '../../ui/review/format';
import { AiBatchPanel } from './AiBatchPanel';
import { FollowMenu, useFollowToggle } from './FollowToggle';
import { followButton, followHint, type FollowAction, isFollowing, isWon, resultCell } from '../../ui/notices/result-view';
import { type EvalBatchState, runEvalBatch, selectableForEval } from '../../ui/notices/eval-fetch-view';
import { PageTitle } from './menu';
import { ResultSummaryStrip } from './stats/ResultSummaryStrip';
import { SortHeader, useSort, type SortValue } from './table-sort';

type Filter = 'all' | 'review' | 'due' | 'follow' | 'won';
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: '전체' }, { id: 'review', label: '확인 필요' }, { id: 'due', label: '마감 임박' },
  { id: 'follow', label: '팔로우' }, { id: 'won', label: '낙찰' },
];

const COLLECT_BADGE: Record<CollectStatus, { tone: BadgeStatus; text: string }> = {
  collected: { tone: 'ok', text: '수집 완료' }, partial: { tone: 'warn', text: '일부 누락' }, failed: { tone: 'error', text: '수집 실패' },
};
const EXTRACT_BADGE: Record<ExtractionStatus, { tone: BadgeStatus; text: string }> = {
  verified: { tone: 'ok', text: '확인 완료' }, needs_review: { tone: 'warn', text: '확인 필요' },
  unsupported: { tone: 'idle', text: '분석 불가' }, failed: { tone: 'error', text: '추출 실패' }, not_run: { tone: 'idle', text: '미분석' },
};

// 체크박스 열은 [AI로 보완할 공고 고르기]·[평가점수 가져올 공고 고르기]를 눌렀을 때만 둔다(평소 목록이 AI 분석처럼 보이지 않게).
const GRID = 'grid grid-cols-[40px_minmax(0,1fr)_180px_110px_110px_130px_80px_32px] items-center gap-6 px-5';
const GRID_PICK = 'grid grid-cols-[18px_40px_minmax(0,1fr)_180px_110px_110px_130px_80px_32px] items-center gap-6 px-5';

type SortKey = 'title' | 'close' | 'collect' | 'extract' | 'collectedAt';
const SORT_BY: Record<SortKey, (n: IndexEntry) => SortValue> = {
  title: (n) => n.title,
  close: (n) => n.bidCloseAt,
  collect: (n) => COLLECT_BADGE[n.collectStatus]?.text,
  extract: (n) => (kindOf(n) === 'prespec' ? undefined : (EXTRACT_BADGE[n.extractionStatus ?? 'not_run'] ?? EXTRACT_BADGE.not_run).text),
  collectedAt: (n) => n.collectedAt,
};

export function NoticesPage() {
  const [list, setList] = useState<IndexEntry[] | null>(null);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  // 선택은 이 컴포넌트 state에만 둔다(필터·검색·정렬을 바꿔도 유지, 페이지를 떠나면 사라진다).
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  // 선택 모드: AI 일괄 보완 또는 평가점수 일괄 가져오기. 모드마다 고를 수 있는 공고가 다르다.
  const [picking, setPicking] = useState<null | 'ai' | 'eval'>(null);
  const stopPicking = () => { setPicking(null); setSelected(new Set()); };
  const [evalHave, setEvalHave] = useState<Set<string>>(() => new Set());
  const [evalBatch, setEvalBatch] = useState<EvalBatchState | null>(null);
  const evalCancel = useRef(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const batch = useAiBatch();
  const { settings } = useSettings();
  const keys = useAiKeyPresence();
  const headerRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const follow = useFollowToggle();
  const [hasG2bKey, setHasG2bKey] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await send('notice/list', undefined));
      void send('deadline/refresh', { reason: 'list' }).catch(() => undefined);
      setError(null);
    } catch (e) {
      setError({ code: (e as { code?: string }).code, message: e instanceof Error ? e.message : String(e) });
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  // 평가점수를 이미 가져온 공고. 못 읽으면 비워 두고 SW가 다시 가져오게 둔다.
  const loadEvalHave = useCallback(async () => {
    try { setEvalHave(new Set((await send('eval/list', undefined)).map((e) => e.noticeId))); } catch { /* 선택 제한만 풀린다 */ }
  }, []);
  useEffect(() => { void loadEvalHave(); }, [loadEvalHave]);
  // 페이지를 떠나면 지금 건까지만 하고 멈춘다.
  useEffect(() => () => { evalCancel.current = true; }, []);
  // 목록을 열 때 낙찰 결과를 한 번 확인한다(SW가 10분 스로틀). 바뀐 게 있으면 다시 불러온다.
  useEffect(() => {
    void send('result/refresh', { reason: 'list' }, { timeoutMs: 150_000 })
      .then((r) => { if (r.updated > 0) void load(); })
      .catch(() => undefined);
  }, [load]);
  useEffect(() => {
    const read = () => void chrome.storage.local.get('secrets')
      .then(({ secrets }) => setHasG2bKey(!!(secrets as { g2bServiceKey?: string } | undefined)?.g2bServiceKey))
      .catch(() => setHasG2bKey(null));
    read();
    const onChanged = (c: Record<string, chrome.storage.StorageChange>, area: string) => { if (area === 'local' && c.secrets) read(); };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  const notify = settings?.notify ?? { rank: true, final: true };
  const applyFollow = async (n: IndexEntry, action: FollowAction) => {
    const r = await follow.apply(n.noticeId, action, n.following ?? null);
    if (r.ok) toast.show(r.body, { mascot: r.mood, title: r.title });
    else toast.show(r.text);
    if (!r.ok) return;
    setList((xs) => xs && xs.map((x) => {
      if (x.noticeId !== n.noticeId) return x;
      const rest: IndexEntry = { ...x };
      delete rest.following;
      return r.following
        ? { ...rest, following: r.following, ...(r.startAt ? { result: { status: 'waiting' as const, ...x.result, startAt: r.startAt } } : {}) }
        : rest;
    }));
  };

  const counts = useMemo(() => {
    const now = new Date();
    const all = list ?? [];
    return {
      all: all.length,
      review: all.filter((n) => n.extractionStatus === 'needs_review').length,
      due: all.filter((n) => isDueSoon(n.bidCloseAt, now)).length,
      follow: all.filter(isFollowing).length,
      won: all.filter(isWon).length,
    };
  }, [list]);

  const filtered = useMemo(() => {
    const now = new Date();
    const q = query.trim().toLowerCase();
    return (list ?? [])
      .filter((n) => filter === 'all'
        || (filter === 'review' ? n.extractionStatus === 'needs_review'
          : filter === 'due' ? isDueSoon(n.bidCloseAt, now)
          : filter === 'follow' ? isFollowing(n)
          : isWon(n)))
      .filter((n) => !q || `${n.title} ${n.noticeNo} ${n.orderingOrg}`.toLowerCase().includes(q));
  }, [list, filter, query]);
  const { sorted: rows, sort, toggle } = useSort<IndexEntry, SortKey>(filtered, SORT_BY, { key: 'collectedAt', dir: 'desc' }, { close: 'asc', collectedAt: 'desc' });

  const open = (id: string) => { location.hash = noticeHash(id); };

  const byId = useMemo(() => new Map((list ?? []).map((n) => [n.noticeId, n])), [list]);
  const selOf = useCallback((n: IndexEntry) => (picking === 'eval' ? selectableForEval(n, new Date(), evalHave) : selectableForAi(n)), [picking, evalHave]);
  const selectableIds = useMemo(() => new Set((list ?? []).filter((n) => selOf(n).ok).map((n) => n.noticeId)), [list, selOf]);
  const picked = useMemo(() => [...selected].filter((id) => selectableIds.has(id)), [selected, selectableIds]);
  const visibleSelectable = rows.filter((n) => selectableIds.has(n.noticeId)).map((n) => n.noticeId);
  const head = headerToggle(visibleSelectable, selected);
  useEffect(() => { if (headerRef.current) headerRef.current.indeterminate = head.indeterminate; }, [head.indeterminate, picking]);

  const provider = settings?.ai.provider ?? 'gemini';
  const active = batchActive(batch.state);
  const block = batchBlockReason({ hasKey: settings && keys ? keys[provider] : null, model: settings?.ai.models[provider], active: active || starting, providerLabel: PROVIDERS[provider].label });
  const mode = settings?.ai.mode;
  const modeNote = batchModeNote(mode);
  // 유료 API인데 설정이 반자동이면 막대 안에서 한 번 더 확인한다(confirm() 대화상자는 쓰지 않는다).
  const [confirming, setConfirming] = useState(false);
  useEffect(() => { if (picked.length === 0 || block) setConfirming(false); }, [picked.length, block]);
  const titleOf = (id: string) => byId.get(id)?.title || id;

  const runBatch = async (ids: string[]) => {
    if (ids.length === 0 || starting) return;
    setStarting(true);
    setAiError(null);
    try {
      await batch.start(ids);
      stopPicking();
    } catch (e) {
      const code = (e as { code?: string }).code;
      setAiError(code === 'AI_BATCH_BUSY' ? '일괄 실행이 이미 진행 중입니다'
        : code === 'AI_PERMISSION_MISSING' ? '공급자 접근 권한이 필요합니다. 설정에서 키를 다시 저장해 권한을 허용하세요'
        : code === 'AI_KEY_MISSING' || code === 'AI_MODEL_MISSING' ? '설정에서 API 키와 모델을 확인하세요'
        : `${code ?? ''} ${e instanceof Error ? e.message : String(e)}`.trim());
    } finally {
      setStarting(false);
    }
  };
  const runEval = async (ids: string[]) => {
    if (evalBatch?.running) return;
    const items = ids.flatMap((id) => { const n = byId.get(id); return n ? [{ noticeId: n.noticeId, noticeNo: n.noticeNo, round: n.round || '000' }] : []; });
    if (items.length === 0) return;
    evalCancel.current = false;
    stopPicking();
    await runEvalBatch(items, {
      collect: (ref) => send('eval/collect', { ref }, { timeoutMs: EVAL_COLLECT_UI_TIMEOUT_MS }),
      errorText: evalErrorText,
      onUpdate: setEvalBatch,
      cancelled: () => evalCancel.current,
    });
    void loadEvalHave();
  };
  const openSettings = () => { void send('ui/open', { page: 'settings', section: 'ai' }).catch(() => undefined); };
  const now = new Date();
  // 낙찰 확인과 팔로우 알림에는 서비스키와 사업자번호가 둘 다 필요하다.
  const missingKey = hasG2bKey === false;
  const missingBiz = !!settings && !settings.company.bizNo;
  const needsSetup = (missingKey || missingBiz) && (list ?? []).some((n) => kindOf(n) !== 'prespec');
  const setupWhat = missingKey && missingBiz ? '나라장터 서비스키와 사업자등록번호를' : missingKey ? '나라장터 서비스키를' : '사업자등록번호를';
  const openSetup = () => { void send('ui/open', { page: 'settings', section: missingKey ? 'g2b' : 'company' }).catch(() => undefined); };

  return (
    <div className="space-y-6" data-ai={provider}>
      <PageTitle page="notices" />
      <FsErrorAlert error={error} onRetry={load} />

      {batch.state && (
        <AiBatchPanel
          state={batch.state} titleOf={titleOf} onOpenSettings={openSettings}
          onCancel={() => void batch.cancel(batch.state!.batchId).catch(() => undefined)}
          onClose={() => void batch.clear(batch.state!.batchId).catch((e) => setAiError(e instanceof Error ? e.message : String(e)))}
          onRetry={(ids) => void runBatch(ids)}
        />
      )}
      {aiError && <InlineAlert tone="error">{aiError}</InlineAlert>}
      {evalBatch && (
        <div className="flex flex-wrap items-start gap-2.5 rounded-card border border-line bg-surface px-3.5 py-2.5 text-ink shadow-card tabular-nums">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">
              {evalBatch.running
                ? `평가점수 가져오는 중 ${evalBatch.done}/${evalBatch.total}`
                : `평가점수 ${evalBatch.ok}건 가져옴${evalBatch.failed.length > 0 ? `, ${evalBatch.failed.length}건 실패` : ''}`}
            </div>
            {evalBatch.running && evalBatch.current && <div className="truncate text-xs text-muted">{titleOf(evalBatch.current)}</div>}
            {evalBatch.stopped && <div className="text-xs text-danger">{evalBatch.stopped === '중단됨' ? '중단했습니다. 남은 공고는 가져오지 않았습니다' : `남은 공고를 멈췄습니다: ${evalBatch.stopped}`}</div>}
            {!evalBatch.running && evalBatch.failed.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-xs text-muted">
                {evalBatch.failed.map((f) => <li key={f.noticeId} className="truncate">{titleOf(f.noticeId)}: {f.message}</li>)}
              </ul>
            )}
          </div>
          {evalBatch.running ? (
            <Button variant="ghost" className="!h-9 !px-3" onClick={() => { evalCancel.current = true; }}>중단</Button>
          ) : (
            <>
              {evalBatch.ok > 0 && <Button variant="ghost" className="!h-9 !px-3" onClick={() => { location.hash = '#/evaluations'; }}>평가분석 보기</Button>}
              <Button variant="ghost" className="!h-9 !px-3" onClick={() => setEvalBatch(null)}>닫기</Button>
            </>
          )}
        </div>
      )}
      {needsSetup && (
        <InlineAlert>
          <span className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <span>낙찰 여부 표시와 팔로우 알림을 쓰려면 설정에서 {setupWhat} 저장하세요.</span>
            <Button variant="secondary" className="!h-8 !px-3" onClick={openSetup}>설정 열기</Button>
          </span>
        </InlineAlert>
      )}

      {list && list.length === 0 && (
        <EmptyState title="아직 수집한 공고가 없습니다" hint="나라장터 공고 화면에서 [공고 수집]을 누르면 여기에 쌓입니다." />
      )}

      {list && list.length > 0 && (
        <>
          <ResultSummaryStrip list={list} />
          <div className="flex items-end justify-between gap-4 border-b border-line">
          <div role="tablist" className="flex gap-7">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                role="tab"
                aria-selected={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={`-mb-px border-b-2 pb-3 transition-colors motion-reduce:transition-none ${
                  filter === f.id ? 'border-ink font-semibold text-ink' : 'border-transparent font-medium text-muted hover:text-ink'
                }`}
              >
                {f.label}<span className={`ml-1.5 font-mono text-sm tabular-nums ${f.id === 'won' && counts.won > 0 ? 'font-semibold text-ok' : 'font-normal text-faint'}`}>{counts[f.id]}</span>
              </button>
            ))}
          </div>
          <div className="mb-2 flex items-center gap-2.5">
          {!picking && (
            <>
              <Button variant="secondary" className="!h-9" icon={<Download />} disabled={!!evalBatch?.running} title={evalBatch?.running ? '평가점수를 가져오는 중입니다' : undefined} onClick={() => setPicking('eval')}>
                평가점수 가져올 공고 고르기
              </Button>
              <Button variant="ai" className="!h-9" icon={<ProviderIcon provider={provider} size={14} />} onClick={() => setPicking('ai')}>
                AI로 보완할 공고 고르기
              </Button>
            </>
          )}
          <div className="relative w-80">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
            <input className={`${inputClass} pl-9`} placeholder="공고명, 번호, 기관 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          </div>
          </div>
          {picking === 'eval' && (
            <div className="flex flex-wrap items-center gap-2.5 rounded-card border border-line bg-surface px-3.5 py-2.5 text-ink shadow-card tabular-nums">
              <div className="min-w-0">
                <div className="text-sm font-semibold">{picked.length > 0 ? `${picked.length}건 선택` : '평가점수를 가져올 공고를 고르세요'}</div>
                <div className="text-xs text-muted">개찰이 끝난 입찰공고만 고를 수 있습니다. 나라장터에 로그인돼 있어야 하며, 한 건씩 차례로 가져옵니다.</div>
              </div>
              <span className="flex-1" />
              <Button variant="ghost" className="!h-9 !px-3" onClick={stopPicking}>취소</Button>
              <Button className="!h-9" icon={<Download />} disabled={picked.length === 0} onClick={() => void runEval(picked)}>선택한 공고 평가점수 가져오기</Button>
            </div>
          )}
          {picking === 'ai' && (
            <div className="flex flex-wrap items-center gap-2.5 rounded-card border border-ai-line bg-surface px-3.5 py-2.5 text-ink shadow-card tabular-nums">
              <div className="min-w-0">
                <div className="text-sm font-semibold">{confirming ? paidConfirmText(picked.length) : picked.length > 0 ? `${picked.length}건 선택` : 'AI 제안을 받을 공고를 고르세요'}</div>
                {!confirming && <div className="text-xs text-muted">규칙 분석에서 '확인 필요'로 남은 항목을 AI가 공고문에서 다시 찾아 제안합니다. 값은 확인 탭에서 [적용]해야 바뀝니다.</div>}
              </div>
              <span className="flex-1" />
              {!confirming && modeNote && <span className="text-xs text-muted">{modeNote}</span>}
              {!confirming && block && <span className="text-xs text-muted">{block.text}</span>}
              {!confirming && block?.setup && <Button variant="ghost" className="!h-9 !px-3" onClick={openSettings}>설정 열기</Button>}
              {confirming ? (
                <>
                  <Button variant="ghost" className="!h-9 !px-3" onClick={() => setConfirming(false)}>취소</Button>
                  <Button variant="ai" className="!h-9" disabled={!!block || starting} icon={<ProviderIcon provider={provider} size={14} />} onClick={() => { setConfirming(false); void runBatch(picked); }}>실행</Button>
                </>
              ) : (
                <>
                  <Button variant="ghost" className="!h-9 !px-3" onClick={stopPicking}>취소</Button>
                  <Button
                    variant="ai" className="!h-9" disabled={!!block || starting || picked.length === 0} icon={<ProviderIcon provider={provider} size={14} />}
                    onClick={() => { if (needsPaidConfirm(provider, mode)) setConfirming(true); else void runBatch(picked); }}
                  >
                    선택한 공고 AI 제안 받기
                  </Button>
                </>
              )}
            </div>
          )}
          <div className="max-h-[max(16rem,calc(100vh-20rem))] overflow-y-auto rounded-card border border-line bg-surface shadow-card">
            <div className={`${picking ? GRID_PICK : GRID} sticky top-0 z-10 bg-sunken py-3 text-sm text-muted`}>
              {picking && (
                <input
                  ref={headerRef} type="checkbox" className="size-4 accent-primary" aria-label="보이는 공고 모두 선택" title={picking === 'eval' ? '평가점수를 가져올 수 있는 공고 모두 선택' : 'AI 제안을 받을 수 있는 공고 모두 선택'}
                  disabled={visibleSelectable.length === 0} checked={head.checked}
                  onChange={() => setSelected(head.next)}
                />
              )}
              <div className="text-right">순번</div>
              <SortHeader label="공고명" k="title" sort={sort} onSort={toggle} />
              <SortHeader label="마감" k="close" sort={sort} onSort={toggle} />
              <SortHeader label="수집" k="collect" sort={sort} onSort={toggle} />
              <SortHeader label="평가정보" k="extract" sort={sort} onSort={toggle} />
              <div>입찰 진행</div>
              <SortHeader label="수집일" k="collectedAt" sort={sort} onSort={toggle} />
              <div className="sr-only">팔로우</div>
            </div>
            {rows.length === 0 && <EmptyState size="sm" className="border-t border-line px-4 !py-10" title="조건에 맞는 공고가 없습니다." />}
            {rows.map((n, i) => {
              const past = isPast(n.bidCloseAt, now);
              const dday = formatDDay(n.bidCloseAt, now);
              const level = dDayLevel(dday);
              const ddayTone = past ? 'font-medium' : level === 'urgent' ? 'text-danger' : level === 'soon' ? 'text-warn' : 'font-medium text-muted';
              const cb = COLLECT_BADGE[n.collectStatus];
              const eb = EXTRACT_BADGE[n.extractionStatus ?? 'not_run'] ?? EXTRACT_BADGE.not_run;
              const sel = selOf(n);
              const won = isWon(n);
              const rc = resultCell(n);
              const fb = followButton(n);
              const hint = followHint(n, now);
              return (
                <div
                  key={n.noticeId}
                  role="link"
                  tabIndex={0}
                  onClick={() => open(n.noticeId)}
                  onKeyDown={(e) => { if (e.key === 'Enter') open(n.noticeId); }}
                  className={`${picking ? GRID_PICK : GRID} relative cursor-pointer border-t border-line py-4 transition-colors hover:bg-sunken motion-reduce:transition-none ${past ? 'text-faint' : ''} ${
                    picking && selected.has(n.noticeId) && sel.ok ? (picking === 'ai' ? 'bg-ai-wash/60' : 'bg-select') : ''
                  }`}
                >
                  {picking && <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox" className="size-4 accent-primary" aria-label={sel.ok ? `${n.title} 선택` : '선택 불가'}
                      disabled={!sel.ok} title={sel.ok ? undefined : sel.reason} checked={sel.ok && selected.has(n.noticeId)}
                      onChange={() => setSelected((s) => { const nx = new Set(s); if (nx.has(n.noticeId)) nx.delete(n.noticeId); else nx.add(n.noticeId); return nx; })}
                    />
                  </div>}
                  <div className={`text-right font-mono text-sm tabular-nums ${past ? '' : 'text-muted'}`}>{i + 1}</div>
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className={`truncate text-base font-semibold ${won ? 'text-ink' : ''}`}>{n.title}</span>
                    </div>
                    <div className={`mt-0.5 flex min-w-0 items-center gap-2.5 text-sm ${past ? '' : 'text-muted'}`}>
                      <span className="truncate"><span className="font-mono">{noticeLabel(n)}</span>, {n.orderingOrg}</span>
                      {kindOf(n) === 'prespec' && <span className="shrink-0"><StatusBadge status="idle">사전규격</StatusBadge></span>}
                      {hint && (
                        <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-star">
                          <BellRing className="size-3.5" aria-hidden />{hint}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-baseline gap-2.5 font-mono text-sm tabular-nums">
                    {dday && (
                      <span className={`min-w-11 font-bold ${ddayTone}`}>{dday}</span>
                    )}
                    <span className={past ? '' : 'text-muted'}>{formatDateTime(n.bidCloseAt)}</span>
                  </div>
                  <div><StatusBadge status={cb.tone}>{cb.text}</StatusBadge></div>
                  <div>{kindOf(n) === 'prespec' ? <span className="text-sm text-muted">해당 없음</span> : <StatusBadge status={eb.tone}>{eb.text}</StatusBadge>}</div>
                  <div>{rc ? <StatusBadge status={rc.tone}>{rc.text}</StatusBadge> : <span className="text-sm text-faint">—</span>}</div>
                  <div className={`font-mono text-sm tabular-nums ${past ? '' : 'text-muted'}`}>{formatDate(n.collectedAt)}</div>
                  {fb.visible
                    ? <FollowMenu variant="star" following={n.following ?? null} rankDone={n.result?.status === 'ranked'} notify={notify} busy={follow.isBusy(n.noticeId)} disabled={fb.disabled} reason={fb.reason} title={n.title} onSelect={(a) => void applyFollow(n, a)} />
                    : <div />}
                </div>
              );
            })}
          </div>
        </>
      )}
      {toast.node}
    </div>
  );
}
