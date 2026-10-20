import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Copy, Download, ExternalLink, LayoutDashboard, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { noticeReviewCount } from '../../core/extraction/review-rows';
import { basicFacts, evalFacts } from '../../core/model/notice-summary';
import type { CollectResult, Job } from '../../core/types/job';
import type { Extraction } from '../../core/types/extraction';
import type { Notice } from '../../core/types/notice';
import { send, sendToTab } from '../../messaging/bus';
import { SIDEPANEL_FOCUS_KEY, type G2bDetected, type NoticeLookup } from '../../messaging/protocol';
import { PROVIDERS } from '../../engine/ai/providers';
import { Button, InlineAlert, Logo, StatusBadge } from '../../ui/components';
import { panelView, progressRatio, type PanelView } from '../../ui/g2b-panel/panel-view';
import { useAiKeyPresence, useAiRun } from '../../ui/hooks/useAiRun';
import { useJobLog } from '../../ui/hooks/useJobLog';
import { useJobs } from '../../ui/hooks/useJobs';
import { useSettings } from '../../ui/hooks/useSettings';
import { buildAiCards, latestRun, quickView } from '../../ui/review/ai-view';
import { aiButtonView } from './ai-button';
import { DiagnosticsSection } from './DiagnosticsSection';
import { HistoryCard } from './HistoryCard';
import { historyView } from './history-view';
import { SummaryCard, TopCard } from './SummaryCard';
import { ACTIVE, pickTarget, type Focus } from './pick-target';
import { statusChip, summaryView } from './summary-view';
import { useActiveTab } from './useActiveTab';
import { secsText } from './view-format';

const G2B_RE = /^https:\/\/www\.g2b\.go\.kr\//;
const DETECT_MS = 2000;
const COLLECT_TYPES = new Set<Job['type']>(['collect', 'download_retry']);
const EMPTY_TEXT = '나라장터 공고나 트래커봇 메일에서 수집 완료를 누르면 요약이 나옵니다';

