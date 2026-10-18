import { describe, expect, it } from 'vitest';
import type { Job, StepState } from '../../src/core/types/job';
import { collectedChip, panelView, progressRatio } from '../../src/ui/g2b-panel/panel-view';

const steps = (...s: Array<Partial<StepState>>): StepState[] =>
  (['fetch_basic', 'download_attachments', 'fetch_html'] as const).map((id, i) => ({ id, status: 'pending', ...s[i] }));
const job = (p: Partial<Job>): Job => ({
  id: 'j1', type: 'collect', status: 'running', steps: steps(), attempt: 1, createdAt: '', updatedAt: '2026-10-17T04:40:00.000Z', errors: [], ...p,
});
const err = (code: string, message = 'msg') => ({ code, message, retryable: true });
const none = { found: false };

describe('panelView', () => {
  it('job 없음 + 미수집 → 공고 수집', () => {
    expect(panelView(null, none)).toEqual({ kind: 'idle', buttonLabel: '공고 수집' });
  });
  it('수집됨 → 칩 + 다시 수집', () => {
    const at = new Date(2026, 9, 17, 13, 40).toISOString();
    expect(panelView(null, { found: true, collectedAt: at })).toEqual({ kind: 'idle', buttonLabel: '다시 수집', chip: '수집됨, 10/17 13:40' });
    expect(collectedChip(at)).toBe('수집됨, 10/17 13:40');
  });
  it('진행: 비율/첨부/취소 중', () => {
    const j = job({
      label: '첨부파일 다운로드 중 (3/7)',
      steps: steps({ status: 'done' }, { status: 'running', progress: { done: 3, total: 6 }, bytes: { received: 1, total: 2 } }),
      errors: [err('X')],
    });
    const v = panelView(j, none, { title: '공고' });
    expect(v).toMatchObject({ kind: 'progress', title: '공고', attach: { done: 3, total: 6 }, errorCount: 1, cancelling: false, pillText: '수집 중 3/6' });
    // (1 + (3+0.5)/6) / 3
    expect((v as { ratio: number }).ratio).toBeCloseTo((1 + 3.5 / 6) / 3);
    expect(panelView({ ...j, status: 'cancelling' }, none)).toMatchObject({ kind: 'progress', cancelling: true });
    expect(progressRatio(steps({ status: 'done' }, { status: 'done' }, { status: 'skipped' }))).toBe(1);
  });
  it('completed', () => {
    const j = job({
      status: 'completed',
      result: { noticeId: 'n', folder: 'notices/2026/n_x', attachments: [{ name: 'a', savedName: 'a', status: 'saved', size: 1 }, { name: 'b', savedName: 'b', status: 'saved', size: 1 }] },
    });
    expect(panelView(j, none)).toMatchObject({ kind: 'completed', headline: '수집 완료, 첨부 2/2', folder: 'notices/2026/n_x' });
  });
  it('partial: 실패 파일 최대 5개', () => {
    const atts = Array.from({ length: 8 }, (_, i) => ({ name: `f${i}`, savedName: null, status: 'failed' as const, size: null, error: 'HTTP 500' }));
    const j = job({ status: 'partial', result: { noticeId: 'n', folder: 'f', attachments: [{ name: 'ok', savedName: 'ok', status: 'saved', size: 1 }, ...atts] } });
    const v = panelView(j, none);
    expect(v).toMatchObject({ kind: 'partial', headline: '일부 첨부 실패, 1/9', moreCount: 3 });
    expect((v as { failures: unknown[] }).failures).toHaveLength(5);
    expect((v as { failures: unknown[] }).failures[0]).toEqual({ name: 'f0', reason: 'HTTP 500' });
  });
  it.each([
    ['NEEDS_FS_PERMISSION', '저장 폴더 접근을 다시 허용해야 합니다', 'grant'],
    ['G2B_KEY_MISSING', '나라장터 서비스키를 확인해 주세요', 'settings'],
    ['G2B_KEY_INVALID', '나라장터 서비스키를 확인해 주세요', 'settings'],
    ['G2B_NOT_FOUND', 'API에서 이 공고를 찾지 못했습니다', 'none'],
    ['G2B_NETWORK', '수집 중 오류가 발생했습니다', 'retry'],
    ['G2B_API_ERROR', '수집 중 오류가 발생했습니다', 'retry'],
    ['OFFSCREEN_ERROR', '수집 중 오류가 발생했습니다', 'retry'],
    ['UNKNOWN_X', '수집 중 오류가 발생했습니다', 'retry'],
  ])('failed %s', (code, message, action) => {
    const v = panelView(job({ status: 'failed', errors: [err(code, 'raw')] }), none);
    expect(v).toMatchObject({ kind: 'error', message, action });
    if (action === 'retry') expect(v).toMatchObject({ detail: 'raw' });
  });
  it('interrupted 오류 없음 → 중단 안내 + 다시 시도', () => {
    expect(panelView(job({ status: 'interrupted' }), none)).toMatchObject({ kind: 'error', message: '수집이 중단되었습니다', action: 'retry' });
  });

  describe('잡 공고 ≠ 현재 공고', () => {
    const ref = { noticeNo: 'R26BK00000001', round: '000', origin: 'g2b' as const };
    const cur = { noticeNo: 'R26BK01722175', round: '000' };
    it('진행: 잡 기준 제목 + 다른 공고 안내', () => {
      const j = job({ ref, steps: steps({ status: 'running' }) });
      expect(panelView(j, none, { title: '현재공고', current: cur })).toMatchObject({
        kind: 'progress', title: 'R26BK00000001', foreignLabel: '다른 공고 수집 중: R26BK00000001',
      });
      const withTitle = job({ ref, result: { noticeId: 'n', folder: 'f', title: '잡공고', attachments: [] } });
      expect(panelView(withTitle, none, { title: '현재공고', current: cur })).toMatchObject({ title: '잡공고', foreignLabel: '다른 공고 수집 중: 잡공고' });
    });
    it('오류: 버튼 숨김 + 안내', () => {
      const v = panelView(job({ ref, status: 'failed', errors: [err('G2B_NETWORK')] }), none, { current: cur });
      expect(v).toMatchObject({ kind: 'error', foreign: true, action: 'none', hint: '해당 공고 화면에서 다시 시도하세요' });
      expect((v as { actionLabel?: string }).actionLabel).toBeUndefined();
    });
    it('partial: 재시도 숨김', () => {
      const j = job({ ref, status: 'partial', result: { noticeId: 'n', folder: 'f', attachments: [{ name: 'a', savedName: null, status: 'failed', size: null }] } });
      expect(panelView(j, none, { current: cur })).toMatchObject({ kind: 'partial', foreign: true, canRetry: false });
    });
    it('같은 공고면 기존 동작 유지', () => {
      const same = { noticeNo: 'R26BK00000001', round: '000' };
      const j = job({ ref, status: 'failed', errors: [err('NEEDS_FS_PERMISSION')] });
      expect(panelView(j, none, { current: same })).toMatchObject({ kind: 'error', foreign: false, action: 'grant', actionLabel: '폴더 접근 허용' });
      expect(panelView(job({ ref, steps: steps({ status: 'running' }) }), none, { title: 'T', current: same }))
        .toMatchObject({ kind: 'progress', title: 'T', foreignLabel: undefined });
    });
  });
});

