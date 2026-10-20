import { Copy } from 'lucide-react';
import type { ReactNode } from 'react';
import { ComposeCard } from '../../ui/compose/ComposeCard';
import type { AiProvider } from '../../core/types/ai';
import { Button, ProviderIcon } from '../../ui/components';
import type { Job } from '../../core/types/job';
import type { NoticeRef } from '../../core/types/notice';
import type { AiButtonView } from './ai-button';
import type { ChipTone, ExtBadge, StatusChip, SummaryView } from './summary-view';

const CHIP: Record<ChipTone, string> = {
  ok: 'bg-ok-wash text-ok',
  run: 'bg-info-wash text-primary',
  warn: 'bg-warn-wash text-warn',
  danger: 'bg-danger-wash text-danger',
};

const EXT: Record<ExtBadge, string> = {
  pdf: 'bg-danger-wash text-danger',
  hwp: 'bg-info-wash text-primary',
  zip: 'bg-sunken text-muted',
  xls: 'bg-ok-wash text-ok',
  etc: 'bg-sunken text-muted',
};

const CARD = 'rounded-card border border-line bg-surface shadow-card';

export interface TopCardProps {
  kindLabel: string;
  chip: StatusChip | null;
  title: string;
  noticeNo: string;
  /** 수집 중일 때만 */
  elapsed?: ReactNode;
  progress?: { ratio: number; done: boolean };
}

