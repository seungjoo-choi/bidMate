import { describe, expect, it } from 'vitest';
import type { ComposeResult, Handoff, Job } from '../../src/core/types/job';
import { handoffView } from '../../src/ui/handoff-view';

const at = '2026-10-18T10:00:00.000Z';
const collect = (handoff?: Handoff, result: unknown = { noticeId: 'n1', folder: 'f', attachments: [] }): Job => ({
  id: 'c0', type: 'collect', status: 'completed', steps: [], attempt: 1, createdAt: '', updatedAt: at, errors: [], result, ...(handoff ? { handoff } : {}),
});
const compose = (p: Partial<Job>): Job => ({
  id: 'cp1', type: 'compose', status: 'running', steps: [], attempt: 1, createdAt: '', updatedAt: at, errors: [], ...p,
});
const started: Handoff = { action: 'compose', state: 'started', jobId: 'cp1', at };
const err = (code: string) => ({ code, message: 'm', retryable: true });
const cres = (p: Partial<ComposeResult>): ComposeResult => ({ noticeId: 'n1', folder: 'f', mode: 'auto', fields: [], attachments: [], outcome: 'partial', attachDir: 'f/a', ...p });

describe('handoffView', () => {
  it('handoff 없음 -> null', () => {
    expect(handoffView(collect(), null)).toBeNull();
  });
  it('edit -> 대시보드 확인 안내 + 편집', () => {
    expect(handoffView(collect({ action: 'edit', opened: true, at }), null))
      .toMatchObject({ kind: 'edit', text: '대시보드에서 메일 내용을 확인한 뒤 작성하세요', tone: 'info', action: 'open-mail', actionLabel: '편집', noticeId: 'n1' });
  });
  it('ask -> 선택 안내 + 편집', () => {
    expect(handoffView(collect({ action: 'ask', at }), null))
      .toMatchObject({ kind: 'ask', text: '수집 완료. 대시보드에서 편집하거나 바로 작성할 수 있습니다', tone: 'info', action: 'open-mail', actionLabel: '편집', noticeId: 'n1' });
  });
  it('compose queued -> 대기 취소', () => {
    expect(handoffView(collect({ action: 'compose', state: 'queued', at }), null))
      .toMatchObject({ kind: 'queued', text: '메일 작성 대기 중', action: 'dequeue', actionLabel: '대기 취소', noticeId: 'n1' });
  });
  it('compose 진행 -> composeView 라벨 + 취소', () => {
    expect(handoffView(collect(started), compose({ currentStep: 'fill_fields' })))
      .toMatchObject({ kind: 'composing', text: '수신자/제목/본문 입력 중', action: 'cancel-compose', actionLabel: '취소', composeJobId: 'cp1' });
  });
  it('started인데 compose 미조회 -> composing, jobId로 취소', () => {
    expect(handoffView(collect(started), null)).toMatchObject({ kind: 'composing', action: 'cancel-compose', composeJobId: 'cp1' });
  });
  it('compose completed -> 열기', () => {
    expect(handoffView(collect(started), compose({ status: 'completed' })))
      .toMatchObject({ kind: 'composed', text: '웹메일 탭에서 확인 후 보내 주세요', tone: 'ok', action: 'open-mail', actionLabel: '열기' });
  });
  it('compose 수동 모드/partial -> 직접 붙여 넣기 안내', () => {
    const text = '웹메일 탭에 내용을 직접 붙여 넣어 주세요';
    expect(handoffView(collect(started), compose({ status: 'partial', result: cres({ mode: 'manual' }) })))
      .toMatchObject({ kind: 'manual', text, action: 'open-mail' });
    expect(handoffView(collect(started), compose({ status: 'partial', result: cres({ fields: [{ field: 'to', requested: 'x', rendered: 'x', status: 'failed', method: 'm' }] }) })))
      .toMatchObject({ kind: 'compose_partial', text, action: 'open-mail' });
  });
  it('compose failed -> 코드별 action', () => {
    const cases: Array<[string, string, object]> = [
      ['GROUP_NOT_FOUND', '수신자 설정', { page: 'settings', section: 'auto-compose' }],
      ['TEMPLATE_NOT_FOUND', '템플릿 설정', { page: 'settings', section: 'auto-compose' }],
      ['NEEDS_SITE_PERMISSION', '권한 설정', { page: 'settings', section: 'mail-service' }],
      ['NEEDS_FS_PERMISSION', '폴더 설정', { page: 'settings', section: 'storage' }],
      ['NO_GROUP', '수신자 설정', { page: 'recipients' }],
      ['NO_RECIPIENTS', '수신자 설정', { page: 'recipients' }],
    ];
    for (const [code, actionLabel, fix] of cases) {
      expect(handoffView(collect(started), compose({ status: 'failed', errors: [err(code)] })))
        .toMatchObject({ kind: 'compose_failed', tone: 'error', action: 'settings', actionLabel, fix });
    }
    expect(handoffView(collect(started), compose({ status: 'failed', errors: [err('GROUP_NOT_FOUND')] }))?.text).toBe('자동 작성 설정의 그룹이 삭제되었습니다');
    expect(handoffView(collect(started), compose({ status: 'failed', errors: [err('COMPOSE_TAB_CLOSED')] })))
      .toMatchObject({ kind: 'compose_failed', action: 'open-mail', actionLabel: '열기' });
  });
  it('compose cancelled -> null', () => {
    expect(handoffView(collect(started), compose({ status: 'cancelled' }))).toBeNull();
  });
  it('review -> 사유 라벨과 건수', () => {
    const result = { noticeId: 'n1', folder: 'f', attachments: [{ name: 'a', savedName: null, status: 'failed', size: null }, { name: 'b', savedName: null, status: 'size_mismatch', size: null }], extraction: { status: 'needs_review', reviewCount: 3, conflictCount: 1 } };
    const v = handoffView(collect({ action: 'review', reasons: ['attachments_failed', 'needs_review', 'extract_failed'], opened: true, at }, result), null);
    expect(v).toMatchObject({ kind: 'review', tone: 'warn', action: 'open-review', actionLabel: '검수', noticeId: 'n1' });
    expect(v?.text).toBe('검수 필요: 첨부 실패 2건, 평가정보 확인 필요 3건, 평가정보 추출 실패');
  });
  it('none 사유별', () => {
    const n = (reason: Extract<Handoff, { action: 'none' }>['reason']) => handoffView(collect({ action: 'none', reason, at }), null);
    expect(n('already_composed')).toMatchObject({ kind: 'skipped', text: '이미 메일을 작성한 공고입니다', action: 'open-mail', actionLabel: '열기' });
    expect(n('needs_site_permission')).toMatchObject({ text: '웹메일 접근 권한이 필요합니다', action: 'settings', actionLabel: '권한 설정', fix: { page: 'settings', section: 'mail-service' } });
    expect(n('compose_running')).toMatchObject({ text: '같은 공고의 메일 작성이 이미 대기 중이거나 진행 중입니다', action: 'none' });
    expect(n('start_failed')).toMatchObject({ text: '메일 작성을 시작하지 못했습니다', action: 'open-mail', actionLabel: '열기' });
    expect(n('dequeued')).toMatchObject({ text: '자동 메일 작성을 취소했습니다', action: 'none' });
    expect(n('disabled')).toBeNull();
    expect(n('no_notice')).toBeNull();
  });
});

describe('handoffView url 결과', () => {
  it('url -> compose_partial Gmail 안내', () => {
    const c = compose({ status: 'partial', result: cres({ mode: 'url', provider: 'gmail' }) });
    expect(handoffView(collect(started), c)).toMatchObject({
      kind: 'compose_partial', text: '첨부·서식 본문은 직접 넣어 주세요', tone: 'warn', action: 'open-mail', actionLabel: '열기',
    });
  });
});
