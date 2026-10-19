import { describe, expect, it } from 'vitest';
import { decideHandoff, handoffReasonLabel, parseHandoffReasons } from '../../src/core/model/handoff';
import type { Job, JobStatus } from '../../src/core/types/job';
import type { AutoComposeSettings } from '../../src/core/types/settings';

const S: AutoComposeSettings = { enabled: true, afterCollect: 'compose', recipients: { mode: 'default' }, reviewGate: 'conflicts' };
function job(status: JobStatus, result?: unknown, errors: Job['errors'] = [], type: Job['type'] = 'collect'): Job {
  return { id: 'j1', type, status, steps: [], attempt: 1, createdAt: 't', updatedAt: 't', result, errors };
}
const ext = (status: string, reviewCount: number, conflictCount: number) => ({ status, reviewCount, conflictCount });

describe('decideHandoff', () => {
  it('collect가 아니거나 비종결 상태면 null', () => {
    expect(decideHandoff(job('completed', { noticeId: 'n' }, [], 'compose'), S)).toBeNull();
    for (const st of ['queued', 'running', 'cancelling', 'cancelled', 'interrupted'] as JobStatus[]) {
      expect(decideHandoff(job(st, { noticeId: 'n' }), S)).toBeNull();
    }
  });
  it('disabled면 skip', () => {
    expect(decideHandoff(job('completed', { noticeId: 'n' }), { ...S, enabled: false })).toEqual({ kind: 'skip', reason: 'disabled' });
  });
  it('failed: noticeId 없으면 no_notice, 있으면 collect_failed 검수', () => {
    expect(decideHandoff(job('failed'), S)).toEqual({ kind: 'skip', reason: 'no_notice' });
    expect(decideHandoff(job('failed', { noticeId: 'n' }), S)).toEqual({ kind: 'review', reasons: ['collect_failed'] });
  });
  it('partial + DETAIL_ 오류 → detail_failed', () => {
    const err = [{ code: 'DETAIL_TIMEOUT', message: 'x', retryable: true }] as Job['errors'];
    expect(decideHandoff(job('partial', { noticeId: 'n', attachments: [] }, err), S)).toEqual({ kind: 'review', reasons: ['detail_failed'] });
  });
  it('partial: 사유 조합', () => {
    const att = (status: string) => ({ noticeId: 'n', attachments: [{ name: 'a', savedName: null, status, size: null }] });
    expect(decideHandoff(job('partial', att('failed')), S)).toEqual({ kind: 'review', reasons: ['attachments_failed'] });
    expect(decideHandoff(job('partial', att('size_mismatch')), S)).toEqual({ kind: 'review', reasons: ['attachments_failed'] });
    const ex = [{ code: 'EXTRACT_FAILED', message: 'x', retryable: true }];
    expect(decideHandoff(job('partial', att('saved'), ex), S)).toEqual({ kind: 'review', reasons: ['extract_failed'] });
    expect(decideHandoff(job('partial', att('failed'), ex), S)).toEqual({ kind: 'review', reasons: ['attachments_failed', 'extract_failed'] });
    expect(decideHandoff(job('partial', att('saved')), S)).toEqual({ kind: 'review', reasons: ['collect_failed'] });
  });
  it('mailStatus와 무관하게 compose, 검수 기준에 걸리면 review', () => {
    for (const m of ['ready_for_review', 'delivered', 'drafting']) {
      expect(decideHandoff(job('completed', { noticeId: 'n', mailStatus: m }), S)).toEqual({ kind: 'compose' });
      expect(decideHandoff(job('completed', { noticeId: 'n', mailStatus: m, extraction: ext('needs_review', 2, 1) }), S)).toEqual({ kind: 'review', reasons: ['needs_review'] });
    }
  });
  it('게이트 3종', () => {
    const r = (e: unknown) => job('completed', { noticeId: 'n', extraction: e });
    const review = { kind: 'review', reasons: ['needs_review'] };
    const e = ext('needs_review', 2, 0);
    expect(decideHandoff(r(e), { ...S, reviewGate: 'errors_only' })).toEqual({ kind: 'compose' });
    expect(decideHandoff(r(e), { ...S, reviewGate: 'conflicts' })).toEqual({ kind: 'compose' });
    expect(decideHandoff(r(e), { ...S, reviewGate: 'any_review' })).toEqual(review);
    const c = ext('needs_review', 2, 1);
    expect(decideHandoff(r(c), { ...S, reviewGate: 'errors_only' })).toEqual({ kind: 'compose' });
    expect(decideHandoff(r(c), { ...S, reviewGate: 'conflicts' })).toEqual(review);
    expect(decideHandoff(r(c), { ...S, reviewGate: 'any_review' })).toEqual(review);
  });
  it('extraction 없음/not_run/unsupported는 통과', () => {
    const any = { ...S, reviewGate: 'any_review' as const };
    expect(decideHandoff(job('completed', { noticeId: 'n' }), any)).toEqual({ kind: 'compose' });
    expect(decideHandoff(job('completed', { noticeId: 'n', extraction: ext('not_run', 3, 3) }), any)).toEqual({ kind: 'compose' });
    expect(decideHandoff(job('completed', { noticeId: 'n', extraction: ext('unsupported', 3, 3) }), any)).toEqual({ kind: 'compose' });
  });
});

