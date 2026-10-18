import type { CollectResult, HandoffReason, Job } from '../core/types/job';
import { handoffReasonLabel } from '../core/model/handoff';
import { composeView } from './compose-view';

/** 수집 잡의 handoff와 연결된 compose 잡 -> 표시 상태. 순수 함수(UI는 이 결과만 그린다). */
export type HandoffAction = 'open-mail' | 'open-review' | 'settings' | 'dequeue' | 'cancel-compose' | 'none';
export interface HandoffView {
  kind: 'queued' | 'composing' | 'composed' | 'manual' | 'compose_partial' | 'compose_failed' | 'review' | 'skipped';
  text: string; tone: 'ok' | 'warn' | 'error' | 'info'; action: HandoffAction; actionLabel?: string;
  composeJobId?: string; noticeId?: string;
}

function reasonText(r: HandoffReason, result: Partial<CollectResult> | undefined): string {
  if (r === 'attachments_failed') {
    const n = (result?.attachments ?? []).filter((a) => a.status === 'failed' || a.status === 'size_mismatch').length;
    if (n > 0) return `${handoffReasonLabel(r)} ${n}건`;
  }
  if (r === 'needs_review') {
    const n = result?.extraction?.reviewCount ?? 0;
    if (n > 0) return `${handoffReasonLabel(r)} ${n}건`;
  }
  return handoffReasonLabel(r);
}

const MANUAL_TEXT = '웹메일 탭을 열었습니다. 내용은 직접 붙여 넣어야 합니다';
const URL_TEXT = 'Gmail 작성 창을 열었습니다. 첨부와 서식 본문은 직접 넣어 주세요';

export function handoffView(collect: Job, compose: Job | null): HandoffView | null {
  const h = collect.handoff;
  if (!h) return null;
  const result = collect.result as Partial<CollectResult> | undefined;
  const noticeId = result?.noticeId ?? collect.noticeId;
  const base = noticeId ? { noticeId } : {};

  if (h.action === 'review') {
    return {
      kind: 'review', text: `검수 필요: ${h.reasons.map((r) => reasonText(r, result)).join(', ')}`,
      tone: 'warn', action: 'open-review', actionLabel: '검수', ...base,
    };
  }

  if (h.action === 'none') {
    switch (h.reason) {
      case 'already_composed':
        return { kind: 'skipped', text: '이미 메일을 작성한 공고입니다', tone: 'info', action: 'open-mail', actionLabel: '열기', ...base };
      case 'needs_site_permission':
        return { kind: 'skipped', text: '웹메일 접근 권한이 필요합니다', tone: 'warn', action: 'settings', actionLabel: '설정 열기', ...base };
      case 'compose_running':
        return { kind: 'skipped', text: '같은 공고의 메일 작성이 이미 대기 중이거나 진행 중입니다', tone: 'info', action: 'none', ...base };
      case 'start_failed':
        return { kind: 'skipped', text: '메일 작성을 시작하지 못했습니다', tone: 'error', action: 'open-mail', actionLabel: '열기', ...base };
      case 'dequeued':
        return { kind: 'skipped', text: '자동 메일 작성을 취소했습니다', tone: 'info', action: 'none', ...base };
      default:
        return null; // disabled, no_notice
    }
  }

  // action === 'compose'
  const composeJobId = compose?.id ?? h.jobId;
  const idPart = composeJobId ? { composeJobId } : {};
  if (!compose) {
    if (h.state === 'queued') return { kind: 'queued', text: '메일 작성 대기 중', tone: 'info', action: 'dequeue', actionLabel: '대기 취소', ...base };
    return {
      kind: 'composing', text: '메일 작성 중', tone: 'info',
      action: composeJobId ? 'cancel-compose' : 'none', ...(composeJobId ? { actionLabel: '취소' } : {}), ...idPart, ...base,
    };
  }
  const v = composeView(compose);
  if (!v) return null;
  switch (v.kind) {
    case 'progress':
      return {
        kind: 'composing', text: v.label, tone: 'info',
        action: v.cancelling ? 'none' : 'cancel-compose', ...(v.cancelling ? {} : { actionLabel: '취소' }), ...idPart, ...base,
      };
    case 'done':
      return { kind: 'composed', text: '메일 작성 완료, 웹메일 탭에서 확인 후 보내세요', tone: 'ok', action: 'open-mail', actionLabel: '열기', ...idPart, ...base };
    case 'manual':
      return { kind: 'manual', text: MANUAL_TEXT, tone: 'warn', action: 'open-mail', actionLabel: '열기', ...idPart, ...base };
    case 'partial':
      return { kind: 'compose_partial', text: MANUAL_TEXT, tone: 'warn', action: 'open-mail', actionLabel: '열기', ...idPart, ...base };
    case 'url':
      return { kind: 'compose_partial', text: URL_TEXT, tone: 'warn', action: 'open-mail', actionLabel: '열기', ...idPart, ...base };
    case 'error': {
      const toSettings = v.action === 'settings' || v.action === 'grant-site' || v.action === 'grant-fs' || v.action === 'recipients'; // 자동 작성 수신자는 설정 카드에서 고른다
      return {
        kind: 'compose_failed', text: v.message, tone: 'error',
        action: toSettings ? 'settings' : 'open-mail', actionLabel: toSettings ? '설정 열기' : '열기', ...idPart, ...base,
      };
    }
  }
}
