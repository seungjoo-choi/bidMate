import { BarChart3, Bookmark, ClipboardCopy, Download, ExternalLink, GitCompareArrows, Loader2, Mail, RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Extraction } from '../../../core/types/extraction';
import { handoffReasonLabel } from '../../../core/model/handoff';
import type { IndexEntry } from '../../../core/types/index-file';
import type { HandoffReason } from '../../../core/types/job';
import type { Notice } from '../../../core/types/notice';
import { send } from '../../../messaging/bus';
import { evalErrorText } from '../../../core/evaluation/error-text';
import { EVAL_COLLECT_UI_TIMEOUT_MS } from '../../../core/evaluation/limits';
import { kindOf, noticeLabel } from '../../../core/model/ids';
import { BackLink, Button, ConfirmDialog, InlineAlert, MoreMenu, StatusBadge, useToast } from '../../../ui/components';
import { useJobs } from '../../../ui/hooks/useJobs';
import { COLLECT_BADGE, detailTabs, effectiveTab, folderRelPath } from '../../../ui/notice-detail/view';
import { dDayLevel, formatDDay, formatDateTime } from '../../../ui/review/format';
import type { ReviewLeafKey } from '../../../core/extraction/review-rows';
import type { EditError } from '../review/ReviewRows';
import { evaluationHash, rfpHash, type NoticeTab } from '../route';
import { FilesTab } from './FilesTab';
import { HistoryTab } from './HistoryTab';
import { JobDock } from './JobDock';
import { OverviewTab } from './OverviewTab';
import { ReviewTab } from './ReviewTab';
import { TabBar } from './TabBar';
import { FollowMenu, useFollowToggle } from '../FollowToggle';
import { useSearchContext } from '../search/NoticeSearchProvider';
import { SearchButton } from '../search/SearchButton';
import { useFavorites } from '../../../ui/hooks/useFavorites';
import { WonCard } from './ResultStrip';
import { followButton, isWon, type FollowAction } from '../../../ui/notices/result-view';
import { evalFetchable } from '../../../ui/notices/eval-fetch-view';
import { useSettings } from '../../../ui/hooks/useSettings';

const ACTIVE = new Set(['queued', 'running', 'cancelling']);