/** 수집 중 경과 시간. 매초 자기만 다시 그린다. */
function Elapsed({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <>{secsText(now - Date.parse(startedAt))}</>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-card border border-line bg-surface p-4 shadow-card">
      <h2 className="title-mark text-sm font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

export function App() {
  const { tab } = useActiveTab();
  const jobs = useJobs();
  const [notice, setNotice] = useState<G2bDetected | null>(null);
  const [lookup, setLookup] = useState<NoticeLookup>({ found: false });
  const [focus, setFocus] = useState<Focus | null>(null);
  const [data, setData] = useState<{ notice: Notice; extraction: Extraction | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [logOpen, setLogOpen] = useState<boolean | null>(null);
  const [attemptSel, setAttemptSel] = useState<number | null>(null);

  const g2bTabId = tab && G2B_RE.test(tab.url) ? tab.id : null;

  // 트래커봇 등 나라장터 밖에서 요약 보기를 누르면 SW가 focus를 남긴다.
  useEffect(() => {
    let alive = true;
    void chrome.storage.session.get(SIDEPANEL_FOCUS_KEY).then((r) => { if (alive) setFocus((r[SIDEPANEL_FOCUS_KEY] as Focus | undefined) ?? null); });
    const onChanged = (c: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'session' && SIDEPANEL_FOCUS_KEY in c) setFocus((c[SIDEPANEL_FOCUS_KEY]?.newValue as Focus | undefined) ?? null);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => { alive = false; chrome.storage.onChanged.removeListener(onChanged); };
  }, []);

  // 나라장터 탭이면 상세화면 공고를 감지한다. 화면 전환이 탭 이벤트 없이 일어나므로 주기적으로 다시 묻는다.
  useEffect(() => {
    setNotice(null);
    setNote(null);
    if (g2bTabId === null) return;
    let alive = true;
    let inflight = false;
    const detect = async () => {
      if (inflight) return;
      inflight = true;
      let d: G2bDetected | null = null;
      try { d = await sendToTab(g2bTabId, 'g2b/detect', undefined); } catch { /* CS 미준비 */ } finally { inflight = false; }
      if (alive) setNotice((prev) => (prev?.noticeNo === d?.noticeNo && prev?.round === d?.round && prev?.title === d?.title ? prev : d));
    };
    void detect();
    const t = setInterval(() => void detect(), DETECT_MS);
    return () => { alive = false; clearInterval(t); };
  }, [g2bTabId]);

  const collectJobs = useMemo(
    () => jobs.filter((j) => COLLECT_TYPES.has(j.type)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [jobs],
  );
  const { job, noticeId } = pickTarget(collectJobs, notice, lookup, focus, tab?.id ?? null);
  const jobStatus = job?.status;
  const active = !!job && ACTIVE.has(job.status);
  // 감지된 공고에 자기 잡이 없는데 다른 공고가 수집 중이면 안내만 한다.
  const otherActive = notice && !job ? collectJobs.find((j) => ACTIVE.has(j.status)) : undefined;

  // 공고가 바뀌면 초기화하고 note를 지운다.
  useEffect(() => { setLookup({ found: false }); setNote(null); }, [notice?.noticeNo, notice?.round]);

  // 공고가 바뀌거나 잡 상태가 바뀌면 수집 이력(수집됨 칩)을 다시 조회한다.
  useEffect(() => {
    if (!notice) return;
    let alive = true;
    send('notice/lookup', { noticeNo: notice.noticeNo, round: notice.round }).then(
      (r) => { if (alive) setLookup(r); },
      () => undefined,
    );
    return () => { alive = false; };
  }, [notice?.noticeNo, notice?.round, jobStatus]);

  // 요약 재조회는 noticeId가 바뀌거나 잡이 끝났을 때(active가 false로 바뀔 때)만 한다.
  useEffect(() => {
    if (!noticeId) { setData(null); return; }
    let alive = true;
    send('notice/get', { noticeId }).then(
      (r) => { if (alive) setData(r); },
      () => { if (alive) setData(null); },
    );
    return () => { alive = false; };
  }, [noticeId, active]);

  useEffect(() => { setCopied(false); setShowErrors(false); setAttemptSel(null); setLogOpen(null); }, [job?.id, noticeId]);

  const log = useJobLog(job?.id ?? null);
  const current = data && data.notice.id === noticeId ? data : null;
  const { state: aiState, review: aiReview } = useAiRun(noticeId);
  const { settings } = useSettings();
  const keyPresence = useAiKeyPresence();
  const [aiBusy, setAiBusy] = useState(false);
  useEffect(() => { setAiBusy(false); setNote(null); }, [noticeId]);
  const summary = useMemo(
    () => (current && !active
      ? summaryView({
        facts: basicFacts(current.notice), eval: evalFacts(current.notice, current.extraction), notice: current.notice,
        ai: current.extraction ? buildAiCards(aiReview, current.extraction) : undefined,
        reviewCount: noticeReviewCount(current.notice, current.extraction),
      })
      : null),
    [current, active, aiReview],
  );
  // 설정 로드 전에는 null(버튼 로딩). 진행·결과 표시의 공급자는 최신 run → 세션 state → 설정값 순.
  const settingsProvider = settings?.ai.provider ?? null;
  const aiQuick = quickView(aiReview, current?.extraction, aiState);
  const aiProvider = aiQuick.phase !== 'idle' ? (latestRun(aiReview)?.provider ?? aiState?.provider ?? settingsProvider) : settingsProvider;
  const aiView = aiButtonView({
    quick: aiQuick,
    mode: settings?.ai.mode,
    parsedCount: current?.extraction?.files.filter((f) => f.status === 'parsed' && f.textPath).length ?? 0,
    jobActive: active,
    hasKey: keyPresence && settingsProvider ? keyPresence[settingsProvider] : null,
    hasModel: !!(settingsProvider && settings?.ai.models[settingsProvider]?.trim()),
  });
  const composeJob = job?.handoff?.action === 'compose' ? jobs.find((j) => j.id === (job.handoff as { jobId?: string }).jobId) ?? null : null;
  const hist = useMemo(
    () => (job ? historyView({ log, job, compose: composeJob, hasSummary: !!summary, attempt: attemptSel ?? undefined }) : null),
    [log, job, composeJob, summary, attemptSel],
  );
  const startedAt = useMemo(() => log?.events.find((e) => e.attempt === job?.attempt)?.at ?? job?.createdAt, [log, job?.attempt, job?.createdAt]);
  const showHistory = !!hist && (hist.runs.length > 0 || hist.live);

  const view: PanelView | null = notice || job ? panelView(job, lookup, { title: notice?.title, current: notice }) : null;
  const result = job?.result as CollectResult | undefined;
  // 다른 탭에서 시작한 잡은 SW가 재시도를 거절하므로(JOB_RETRY_FORBIDDEN) 버튼 대신 안내를 보인다.
  const otherTabJob = !!job && job.originTabId !== undefined && job.originTabId !== g2bTabId;
  const otherTabHint = '이 공고를 수집한 나라장터 탭에서 다시 시도하세요';

  const startOnTab = async (fn: (tabId: number) => Promise<{ started: boolean; code?: string }>) => {
    if (g2bTabId === null) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await fn(g2bTabId);
      if (r.code === 'JOB_ALREADY_RUNNING') setNote('이 공고가 다른 탭에서 수집 중입니다');
      else if (r.code === 'JOB_RETRY_FORBIDDEN') setNote(otherTabHint);
      else if (!r.started) setNote('수집을 시작하지 못했습니다. 나라장터 화면을 새로고침한 뒤 다시 시도하세요');
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const collect = () => startOnTab((id) => sendToTab(id, 'g2b/collect', undefined));
  const retry = () => { if (job) void startOnTab((id) => sendToTab(id, 'g2b/retry', { jobId: job.id })); };
  const cancel = (force: boolean, target: Job | null = job) => { if (target) void send('job/cancel', { jobId: target.id, force }).catch(() => undefined); };
  const openUi = (page: 'settings' | 'grant' | 'review', noticeId?: string) => void send('ui/open', { page, noticeId }).catch(() => undefined);
  const openDashboard = () => void chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
  // 실행·취소만 한다. 적용은 대시보드 확인 탭에서(사이드패널에서 ai/apply 금지).
  const runAi = () => {
    if (!noticeId || aiBusy) return;
    setAiBusy(true);
    setNote(null);
    send('ai/run', { noticeId, scope: 'auto' }, { timeoutMs: 70_000 })
      .catch((e) => setNote(e instanceof Error ? e.message : String(e)))
      .finally(() => setAiBusy(false));
  };
  const cancelAi = () => {
    const runId = aiState?.runId ?? latestRun(aiReview)?.id;
    if (noticeId && runId) void send('ai/cancel', { noticeId, runId }).catch(() => undefined);
  };
  const copyFolder = (folder: string) => void navigator.clipboard?.writeText(folder).then(() => setCopied(true)).catch(() => undefined);

  const errorList = job && job.errors.length > 0 && (
    <div>
      <button onClick={() => setShowErrors(!showErrors)} aria-expanded={showErrors} className="flex items-center gap-1 text-sm text-muted hover:text-ink">
        {showErrors ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        오류 상세 {job.errors.length}건
      </button>
      {showErrors && (
        <ul className="mt-2 space-y-2">
          {job.errors.map((e, i) => (
            <li key={i} className="rounded-ctl bg-sunken px-3 py-2 text-sm">
              <div className="font-mono text-xs text-muted">{e.code}{e.step ? `, ${e.step}` : ''}</div>
              <div className="mt-0.5 wrap-anywhere">{e.message}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  let status: ReactNode = null;
  if (view?.kind === 'idle') {
    status = (
      <div className="space-y-2">
        {!summary && (view.collected ? <StatusBadge status="ok">{view.collected.dday ? `${view.collected.text}, ${view.collected.dday}` : view.collected.text}</StatusBadge> : <StatusBadge status="idle">아직 수집하지 않음</StatusBadge>)}
        <Button className="w-full" icon={<Download />} loading={busy} disabled={!notice} onClick={collect}>{view.buttonLabel}</Button>
      </div>
    );
  } else if (view?.kind === 'progress') {
    status = (
      <div className="space-y-2.5">
        {view.foreignLabel && <InlineAlert tone="info"><div className="truncate">{view.foreignLabel}</div></InlineAlert>}
        <div className="wrap-anywhere text-sm">{view.label}</div>
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-3 text-muted">
            {view.attach && <span>첨부 {view.attach.done}/{view.attach.total}</span>}
            {view.errorCount > 0 && <StatusBadge status="error">오류 {view.errorCount}</StatusBadge>}
          </span>
          {view.cancelling ? (
            <span className="flex items-center gap-2">
              <span className="text-warn">취소 중…</span>
              <Button variant="ghost" onClick={() => cancel(true)}>강제 중단</Button>
            </span>
          ) : (
            <Button variant="ghost" onClick={() => cancel(false)}>취소</Button>
          )}
        </div>
        {errorList}
      </div>
    );
  } else if ((view?.kind === 'completed' && !summary) || view?.kind === 'partial') {
    const ok = view.kind === 'completed';
    status = (
      <div className="space-y-3">
        <div className="flex items-start gap-2">
          {ok ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-ok" /> : <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warn" />}
          <div className="min-w-0 flex-1">
            <div className="font-semibold">{view.headline}</div>
            {view.foreign && view.title && <div className="truncate text-sm text-muted" title={view.title}>다른 공고: {view.title}</div>}
          </div>
        </div>
        {!summary && view.extractionLine && (
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1 truncate text-sm">{view.extractionLine}</div>
            {view.reviewNoticeId && <Button variant="secondary" onClick={() => openUi('review', view.reviewNoticeId)}>검수</Button>}
          </div>
        )}
        {!summary && view.folder && (
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1 truncate font-mono text-xs text-muted" title={view.folder}>{view.folder}</div>
            <Button variant="ghost" icon={<Copy />} onClick={() => copyFolder(view.folder!)}>{copied ? '복사됨' : '경로 복사'}</Button>
          </div>
        )}
        {view.kind === 'partial' && view.canRetry && !otherTabJob && (
          <Button className="w-full" loading={busy} disabled={g2bTabId === null} onClick={retry}>{view.retryLabel}</Button>
        )}
        {view.kind === 'partial' && !view.canRetry && <p className="text-sm text-muted">해당 공고 화면에서 다시 시도하세요</p>}
        {view.kind === 'partial' && view.canRetry && otherTabJob && <p className="text-sm text-muted">{otherTabHint}</p>}
        {errorList}
      </div>
    );
  } else if (view?.kind === 'error') {
    status = (
      <div className="space-y-3">
        <div className="flex items-start gap-2">
          <XCircle className="mt-0.5 size-5 shrink-0 text-danger" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold">{view.message}</div>
            {view.foreign && view.title && <div className="truncate text-sm text-muted" title={view.title}>다른 공고: {view.title}</div>}
          </div>
        </div>
        {view.hint && <p className="text-sm text-muted">{view.hint}</p>}
        {view.action === 'retry' && otherTabJob && <p className="text-sm text-muted">{otherTabHint}</p>}
        {view.action !== 'none' && !(view.action === 'retry' && otherTabJob) && (
          <Button className="w-full" loading={busy} disabled={view.action === 'retry' && g2bTabId === null} onClick={() => {
            if (view.action === 'grant') openUi('grant');
            else if (view.action === 'settings') void send('ui/open', view.fix ?? { page: 'settings' }).catch(() => undefined);
            else retry();
          }}>{view.actionLabel}</Button>
        )}
        {errorList}
      </div>
    );
  }

  // 상단 카드 표시값. 요약이 있으면 요약 기준, 없으면 감지된 공고나 잡 기준.
  const ref = job?.ref;
  const refNo = ref ? (ref.round ? `${ref.noticeNo}-${ref.round}` : ref.noticeNo) : undefined;
  const topTitle = summary?.title ?? result?.title ?? notice?.title ?? lookup.title ?? notice?.noticeNo ?? ref?.noticeNo ?? '';
  const topNo = summary?.noticeNo ?? (notice ? (notice.round ? `${notice.noticeNo}-${notice.round}` : notice.noticeNo) : refNo ?? '');
  const kindLabel = summary?.kindLabel ?? (ref?.kind === 'prespec' ? '사전규격' : '입찰공고');
  const collectInfo = current?.notice.collect ?? (lookup.found && lookup.collectStatus && lookup.collectedAt ? { status: lookup.collectStatus, collectedAt: lookup.collectedAt } : null);
  const chip = statusChip(job, collectInfo);
  const hasTop = !!(summary || job || notice || lookup.found);
  const elapsed = active && startedAt ? <Elapsed startedAt={startedAt} /> : undefined;
  const progress = view?.kind === 'progress' && job ? { ratio: progressRatio(job.steps), done: false } : undefined;

  return (
    <div className="min-h-screen bg-canvas text-base">
      <header className="sticky top-0 z-10 flex items-center gap-2.5 border-b border-line bg-surface px-5 py-3.5 shadow-card">
        <Logo size={26} />
        <div>
          <div className="text-lg leading-tight font-bold tracking-tight">BidMate</div>
          <div className="text-xs leading-tight text-muted">비드메이트</div>
        </div>
        <span className="ml-auto flex items-center gap-3">
          <button onClick={openDashboard} className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
            <LayoutDashboard className="size-3.5" />대시보드
          </button>
          <button onClick={() => openUi('settings')} className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
            설정 <ExternalLink className="size-3.5" />
          </button>
        </span>
      </header>

      <div className="space-y-3 p-4">
        {hasTop ? (
          <TopCard kindLabel={kindLabel} chip={chip} title={topTitle} noticeNo={topNo} elapsed={elapsed} progress={progress} />
        ) : (
          <Section title="현재 공고">
            <p className="text-sm text-muted">{EMPTY_TEXT}</p>
            {g2bTabId !== null && <p className="text-sm text-muted">나라장터 공고 상세화면을 열면 바로 수집할 수 있습니다</p>}
          </Section>
        )}
        {note && <InlineAlert tone="error">{note}</InlineAlert>}
        {otherActive && (
          <InlineAlert tone="info">
            <div className="space-y-2">
              <div className="truncate">다른 공고 수집 중: {(otherActive.result as CollectResult | undefined)?.title ?? otherActive.ref?.noticeNo}</div>
              <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
                <i className="block h-full rounded-full bg-primary" style={{ width: `${Math.round(progressRatio(otherActive.steps) * 100)}%` }} />
              </div>
              <div className="flex justify-end">
                {otherActive.status === 'cancelling'
                  ? <Button variant="ghost" onClick={() => cancel(true, otherActive)}>강제 중단</Button>
                  : <Button variant="ghost" onClick={() => cancel(false, otherActive)}>취소</Button>}
              </div>
            </div>
          </InlineAlert>
        )}

        {status && <Section title="진행 상태">{status}</Section>}

        {summary && current && (
          <SummaryCard view={summary}
            ai={noticeId ? { view: aiBusy && aiView.kind === 'run' ? { ...aiView, disabled: true } : aiView, provider: aiProvider ?? 'claude', providerLabel: PROVIDERS[aiProvider ?? 'claude'].label,
              onRun: runAi, onCancel: cancelAi, onOpenReview: () => openUi('review', noticeId), onOpenSettings: () => void send('ui/open', { page: 'settings', section: 'ai' }).catch(() => undefined) } : undefined}
            jobs={jobs} noticeRef={current.notice.ref} copied={copied}
            onReview={(id) => openUi('review', id)} onCopyFolder={copyFolder} />
        )}

        {showHistory && hist && (
          <HistoryCard view={hist} open={logOpen ?? hist.defaultOpen} onToggle={() => setLogOpen(!(logOpen ?? hist.defaultOpen))} onSelectAttempt={setAttemptSel} />
        )}

        <DiagnosticsSection tab={tab} />
      </div>
    </div>
  );
}
