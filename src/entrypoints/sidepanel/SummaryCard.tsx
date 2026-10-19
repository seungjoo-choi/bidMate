import { Copy } from 'lucide-react';
import type { ReactNode } from 'react';
import { ComposeCard } from '../../ui/compose/ComposeCard';
import { Button } from '../../ui/components';
import type { Job } from '../../core/types/job';
import type { NoticeRef } from '../../core/types/notice';
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
      <div className="text-balance text-base leading-snug font-bold break-all" title={title}>{title}</div>
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

function Group({ title, badge, children }: { title: string; badge?: string; children: ReactNode }) {
  return (
    <div className="border-t border-line px-3.5 py-3">
      <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted">
        {title}
        {badge && <span className="rounded-full bg-warn-wash px-1.5 text-[11px] font-normal text-warn">{badge}</span>}
      </h3>
      {children}
    </div>
  );
}

export interface SummaryCardProps {
  view: SummaryView;
  jobs: Job[];
  noticeRef?: NoticeRef;
  copied: boolean;
  onReview: (noticeId: string) => void;
  onCopyFolder: (folder: string) => void;
}

/** 공고 요약 카드: 핵심 3칸, 기본 정보, 평가 기준, 첨부, 버튼. */
export function SummaryCard({ view, jobs, noticeRef, copied, onReview, onCopyFolder }: SummaryCardProps) {
  const { actions } = view;
  return (
    <div className={`${CARD} sp-slide`}>
      <div className="grid grid-cols-3 gap-2 px-3.5 pt-3.5 pb-3">
        {view.key3.map((c) => (
          <div key={c.label} className={`grid min-w-0 rounded-btn px-2.5 py-2 ${c.hot ? 'bg-warn-wash' : 'bg-sunken'}`}>
            <span className={`text-xs ${c.hot ? 'text-warn' : 'text-muted'}`}>{c.label}</span>
            <b className={`truncate text-lg leading-snug tabular-nums ${c.hot ? 'text-warn' : ''}`} title={c.value}>{c.value}</b>
            <small className="truncate text-[11px] text-muted tabular-nums" title={c.sub}>{c.sub}</small>
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
        <Group title="평가 기준" badge={view.evaluation.reviewCount > 0 ? `확인 필요 ${view.evaluation.reviewCount}` : undefined}>
          <dl className="m-0 grid grid-cols-[92px_1fr] gap-y-1.5 text-sm">
            {view.evaluation.rows.map((r) => (
              <div key={r.label} className="contents">
                <dt className="whitespace-nowrap text-muted">{r.label}</dt>
                <dd className={`m-0 min-w-0 font-medium tabular-nums [overflow-wrap:anywhere] ${r.check ? 'font-semibold text-warn' : ''}`}>
                  {r.value}
                  {r.check && <span className="ml-1.5 rounded-full bg-warn-wash px-1.5 text-[11px] font-normal">확인 필요</span>}
                </dd>
              </div>
            ))}
          </dl>
        </Group>
      )}

      {view.attachments.files.length > 0 && (
        <Group title={view.attachments.title}>
          <ul className="m-0 grid list-none gap-1.5 p-0 text-sm">
            {view.attachments.files.map((f, i) => (
              <li key={i} className="flex items-center gap-2">
                <i className={`w-[34px] flex-none rounded-[4px] py-0.5 text-center text-[10px] font-bold tracking-wide not-italic ${EXT[f.ext]}`}>{f.extLabel}</i>
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
            <span className="ml-1.5 min-w-[18px] rounded-full bg-warn-wash px-1.5 text-[11px] font-bold text-warn">{actions.reviewCount}</span>
          )}
        </Button>
        <Button variant="secondary" icon={<Copy />} onClick={() => onCopyFolder(actions.folder)}>{copied ? '복사됨' : '폴더 경로 복사'}</Button>
      </div>
    </div>
  );
}