export function NoticeDetailPage({ noticeId, tab, handoff }: { noticeId: string; tab: NoticeTab; handoff?: HandoffReason[] }) {
  const [data, setData] = useState<{ notice: Notice; extraction: Extraction | null } | null | undefined>(undefined);
  const [index, setIndex] = useState<IndexEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  /** 진행 팝업. open이면 띄우고, jobId는 이 화면에서 시작한 잡 */
  const [dock, setDock] = useState<{ open: boolean; jobId: string | null }>({ open: false, jobId: null });
  /** 평가점수를 이미 가져왔는가. null = 모름(목록을 못 읽음) */
  const [evalHave, setEvalHave] = useState<boolean | null>(null);
  const [evalBusy, setEvalBusy] = useState(false);
  const toast = useToast();
  const jobs = useJobs();
  const running = jobs.find((j) => j.type !== 'compose' && j.noticeId === noticeId && ACTIVE.has(j.status));
  const wasRunning = useRef(false);
  const follow = useFollowToggle();
  const fav = useFavorites();
  const faved = fav.has(noticeId);
  const { settings } = useSettings();
  const notify = settings?.notify ?? { rank: true, final: true };
  useSearchContext(noticeId, data?.notice.basic.title.value ?? undefined);

  const load = async () => {
    try {
      const [d, list] = await Promise.all([
        send('notice/get', { noticeId }),
        send('notice/list', undefined).catch(() => [] as IndexEntry[]),
      ]);
      setData(d);
      setIndex(list);
      setLoadError(null);
      void send('eval/list', undefined).then((es) => setEvalHave(es.some((e) => e.noticeId === noticeId))).catch(() => setEvalHave(null));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => { setEvalHave(null); void load(); }, [noticeId]); // eslint-disable-line react-hooks/exhaustive-deps
  // 잡이 끝나면 결과를 다시 불러온다.
  useEffect(() => {
    if (wasRunning.current && !running) void load();
    wasRunning.current = !!running;
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  const busy = !!running || starting;
  // 이 화면에서 시작한 잡을 따라가고, 다른 데서 시작돼 진행 중인 잡이 있으면 그것도 띄운다
  const dockJob = (dock.jobId ? jobs.find((j) => j.id === dock.jobId) : undefined) ?? running ?? null;
  const showDock = (dock.open && (starting || !!dock.jobId || !!dockJob)) || !!running;
  const closeDock = useCallback(() => setDock({ open: false, jobId: null }), []);

  const runDelete = async () => {
    setConfirmDelete(false);
    setAlert(null);
    setDeleting(true);
    try {
      const r = await send('notice/delete', { noticeIds: [noticeId] }, { timeoutMs: 40_000 });
      const f = r.failed[0];
      if (f) setAlert(f.code === 'JOB_ALREADY_RUNNING' ? '이 공고는 다른 작업이 진행 중입니다' : f.message);
      else window.location.hash = '#/notices';
    } catch (e) {
      setAlert(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  };

  const extract = async () => {
    setAlert(null);
    setStarting(true);
    setDock({ open: true, jobId: null });
    try {
      const r = await send('job/start', { type: 'extract', noticeId });
      if (r.code === 'JOB_ALREADY_RUNNING') setAlert('이 공고는 다른 작업이 진행 중입니다');
      setDock({ open: true, jobId: r.code === 'JOB_ALREADY_RUNNING' ? null : r.jobId });
    } catch (e) {
      const code = (e as { code?: string }).code;
      setAlert(code === 'JOB_ALREADY_RUNNING' ? '이 공고는 다른 작업이 진행 중입니다' : e instanceof Error ? e.message : String(e));
      setDock({ open: false, jobId: null });
    } finally {
      setStarting(false);
    }
  };

  const edit = async (key: ReviewLeafKey, value: unknown | null, note?: string, raw?: string): Promise<EditError | null> => {
    try {
      const r = await send('notice/field-edit', { noticeId, key, value, ...(raw ? { raw } : {}), ...(note ? { note } : {}) });
      setData(r);
      toast.saved('저장했습니다');
      return null;
    } catch (e) {
      return { code: (e as { code?: string }).code, message: e instanceof Error ? e.message : String(e) };
    }
  };

  const entry = index.find((e) => e.noticeId === noticeId);
  const applyFollow = async (action: FollowAction) => {
    if (!entry) return;
    const r = await follow.apply(noticeId, action, entry.following ?? null);
    if (r.ok) toast.show(r.body, { mascot: r.mood, title: r.title });
    else toast.show(r.text);
    if (r.ok) void load();
  };

  const fetchEval = async () => {
    if (!data || evalBusy) return;
    setAlert(null);
    setEvalBusy(true);
    try {
      await send('eval/collect', { ref: { noticeNo: data.notice.ref.noticeNo, round: data.notice.ref.round || '000' } }, { timeoutMs: EVAL_COLLECT_UI_TIMEOUT_MS });
      setEvalHave(true);
      toast.show('평가점수를 가져왔습니다');
    } catch (e) {
      setAlert(evalErrorText((e as { code?: string }).code, e instanceof Error ? e.message : String(e)));
    } finally {
      setEvalBusy(false);
    }
  };

  const copyPath = async () => {
    if (!data) return;
    try { await navigator.clipboard.writeText(folderRelPath(data.notice.folder)); toast.show('복사됨'); } catch { toast.show('복사하지 못했습니다'); }
  };

  const back = (
    <BackLink href="#/notices">공고 목록</BackLink>
  );

  if (data === undefined) {
    return <div className="space-y-4">{back}{loadError ? <InlineAlert tone="error">{loadError}</InlineAlert> : <Loader2 className="size-4 animate-spin text-muted" />}</div>;
  }
  if (data === null) {
    return <div className="space-y-4">{back}<InlineAlert tone="warn">공고를 찾을 수 없습니다.</InlineAlert></div>;
  }

  const { notice, extraction } = data;
  const sourceUrl = notice.sourceUrl.value;
  const hasRfpFile = notice.attachments.some((a) => a.savedName && /\.(hwp|hwpx|pdf|docx|zip)$/i.test(a.savedName));
  const safeUrl = sourceUrl && /^https?:\/\//i.test(sourceUrl) ? sourceUrl : null;
  const title = notice.basic.title.value ?? notice.id;
  const isPrespec = kindOf(notice.ref) === 'prespec';
  const noticeNo = isPrespec
    ? noticeLabel(notice.ref)
    : `${notice.basic.noticeNo.value ?? notice.ref.noticeNo}-${notice.basic.round.value ?? notice.ref.round ?? '000'}`;
  const closeAt = isPrespec ? notice.prespec.opinionCloseAt.value : notice.schedule.bidCloseAt.value;
  const dday = formatDDay(closeAt);
  const cb = COLLECT_BADGE[notice.collect.status];
  const active = effectiveTab(tab, notice);
  const tabs = detailTabs(notice, extraction);
  const fb = entry ? followButton(entry) : ({ visible: false } as const);

  return (
    <div className="space-y-6">
      {back}
      <header className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <h1 className="title-mark text-2xl leading-snug font-bold tracking-tight text-balance">{title}</h1>
          {/* 상태 배지는 제목 바로 아래 한 줄 */}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <StatusBadge status={cb.tone}>{cb.text}</StatusBadge>
            {isPrespec && <StatusBadge status="idle">사전규격</StatusBadge>}
            {notice.isCorrection && <StatusBadge status="warn">정정공고</StatusBadge>}
            {entry && isWon(entry) && <StatusBadge status="ok"><span className="font-semibold">낙찰</span></StatusBadge>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button variant="secondary" aria-pressed={faved} title={faved ? '즐겨찾기 해제' : '즐겨찾기에 추가'}
            icon={<Bookmark className={faved ? 'text-primary' : undefined} fill={faved ? 'currentColor' : 'none'} />}
            onClick={() => void fav.toggle(noticeId).then((ok) => { if (!ok) toast.show('즐겨찾기를 저장하지 못했습니다.'); })}
          >{faved ? '즐겨찾기됨' : '즐겨찾기'}</Button>
          {entry && fb.visible && !fb.disabled && <FollowMenu variant="button" following={entry.following ?? null} rankDone={entry.result?.status === 'ranked'} notify={notify} busy={follow.isBusy(noticeId)} title={title} onSelect={(a) => void applyFollow(a)} />}
          {/* 자주 쓰는 동작만 밖에 두고 나머지는 더보기로 접는다. 진행 중인 동작은 상태가 보이도록 밖으로 꺼낸다. */}
          {evalBusy && <Button variant="secondary" icon={<Download />} loading>평가점수 가져오기</Button>}
          {!isPrespec && <Button variant="secondary" loading={busy} icon={<RefreshCw />} onClick={() => void extract()}>{busy ? '수집 중' : '다시 수집'}</Button>}
          {safeUrl && <Button variant="secondary" icon={<ExternalLink />} onClick={() => window.open(safeUrl, '_blank', 'noopener')}>원문 보기</Button>}
          <SearchButton noticeId={noticeId} title={title} />
          <MoreMenu items={[
            ...(hasRfpFile ? [{ key: 'rfp-compare', label: '변경점 비교', icon: <GitCompareArrows />, onSelect: () => { window.location.hash = rfpHash({ next: noticeId }); } }] : []),
            ...(evalHave ? [{ key: 'eval-view', label: '평가점수 보기', icon: <BarChart3 />, onSelect: () => { window.location.hash = evaluationHash(noticeId); } }] : []),
            ...(!evalHave && !evalBusy && entry && evalFetchable(entry, new Date()).ok
              ? [{ key: 'eval-fetch', label: '평가점수 가져오기', icon: <Download />, title: '나라장터에 로그인돼 있어야 합니다', onSelect: () => void fetchEval() }]
              : []),
            { key: 'copy-path', label: '폴더 경로 복사', icon: <ClipboardCopy />, onSelect: () => void copyPath() },
            { key: 'delete', label: '공고 삭제', icon: <Trash2 />, disabled: busy || deleting, title: busy ? '작업이 끝난 뒤 삭제할 수 있습니다' : undefined, onSelect: () => setConfirmDelete(true) },
          ]} />
          <Button icon={<Mail />} onClick={() => { window.location.hash = `#/mail/${encodeURIComponent(noticeId)}`; }}>
            {notice.mail.status !== 'none' ? '메일 초안 보기' : '메일 작성 준비'}
          </Button>
        </div>
      </header>
      {/* 기본 정보: 가로 한 줄 카드. 칸마다 이름표 위, 값 아래 */}
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line shadow-card lg:auto-cols-fr lg:grid-flow-col lg:grid-cols-none">
        {notice.basic.orderingOrg.value && (
          <InfoCell label="발주기관"><span className="truncate" title={notice.basic.orderingOrg.value}>{notice.basic.orderingOrg.value}</span></InfoCell>
        )}
        <InfoCell label="공고번호"><span className="font-mono tabular-nums">{noticeNo}</span></InfoCell>
        <InfoCell label={isPrespec ? '의견등록마감' : '입찰마감'}>
          <span className="font-mono tabular-nums">{formatDateTime(closeAt)}</span>
          {dday && dday !== '마감' && <b className={`font-mono text-[0.8125rem] ${dDayLevel(dday) === 'urgent' ? 'text-danger' : dDayLevel(dday) === 'soon' ? 'text-warn' : 'text-muted'}`}>{dday}</b>}
          {dday === '마감' && <span className="text-[0.8125rem] font-normal text-faint">마감됨</span>}
        </InfoCell>
        {extraction && <InfoCell label="최근 수집"><span className="font-mono tabular-nums">{formatDateTime(extraction.extractedAt)}</span></InfoCell>}
      </dl>
      {entry?.result && isWon(entry) && <WonCard result={entry.result} />}
      {handoff && handoff.length > 0 && (
        <InlineAlert tone="warn">
          <div className="flex items-center justify-between gap-4">
            <span>자동 메일 작성을 건너뛰었습니다. 사유: {handoff.map(handoffReasonLabel).join(', ')}. 내용을 확인한 뒤 메일 작성 준비로 진행하세요</span>
            <Button variant="secondary" icon={<Mail />} onClick={() => { window.location.hash = `#/mail/${encodeURIComponent(noticeId)}`; }}>메일 작성 준비</Button>
          </div>
        </InlineAlert>
      )}
      {alert && <InlineAlert tone="error">{alert}</InlineAlert>}
      <ConfirmDialog
        open={confirmDelete} title="이 공고를 삭제할까요?"
        description="공고 파일과 첨부, 추출 결과, AI 제안, 평가점수, 낙찰 결과 추적, RFP 비교가 함께 지워집니다. 메일 발송 이력은 발송 이력 화면에 남습니다. 되돌릴 수 없습니다."
        onCancel={() => setConfirmDelete(false)} onConfirm={() => void runDelete()}
      />
      {loadError && <InlineAlert tone="error">{loadError}</InlineAlert>}

      <TabBar noticeId={noticeId} tabs={tabs} active={active} query={handoff && handoff.length > 0 ? { handoff: handoff.join(',') } : undefined} />

      {active === 'overview' && <OverviewTab notice={notice} index={index} extraction={extraction} />}
      {active === 'files' && <FilesTab notice={notice} extraction={extraction} toast={toast} />}
      {active === 'history' && <HistoryTab notice={notice} index={index} onNoticeChange={(n) => setData((d) => (d ? { ...d, notice: n } : d))} />}
      {active === 'review' && (
        <ReviewTab noticeId={noticeId} notice={notice} extraction={extraction} busy={busy} onExtract={() => void extract()} onEdit={edit} onApplied={(r) => setData((d) => (d ? { ...d, ...r } : d))} toast={toast} />
      )}

      {showDock && <JobDock job={dockJob} needsReview={extraction?.status === 'needs_review'} onClose={closeDock} />}
      {toast.node}
    </div>
  );
}

/** 기본 정보 카드의 한 칸 */
function InfoCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 bg-surface px-5 py-3 max-lg:[&:last-child:nth-child(odd)]:col-span-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 flex min-w-0 items-baseline gap-2 text-[0.9375rem] font-semibold text-ink">{children}</dd>
    </div>
  );
}
