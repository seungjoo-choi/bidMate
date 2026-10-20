import { ArrowLeft, ClipboardCopy, ExternalLink, Loader2, Mail, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Extraction, ExtractionKey } from '../../../core/types/extraction';
import { handoffReasonLabel } from '../../../core/model/handoff';
import type { IndexEntry } from '../../../core/types/index-file';
import type { HandoffReason } from '../../../core/types/job';
import type { Notice } from '../../../core/types/notice';
import { send } from '../../../messaging/bus';
import { kindOf, noticeLabel } from '../../../core/model/ids';
import { Button, InlineAlert, StatusBadge, useToast } from '../../../ui/components';
import { useJobs } from '../../../ui/hooks/useJobs';
import { COLLECT_BADGE, detailTabs, effectiveTab, folderRelPath } from '../../../ui/notice-detail/view';
import { dDayLevel, formatDDay, formatDateTime } from '../../../ui/review/format';
import type { EditError } from '../review/ItemCard';
import type { NoticeTab } from '../route';
import { FilesTab } from './FilesTab';
import { HistoryTab } from './HistoryTab';
import { OverviewTab } from './OverviewTab';
import { ReviewTab } from './ReviewTab';
import { TabBar } from './TabBar';

const ACTIVE = new Set(['queued', 'running', 'cancelling']);

