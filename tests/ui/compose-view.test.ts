import { describe, expect, it } from 'vitest';
import type { AttachResult, FieldResult } from '../../src/core/types/compose';
import type { ComposeResult, Job, StepState } from '../../src/core/types/job';
import { composeView } from '../../src/ui/compose-view';

const steps = (...s: Array<Partial<StepState>>): StepState[] =>
  (['render_mail', 'open_compose', 'fill_fields', 'attach_files', 'verify'] as const).map((id, i) => ({ id, status: 'pending', ...s[i] }));
const job = (p: Partial<Job>): Job => ({
  id: 'j1', type: 'compose', status: 'running', steps: steps(), attempt: 1, createdAt: '', updatedAt: '2026-10-17T04:40:00.000Z', errors: [], ...p,
});
const err = (code: string, message = 'msg') => ({ code, message, retryable: true });
const field = (f: FieldResult['field'], status: FieldResult['status'] = 'ok'): FieldResult =>
  ({ field: f, requested: 'x', rendered: 'x', status, method: 'm' });
const att = (fileId: string, status: AttachResult['status']): AttachResult & { error?: string } =>
  ({ fileId, name: fileId, size: 1, status, method: 'input', elapsedMs: 1 });
const result = (p: Partial<ComposeResult>): ComposeResult => ({
  noticeId: 'n', folder: 'f', mode: 'auto', fields: [], attachments: [], outcome: 'partial', attachDir: 'f/attachments', ...p,
});

describe('composeView', () => {
  it('null, compose 아닌 잡, cancelled → null', () => {
    expect(composeView(null)).toBeNull();
    expect(composeView(job({ type: 'collect' }))).toBeNull();
    expect(composeView(job({ status: 'cancelled' }))).toBeNull();
  });
  it('running render_mail → 단계 라벨', () => {
    expect(composeView(job({ currentStep: 'render_mail' }))).toMatchObject({ kind: 'progress', label: '메일 내용 준비 중' });
  });
  it('job.label 우선', () => {
    expect(composeView(job({ currentStep: 'render_mail', label: '커스텀' }))).toMatchObject({ kind: 'progress', label: '커스텀' });
  });
  it('attach_files running 진행률, pending이면 undefined', () => {
    const running = job({ steps: steps({}, {}, {}, { status: 'running', progress: { done: 1, total: 3 } }) });
    expect(composeView(running)).toMatchObject({ kind: 'progress', attach: { done: 1, total: 3 } });
    const pending = composeView(job({ steps: steps({}, {}, {}, { status: 'pending', progress: { done: 1, total: 3 } }) })) as { attach?: unknown };
    expect(pending.attach).toBeUndefined();
  });
  it('cancelling → cancelling true', () => {
    expect(composeView(job({ status: 'cancelling' }))).toMatchObject({ kind: 'progress', cancelling: true });
    expect(composeView(job({ status: 'running' }))).toMatchObject({ cancelling: false });
  });
  it('composeTabId에 따라 canFocus', () => {
    expect(composeView(job({ composeTabId: 5 }))).toMatchObject({ kind: 'progress', canFocus: true });
    expect(composeView(job({}))).toMatchObject({ kind: 'progress', canFocus: false });
    expect(composeView(job({ status: 'completed', composeTabId: 5 }))).toMatchObject({ kind: 'done', canFocus: true });
    expect(composeView(job({ status: 'completed' }))).toMatchObject({ kind: 'done', canFocus: false });
  });
  it('completed → done', () => {
    expect(composeView(job({ status: 'completed' }))).toMatchObject({ kind: 'done' });
  });
  it('partial manual → 전체 복사 + attachDir', () => {
    const j = job({ status: 'partial', result: result({ mode: 'manual', attachDir: 'dir/attachments' }) });
    expect(composeView(j)).toMatchObject({ kind: 'manual', copies: ['to', 'cc', 'subject', 'body', 'attach'], attachDir: 'dir/attachments' });
  });
  it('partial auto: 실패 항목만', () => {
    const j = job({
      status: 'partial',
      result: result({
        fields: [field('to'), field('cc'), field('subject', 'mismatch'), field('body')],
        attachments: [att('a', 'uploaded'), att('b', 'failed')],
      }),
    });
    const v = composeView(j) as { kind: string; fields: FieldResult[]; attachments: AttachResult[]; copies: string[] };
    expect(v.kind).toBe('partial');
    expect(v.fields).toHaveLength(1);
    expect(v.fields[0]!.field).toBe('subject');
    expect(v.attachments).toHaveLength(1);
    expect(v.attachments[0]!.fileId).toBe('b');
    expect(v.copies).toEqual(['subject', 'attach']);
  });
  it('partial auto 전부 성공 → copies 빈 배열', () => {
    const j = job({
      status: 'partial',
      result: result({ fields: [field('to'), field('cc'), field('subject'), field('body')], attachments: [att('a', 'uploaded')] }),
    });
    expect(composeView(j)).toMatchObject({ kind: 'partial', copies: [] });
  });
  it('partial인데 result 없음 → error', () => {
    expect(composeView(job({ status: 'partial' }))).toMatchObject({ kind: 'error' });
  });
  it.each([
    ['NEEDS_SITE_PERMISSION', 'grant-site'],
    ['NEEDS_FS_PERMISSION', 'grant-fs'],
    ['NO_GROUP', 'recipients'],
    ['NO_RECIPIENTS', 'recipients'],
    ['JOB_ALREADY_RUNNING', 'none'],
    ['COMPOSE_NOT_DETECTED', 'retry'],
  ])('failed %s → %s', (code, action) => {
    expect(composeView(job({ status: 'failed', errors: [err(code)] }))).toMatchObject({ kind: 'error', action });
  });
  it('failed 알 수 없는 code → retry + detail', () => {
    expect(composeView(job({ status: 'failed', errors: [err('WHATEVER', '원문 오류')] }))).toMatchObject({ kind: 'error', action: 'retry', detail: '원문 오류' });
  });
  it('interrupted + errors 없음 → 중단 메시지', () => {
    expect(composeView(job({ status: 'interrupted' }))).toEqual({ kind: 'error', message: '메일 작성이 중단되었습니다', action: 'retry', actionLabel: '다시 시도' });
  });
});

describe('composeView 자동 작성 오류 코드', () => {
  it('GROUP_NOT_FOUND / TEMPLATE_NOT_FOUND -> settings', () => {
    expect(composeView(job({ status: 'failed', errors: [err('GROUP_NOT_FOUND')] })))
      .toMatchObject({ kind: 'error', message: '자동 작성 설정의 그룹이 삭제되었습니다', action: 'settings' });
    expect(composeView(job({ status: 'failed', errors: [err('TEMPLATE_NOT_FOUND')] })))
      .toMatchObject({ kind: 'error', message: '자동 작성 설정의 템플릿이 삭제되었습니다', action: 'settings' });
  });
});
