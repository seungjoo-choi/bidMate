import { ArrowLeft, ChevronDown, ChevronRight, ClipboardCopy, ExternalLink, FileSearch, Loader2, Mail, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { EvidenceRef, Extraction, ExtractionKey } from '../../core/types/extraction';
import { handoffReasonLabel } from '../../core/model/handoff';
import type { HandoffReason } from '../../core/types/job';
import type { Notice } from '../../core/types/notice';
import { send } from '../../messaging/bus';
import { kindOf, noticeLabel } from '../../core/model/ids';
import { Button, Card, InlineAlert, StatusBadge, useToast } from '../../ui/components';
import { useJobs } from '../../ui/hooks/useJobs';
import { dDayLevel, formatAmountFull, formatDDay, formatDateTime } from '../../ui/review/format';
import {
  DOC_KIND_LABEL, FILE_STATUS_LABEL, buildCards, fileDisplayName, filePagesTables, fileRemark, findTextPath, summarize,
} from '../../ui/review/view';
import { EditedMark, ItemCard, type EditError } from './review/ItemCard';
import { TextDrawer, type DrawerTarget } from './review/TextDrawer';

const ACTIVE = new Set(['queued', 'running', 'cancelling']);

function Collapsible({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-card border border-line bg-surface shadow-card">
      <button className="flex w-full items-center gap-2 px-5 py-4 text-left text-base font-semibold hover:bg-sunken" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? <ChevronDown className="size-4 text-muted" /> : <ChevronRight className="size-4 text-muted" />}
        {title}
      </button>
      {open && <div className="border-t border-line">{children}</div>}
    </section>
  );
}

export function ReviewPage({ noticeId, handoff }: { noticeId: string; handoff?: HandoffReason[] }) {
  const [data, setData] = useState<{ notice: Notice; extraction: Extraction | null } | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [drawer, setDrawer] = useState<DrawerTarget | null>(null);
  const toast = useToast();
  const jobs = useJobs();
  const running = jobs.find((j) => j.type !== 'compose' && j.noticeId === noticeId && ACTIVE.has(j.status));
  const wasRunning = useRef(false);

  const load = async () => {
    try {
      setData(await send('notice/get', { noticeId }));
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
    const f = data.notice.folder.replace(/\\/g, '/');
    const rel = f.startsWith('notices/') ? f : `notices/${f.replace(/^\/+/, '')}`;
    try { await navigator.clipboard.writeText(rel); toast.show('복사됨'); } catch { toast.show('복사하지 못했습니다'); }
  };

  const openText = (ex: Extraction, e: EvidenceRef) => {
    const textPath = findTextPath(ex.files, e);
    if (!textPath) { toast.show('이 파일의 추출 텍스트가 없습니다'); return; }
    setDrawer({ textPath, line: e.line, title: e.sourceFile });
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
  const prespecRows: [string, string][] = isPrespec ? [
    ['사전규격 등록번호', notice.prespec.specRegNo.value ?? '—'],
    ['사전규격명', notice.prespec.specName.value ?? '—'],
    ['업무구분', notice.prespec.bizDivision.value ?? '—'],
    ['배정예산', typeof notice.prespec.assignedBudget.value === 'number' ? formatAmountFull(notice.prespec.assignedBudget.value) : '—'],
    ['공개일시', formatDateTime(notice.prespec.registeredAt.value)],
    ['의견등록 마감일시', formatDateTime(notice.prespec.opinionCloseAt.value)],
    ['담당자', notice.prespec.officerName.value ?? '—'],
    ['담당자 연락처', notice.prespec.officerTel.value ?? '—'],
    ['연계 입찰공고번호', notice.prespec.relatedBidNo.value ?? '—'],
    ['발주기관', notice.basic.orderingOrg.value ?? '—'],
    ['수요기관', notice.basic.demandOrg.value ?? '—'],
  ] : [];
  const dday = formatDDay(closeAt);
  const cards = extraction ? buildCards(extraction) : [];
  const counts = extraction ? summarize(extraction) : null;

  return (
    <div className="space-y-6">
      {back}
      <header className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <h1 className="title-mark text-2xl leading-snug font-bold tracking-tight text-balance">{title}</h1>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-6 pl-[calc(3px+0.75rem)] gap-y-1 text-sm text-muted">
            <span className="font-mono text-sm">{noticeNo}</span>
            {isPrespec && <StatusBadge status="idle">사전규격</StatusBadge>}
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

      {isPrespec ? (
        <Card title="사전규격 정보">
          <dl className="grid grid-cols-[10rem_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-sm">
            {prespecRows.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted">{label}</dt>
                <dd className="min-w-0 break-words">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>
      ) : !extraction ? (
        <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-line-strong py-20 text-muted">
          <FileSearch className="size-9 text-faint" strokeWidth={1.5} />
          <p className="font-semibold text-ink">아직 평가정보를 분석하지 않았습니다</p>
          <Button loading={busy} onClick={() => void extract()}>평가정보 분석</Button>
        </div>
      ) : (
        <>
          {counts && (
            <div className="flex gap-6 border-y border-line py-3.5 tabular-nums">
              <StatusBadge status="ok">확인 완료 {counts.verified}</StatusBadge>
              <StatusBadge status="warn">확인 필요 {counts.needsReview}</StatusBadge>
              <EditedMark>직접 수정 {counts.edited}</EditedMark>
            </div>
          )}
          <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-card">
            {cards.map((c) => (
              <ItemCard key={c.key} card={c} busy={busy} onEdit={(v, note) => edit(c.key, v, note)} onOpenText={(e) => openText(extraction, e)} />
            ))}
          </div>

          <Collapsible title={`분석한 파일 (${extraction.files.length})`}>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-sunken text-muted">
                  <tr>{['이름', '종류', '상태', '쪽/표 수', '소요(ms)', '비고'].map((h) => <th key={h} className="px-5 py-3 font-medium">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {extraction.files.map((f, i) => (
                    <tr key={i} className={`border-t border-line ${f.status === 'parsed' ? '' : 'text-faint'}`}>
                      <td className="max-w-xs px-5 py-3 break-all">{fileDisplayName(f)}</td>
                      <td className="px-5 py-3">{DOC_KIND_LABEL[f.docKind] ?? f.docKind}</td>
                      <td className="px-5 py-3">{FILE_STATUS_LABEL[f.status] ?? f.status}</td>
                      <td className="px-5 py-3">{filePagesTables(f)}</td>
                      <td className="px-5 py-3 font-mono tabular-nums">{f.ms ?? '—'}</td>
                      <td className="px-5 py-3">{fileRemark(f)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Collapsible>

          {extraction.warnings.length > 0 && (
            <Collapsible title={`경고 (${extraction.warnings.length})`}>
              <ul className="list-disc space-y-1.5 py-4 pr-5 pl-10 text-sm text-muted">
                {extraction.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </Collapsible>
          )}
        </>
      )}

      {drawer && <TextDrawer noticeId={noticeId} target={drawer} onClose={() => setDrawer(null)} />}
      {toast.node}
    </div>
  );
}
