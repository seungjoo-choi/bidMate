import { describe, expect, it } from 'vitest';
import { noticeLabel } from '../../src/core/model/ids';
import type { Job, StepState } from '../../src/core/types/job';
import type { PanelView } from '../../src/ui/g2b-panel/panel-view';
import { collectProgressView, settledProgressView } from '../../src/ui/g2b-panel/progress-card-view';

type PV = Extract<PanelView, { kind: 'progress' }>;
const steps = (...s: Array<Partial<StepState>>): StepState[] =>
  (['fetch_basic', 'download_attachments', 'extract', 'fetch_html'] as const).map((id, i) => ({ id, status: 'pending', ...s[i] }));
const ref = { noticeNo: 'R26BK01722175', round: '000', origin: 'g2b' } as unknown as Job['ref'];
const job = (p: Partial<Job> = {}): Job => ({
  id: 'j1', type: 'collect', status: 'running', steps: steps(), attempt: 1, createdAt: '2026-10-18T10:00:00.000Z', updatedAt: '2026-10-18T10:00:00.000Z', errors: [], ref, ...p,
});
const pv = (p: Partial<PV> = {}): PV => ({ kind: 'progress', label: '', ratio: 0.3, errorCount: 0, cancelling: false, pillText: '수집 중 30%', ...p });
const card = (v: ReturnType<typeof collectProgressView>) => {
  if (v.kind !== 'card') throw new Error('card 아님');
  return v;
};

describe('collectProgressView', () => {
  it('다운로드 3/6: 라벨·파일 정보·강제 중단 가능·headline·key', () => {
    const st = steps({ status: 'done' }, { status: 'running', progress: { done: 3, total: 6 }, bytes: { received: 1258291, total: 3565158, name: 'a.hwp' } });
    const j = job({ currentStep: 'download_attachments', steps: st });
    const v = card(collectProgressView(j, pv({ title: '공고 A' }), false));
    expect(v.headline).toBe('BidMate · 1건 진행 중');
    expect(v).toMatchObject({ activeCount: 1, settledCount: 0, moreCount: 0 });
    const it = v.items[0]!;
    expect(it.key).toBe(j.id);
    expect(it.title).toBe('공고 A');
    expect(it.stepLabel).toContain('(3/6)');
    expect(it.detail).toBe('a.hwp · 1.2 MB/3.4 MB');
    expect(it.cancel).toEqual({ target: 'collect', cancelling: false, force: true });
  });
  it('foreignLabel -> 다른 공고 headline, title 없으면 noticeLabel 폴백', () => {
    const j = job();
    const v = card(collectProgressView(j, pv({ foreignLabel: 'R26BK00000000' }), false));
    expect(v.headline).toBe('BidMate · 다른 공고 수집 중');
    expect(v.items[0]!.title).toBe(noticeLabel(j.ref!));
  });
  it('collapsed -> pill', () => {
    const v = pv();
    expect(collectProgressView(job(), v, true)).toEqual({ kind: 'pill', text: v.pillText, activeCount: 1 });
  });
  it('cancelling -> cancel.cancelling true', () => {
    const v = card(collectProgressView(job({ status: 'cancelling' }), pv(), false));
    expect(v.items[0]!.cancel?.cancelling).toBe(true);
  });
});

describe('settledProgressView', () => {
  const chip = { tone: 'ok', text: '수집 완료', dday: null } as const;
  it('completed -> ok, stepLabel = headline', () => {
    const v = card(settledProgressView(job(), { kind: 'completed', headline: '수집 완료', chip, foreign: false }));
    expect(v).toMatchObject({ headline: 'BidMate · 작업 완료', activeCount: 0, settledCount: 1, moreCount: 0 });
    expect(v.items[0]).toMatchObject({ key: 'j1', state: 'ok', stepLabel: '수집 완료' });
    expect(v.items[0]!.ratio).toBeUndefined();
    expect(v.items[0]!.actions).toBeUndefined();
  });
  it('partial -> warn', () => {
    const v = card(settledProgressView(job(), { kind: 'partial', headline: '일부 실패', failures: [], moreCount: 0, foreign: false, canRetry: true, retryLabel: '다시' }));
    expect(v.items[0]).toMatchObject({ state: 'warn', stepLabel: '일부 실패' });
    expect(v.items[0]!.actions).toBeUndefined();
  });
  it('error -> error, stepLabel = message', () => {
    const v = card(settledProgressView(job(), { kind: 'error', message: '실패했어요', action: 'none', foreign: false }));
    expect(v.items[0]).toMatchObject({ state: 'error', stepLabel: '실패했어요' });
    expect(v.items[0]!.ratio).toBeUndefined();
    expect(v.items[0]!.actions).toBeUndefined();
  });
});
