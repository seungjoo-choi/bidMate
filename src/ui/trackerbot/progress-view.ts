import { noticeLabel } from '../../core/model/ids';
import type { Job } from '../../core/types/job';
import { COMPOSE_STEP_LABEL } from '../compose-view';
import { COLLECT_STEP_LABEL, progressRatio } from '../g2b-panel/panel-view';
import { handoffAsk, handoffQueued, isActive, type PopupChoiceAction } from './controller';
import { rowView, type RowEntry, type RowSubAction } from './row-view';

const MAX_ITEMS = 5;

export interface ProgressSession {
  /** 이 페이지에서 ACTIVE(또는 handoff queued)로 관측한 잡 id(collect·compose) */
  seen: ReadonlySet<string>;
  /** key -> 닫힌 시점의 collect job id */
  dismissed: ReadonlyMap<string, string>;
  collapsed: boolean;
}
export type ProgressState = 'active' | 'ok' | 'warn' | 'error';
export type ProgressActionId = 'retry' | 'grant' | RowSubAction | PopupChoiceAction;
export interface ProgressAction { id: ProgressActionId; label: string }
export interface ProgressItem {
  key: string;
  title: string;
  phase: 'collect' | 'compose';
  state: ProgressState;
  stepLabel: string;
  detail?: string;
  /** active에서만 0..1 */
  ratio?: number;
  cancel?: { target: 'collect' | 'compose'; cancelling: boolean };
  /** 끝났지만 사용자의 완료 후 선택을 기다리는 항목(자동 소멸 제외) */
  awaiting?: true;
  /** 끝난 항목에서만. 행의 주 버튼과 같은 동작(메일 보기·검수·다시 시도 등) */
  actions?: ProgressAction[];
}
export type ProgressPanelView =
  | { kind: 'hidden' }
  | { kind: 'pill'; text: string; activeCount: number }
  | { kind: 'card'; headline: string; items: ProgressItem[]; moreCount: number; activeCount: number; settledCount: number };

const fmtSize = (n: number): string => (n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/** 진행 중 잡 -> 항목. 라벨은 단계 라벨 맵을 쓰고 job.label은 detail 보조로만 쓴다. */
function activeItem(key: string, title: string, a: Job): ProgressItem {
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
    key, title, phase, state: 'active', stepLabel, detail,
    ratio: progressRatio(a.steps), cancel: { target: phase, cancelling: a.status === 'cancelling' },
  };
}

/**
 * 끝난 행의 버튼 -> 팝업 버튼. 행에 버튼이 없는 성공 완료도 대시보드로 갈 길은 남긴다.
 * error의 'settings'는 행과 같은 '설정' 라벨을 쓴다.
 */
function settledActions(rv: ReturnType<typeof rowView>, entry: RowEntry): ProgressAction[] | undefined {
  const out: ProgressAction[] = [];
  if (rv.kind === 'done' && handoffAsk(entry.job)) {
    out.push({ id: 'choose-dashboard', label: '대시보드 편집' }, { id: 'choose-compose', label: '바로 작성' });
  } else if (rv.kind === 'done') {
    out.push(rv.action ? { id: rv.action, label: rv.actionLabel ?? '대시보드에서 보기' } : { id: 'open-mail', label: '대시보드에서 보기' });
  } else if (rv.kind === 'error') {
    if (rv.action !== 'none') out.push({ id: rv.action, label: rv.actionLabel ?? (rv.action === 'settings' ? '설정' : '다시 시도') });
    if (rv.subAction) out.push({ id: rv.subAction, label: rv.subActionLabel ?? '설정' });
  }
  return out.length > 0 ? out : undefined;
}

/** 엔트리 -> 항목 전체 목록(active 먼저, 끝난 항목은 최근순). 절단·접기 반영 전. 순수 함수. */
export function progressItems(entries: RowEntry[], session: ProgressSession): ProgressItem[] {
  const actives: Array<{ item: ProgressItem; at: string }> = [];
  const settled: Array<{ item: ProgressItem; at: string }> = [];

  for (const entry of entries) {
    const { key, job, compose } = entry;
    const title = entry.title ?? noticeLabel(entry.ref);

    if (entry.starting && !isActive(job)) {
      actives.push({ item: { key, title, phase: 'collect', state: 'active', stepLabel: '시작 중', ratio: 0 }, at: job?.createdAt ?? '' });
      continue;
    }
    if (!job || (job.status === 'cancelled' && !isActive(compose))) continue;

    const a = isActive(compose) ? compose : (isActive(job) ? job : null);
    if (a) {
      actives.push({ item: activeItem(key, title, a), at: job.createdAt });
      continue;
    }
    if (handoffQueued(job)) {
      actives.push({ item: { key, title, phase: 'compose', state: 'active', stepLabel: '메일 작성 대기 중', ratio: 0 }, at: job.createdAt });
      continue;
    }

    // 끝난 상태: 이 페이지에서 진행을 본 잡만, 닫지 않은 것만 보인다
    if (!session.seen.has(job.id) && !(compose && session.seen.has(compose.id))) continue;
    if (session.dismissed.get(key) === job.id) continue;
    const rv = rowView(entry, { orphaned: false });
    if (rv.kind !== 'done' && rv.kind !== 'error') continue;
    const state: ProgressState = rv.kind === 'error' ? 'error' : (rv.tone === 'ok' ? 'ok' : 'warn');
    const detail = rv.detail?.split('\n').slice(0, 3).join('\n');
    const phase = compose || job.handoff?.action === 'compose' ? 'compose' : 'collect';
    const at = compose && compose.updatedAt > job.updatedAt ? compose.updatedAt : job.updatedAt;
    const awaiting = rv.kind === 'done' && handoffAsk(job);
    settled.push({ item: { key, title, phase, state, stepLabel: rv.label, detail, actions: settledActions(rv, entry), ...(awaiting ? { awaiting: true as const } : {}) }, at });
  }

  actives.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
  settled.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
  return [...actives, ...settled].map((x) => x.item);
}

/** 엔트리 목록 -> 우측 하단 진행 팝업 표시 상태. 순수 함수. */
export function progressPanelView(entries: RowEntry[], session: ProgressSession): ProgressPanelView {
  const all = progressItems(entries, session);
  if (all.length === 0) return { kind: 'hidden' };

  const activeCount = all.filter((i) => i.state === 'active').length;
  const settledCount = all.length - activeCount;
  if (session.collapsed) return { kind: 'pill', text: activeCount > 0 ? `작업 ${activeCount}건 진행 중` : `완료 ${settledCount}건`, activeCount };
  return {
    kind: 'card',
    headline: activeCount > 0 ? `BidMate · ${activeCount}건 진행 중` : 'BidMate · 작업 완료',
    items: all.slice(0, MAX_ITEMS), moreCount: Math.max(0, all.length - MAX_ITEMS), activeCount, settledCount,
  };
}