/** 상단 카드: 종류 칩, 상태 칩, 제목, 공고번호, 수집 중이면 경과 시간과 진행 막대. */
export function TopCard({ kindLabel, chip, title, noticeNo, elapsed, progress }: TopCardProps) {
  const pct = progress ? Math.round(Math.max(0, Math.min(1, progress.ratio)) * 100) : 0;
  return (
    <div className={`${CARD} grid gap-1.5 px-3.5 py-3`}>
      <div className="flex items-center gap-2">
        <span className="rounded-[4px] bg-info-wash px-2 py-px text-xs font-semibold text-accent">{kindLabel}</span>
        {chip && (
          <span className={`ml-auto inline-flex items-center gap-1.5 rounded-full py-0.5 pr-2.5 pl-2 text-xs font-semibold whitespace-nowrap ${CHIP[chip.tone]}`}>
            <i className={`size-[7px] rounded-full bg-current ${chip.tone === 'run' ? 'sp-blink' : ''}`} />
            {chip.text}
          </span>
        )}
      </div>
      <div className="text-balance text-base leading-snug font-bold wrap-anywhere" title={title}>{title}</div>
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="font-mono">{noticeNo}</span>
        {elapsed && <span className="ml-auto tabular-nums">{elapsed}</span>}
      </div>
      {progress && (
        <div className={`relative pt-[30px] ${progress.done ? 'sp-track-done' : ''}`}>
          <img className="sp-rider absolute bottom-px size-[34px] -translate-x-1/2" style={{ left: `${pct}%` }} src="/icon/bidmate-96.png" alt="" />
          <div className="h-1.5 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <i className={`block h-full rounded-full transition-[width] duration-200 motion-reduce:transition-none ${progress.done ? 'bg-ok' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}

function Group({ title, badge, action, children }: { title: string; badge?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="border-t border-line px-3.5 py-3">
      <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted">
        {title}
        {badge && <span className="rounded-full bg-warn-wash px-1.5 text-[0.6875rem] font-normal text-warn">{badge}</span>}
        {action && <span className="ml-auto flex items-center gap-1.5 font-normal tracking-normal">{action}</span>}
      </h3>
      {children}
    </div>
  );
}

export interface SummaryAi {
  view: AiButtonView;
  provider: AiProvider;
  providerLabel: string;
  onRun: () => void;
  onCancel: () => void;
  /** 대시보드 확인 탭으로 이동(계속·적용·수동 진행) */
  onOpenReview: () => void;
  onOpenSettings: () => void;
}

/** 목업 7.3 결과 상자 문구: "AI 제안 n"은 굵게. */
function ResultText({ text }: { text: string }) {
  const m = /^(AI 제안 \d+)(.*)$/.exec(text);
  return m ? <><b className="font-semibold text-ai-ink">{m[1]}</b>{m[2]}</> : <>{text}</>;
}

function AiHeaderAction({ ai }: { ai: SummaryAi }) {
  const v = ai.view;
  const icon = <ProviderIcon provider={ai.provider} size={14} />;
  if (v.kind === 'run') return <Button variant="secondary" className="!h-8 !px-2.5 [&_svg]:!size-3.5" icon={icon} disabled={v.disabled} title={v.hint} onClick={ai.onRun}>{v.label}</Button>;
  if (v.kind === 'manual') return <Button variant="secondary" className="!h-8 !px-2.5 [&_svg]:!size-3.5" icon={icon} disabled={v.disabled} title={v.hint} onClick={ai.onOpenReview}>{v.label}</Button>;
  if (v.kind === 'setup') {
    return (
      <>
        <span className="text-xs text-warn">{v.message}</span>
        <Button variant="secondary" className="!h-8 !px-2.5" onClick={ai.onOpenSettings}>{v.label}</Button>
      </>
    );
  }
  return null;
}

/** 그룹 하단 결과 상자(진행·대기·완료·실패). idle이면 없음. */
function AiResultBox({ ai }: { ai: SummaryAi }) {
  const v = ai.view;
  if (v.kind === 'run' || v.kind === 'manual' || v.kind === 'setup') return null;
  const action =
    v.kind === 'running' ? <Button variant="secondary" className="!h-8 !px-2.5" onClick={ai.onCancel}>{v.label}</Button>
    : v.kind === 'failed' ? (v.setup ? <Button variant="secondary" className="!h-8 !px-2.5" onClick={ai.onOpenSettings}>{v.label}</Button> : v.label ? <Button variant="secondary" className="!h-8 !px-2.5" disabled={v.disabled} onClick={ai.onRun}>{v.label}</Button> : null)
    : <Button variant="secondary" className="!h-8 !px-2.5" onClick={ai.onOpenReview}>{v.label} ↗</Button>;
  return (
    <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-ai-line bg-ai-wash px-2.5 py-2 text-sm text-ai-ink">
      <span className={`[&_svg]:!size-3.5 ${v.kind === 'running' ? 'animate-spin motion-reduce:animate-none' : ''}`}><ProviderIcon provider={ai.provider} size={14} /></span>
      <span className="min-w-0 flex-1">
        {v.kind === 'running' ? `${ai.providerLabel}가 찾는 중…` : <ResultText text={v.message ?? ''} />}
        {v.note && <span className="block text-xs">{v.note}</span>}
      </span>
      {action}
    </div>
  );
}

export interface SummaryCardProps {
  view: SummaryView;
  ai?: SummaryAi;
  jobs: Job[];
  noticeRef?: NoticeRef;
  copied: boolean;
  onReview: (noticeId: string) => void;
  onCopyFolder: (folder: string) => void;
}

/** 공고 요약 카드: 핵심 3칸, 기본 정보, 평가 기준, 첨부, 버튼. */
export function SummaryCard({ view, ai, jobs, noticeRef, copied, onReview, onCopyFolder }: SummaryCardProps) {
  const { actions } = view;
  return (
    <div data-ai={ai?.provider} className={`${CARD} sp-slide`}>
      <div className="grid grid-cols-3 gap-2 px-3.5 pt-3.5 pb-3">
        {view.key3.map((c) => (
          <div key={c.label} className={`grid min-w-0 rounded-btn px-2.5 py-2 ${c.hot ? 'bg-warn-wash' : 'bg-sunken'}`}>
            <span className={`text-xs ${c.hot ? 'text-warn' : 'text-muted'}`}>{c.label}</span>
            <b className={`truncate text-lg leading-snug tabular-nums ${c.hot ? 'text-warn' : ''}`} title={c.value}>{c.value}</b>
            <small className="truncate text-[0.6875rem] text-muted tabular-nums" title={c.sub}>{c.sub}</small>
          </div>
        ))}
      </div>

      <Group title="기본 정보">
        <dl className="m-0 grid grid-cols-[92px_1fr] gap-y-1.5 text-sm">
          {view.basic.map((r) => (
            <div key={r.label} className="contents">
              <dt className="whitespace-nowrap text-muted">{r.label}</dt>
              <dd className="m-0 min-w-0 font-medium tabular-nums [overflow-wrap:anywhere]">{r.value}</dd>
            </div>
          ))}
        </dl>
      </Group>

      {view.evaluation && (
        <Group title="평가 기준" badge={view.evaluation.reviewCount > 0 ? `확인 필요 ${view.evaluation.reviewCount}` : undefined}
          action={ai && <AiHeaderAction ai={ai} />}>
          <dl className="m-0 grid grid-cols-[92px_1fr] gap-y-1.5 text-sm">
            {view.evaluation.rows.map((r) => (
              <div key={r.label} className="contents">
                <dt className="whitespace-nowrap text-muted">{r.label}</dt>
                <dd className={`m-0 min-w-0 font-medium tabular-nums [overflow-wrap:anywhere] ${r.check ? 'font-semibold text-warn' : ''}`}>
                  {r.value}
                  {r.check && <span className="ml-1.5 rounded-full bg-warn-wash px-1.5 text-[0.6875rem] font-normal">확인 필요</span>}
                  {r.ai && <span className="ml-1.5 rounded-full border border-ai-line bg-ai-wash px-1.5 text-xs font-normal text-ai-ink">AI 제안</span>}
                </dd>
              </div>
            ))}
          </dl>
          {ai && <AiResultBox ai={ai} />}
        </Group>
      )}

      {view.attachments.files.length > 0 && (
        <Group title={view.attachments.title}>
          <ul className="m-0 grid list-none gap-1.5 p-0 text-sm">
            {view.attachments.files.map((f, i) => (
              <li key={i} className="flex items-center gap-2">
                <i className={`w-[34px] flex-none rounded-[4px] py-0.5 text-center text-[0.625rem] font-bold tracking-wide not-italic ${EXT[f.ext]}`}>{f.extLabel}</i>
                <span className="min-w-0 flex-1 truncate" title={f.name}>{f.name}</span>
                {f.problem && <small className="text-xs text-danger">{f.problem}</small>}
                <small className="text-muted tabular-nums">{f.size}</small>
              </li>
            ))}
          </ul>
        </Group>
      )}

      <div className="grid grid-cols-2 gap-1.5 border-t border-line px-3.5 pt-3 pb-3.5">
        <div className="col-span-2">
          <ComposeCard noticeId={actions.noticeId} noticeRef={noticeRef} params={{}} jobs={jobs} />
        </div>
        <Button variant="secondary" onClick={() => onReview(actions.noticeId)}>
          검수
          {actions.reviewCount > 0 && (
            <span className="ml-1.5 min-w-[18px] rounded-full bg-warn-wash px-1.5 text-[0.6875rem] font-bold text-warn">{actions.reviewCount}</span>
          )}
        </Button>
        <Button variant="secondary" icon={<Copy />} onClick={() => onCopyFolder(actions.folder)}>{copied ? '복사됨' : '폴더 경로 복사'}</Button>
      </div>
    </div>
  );
}
