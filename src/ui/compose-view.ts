import type { AttachResult, FieldResult } from '../core/types/compose';
import type { ComposeResult, Job } from '../core/types/job';
import { progressRatio } from './g2b-panel/panel-view';

/** compose 잡 → 표시 상태. 순수 함수(UI는 이 결과만 그린다). */
export type CopyKind = 'to' | 'cc' | 'subject' | 'body' | 'attach';
export type ComposeAction = 'grant-site' | 'grant-fs' | 'recipients' | 'settings' | 'retry' | 'none';

export type ComposeView =
  | { kind: 'progress'; label: string; ratio: number; attach?: { done: number; total: number }; cancelling: boolean; canFocus: boolean }
  | { kind: 'done'; canFocus: boolean }
  | { kind: 'manual'; copies: CopyKind[]; attachDir?: string; canFocus: boolean }
  | {
      kind: 'partial'; fields: FieldResult[]; attachments: Array<AttachResult & { error?: string }>;
      copies: CopyKind[]; attachDir?: string; canFocus: boolean;
    }
  | { kind: 'error'; message: string; detail?: string; action: ComposeAction; actionLabel?: string };

const STEP_LABEL: Record<string, string> = {
  render_mail: '메일 내용 준비 중',
  open_compose: '웹메일 여는 중',
  fill_fields: '수신자/제목/본문 입력 중',
  attach_files: '첨부 중',
  verify: '입력 결과 확인 중',
};

const ALL_COPIES: CopyKind[] = ['to', 'cc', 'subject', 'body', 'attach'];

function errorOf(code: string | undefined, message: string | undefined): Extract<ComposeView, { kind: 'error' }> {
  switch (code) {
    case 'NEEDS_SITE_PERMISSION':
      return { kind: 'error', message: '웹메일 사이트 접근을 허용해야 합니다', action: 'grant-site', actionLabel: '웹메일 접근 허용' };
    case 'NEEDS_FS_PERMISSION':
      return { kind: 'error', message: '저장 폴더 접근을 다시 허용해야 합니다', action: 'grant-fs', actionLabel: '폴더 접근 허용' };
    case 'NO_GROUP':
      return { kind: 'error', message: '수신 그룹이 없습니다. 기본 그룹을 지정하거나 자동 작성 설정에서 수신자를 고르세요', action: 'recipients', actionLabel: '수신자 관리 열기' };
    case 'NO_RECIPIENTS':
      return { kind: 'error', message: '받을 수신자가 없습니다. 선택한 수신자가 사용 안 함이거나 삭제되었는지 확인하세요', action: 'recipients', actionLabel: '수신자 관리 열기' };
    case 'GROUP_NOT_FOUND':
      return { kind: 'error', message: '자동 작성 설정의 그룹이 삭제되었습니다', action: 'settings', actionLabel: '설정 열기' };
    case 'TEMPLATE_NOT_FOUND':
      return { kind: 'error', message: '자동 작성 설정의 템플릿이 삭제되었습니다', action: 'settings', actionLabel: '설정 열기' };
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
  for (const f of r.fields) if (f.status !== 'ok') out.push(f.field);
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
        kind: 'progress', label: job.label ?? (cur ? STEP_LABEL[cur] ?? '메일 작성 중' : '준비 중…'),
        ratio: progressRatio(job.steps), attach, cancelling: job.status === 'cancelling', canFocus,
      };
    }
    case 'completed':
      return { kind: 'done', canFocus };
    case 'partial':
      if (!result) return errorOf(job.errors[0]?.code, job.errors[0]?.message);
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
