import type { Job } from '../../core/types/job';
import { COMPOSE_STEP_LABEL } from '../compose-view';
import { COLLECT_STEP_LABEL, progressRatio, runningStepSpan } from '../g2b-panel/panel-view';
import type { ProgressItem } from './types';

const fmtSize = (n: number): string => (n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/** 진행 중 잡 -> 항목. 라벨은 단계 라벨 맵을 쓰고 job.label은 detail 보조로만 쓴다. */
export function activeItem(key: string, title: string, a: Job): ProgressItem {
  const phase = a.type === 'compose' ? 'compose' : 'collect';
  const fallback = phase === 'collect' ? '수집 중' : '메일 작성 중';
  let base = (phase === 'collect' ? COLLECT_STEP_LABEL : COMPOSE_STEP_LABEL)[a.currentStep ?? ''] ?? fallback;
  if (a.status === 'queued' && !a.currentStep) base = '대기 중';
  const step = a.steps.find((s) => s.id === a.currentStep);
  const stepLabel = step?.progress ? `${base} (${step.progress.done}/${step.progress.total})` : base;
  let detail: string | undefined;
  if (step?.bytes?.name) {
    const { name, received, total } = step.bytes;
    detail = `${name} · ${fmtSize(received)}${total ? `/${fmtSize(total)}` : ''}`;
  } else {
    const rem = a.label?.startsWith(base) ? a.label.slice(base.length).replace(/^\s*\(\d+\/\d+\)\s*,?\s*/, '').trim() : (a.label ?? '');
    detail = rem || undefined;
  }
  return {
    key, title, phase, state: 'active', stepLabel, stepId: a.currentStep, detail,
    ratio: progressRatio(a.steps), stepSpan: runningStepSpan(a.steps), cancel: { target: phase, cancelling: a.status === 'cancelling' },
  };
}
