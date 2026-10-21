import type { AttachResult, FieldResult } from '../core/types/compose';
import type { ComposeResult, Job, SendSkipReason } from '../core/types/job';
import type { MailProvider } from '../core/types/settings';
import type { FixTarget } from '../messaging/protocol';
import { progressRatio } from './g2b-panel/panel-view';

/** compose 잡 → 표시 상태. 순수 함수(UI는 이 결과만 그린다). */
export type CopyKind = 'to' | 'cc' | 'subject' | 'body' | 'attach';
export type ComposeAction = 'grant-site' | 'grant-fs' | 'recipients' | 'settings' | 'retry' | 'none';

export type ComposeView =
  | { kind: 'progress'; label: string; ratio: number; attach?: { done: number; total: number }; cancelling: boolean; canFocus: boolean }
  | { kind: 'done'; canFocus: boolean }
  | { kind: 'sent'; clickedAt?: string; tabClosed: boolean; canFocus: boolean }
  | {
      kind: 'send-issue'; state: 'unconfirmed' | 'skipped' | 'unknown'; message: string; maybeSent: boolean;
      fields: FieldResult[]; attachments: Array<AttachResult & { error?: string }>; copies: CopyKind[]; attachDir?: string; canFocus: boolean;
    }
  | { kind: 'manual'; copies: CopyKind[]; attachDir?: string; canFocus: boolean }
  | {
      kind: 'partial'; fields: FieldResult[]; attachments: Array<AttachResult & { error?: string }>;
      copies: CopyKind[]; attachDir?: string; canFocus: boolean;
    }
  | {
      kind: 'url'; provider: MailProvider; prefilled: FieldResult[]; pending: FieldResult[];
      attachments: Array<AttachResult & { error?: string }>; copies: CopyKind[]; attachDir?: string; canFocus: boolean;
    }
  | { kind: 'error'; message: string; detail?: string; action: ComposeAction; actionLabel?: string; /** 고칠 수 있는 화면 */ fix?: FixTarget };

export const COMPOSE_STEP_LABEL: Record<string, string> = {
  render_mail: '메일 내용 준비 중',
  open_compose: '웹메일 여는 중',
  fill_fields: '수신자/제목/본문 입력 중',
  attach_files: '첨부 중',
  verify: '입력 결과 확인 중',
  send_mail: '발송',
};

export const SEND_SKIP_LABEL: Record<SendSkipReason, string> = {
  NOT_SUPPORTED: '자동 발송을 지원하지 않는 작성 화면입니다',
  RETRY_ATTEMPT: '다시 시도한 작성은 자동 발송하지 않습니다',
  AUTO_JOB: '자동 작성은 자동 발송하지 않습니다',
  FIELDS_NOT_OK: '입력되지 않은 항목이 있습니다',
  ATTACH_NOT_OK: '첨부가 모두 올라가지 않았습니다',
  FINGERPRINT_MISMATCH: '미리보기와 입력된 내용이 다릅니다',
  SENT_COUNT_CHANGED: '미리보기 뒤에 다른 발송 기록이 생겼습니다',
  BUTTON_NOT_FOUND: '보내기 버튼을 찾지 못했습니다',
  BUTTON_DISABLED: '보내기 버튼이 눌리지 않는 상태입니다',
  SUBJECT_MISMATCH: '작성 창의 제목이 다릅니다',
  RECIPIENT_MISMATCH: '작성 창의 받는사람·참조가 초안과 다릅니다',
  ALREADY_FIRED: '이미 보내기를 눌렀습니다',
  CLICK_FAILED: '보내기를 누르지 못했습니다',
};

function sendIssueMessage(send: NonNullable<ComposeResult['send']>): string {
  if (send.state === 'unconfirmed') return '보내기를 눌렀지만 발송 완료를 확인하지 못했습니다. 웹메일 탭을 확인하세요';
  if (send.state === 'unknown') return '발송 여부를 알 수 없습니다. 웹메일 탭을 확인하세요';
  const why = send.reason ? SEND_SKIP_LABEL[send.reason] : '자동 발송 조건을 만족하지 않았습니다';
  return `자동 발송하지 않았습니다. ${why}. 내용을 확인한 뒤 직접 보내 주세요`;
}

const ALL_COPIES: CopyKind[] = ['to', 'cc', 'subject', 'body', 'attach'];