describe('panelView 추출 실패 표시', () => {
  const ok = { name: 'a', savedName: 'a', status: 'saved' as const, size: 1 };
  const bad = { name: 'b', savedName: null, status: 'failed' as const, size: null, error: 'HTTP 500' };
  const mk = (atts: Array<typeof ok | typeof bad>, errors: ReturnType<typeof err>[]) =>
    panelView(job({ status: 'partial', errors, result: { noticeId: 'n', folder: 'f', attachments: atts } }), none);
  it('첨부만 실패', () => {
    expect(mk([ok, bad], [])).toMatchObject({ retryLabel: '실패 파일 재시도' });
  });
  it('추출만 실패: result.extraction이 없어도 실패 줄 표시', () => {
    expect(mk([ok], [err('EXTRACT_FAILED')])).toMatchObject({ retryLabel: '평가정보 다시 추출', extractionLine: '평가정보 추출 실패', reviewNoticeId: undefined });
  });
  it('둘 다 실패', () => {
    expect(mk([ok, bad], [err('EXTRACT_FAILED')])).toMatchObject({ retryLabel: '실패 항목 재시도', extractionLine: '평가정보 추출 실패' });
  });
});

describe('panelView handoff', () => {
  const at = '2026-10-18T10:00:00.000Z';
  const done = (handoff?: Job['handoff']) => job({ status: 'completed', result: { noticeId: 'n1', folder: 'f', attachments: [] }, ...(handoff ? { handoff } : {}) });
  it('completed + handoff -> handoff 포함', () => {
    expect(panelView(done({ action: 'compose', state: 'queued', at }), none)).toMatchObject({ kind: 'completed', handoff: { kind: 'queued' } });
  });
  it('compose 전달 -> 진행 라벨', () => {
    const c = job({ id: 'cp1', type: 'compose', status: 'running', currentStep: 'attach_files' });
    expect(panelView(done({ action: 'compose', state: 'started', jobId: 'cp1', at }), none, { compose: c }))
      .toMatchObject({ handoff: { kind: 'composing', text: '첨부 중' } });
  });
  it('handoff 없음/disabled -> 생략', () => {
    expect(panelView(done(), none)).not.toHaveProperty('handoff');
    expect(panelView(done({ action: 'none', reason: 'disabled', at }), none)).not.toHaveProperty('handoff');
  });
  it('partial + review, error + review', () => {
    const rv: Job['handoff'] = { action: 'review', reasons: ['collect_failed'], opened: false, at };
    expect(panelView(job({ status: 'partial', handoff: rv }), none)).toMatchObject({ kind: 'partial', handoff: { kind: 'review' } });
    expect(panelView(job({ status: 'failed', errors: [err('X')], handoff: rv }), none)).toMatchObject({ kind: 'error', handoff: { kind: 'review' } });
  });
  it('foreign이면 생략', () => {
    const j = done({ action: 'compose', state: 'queued', at });
    j.ref = { noticeNo: 'A', origin: 'g2b' };
    expect(panelView(j, none, { current: { noticeNo: 'B' } })).not.toHaveProperty('handoff');
  });
});
