import { noticeLabel } from '../../core/model/ids';
import { activeItem } from '../progress-card/active-item';
import type { ProgressAction, ProgressItem, ProgressPanelView, ProgressState } from '../progress-card/types';
import { handoffAsk, handoffQueued, isActive } from './controller';
import { rowView, type RowEntry } from './row-view';

export type { ProgressState, ProgressActionId, ProgressAction, ProgressItem, ProgressPanelView } from '../progress-card/types';

const MAX_ITEMS = 5;

export interface ProgressSession {
  /** 이 페이지에서 ACTIVE(또는 handoff queued)로 관측한 잡 id(collect·compose) */
  seen: ReadonlySet<string>;
  /** key -> 닫힌 시점의 collect job id */
  dismissed: ReadonlyMap<string, string>;
  collapsed: boolean;
}

/**
 * 끝난 행의 버튼 -> 팝업 버튼. 행에 버튼이 없는 성공 완료도 대시보드로 갈 길은 남긴다.
 * error의 'settings'는 행과 같은 '설정' 라벨을 쓴다.
 */
function settledActions(rv: ReturnType<typeof rowView>): ProgressAction[] | undefined {
  const out: ProgressAction[] = [];
  if (rv.kind === 'done') {
    // 대시보드는 저절로 열지 않는다. [상세] [검수 등 행 버튼] [메일 작성] 중 눌러서 간다(바로 작성·고르기는 없앴다)
    out.push({ id: 'open-notice', label: '상세' });
    if (rv.action && rv.action !== 'open-mail') out.push({ id: rv.action, label: rv.actionLabel ?? '대시보드에서 보기' });
    out.push({ id: 'open-mail', label: '메일 작성' });
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
    // 카드가 두 줄로 접고 펼치기를 제공하므로 자르지 않는다
    const detail = rv.detail;
    const phase = compose || job.handoff?.action === 'compose' ? 'compose' : 'collect';
    const at = compose && compose.updatedAt > job.updatedAt ? compose.updatedAt : job.updatedAt;
    const awaiting = rv.kind === 'done' && handoffAsk(job);
    settled.push({ item: { key, title, phase, state, stepLabel: rv.label, detail, actions: settledActions(rv), ...(awaiting ? { awaiting: true as const } : {}) }, at });
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
