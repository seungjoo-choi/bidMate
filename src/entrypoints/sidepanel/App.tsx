import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Copy, Download, ExternalLink, LayoutDashboard, XCircle } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { refsConflict } from '../../core/model/job-conflict';
import type { CollectResult, Job } from '../../core/types/job';
import type { AttachmentStatus } from '../../core/types/notice';
import { send, sendToTab } from '../../messaging/bus';
import type { G2bDetected, NoticeLookup } from '../../messaging/protocol';
import { Button, InlineAlert, Logo, StatusBadge, type BadgeStatus } from '../../ui/components';
import { panelView, type PanelView } from '../../ui/g2b-panel/panel-view';
import { useJobs } from '../../ui/hooks/useJobs';
import { ComposeCard } from '../../ui/compose/ComposeCard';
import { DiagnosticsSection } from './DiagnosticsSection';
import { useActiveTab } from './useActiveTab';

const G2B_RE = /^https:\/\/www\.g2b\.go\.kr\//;
const DETECT_MS = 2000;
const COLLECT_TYPES = new Set<Job['type']>(['collect', 'download_retry']);
const ACTIVE = new Set<Job['status']>(['queued', 'running', 'cancelling']);

const ATTACH_BADGE: Record<AttachmentStatus, { status: BadgeStatus; label: string }> = {
  saved: { status: 'ok', label: '저장됨' },
  downloading: { status: 'idle', label: '받는 중' },
  pending: { status: 'idle', label: '대기' },
  skipped: { status: 'idle', label: '건너뜀' },
  failed: { status: 'error', label: '실패' },
  size_mismatch: { status: 'warn', label: '크기 불일치' },
};

/** 현재 공고의 최신 잡. 없으면 진행 중인 다른 공고의 잡(다른 공고로 표시된다). */
function pickJob(jobs: Job[], notice: G2bDetected | null): Job | null {
  const list = jobs.filter((j) => COLLECT_TYPES.has(j.type));
  const mine = notice ? list.find((j) => !!j.ref && refsConflict(j.ref, notice)) : undefined;
  return mine ?? list.find((j) => ACTIVE.has(j.status)) ?? null;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-card border border-line bg-surface p-4 shadow-card">
      <h2 className="title-mark text-sm font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

function Progress({ ratio }: { ratio: number }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
      <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(ratio * 100)}%`, transition: 'width 200ms' }} />
    </div>
  );
}

export function App() {
  const { tab } = useActiveTab();
  const jobs = useJobs();
  const [notice, setNotice] = useState<G2bDetected | null>(null);
  const [lookup, setLookup] = useState<NoticeLookup>({ found: false });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const g2bTabId = tab && G2B_RE.test(tab.url) ? tab.id : null;

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

  const job = pickJob(jobs, notice);
  const jobStatus = job?.status;

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

  useEffect(() => { setCopied(false); setShowErrors(false); }, [job?.id]);

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
  const cancel = (force: boolean) => { if (job) void send('job/cancel', { jobId: job.id, force }).catch(() => undefined); };
  const openUi = (page: 'settings' | 'grant' | 'review', noticeId?: string) => void send('ui/open', { page, noticeId }).catch(() => undefined);
  const openDashboard = () => void chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
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
              <div className="mt-0.5 break-all">{e.message}</div>
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
        {view.chip ? <StatusBadge status="ok">{view.chip}</StatusBadge> : <StatusBadge status="idle">아직 수집하지 않음</StatusBadge>}
        <Button className="w-full" icon={<Download />} loading={busy} disabled={!notice} onClick={collect}>{view.buttonLabel}</Button>
      </div>
    );
  } else if (view?.kind === 'progress') {
    status = (
      <div className="space-y-2.5">
        {view.foreignLabel && <InlineAlert tone="info"><div className="truncate">{view.foreignLabel}</div></InlineAlert>}
        <div className="break-all text-sm">{view.label}</div>
        <Progress ratio={view.ratio} />
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
  } else if (view?.kind === 'completed' || view?.kind === 'partial') {
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
        {view.extractionLine && (
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1 truncate text-sm">{view.extractionLine}</div>
            {view.reviewNoticeId && <Button variant="secondary" onClick={() => openUi('review', view.reviewNoticeId)}>검수</Button>}
          </div>
        )}
        {view.folder && (
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
            else if (view.action === 'settings') openUi('settings');
            else retry();
          }}>{view.actionLabel}</Button>
        )}
        {errorList}
      </div>
    );
  }

  const attachments = !view || view.kind === 'idle' ? [] : result?.attachments ?? [];

  return (
    <div className="min-h-screen bg-canvas text-base">
      <header className="sticky top-0 z-10 flex items-center gap-2.5 border-b border-line bg-surface px-5 py-3.5 shadow-card">
        <Logo size={26} />
        <div>
          <div className="text-lg leading-tight font-bold tracking-tight">BidMate</div>
          <div className="text-xs leading-tight text-muted">나의 입찰메이트</div>
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
      <Section title="현재 공고">
        {notice ? (
          <div className="min-w-0">
            <div className="line-clamp-2 text-lg font-bold" title={notice.title}>{notice.title ?? notice.noticeNo}</div>
            <div className="mt-0.5 font-mono text-sm text-muted">{notice.noticeNo}{notice.round ? `-${notice.round}` : ''}</div>
          </div>
        ) : (
          <p className="text-sm text-muted">
            {g2bTabId !== null ? '나라장터 공고 상세화면을 열면 공고 정보가 표시됩니다' : '나라장터 탭에서 공고 상세화면을 열어 주세요'}
          </p>
        )}
        {note && <InlineAlert tone="error">{note}</InlineAlert>}
      </Section>

      {status && <Section title="진행 상태">{status}</Section>}

      {job && result?.noticeId && (view?.kind === 'completed' || view?.kind === 'partial') && !view.foreign && (
        <Section title="메일 작성"><ComposeCard noticeId={result.noticeId} noticeRef={job.ref} params={{}} jobs={jobs} /></Section>
      )}

      {attachments.length > 0 && (
        <Section title={`첨부 ${attachments.filter((a) => a.status === 'saved').length}/${attachments.length}`}>
          <ul className="space-y-2">
            {attachments.map((a, i) => (
              <li key={i} className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm" title={a.name}>{a.name}</div>
                  {a.error && <div className="truncate text-xs text-muted" title={a.error}>{a.error}</div>}
                </div>
                <StatusBadge status={ATTACH_BADGE[a.status].status}>{ATTACH_BADGE[a.status].label}</StatusBadge>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <DiagnosticsSection tab={tab} />
      </div>
    </div>
  );
}
