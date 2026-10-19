import { describe, expect, it } from 'vitest';
import type { Job, StepState } from '../../src/core/types/job';
import { rowView, type RowEntry } from '../../src/ui/trackerbot/row-view';

const steps = (...s: Array<Partial<StepState>>): StepState[] =>
  (['fetch_basic', 'download_attachments', 'fetch_html'] as const).map((id, i) => ({ id, status: 'pending', ...s[i] }));
const job = (p: Partial<Job>): Job => ({
  id: 'j1', type: 'collect', status: 'running', steps: steps(), attempt: 1, createdAt: '', updatedAt: '2026-10-17T04:40:00.000Z', errors: [], ...p,
});
const entry = (p: Partial<RowEntry> = {}): RowEntry => ({
  key: 'k', ref: { noticeNo: 'R26BK01722175', round: '000', origin: 'trackerbot' }, lookup: { found: false },
  job: null, compose: null, starting: false, error: null, otherTab: false, ...p,
});
const v = (e: RowEntry, orphaned = false) => rowView(e, { orphaned });
const err = (code: string) => ({ code, message: 'm', retryable: true });
const att = (status: string) => ({ name: 'a', savedName: null, status, size: null });

describe('rowView', () => {
  it('미수집 idle', () => {
    expect(v(entry())).toEqual({ kind: 'idle', label: '공고 수집', chip: undefined, tone: 'primary' });
  });
  it('prespec 미수집 idle -> 사전규격 수집, found면 다시 수집 유지', () => {
    const ref = { kind: 'prespec' as const, noticeNo: 'R26BD00273952', origin: 'trackerbot' as const };
    expect(v(entry({ ref }))).toMatchObject({ kind: 'idle', label: '사전규격 수집', tone: 'primary' });
    expect(v(entry({ ref, lookup: { found: true, collectedAt: new Date(2026, 9, 17, 13, 40).toISOString() } }))).toMatchObject({ label: '다시 수집' });
  });
  it('lookup found -> 다시 수집 + 칩', () => {
    const at = new Date(2026, 9, 17, 13, 40).toISOString();
    expect(v(entry({ lookup: { found: true, collectedAt: at, collectStatus: 'collected' } }))).toMatchObject({ kind: 'idle', label: '다시 수집', chip: '수집 완료', tone: 'secondary' });
  });
  it('starting', () => {
    expect(v(entry({ starting: true }))).toEqual({ kind: 'busy', label: '시작 중', canCancel: false, cancelling: false, cancelTarget: 'collect' });
  });
  it('진행(첨부 n/m)', () => {
    const j = job({ steps: steps({ status: 'done' }, { status: 'running', progress: { done: 3, total: 6 } }) });
    expect(v(entry({ job: j }))).toEqual({ kind: 'busy', label: '첨부 3/6', canCancel: true, cancelling: false, cancelTarget: 'collect' });
    expect(v(entry({ job: job({ status: 'cancelling', label: '가'.repeat(30) }) }))).toMatchObject({ kind: 'busy', label: '가'.repeat(20), canCancel: false, cancelling: true });
  });
  it('completed', () => {
    const j = job({ status: 'completed', result: { noticeId: 'n', folder: 'f', attachments: [att('saved'), att('saved')] } });
    expect(v(entry({ job: j }))).toMatchObject({ kind: 'done', tone: 'ok', label: '수집 완료' });
    expect((v(entry({ job: j })) as { detail?: string }).detail).toContain('수집 완료, 첨부 2/2');
  });
  it('partial', () => {
    const j = job({ status: 'partial', result: { noticeId: 'n', folder: 'f', attachments: [att('saved'), att('failed')] } });
    expect(v(entry({ job: j }))).toMatchObject({ kind: 'done', tone: 'warn', label: '일부 실패', canRetry: true });
  });
  it('error 3종 action', () => {
    expect(v(entry({ job: job({ status: 'failed', errors: [err('NEEDS_FS_PERMISSION')] }) }))).toMatchObject({
      kind: 'error', label: '수집 실패', action: 'grant', message: '저장 폴더 접근을 다시 허용해야 합니다',
      subAction: 'settings', subActionLabel: '폴더 설정', fix: { page: 'settings', section: 'storage' },
    });
    expect(v(entry({ job: job({ status: 'failed', errors: [err('G2B_KEY_MISSING')] }) }))).toMatchObject({
      kind: 'error', action: 'retry', actionLabel: '다시 시도', subAction: 'settings', subActionLabel: '서비스키 설정',
      message: '나라장터 서비스키를 확인해 주세요', fix: { page: 'settings', section: 'g2b' },
    });
    expect(v(entry({ job: job({ status: 'failed', errors: [err('G2B_KEY_INVALID')] }) })))
      .toMatchObject({ kind: 'error', action: 'retry', subAction: 'settings' });
    expect(v(entry({ job: job({ status: 'failed', errors: [err('X')] }) }))).toMatchObject({ kind: 'error', action: 'retry' });
  });
  it('orphaned -> disabled', () => {
    expect(v(entry({ starting: true }), true)).toMatchObject({ kind: 'disabled', label: '새로고침 필요' });
  });
  it('otherTab', () => {
    expect(v(entry({ otherTab: true }))).toMatchObject({ kind: 'idle', detail: '다른 탭에서 수집 중' });
  });
  it('끝난 잡과 entry.error가 함께 있으면 detail에 error 포함', () => {
    const j = job({ status: 'completed', result: { noticeId: 'n', folder: 'f', attachments: [att('saved')] } });
    const r = v(entry({ job: j, error: '시작 실패' }));
    expect(r).toMatchObject({ kind: 'done' });
    expect((r as { detail?: string }).detail).toContain('시작 실패');
  });

  describe('handoff', () => {
    const done = (handoff: Job['handoff'], result: unknown = { noticeId: 'n1', folder: 'f', attachments: [] }) =>
      job({ status: 'completed', result, handoff });
    const comp = (p: Partial<Job>): Job => job({ id: 'c1', type: 'compose', ...p });
    const at = '2026-10-18T10:00:00.000Z';
    it('edit -> 수집 완료 ok + 편집 보조 버튼', () => {
      const r = v(entry({ job: done({ action: 'edit', opened: true, at }) }));
      expect(r).toMatchObject({ kind: 'done', label: '수집 완료', tone: 'ok', canRetry: false, action: 'open-mail', actionLabel: '편집' });
    });
    it('ask -> 수집 완료 ok + 편집 보조 버튼', () => {
      const r = v(entry({ job: done({ action: 'ask', at }) }));
      expect(r).toMatchObject({ kind: 'done', label: '수집 완료', tone: 'ok', canRetry: false, action: 'open-mail', actionLabel: '편집' });
    });
    it('queued -> 수집 완료, 툴팁에 대기 문구', () => {
      const r = v(entry({ job: done({ action: 'compose', state: 'queued', at }) }));
      expect(r).toMatchObject({ kind: 'done', label: '수집 완료', tone: 'ok' });
      expect((r as { detail?: string }).detail).toContain('메일 작성 대기 중');
    });
    it('composing -> busy 메일 작성 중, 취소 대상 compose', () => {
      const r = v(entry({ job: done({ action: 'compose', state: 'started', jobId: 'c1', at }), compose: comp({ status: 'running', currentStep: 'fill_fields' }) }));
      expect(r).toEqual({ kind: 'busy', label: '메일 작성 중', canCancel: true, cancelling: false, cancelTarget: 'compose' });
    });
    it('composed -> 메일 작성됨 + 열기', () => {
      const r = v(entry({ job: done({ action: 'compose', state: 'started', jobId: 'c1', at }), compose: comp({ status: 'completed' }) }));
      expect(r).toMatchObject({ kind: 'done', label: '메일 작성됨', tone: 'ok', action: 'open-mail', actionLabel: '열기' });
    });
    it('manual -> 메일 확인 warn + 열기', () => {
      const result = { noticeId: 'n1', folder: 'f', mode: 'manual', fields: [], attachments: [], outcome: 'partial', attachDir: 'f/a' };
      const r = v(entry({ job: done({ action: 'compose', state: 'started', jobId: 'c1', at }), compose: comp({ status: 'partial', result }) }));
      expect(r).toMatchObject({ kind: 'done', label: '메일 확인', tone: 'warn', action: 'open-mail' });
    });
    it('url -> 메일 확인 warn + 열기', () => {
      const result = { noticeId: 'n1', folder: 'f', mode: 'url', provider: 'gmail', fields: [], attachments: [], outcome: 'partial', attachDir: 'f/a' };
      const r = v(entry({ job: done({ action: 'compose', state: 'started', jobId: 'c1', at }), compose: comp({ status: 'partial', result }) }));
      expect(r).toMatchObject({ kind: 'done', label: '메일 확인', tone: 'warn', action: 'open-mail' });
    });
    it('compose_failed -> error 메일 작성 실패 + 보조 동작', () => {
      const h = done({ action: 'compose', state: 'started', jobId: 'c1', at });
      expect(v(entry({ job: h, compose: comp({ status: 'failed', errors: [err('GROUP_NOT_FOUND')] }) })))
        .toMatchObject({
          kind: 'error', label: '메일 작성 실패', action: 'retry', actionLabel: '다시 시도', subAction: 'settings', subActionLabel: '수신자 설정',
          message: '자동 작성 설정의 그룹이 삭제되었습니다', fix: { page: 'settings', section: 'auto-compose' },
        });
      expect(v(entry({ job: h, compose: comp({ status: 'failed', errors: [err('NO_RECIPIENTS')] }) })))
        .toMatchObject({ subAction: 'settings', subActionLabel: '수신자 설정', fix: { page: 'recipients' } });
      expect(v(entry({ job: h, compose: comp({ status: 'failed', errors: [err('TEMPLATE_NOT_FOUND')] }) })))
        .toMatchObject({ subActionLabel: '템플릿 설정', fix: { page: 'settings', section: 'auto-compose' } });
      expect(v(entry({ job: h, compose: comp({ status: 'failed', errors: [err('COMPOSE_NOT_DETECTED')] }) })))
        .toMatchObject({ kind: 'error', subAction: 'open-mail' });
    });
    it('review -> 검수 필요 + 검수', () => {
      const r = v(entry({ job: job({ status: 'partial', result: { noticeId: 'n1', folder: 'f', attachments: [att('failed')] }, handoff: { action: 'review', reasons: ['attachments_failed'], opened: true, at } }) }));
      expect(r).toMatchObject({ kind: 'done', label: '검수 필요', tone: 'warn', action: 'open-review', actionLabel: '검수' });
    });
    it('skipped(already_composed) -> 이미 작성함 + 툴팁 + 메일 보기', () => {
      const r = v(entry({ job: done({ action: 'none', reason: 'already_composed', at }) }));
      expect(r).toMatchObject({ kind: 'done', label: '이미 작성함', tone: 'warn', action: 'open-mail', actionLabel: '메일 보기' });
      expect((r as { detail?: string }).detail).toContain('이미 메일을 작성한 공고입니다');
    });
    it('handoff 없음/disabled -> 기존 표시', () => {
      expect(v(entry({ job: done(undefined) }))).toMatchObject({ kind: 'done', label: '수집 완료' });
      expect(v(entry({ job: done({ action: 'none', reason: 'disabled', at }) }))).toEqual(v(entry({ job: done(undefined) })));
    });
  });
});
