import { Check, ExternalLink, Minimize2, Minus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { StepId, StepState } from '../../core/types/job';
import { send } from '../../messaging/bus';
import { Button } from '../components';
import { Mascot, STEP_ICON, STEP_ICON_CSS, type MascotMood } from '../mascot';
import { formatDateTimeSlash } from '../../core/model/format';
import type { ComposeController } from './ComposeCard';

/** 팝업에 보이는 단계(작성 잡 단계 순서). 무게는 체감 소요 시간 비율 */
const STEPS: Array<{ id: StepId; label: string; weight: number }> = [
  { id: 'render_mail', label: '메일 준비', weight: 1 },
  { id: 'open_compose', label: '웹메일 열기', weight: 3 },
  { id: 'fill_fields', label: '내용 입력', weight: 1 },
  { id: 'attach_files', label: '첨부', weight: 4 },
  { id: 'verify', label: '입력 확인', weight: 1 },
  { id: 'send_mail', label: '발송', weight: 3 },
];
/** 진행 중 단계 안에서 막대가 조금씩 차오르는 정도(단계 무게 대비 최대치)와 속도 */
const CREEP_MAX = 0.85;
const CREEP_TAU_MS = 8000;

function stepFill(s: StepState | undefined, now: number): number {
  if (!s) return 0;
  if (s.status === 'done' || s.status === 'skipped' || s.status === 'failed') return 1;
  if (s.status !== 'running') return 0;
  if (s.progress && s.progress.total > 0) return Math.min(1, s.progress.done / s.progress.total);
  const since = s.startedAt ? now - Date.parse(s.startedAt) : 0;
  return CREEP_MAX * (1 - Math.exp(-Math.max(0, since) / CREEP_TAU_MS));
}

function ratioOf(defs: typeof STEPS, steps: StepState[], now: number): number {
  const total = defs.reduce((a, s) => a + s.weight, 0);
  const sum = defs.reduce((a, s) => a + s.weight * stepFill(steps.find((x) => x.id === s.id), now), 0);
  return sum / total;
}

function StepMark({ s }: { s: StepState | undefined }) {
  const st = s?.status ?? 'pending';
  if (st === 'done') return <span className="grid size-5 place-items-center rounded-full bg-ok text-surface"><Check className="size-3" strokeWidth={3} /></span>;
  if (st === 'failed') return <span className="grid size-5 place-items-center rounded-full bg-danger text-surface"><X className="size-3" strokeWidth={3} /></span>;
  if (st === 'skipped') return <span className="grid size-5 place-items-center rounded-full bg-sunken text-faint"><Minus className="size-3" /></span>;
  if (st === 'running') {
    const icon = s ? STEP_ICON[s.id] : undefined;
    return icon
      ? <span className="grid size-5 place-items-center rounded-full bg-info-wash text-accent [&_svg]:size-3.5" dangerouslySetInnerHTML={{ __html: icon }} />
      : <span className="size-5 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />;
  }
  return <span className="grid size-5 place-items-center"><span className="size-2 rounded-full bg-line" /></span>;
}

/**
 * 작성/발송 진행 팝업. 작성 탭은 뒤에서 돌고 있으므로 여기서 단계와 진행률을 보여 준다.
 * mode 'send'는 [메일 발송](보내기까지), 'compose'는 [네이버웍스로 작성](채우기까지, 보내기는 사용자).
 * 닫아도 작업은 계속되고 메일 준비 화면의 작성 카드에 상태가 남는다.
 */
export function SendProgressDialog({ ctl, mode, since, onClose }: {
  ctl: ComposeController; mode: 'send' | 'compose';
  /** 버튼을 누른 시각(ms). 그 전에 만든 잡(지난 작성)은 보이지 않는다 */ since: number; onClose: () => void;
}) {
  const defs = mode === 'send' ? STEPS : STEPS.filter((d) => d.id !== 'send_mail');
  const fresh = !!ctl.job && Date.parse(ctl.job.createdAt) >= since - 1000;
  const job = fresh ? ctl.job : null;
  const view = fresh ? ctl.view : null;
  const { focusTab } = ctl;
  const startFailed = !job && !ctl.busy && ctl.note !== null;
  const [now, setNow] = useState(() => Date.now());
  const close = useRef(onClose);
  close.current = onClose;
  // 취소된 잡은 composeView가 null을 돌려준다. 시작 전(null)과 구분하지 않으면 진행 중으로 남는다
  const cancelled = job?.status === 'cancelled';
  const running = !startFailed && !cancelled && (!view || view.kind === 'progress');
  const [cancelAsked, setCancelAsked] = useState(false);
  const cancelling = cancelAsked || (view?.kind === 'progress' && view.cancelling);
  // 사용자가 취소한 것이므로 끝나면 팝업도 닫는다(작성 카드는 시작 전 상태로 돌아간다)
  useEffect(() => { if (cancelled) close.current(); }, [cancelled]);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [running]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const steps = job?.steps ?? [];
  const sent = view?.kind === 'sent';
  const composed = mode === 'compose' && view?.kind === 'done';
  const ok = sent || composed;
  const trouble = startFailed || (!!view && view.kind !== 'progress' && !ok);
  const ratio = ok ? 1 : ratioOf(defs, steps, now);
  const pct = Math.round(ratio * 100);
  const sending = job?.currentStep === 'send_mail';
  const mood: MascotMood = ok ? 'happy' : trouble ? 'huh' : sending ? 'run' : 'work';
  const elapsed = job ? Math.max(0, Math.round(((running ? now : Date.parse(job.updatedAt)) - Date.parse(job.createdAt)) / 1000)) : 0;
  const attach = steps.find((s) => s.id === 'attach_files');
  const canFocus = !!view && 'canFocus' in view && view.canFocus;

  let title: string;
  let detail: string | null = null;
  if (sent) {
    title = '메일을 보냈어요!';
    detail = view.clickedAt ? formatDateTimeSlash(view.clickedAt) : null;
  } else if (composed) {
    title = '메일 작성을 마쳤어요';
    detail = '작성 탭에서 내용을 확인한 뒤 보내 주세요';
  } else if (startFailed) {
    title = mode === 'send' ? '발송을 시작하지 못했어요' : '작성을 시작하지 못했어요';
    detail = ctl.note;
  } else if (view?.kind === 'send-issue' || view?.kind === 'error') {
    title = view.message;
    if (view.kind === 'send-issue' && view.maybeSent) detail = '발송 이력에 \'확인 없음\'으로 기록했어요. 실제로 안 갔다면 발송 이력에서 취소하세요';
  } else if (trouble) {
    title = mode === 'send' ? '자동 발송을 마치지 못했어요. 작성 탭에서 확인해 주세요' : '일부 항목은 직접 넣어야 해요. 작성 탭에서 확인해 주세요';
  } else {
    title = job?.label ?? (mode === 'send' ? '발송 준비 중…' : '작성 준비 중…');
    if (job?.currentStep === 'attach_files' && attach?.progress) title = `${title} (${attach.progress.done}/${attach.progress.total})`;
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <style>{STEP_ICON_CSS}</style>
      <div role="dialog" aria-modal="true" aria-label={mode === 'send' ? '메일 발송 진행' : '메일 작성 진행'} aria-live="polite" className="w-full max-w-md rounded-card border border-line bg-surface p-6 shadow-overlay">
        <div className="flex flex-col items-center text-center">
          <Mascot key={mood} mood={mood} size={88} hops={ok ? 2 : undefined} />
          <div className={`mt-3 text-base font-semibold wrap-anywhere ${ok ? 'text-ok' : 'text-ink'}`}>{title}</div>
          {detail && <div className="mt-1 text-sm text-muted">{detail}</div>}
        </div>

        <div className="mt-5">
          <div className="relative h-2 rounded-full bg-sunken">
            <div className={`h-full rounded-full ${trouble ? 'bg-warn' : ok ? 'bg-ok' : 'bg-accent'}`} style={{ width: `${pct}%`, transition: 'width 250ms linear' }} />
            {running && (
              <Mascot variant="face" mood="run" size={22} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `${pct}%`, transition: 'left 250ms linear' }} />
            )}
          </div>
          <div className="mt-1.5 flex justify-between text-xs text-muted tabular-nums">
            <span>{pct}%</span>
            <span>{elapsed}초</span>
          </div>
        </div>

        <ol className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2">
          {defs.map((def) => {
            const s = steps.find((x) => x.id === def.id);
            const st = s?.status ?? 'pending';
            return (
              <li key={def.id} className="flex items-center gap-2 text-sm">
                <StepMark s={s} />
                <span className={st === 'running' ? 'font-semibold text-ink' : st === 'pending' ? 'text-faint' : st === 'failed' ? 'text-danger' : 'text-muted'}>
                  {def.label}
                  {def.id === 'attach_files' && s?.progress ? ` ${s.progress.done}/${s.progress.total}` : ''}
                </span>
              </li>
            );
          })}
        </ol>

        {/* 이동·계속 버튼을 앞에 두고, 작업을 끝내는 버튼(취소·닫기)은 항상 오른쪽 끝에 둔다. */}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          {running ? (
            <>
              {canFocus && <Button variant="secondary" icon={<ExternalLink />} onClick={() => void focusTab()}>작성 탭으로 이동</Button>}
              <Button variant="secondary" icon={<Minimize2 />} onClick={onClose}>뒤에서 계속</Button>
              {!sending && job && (
                <Button
                  variant="secondary" icon={<X />} disabled={cancelling}
                  onClick={() => { setCancelAsked(true); void send('job/cancel', { jobId: job.id, force: false }).catch(() => setCancelAsked(false)); }}
                >{cancelling ? '취소 중…' : '취소'}</Button>
              )}
            </>
          ) : (
            <>
              {canFocus && !sent && (
                <Button icon={<ExternalLink />} onClick={() => { void focusTab(); onClose(); }}>작성 탭으로 이동</Button>
              )}
              <Button variant={canFocus && !sent ? 'secondary' : 'primary'} icon={<X />} onClick={onClose}>닫기</Button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