export function NoticeDetailPage({ noticeId, tab, handoff }: { noticeId: string; tab: NoticeTab; handoff?: HandoffReason[] }) {
  const [data, setData] = useState<{ notice: Notice; extraction: Extraction | null } | null | undefined>(undefined);
  const [index, setIndex] = useState<IndexEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const toast = useToast();
  const jobs = useJobs();
  const running = jobs.find((j) => j.type !== 'compose' && j.noticeId === noticeId && ACTIVE.has(j.status));
  const wasRunning = useRef(false);

  const load = async () => {
    try {
      const [d, list] = await Promise.all([
        send('notice/get', { noticeId }),
        send('notice/list', undefined).catch(() => [] as IndexEntry[]),
      ]);
      setData(d);
      setIndex(list);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => { void load(); }, [noticeId]); // eslint-disable-line react-hooks/exhaustive-deps
  // 잡이 끝나면 결과를 다시 불러온다.
  useEffect(() => {
    if (wasRunning.current && !running) void load();
    wasRunning.current = !!running;
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  const busy = !!running || starting;

  const extract = async () => {
    setAlert(null);
    setStarting(true);
    try {
      const r = await send('job/start', { type: 'extract', noticeId });
      if (r.code === 'JOB_ALREADY_RUNNING') setAlert('이 공고는 다른 작업이 진행 중입니다');
    } catch (e) {
      const code = (e as { code?: string }).code;
      setAlert(code === 'JOB_ALREADY_RUNNING' ? '이 공고는 다른 작업이 진행 중입니다' : e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  };

  const edit = async (key: ExtractionKey, value: unknown | null, note?: string): Promise<EditError | null> => {
    try {
      const r = await send('extraction/edit', { noticeId, key, value, note });
      setData(r);
      toast.show('저장됨');
      return null;
    } catch (e) {
      return { code: (e as { code?: string }).code, message: e instanceof Error ? e.message : String(e) };
    }
  };

  const copyPath = async () => {
    if (!data) return;
    try { await navigator.clipboard.writeText(folderRelPath(data.notice.folder)); toast.show('복사됨'); } catch { toast.show('복사하지 못했습니다'); }
  };

  const back = (
    <a href="#/notices" className="inline-flex items-center gap-1 text-sm text-accent hover:underline"><ArrowLeft className="size-4" />공고 목록</a>
  );

  if (data === undefined) {
    return <div className="space-y-4">{back}{loadError ? <InlineAlert tone="error">{loadError}</InlineAlert> : <Loader2 className="size-4 animate-spin text-muted" />}</div>;
  }
  if (data === null) {
    return <div className="space-y-4">{back}<InlineAlert tone="warn">공고를 찾을 수 없습니다.</InlineAlert></div>;
  }

  const { notice, extraction } = data;
  const sourceUrl = notice.sourceUrl.value;
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

  return (
    <div className="space-y-6">
      {back}
      <header className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <h1 className="title-mark text-2xl leading-snug font-bold tracking-tight text-balance">{title}</h1>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-6 pl-[calc(3px+0.75rem)] gap-y-1 text-sm text-muted">
            <span className="font-mono text-sm">{noticeNo}</span>
            {isPrespec && <StatusBadge status="idle">사전규격</StatusBadge>}
            {notice.isCorrection && <StatusBadge status="warn">정정공고</StatusBadge>}
            <StatusBadge status={cb.tone}>{cb.text}</StatusBadge>
            {notice.basic.orderingOrg.value && <span>{notice.basic.orderingOrg.value}</span>}
            <span>
              {isPrespec ? '의견등록마감' : '입찰마감'}{' '}<b className="font-mono text-sm font-semibold text-ink tabular-nums">{formatDateTime(closeAt)}</b>
              {dday && dday !== '마감' && <b className={`ml-2 font-mono text-sm ${dDayLevel(dday) === 'urgent' ? 'text-danger' : dDayLevel(dday) === 'soon' ? 'text-warn' : 'text-muted'}`}>{dday}</b>}
              {dday === '마감' && <span className="ml-1.5 text-faint">마감됨</span>}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {safeUrl && <Button variant="ghost" icon={<ExternalLink />} onClick={() => window.open(safeUrl, '_blank', 'noopener')}>원문 보기</Button>}
          <Button variant="ghost" icon={<ClipboardCopy />} onClick={() => void copyPath()}>폴더 경로 복사</Button>
          <Button icon={<Mail />} onClick={() => { window.location.hash = `#/mail/${encodeURIComponent(noticeId)}`; }}>
            {notice.mail.status !== 'none' ? '메일 초안 보기' : '메일 작성 준비'}
          </Button>
          {!isPrespec && (
            <Button variant="secondary" loading={busy} icon={<RefreshCw />} onClick={() => void extract()}>
              {running ? (running.label ?? '진행 중') : '다시 추출'}
            </Button>
          )}
        </div>
      </header>
      {handoff && handoff.length > 0 && (
        <InlineAlert tone="warn">
          <div className="flex items-center justify-between gap-4">
            <span>자동 메일 작성을 건너뛰었습니다. 사유: {handoff.map(handoffReasonLabel).join(', ')}. 내용을 확인한 뒤 메일 작성 준비로 진행하세요</span>
            <Button variant="secondary" icon={<Mail />} onClick={() => { window.location.hash = `#/mail/${encodeURIComponent(noticeId)}`; }}>메일 작성 준비</Button>
          </div>
        </InlineAlert>
      )}
      {alert && <InlineAlert tone="error">{alert}</InlineAlert>}
      {loadError && <InlineAlert tone="error">{loadError}</InlineAlert>}

      <TabBar noticeId={noticeId} tabs={tabs} active={active} query={handoff && handoff.length > 0 ? { handoff: handoff.join(',') } : undefined} />

      {active === 'overview' && <OverviewTab notice={notice} index={index} />}
      {active === 'files' && <FilesTab notice={notice} extraction={extraction} toast={toast} />}
      {active === 'history' && <HistoryTab notice={notice} index={index} onNoticeChange={(n) => setData((d) => (d ? { ...d, notice: n } : d))} />}
      {active === 'review' && (
        <ReviewTab noticeId={noticeId} extraction={extraction} busy={busy} onExtract={() => void extract()} onEdit={edit} onApplied={(r) => setData((d) => (d ? { ...d, ...r } : d))} toast={toast} />
      )}

      {toast.node}
    </div>
  );
}
