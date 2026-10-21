import { describe, expect, it } from 'vitest';
import type { Job, StepState } from '../../src/core/types/job';
import { COMPOSE_STEP_LABEL } from '../../src/ui/compose-view';
import { COLLECT_STEP_LABEL, progressRatio } from '../../src/ui/g2b-panel/panel-view';
import type { RowEntry } from '../../src/ui/trackerbot/row-view';
import { progressPanelView, type ProgressSession } from '../../src/ui/trackerbot/progress-view';

const steps = (...s: Array<Partial<StepState>>): StepState[] =>
  (['fetch_basic', 'download_attachments', 'extract', 'fetch_html'] as const).map((id, i) => ({ id, status: 'pending', ...s[i] }));
const csteps = (...s: Array<Partial<StepState>>): StepState[] =>
  (['render_mail', 'open_compose', 'fill_fields', 'attach_files', 'verify'] as const).map((id, i) => ({ id, status: 'pending', ...s[i] }));
const job = (p: Partial<Job>): Job => ({
  id: 'j1', type: 'collect', status: 'running', steps: steps(), attempt: 1, createdAt: '2026-10-18T10:00:00.000Z', updatedAt: '2026-10-18T10:00:00.000Z', errors: [], ...p,
});
const comp = (p: Partial<Job>): Job => job({ id: 'c1', type: 'compose', steps: csteps(), ...p });
const entry = (p: Partial<RowEntry> = {}): RowEntry => ({
  key: 'k', ref: { noticeNo: 'R26BK01722175', round: '000', origin: 'trackerbot' }, lookup: { found: false },
  job: null, compose: null, starting: false, error: null, otherTab: false, ...p,
});
const sess = (p: Partial<{ seen: string[]; dismissed: Array<[string, string]>; collapsed: boolean }> = {}): ProgressSession => ({
  seen: new Set(p.seen ?? []), dismissed: new Map(p.dismissed ?? []), collapsed: p.collapsed ?? false,
});
const at = '2026-10-18T10:00:00.000Z';
const result = { noticeId: 'n', folder: 'f', attachments: [{ name: 'a', savedName: null, status: 'saved', size: null }] };
const items = (v: ReturnType<typeof progressPanelView>) => (v.kind === 'card' ? v.items : []);
const first = (e: RowEntry, s = sess()) => items(progressPanelView([e], s))[0];

