import type { CollectResult, HandoffReason, HandoffSkip, Job } from '../types/job';
import type { AutoComposeSettings } from '../types/settings';

export type Verdict = { kind: 'compose' } | { kind: 'review'; reasons: HandoffReason[] } | { kind: 'skip'; reason: HandoffSkip };

const REASONS: HandoffReason[] = ['collect_failed', 'attachments_failed', 'extract_failed', 'needs_review'];
const LABELS: Record<HandoffReason, string> = {
  attachments_failed: '첨부 실패',
  extract_failed: '평가정보 추출 실패',
  needs_review: '평가정보 확인 필요',
  collect_failed: '수집 오류',
};

function gated(x: CollectResult['extraction'], gate: AutoComposeSettings['reviewGate']): boolean {
  if (!x || x.status === 'not_run' || x.status === 'unsupported') return false;
  if (gate === 'errors_only') return false;
  if (gate === 'conflicts') return (x.conflictCount ?? 0) > 0;
  return x.reviewCount > 0;
}

/** 수집 잡 종결 시 자동 작성/검수/생략을 판정한다. 판정 대상이 아니면 null. */
export function decideHandoff(job: Job, s: AutoComposeSettings): Verdict | null {
  if (job.type !== 'collect') return null;
  if (job.status !== 'completed' && job.status !== 'partial' && job.status !== 'failed') return null;
  if (!s.enabled) return { kind: 'skip', reason: 'disabled' };
  const result = job.result as Partial<CollectResult> | undefined;
  if (job.status === 'failed') {
    return result?.noticeId ? { kind: 'review', reasons: ['collect_failed'] } : { kind: 'skip', reason: 'no_notice' };
  }
  if (job.status === 'partial') {
    const reasons: HandoffReason[] = [];
    if (result?.attachments?.some((a) => a.status === 'failed' || a.status === 'size_mismatch')) reasons.push('attachments_failed');
    if (job.errors.some((e) => e.code === 'EXTRACT_FAILED')) reasons.push('extract_failed');
    if (reasons.length === 0) reasons.push('collect_failed');
    return { kind: 'review', reasons };
  }
  if (result?.mailStatus === 'ready_for_review' || result?.mailStatus === 'delivered') return { kind: 'skip', reason: 'already_composed' };
  if (gated(result?.extraction, s.reviewGate)) return { kind: 'review', reasons: ['needs_review'] };
  return { kind: 'compose' };
}

export function handoffReasonLabel(r: HandoffReason): string {
  return LABELS[r];
}

/** 쉼표 구분 문자열을 파싱한다. 모르는 값은 무시한다. */
export function parseHandoffReasons(q: string | undefined): HandoffReason[] {
  if (!q) return [];
  return q.split(',').map((x) => x.trim()).filter((x): x is HandoffReason => (REASONS as string[]).includes(x));
}
