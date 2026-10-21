import { noticeLabel } from '../../core/model/ids';
import type { Job } from '../../core/types/job';
import { activeItem } from '../progress-card/active-item';
import type { ProgressPanelView } from '../progress-card/types';
import type { EvalRun } from './controller';
import type { PanelView } from './panel-view';

type ProgressPV = Extract<PanelView, { kind: 'progress' }>;
type SettledPV = Extract<PanelView, { kind: 'completed' | 'partial' | 'error' }>;

const titleOf = (job: Job, title: string | undefined): string => title ?? (job.ref ? noticeLabel(job.ref) : '공고');

/** g2b 수집 진행 -> 트래커봇 진행 카드 뷰(항목 1개). 순수 함수. */
export function collectProgressView(job: Job, v: ProgressPV, collapsed: boolean): ProgressPanelView {
  if (collapsed) return { kind: 'pill', text: v.pillText, activeCount: 1 };
  return {
    kind: 'card',
    headline: v.foreignLabel !== undefined ? 'BidMate · 다른 공고 수집 중' : 'BidMate · 1건 진행 중',
    items: [{
      ...activeItem(job.id, titleOf(job, v.title), job),
      cancel: { target: 'collect', cancelling: job.status === 'cancelling', force: true },
    }],
    moreCount: 0, activeCount: 1, settledCount: 0,
  };
}

/** 평가점수 가져오기 -> 진행 카드 뷰. 단계 진행률이 없어 막대는 시간에 따라 천천히 차오르고, 끝나면 arrive/fail 연출을 카드가 그린다 */
export function evalProgressView(run: EvalRun, collapsed: boolean): ProgressPanelView {
  const active = run.state === 'active';
  if (collapsed && active) return { kind: 'pill', text: '평가점수 가져오는 중', activeCount: 1 };
  return {
    kind: 'card',
    headline: active ? 'BidMate · 평가점수 가져오는 중' : 'BidMate · 작업 완료',
    items: [active
      ? { key: run.key, title: run.title, phase: 'eval', state: 'active', stepLabel: '평가점수 가져오는 중', ratio: 0, stepSpan: 1 }
      : { key: run.key, title: run.title, phase: 'eval', state: run.state, stepLabel: run.message ?? '' }],
    moreCount: 0, activeCount: active ? 1 : 0, settledCount: active ? 0 : 1,
  };
}

/** 진행 -> 완료 전환 연출용. 끝난 상태의 항목 1개(arrive/fail 연출을 카드가 그린다). */
export function settledProgressView(job: Job, v: SettledPV): ProgressPanelView {
  return {
    kind: 'card',
    headline: 'BidMate · 작업 완료',
    items: [{
      key: job.id, title: titleOf(job, v.title), phase: 'collect',
      state: v.kind === 'completed' ? 'ok' : v.kind === 'partial' ? 'warn' : 'error',
      stepLabel: v.kind === 'error' ? v.message : v.headline,
    }],
    moreCount: 0, activeCount: 0, settledCount: 1,
  };
}