describe('progressPanelView', () => {
  it('job 없음 -> hidden, starting만 -> 시작 중 active', () => {
    expect(progressPanelView([entry()], sess())).toEqual({ kind: 'hidden' });
    expect(first(entry({ starting: true }))).toMatchObject({ phase: 'collect', state: 'active', stepLabel: '시작 중', ratio: 0 });
    expect(first(entry({ starting: true }))!.cancel).toBeUndefined();
  });
  it('다운로드 진행: 라벨/파일명·크기/취소/ratio', () => {
    const st = steps({ status: 'done' }, { status: 'running', progress: { done: 2, total: 6 }, bytes: { received: 1258291, total: 3565158, name: 'a.hwp' } });
    const it = first(entry({ job: job({ currentStep: 'download_attachments', steps: st }) }))!;
    expect(it.stepLabel).toBe(`${COLLECT_STEP_LABEL.download_attachments} (2/6)`);
    expect(it.detail).toBe('a.hwp · 1.2 MB/3.4 MB');
    expect(it.cancel).toEqual({ target: 'collect', cancelling: false });
    expect(it.ratio).toBe(progressRatio(st));
  });
  it('끝난 ask 항목 -> [상세, 메일 작성] 버튼, awaiting, state ok', () => {
    const j = job({ status: 'completed', result, handoff: { action: 'ask', at } });
    const it = first(entry({ job: j }), sess({ seen: ['j1'] }))!;
    expect(it.state).toBe('ok');
    expect(it.awaiting).toBe(true);
    expect(it.actions).toEqual([{ id: 'open-notice', label: '상세' }, { id: 'open-mail', label: '메일 작성' }]);
  });
  it('검수(review) 끝난 항목 -> [상세, 검수, 메일 작성]', () => {
    const j = job({ status: 'completed', result, handoff: { action: 'review', reasons: ['needs_review'], opened: false, at } });
    const it = first(entry({ job: j }), sess({ seen: ['j1'] }))!;
    expect(it.actions?.map((a) => a.label)).toEqual(['상세', '검수', '메일 작성']);
    expect(it.actions?.[1]?.id).not.toBe('open-mail');
  });
  it('handoff가 edit·compose면 awaiting 없음', () => {
    const e = job({ status: 'completed', result, handoff: { action: 'edit', opened: true, at } });
    expect(first(entry({ job: e }), sess({ seen: ['j1'] }))!.awaiting).toBeUndefined();
    const c = job({ status: 'completed', result, handoff: { action: 'compose', state: 'started', jobId: 'c1', at } });
    const done = comp({ status: 'completed' });
    expect(first(entry({ job: c, compose: done }), sess({ seen: ['j1'] }))!.awaiting).toBeUndefined();
  });
  it('bytes 없고 label이 base+진행 -> detail 없음', () => {
    const st = steps({ status: 'done' }, { status: 'running', progress: { done: 3, total: 6 } });
    const it = first(entry({ job: job({ currentStep: 'download_attachments', steps: st, label: '첨부파일 다운로드 중 (3/6)' }) }))!;
    expect(it.detail).toBeUndefined();
  });
  it('extract label 잔여 파일명 -> detail', () => {
    const st = steps({ status: 'done' }, { status: 'done' }, { status: 'running', progress: { done: 0, total: 3 } });
    const it = first(entry({ job: job({ currentStep: 'extract', steps: st, label: '평가정보 수집 중 (1/3), b.pdf' }) }))!;
    expect(it.stepLabel).toBe(`${COLLECT_STEP_LABEL.extract} (0/3)`);
    expect(it.detail).toBe('b.pdf');
  });
  it('bytes.total null -> 크기만', () => {
    const st = steps({ status: 'done' }, { status: 'running', progress: { done: 0, total: 1 }, bytes: { received: 524288, total: null, name: 'a.hwp' } });
    expect(first(entry({ job: job({ currentStep: 'download_attachments', steps: st }) }))!.detail).toBe('a.hwp · 512.0 KB');
  });
  it('queued 대기 중 / cancelling', () => {
    expect(first(entry({ job: job({ status: 'queued' }) }))!.stepLabel).toBe('대기 중');
    expect(first(entry({ job: job({ status: 'cancelling', currentStep: 'extract' }) }))!.cancel).toEqual({ target: 'collect', cancelling: true });
  });
  it('collect 완료 + handoff compose queued -> 메일 작성 대기 중', () => {
    const j = job({ status: 'completed', result, handoff: { action: 'compose', state: 'queued', at } });
    const it = first(entry({ job: j }))!;
    expect(it).toMatchObject({ phase: 'compose', state: 'active', stepLabel: '메일 작성 대기 중' });
    expect(it.cancel).toBeUndefined();
  });
  it('compose 진행: base로 시작 안 하는 label은 detail 원문', () => {
    const label = '웹메일에서 [메일쓰기]를 눌러 주세요 (남은 30초)';
    const j = job({ status: 'completed', result, handoff: { action: 'compose', state: 'started', jobId: 'c1', at } });
    const it = first(entry({ job: j, compose: comp({ currentStep: 'open_compose', label }) }))!;
    expect(it).toMatchObject({ phase: 'compose', state: 'active', stepLabel: COMPOSE_STEP_LABEL.open_compose, detail: label });
    expect(it.cancel).toEqual({ target: 'compose', cancelling: false });
  });
  it('compose attach_files bytes -> 파일명·크기 detail', () => {
    const st = csteps({}, {}, {}, { status: 'running', progress: { done: 1, total: 3 }, bytes: { received: 2097152, total: 4194304, name: 'c.pdf' } });
    const j = job({ status: 'completed', result, handoff: { action: 'compose', state: 'started', jobId: 'c1', at } });
    const it = first(entry({ job: j, compose: comp({ currentStep: 'attach_files', steps: st }) }))!;
    expect(it.stepLabel).toBe(`${COMPOSE_STEP_LABEL.attach_files} (1/3)`);
    expect(it.detail).toBe('c.pdf · 2.0 MB/4.0 MB');
  });
  it('끝난 잡: seen/dismissed 규칙', () => {
    const e = entry({ job: job({ status: 'completed', result }) });
    expect(progressPanelView([e], sess())).toEqual({ kind: 'hidden' });
    expect(first(e, sess({ seen: ['j1'] }))).toMatchObject({ state: 'ok', stepLabel: '수집 완료' });
    expect(progressPanelView([e], sess({ seen: ['j1'], dismissed: [['k', 'j1']] }))).toEqual({ kind: 'hidden' });
    expect(first(e, sess({ seen: ['j1'], dismissed: [['k', 'old']] }))).toBeDefined();
  });
  it('partial -> warn(detail 3줄 이하), failed -> error', () => {
    const p = job({ status: 'partial', result: { ...result, attachments: [{ name: 'a', savedName: null, status: 'failed', size: null }] } });
    const it = first(entry({ job: p }), sess({ seen: ['j1'] }))!;
    expect(it).toMatchObject({ state: 'warn', stepLabel: '일부 실패' });
    expect((it.detail ?? '').split('\n').length).toBeLessThanOrEqual(3);
    const f = job({ status: 'failed', errors: [{ code: 'X', message: 'm', retryable: true }] });
    expect(first(entry({ job: f }), sess({ seen: ['j1'] }))).toMatchObject({ state: 'error', stepLabel: '수집 실패' });
  });
  it('compose 결과: composed ok / 실패 error', () => {
    const j = job({ status: 'completed', result, handoff: { action: 'compose', state: 'started', jobId: 'c1', at } });
    expect(first(entry({ job: j, compose: comp({ status: 'completed' }) }), sess({ seen: ['c1'] })))
      .toMatchObject({ state: 'ok', stepLabel: '메일 작성됨', phase: 'compose' });
    const failed = comp({ status: 'failed', errors: [{ code: 'GROUP_NOT_FOUND', message: 'm', retryable: true }] });
    expect(first(entry({ job: j, compose: failed }), sess({ seen: ['c1'] }))).toMatchObject({ state: 'error', stepLabel: '메일 작성 실패' });
  });
  it('cancelled -> hidden', () => {
    expect(progressPanelView([entry({ job: job({ status: 'cancelled' }) })], sess({ seen: ['j1'] }))).toEqual({ kind: 'hidden' });
  });
  it('정렬: active(createdAt 오름차순) 먼저, 끝난 것은 updatedAt 내림차순', () => {
    const mk = (k: string, p: Partial<Job>) => entry({ key: k, job: job({ id: `j-${k}`, ...p }) });
    const list = [
      mk('d1', { status: 'completed', result, updatedAt: '2026-10-18T10:01:00.000Z' }),
      mk('a2', { createdAt: '2026-10-18T10:02:00.000Z' }),
      mk('d2', { status: 'completed', result, updatedAt: '2026-10-18T10:03:00.000Z' }),
      mk('a1', { createdAt: '2026-10-18T10:01:00.000Z' }),
    ];
    const v = progressPanelView(list, sess({ seen: ['j-d1', 'j-d2'] }));
    expect(items(v).map((i) => i.key)).toEqual(['a1', 'a2', 'd2', 'd1']);
  });
  it('7개 -> items 5, moreCount 2', () => {
    const list = Array.from({ length: 7 }, (_, i) => entry({ key: `k${i}`, job: job({ id: `j${i}` }) }));
    const v = progressPanelView(list, sess());
    expect(v).toMatchObject({ kind: 'card', moreCount: 2, activeCount: 7 });
    expect(items(v)).toHaveLength(5);
  });
  it('collapsed -> pill, headline 두 가지', () => {
    const two = [entry({ key: 'a', job: job({ id: 'a' }) }), entry({ key: 'b', job: job({ id: 'b' }) })];
    expect(progressPanelView(two, sess({ collapsed: true }))).toEqual({ kind: 'pill', text: '작업 2건 진행 중', activeCount: 2 });
    expect(progressPanelView(two, sess())).toMatchObject({ kind: 'card', headline: 'BidMate · 2건 진행 중' });
    const done = entry({ job: job({ status: 'completed', result }) });
    expect(progressPanelView([done], sess({ seen: ['j1'], collapsed: true }))).toEqual({ kind: 'pill', text: '완료 1건', activeCount: 0 });
    expect(progressPanelView([done], sess({ seen: ['j1'] }))).toMatchObject({ kind: 'card', headline: 'BidMate · 작업 완료', settledCount: 1 });
  });
});