describe('decideHandoff afterCollect', () => {
  const ok = { noticeId: 'n' };
  const withAfter = (a: 'dashboard' | 'compose' | undefined): Job => ({ ...job('completed', ok), ...(a ? { afterCollect: a } : {}) });
  it('job 스냅샷이 설정보다 우선', () => {
    expect(decideHandoff(withAfter('dashboard'), S)).toEqual({ kind: 'edit' });
    expect(decideHandoff(withAfter('compose'), { ...S, afterCollect: 'dashboard' })).toEqual({ kind: 'compose' });
  });
  it('job 값이 없으면 설정 폴백', () => {
    expect(decideHandoff(withAfter(undefined), { ...S, afterCollect: 'dashboard' })).toEqual({ kind: 'edit' });
    expect(decideHandoff(withAfter(undefined), S)).toEqual({ kind: 'compose' });
  });
  it('edit는 mailStatus를 무시한다', () => {
    const j: Job = { ...job('completed', { noticeId: 'n', mailStatus: 'delivered' }), afterCollect: 'dashboard' };
    expect(decideHandoff(j, S)).toEqual({ kind: 'edit' });
  });
  it('compose는 mailStatus와 무관하게 compose', () => {
    const j: Job = { ...job('completed', { noticeId: 'n', mailStatus: 'ready_for_review' }), afterCollect: 'compose' };
    expect(decideHandoff(j, S)).toEqual({ kind: 'compose' });
  });
  describe('ask', () => {
    const SA: AutoComposeSettings = { ...S, afterCollect: 'ask' };
    it('completed면 ask', () => {
      expect(decideHandoff(job('completed', { noticeId: 'n' }), SA)).toEqual({ kind: 'ask' });
    });
    it('needsReview면 review가 우선', () => {
      expect(decideHandoff(job('completed', { noticeId: 'n', extraction: ext('done', 1, 1) }), SA)).toEqual({ kind: 'review', reasons: ['needs_review'] });
    });
    it('mailStatus가 delivered여도 ask', () => {
      expect(decideHandoff(job('completed', { noticeId: 'n', mailStatus: 'delivered' }), SA)).toEqual({ kind: 'ask' });
    });
    it("job.afterCollect 'compose'가 설정 ask보다 우선", () => {
      const j: Job = { ...job('completed', { noticeId: 'n' }), afterCollect: 'compose' };
      expect(decideHandoff(j, SA)).toEqual({ kind: 'compose' });
    });
    it('disabled면 skip', () => {
      expect(decideHandoff(job('completed', { noticeId: 'n' }), { ...SA, enabled: false })).toEqual({ kind: 'skip', reason: 'disabled' });
    });
  });
});

describe('handoff helpers', () => {
  it('라벨', () => {
    expect(handoffReasonLabel('attachments_failed')).toBe('첨부 실패');
    expect(handoffReasonLabel('extract_failed')).toBe('평가정보 추출 실패');
    expect(handoffReasonLabel('needs_review')).toBe('평가정보 확인 필요');
    expect(handoffReasonLabel('collect_failed')).toBe('수집 오류');
  });
  it('parseHandoffReasons', () => {
    expect(parseHandoffReasons(undefined)).toEqual([]);
    expect(parseHandoffReasons('')).toEqual([]);
    expect(parseHandoffReasons('needs_review,bogus,attachments_failed')).toEqual(['needs_review', 'attachments_failed']);
  });
});