function errorOf(code: string | undefined, message: string | undefined): Extract<ComposeView, { kind: 'error' }> {
  switch (code) {
    case 'NEEDS_SITE_PERMISSION':
      return { kind: 'error', message: '웹메일 사이트 접근을 허용해야 합니다', action: 'grant-site', actionLabel: '웹메일 접근 허용', fix: { page: 'settings', section: 'mail-service' } };
    case 'NEEDS_FS_PERMISSION':
      return { kind: 'error', message: '저장 폴더 접근을 다시 허용해야 합니다', action: 'grant-fs', actionLabel: '폴더 접근 허용', fix: { page: 'settings', section: 'storage' } };
    case 'NO_GROUP':
      return { kind: 'error', message: '수신 그룹이 없습니다. 기본 그룹을 지정하거나 자동 작성 설정에서 수신자를 고르세요', action: 'recipients', actionLabel: '수신자 관리 열기', fix: { page: 'recipients' } };
    case 'NO_RECIPIENTS':
      return { kind: 'error', message: '받을 수신자가 없습니다. 선택한 수신자가 사용 안 함이거나 삭제되었는지 확인하세요', action: 'recipients', actionLabel: '수신자 관리 열기', fix: { page: 'recipients' } };
    case 'GROUP_NOT_FOUND':
      return { kind: 'error', message: '자동 작성 설정의 그룹이 삭제되었습니다', action: 'settings', actionLabel: '수신자 설정', fix: { page: 'settings', section: 'auto-compose' } };
    case 'TEMPLATE_NOT_FOUND':
      return { kind: 'error', message: '자동 작성 설정의 템플릿이 삭제되었습니다', action: 'settings', actionLabel: '템플릿 설정', fix: { page: 'settings', section: 'auto-compose' } };
    case 'JOB_ALREADY_RUNNING':
      return { kind: 'error', message: '이 공고의 수집/추출이 끝난 뒤 다시 시도하세요', action: 'none' };
    case 'COMPOSE_NOT_DETECTED':
      return { kind: 'error', message: '메일쓰기 화면을 찾지 못했습니다. 로그인 상태와 화면을 확인한 뒤 다시 시도하세요', action: 'retry', actionLabel: '다시 시도' };
    case 'COMPOSE_TAB_CLOSED':
      return { kind: 'error', message: '웹메일 탭이 닫혔습니다', action: 'retry', actionLabel: '다시 시도' };
    default:
      return { kind: 'error', message: '메일 작성 중 오류가 발생했습니다', detail: message, action: 'retry', actionLabel: '다시 시도' };
  }
}

/** 실패한 항목에 해당하는 복사 버튼만 고른다. 첨부가 하나라도 업로드되지 않았으면 폴더 경로 복사를 둔다. */
function copiesFor(r: ComposeResult): CopyKind[] {
  const out: CopyKind[] = [];
  // 주소로 넣은 필드는 복사 대상이 아니다. 단 본문은 서식이 빠지므로 prefilled여도 복사를 둔다.
  for (const f of r.fields) if (f.status !== 'ok' && (f.field === 'body' || f.status !== 'prefilled')) out.push(f.field);
  if (r.attachments.some((a) => a.status !== 'uploaded')) out.push('attach');
  return ALL_COPIES.filter((k) => out.includes(k));
}

export function composeView(job: Job | null): ComposeView | null {
  if (!job || job.type !== 'compose' || job.status === 'cancelled') return null;
  const result = job.result as ComposeResult | undefined;
  const canFocus = job.composeTabId !== undefined;
  switch (job.status) {
    case 'queued':
    case 'running':
    case 'cancelling': {
      const at = job.steps.find((s) => s.id === 'attach_files');
      const attach = at?.status === 'running' && at.progress ? { done: at.progress.done, total: at.progress.total } : undefined;
      const cur = job.currentStep;
      return {
        kind: 'progress', label: job.label ?? (cur ? COMPOSE_STEP_LABEL[cur] ?? '메일 작성 중' : '준비 중…'),
        ratio: progressRatio(job.steps), attach, cancelling: job.status === 'cancelling', canFocus,
      };
    }
    case 'completed':
    case 'partial':
      if (result?.send?.state === 'sent') return { kind: 'sent', clickedAt: result.send.clickedAt, tabClosed: result.send.tabClosed === true, canFocus };
      if (job.status === 'completed') return { kind: 'done', canFocus };
      if (!result) return errorOf(job.errors[0]?.code, job.errors[0]?.message);
      if (result.send) {
        return {
          kind: 'send-issue', state: result.send.state, message: sendIssueMessage(result.send), maybeSent: result.send.state !== 'skipped',
          // 주소로 전달한 수신자(prefilled)는 클릭 직전 화면 대조로 확인하므로 문제 항목에서 뺀다
          fields: result.fields.filter((f) => f.status !== 'ok' && f.status !== 'prefilled'),
          attachments: result.attachments.filter((a) => a.status !== 'uploaded'),
          copies: copiesFor(result), attachDir: result.attachDir, canFocus,
        };
      }
      if (result.mode === 'url') {
        return {
          kind: 'url', provider: result.provider ?? 'gmail',
          prefilled: result.fields.filter((f) => f.status === 'prefilled'),
          pending: result.fields.filter((f) => f.status !== 'ok' && f.status !== 'prefilled'),
          attachments: result.attachments.filter((a) => a.status !== 'uploaded'),
          copies: copiesFor(result), attachDir: result.attachDir, canFocus,
        };
      }
      return result.mode === 'manual'
        ? { kind: 'manual', copies: ALL_COPIES, attachDir: result.attachDir, canFocus }
        : {
            kind: 'partial', fields: result.fields.filter((f) => f.status !== 'ok'),
            attachments: result.attachments.filter((a) => a.status !== 'uploaded'),
            copies: copiesFor(result), attachDir: result.attachDir, canFocus,
          };
    case 'failed':
    case 'interrupted': {
      const e = job.errors[0];
      return !e && job.status === 'interrupted'
        ? { kind: 'error', message: '메일 작성이 중단되었습니다', action: 'retry', actionLabel: '다시 시도' }
        : errorOf(e?.code, e?.message);
    }
  }
}
