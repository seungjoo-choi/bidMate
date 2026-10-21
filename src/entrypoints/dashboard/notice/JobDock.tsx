import { useEffect } from 'react';
import type { Job } from '../../../core/types/job';
import { send } from '../../../messaging/bus';
import { Button } from '../../../ui/components';
import { Mascot, type MascotMood } from '../../../ui/mascot';

const ACTIVE = new Set(['queued', 'running', 'cancelling']);
const OK = new Set(['completed', 'partial']);

const DOCK_CSS = `
@keyframes bm-dock-in { from { opacity: 0; transform: translateY(12px) scale(.98); } to { opacity: 1; transform: none; } }
.bm-dock { animation: bm-dock-in 260ms cubic-bezier(.2,.8,.3,1) both; }
@keyframes bm-dock-slide { from { transform: translateX(-100%); } to { transform: translateX(250%); } }
.bm-dock-indet { animation: bm-dock-slide 1.2s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .bm-dock, .bm-dock-indet { animation: none; } }
`;

const RUN_TITLE: Record<Job['type'], string> = {
  extract: '다시 수집 중', collect: '공고 수집 중', download_retry: '첨부파일 다시 받는 중', compose: '메일 작성 중',
};
const DONE_TITLE: Record<Job['type'], string> = {
  extract: '다시 수집을 마쳤어요', collect: '공고 수집을 마쳤어요', download_retry: '첨부파일을 다시 받았어요', compose: '메일 작성을 마쳤어요',
};

/** 지금 단계의 진행률(0~1). 단계 안 개수가 있으면 그것, 없으면 끝난 단계 비율. 알 수 없으면 null */
function ratioOf(job: Job): number | null {
  const cur = job.steps.find((s) => s.id === job.currentStep);
  if (cur?.progress && cur.progress.total > 0) return cur.progress.done / cur.progress.total;
  const live = job.steps.filter((s) => s.status !== 'skipped');
  if (live.length < 2) return null;
  return live.filter((s) => s.status === 'done').length / live.length;
}

/**
 * 공고 상세 오른쪽 아래 진행 팝업. job이 없으면 시작 요청 중(준비)으로 그린다.
 * 성공으로 끝나면 몇 초 뒤 스스로 닫는다.
 */
export function JobDock({ job, needsReview, onClose }: { job: Job | null; needsReview: boolean; onClose: () => void }) {
  const running = !job || ACTIVE.has(job.status);
  const ok = !!job && OK.has(job.status);
  useEffect(() => {
    if (!ok) return;
    const t = setTimeout(onClose, 5000);
    return () => clearTimeout(t);
  }, [ok, onClose]);

  const type = job?.type ?? 'extract';
  const mood: MascotMood = running ? (job?.status === 'running' ? 'run' : 'work') : ok ? 'happy' : 'huh';
  const ratio = job && running ? ratioOf(job) : null;
  const cur = job?.steps.find((s) => s.id === job.currentStep)?.progress;
  const title = !job ? '수집 준비 중'
    : job.status === 'cancelling' ? '멈추는 중'
    : running ? RUN_TITLE[type]
    : ok ? DONE_TITLE[type]
    : job.status === 'cancelled' ? '중단했어요'
    : '끝내지 못했어요';
  const sub = running ? job?.label
    : ok ? (type === 'extract' && needsReview ? '확인이 필요한 항목이 있어요. 검토 탭에서 확인하세요' : job?.status === 'partial' ? '일부 항목은 가져오지 못했어요' : undefined)
    : job?.errors[0]?.message;

  return (
    <div role="status" className="bm-dock fixed right-6 bottom-6 z-40 w-[25rem] max-w-[calc(100vw-3rem)] rounded-card border border-line bg-surface p-4 text-ink shadow-raised tabular-nums">
      <style>{DOCK_CSS}</style>
      <div className="flex items-center gap-3.5">
        <div className={`grid size-14 shrink-0 place-items-center rounded-full ${running ? 'bg-primary/10 ring-2 ring-primary/30' : 'bg-sunken'}`}>
          <Mascot key={mood} mood={mood} variant="face" size={46} hops={mood === 'run' || mood === 'work' ? undefined : 2} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-[0.9375rem] font-bold">{title}</span>
            {running && cur && cur.total > 0 && <span className="font-mono text-[0.8125rem] font-semibold text-primary">{cur.done}/{cur.total}</span>}
          </div>
          {sub && <div className={`mt-0.5 text-[0.8125rem] leading-snug ${running ? 'truncate' : 'break-words'} ${!running && !ok ? 'text-danger' : 'text-muted'}`} title={sub}>{sub}</div>}
        </div>
        {running
          ? job && job.status !== 'cancelling' && <Button variant="ghost" className="!h-8 shrink-0 !px-2.5" onClick={() => void send('job/cancel', { jobId: job.id }).catch(() => undefined)}>중단</Button>
          : <Button variant="ghost" className="!h-8 shrink-0 !px-2.5" onClick={onClose}>닫기</Button>}
      </div>
      {running && (
        <div className="relative mt-3 h-1.5 overflow-hidden rounded-full bg-sunken">
          {ratio === null
            ? <div className="bm-dock-indet absolute inset-y-0 left-0 w-2/5 rounded-full bg-primary" />
            : <div className="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${Math.max(Math.round(ratio * 100), 4)}%` }} />}
        </div>
      )}
    </div>
  );
}
