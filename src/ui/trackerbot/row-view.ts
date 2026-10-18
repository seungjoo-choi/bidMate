import type { Job } from '../../core/types/job';
import type { NoticeRef } from '../../core/types/notice';
import type { NoticeLookup } from '../../messaging/protocol';
import { panelView } from '../g2b-panel/panel-view';
import { handoffView } from '../handoff-view';

export interface RowEntry {
  key: string; ref: NoticeRef; title?: string; lookup: NoticeLookup; job: Job | null;
  /** collect 잡의 handoff.jobId가 가리키는 자동 작성 compose 잡 */
  compose: Job | null;
  starting: boolean; error: string | null; otherTab: boolean;
}

/** 행 보조 버튼 동작 */
export type RowSubAction = 'open-mail' | 'open-review' | 'settings';

export type RowView =
  | { kind: 'idle'; label: string; chip?: string; tone: 'primary' | 'secondary'; detail?: string }
  | { kind: 'busy'; label: string; canCancel: boolean; cancelling: boolean; cancelTarget: 'collect' | 'compose' }
  | { kind: 'done'; label: string; tone: 'ok' | 'warn'; detail?: string; canRetry: boolean; action?: RowSubAction; actionLabel?: string }
  | { kind: 'error'; label: string; detail?: string; action: 'retry' | 'grant' | 'settings' | 'none'; actionLabel?: string; subAction?: RowSubAction; subActionLabel?: string }
  | { kind: 'disabled'; label: string; reason: string };

/** 엔트리 -> 행 버튼 표시 상태. 순수 함수. */
export function rowView(entry: RowEntry, opts: { orphaned: boolean }): RowView {
  if (opts.orphaned) return { kind: 'disabled', label: '새로고침 필요', reason: '확장 프로그램이 갱신되었습니다. 페이지를 새로고침하세요' };
  if (entry.starting) return { kind: 'busy', label: '시작 중', canCancel: false, cancelling: false, cancelTarget: 'collect' };

  const v = panelView(entry.job, entry.lookup, { title: entry.title });
  // 재시도 시작 실패 등 잡 밖의 오류도 끝난 상태에서 보이게 한다
  const withError = (d?: string) => (entry.error ? (d ? `${entry.error}\n${d}` : entry.error) : d);
  const h = v.kind === 'completed' || v.kind === 'partial' || v.kind === 'error' ? handoffView(entry.job!, entry.compose) : null;
  const sub = (a: string): RowSubAction | undefined => (a === 'open-mail' || a === 'open-review' || a === 'settings' ? a : undefined);
  const hAction = h ? sub(h.action) : undefined;
  if (h && (v.kind === 'completed' || v.kind === 'partial')) {
    // 셀이 좁아 라벨은 짧게, 상세는 툴팁
    const tip = withError([v.kind === 'completed' ? [v.headline, v.chip].join('\n') : [v.headline, ...v.failures.map((f) => `${f.name}: ${f.reason}`)].join('\n'), h.text].join('\n'));
    const act = hAction ? { action: hAction, actionLabel: h.actionLabel } : {};
    switch (h.kind) {
      case 'composing':
        return { kind: 'busy', label: '메일 작성 중', canCancel: h.action === 'cancel-compose', cancelling: h.action === 'none' && !!h.composeJobId, cancelTarget: 'compose' };
      case 'composed':
        return { kind: 'done', label: '메일 작성됨', tone: 'ok', canRetry: false, detail: tip, ...act };
      case 'manual':
      case 'compose_partial':
        return { kind: 'done', label: '메일 확인', tone: 'warn', canRetry: false, detail: tip, ...act };
      case 'compose_failed':
        return { kind: 'error', label: '메일 작성 실패', detail: tip, action: 'none', ...(hAction ? { subAction: hAction, subActionLabel: h.actionLabel } : {}) };
      case 'review':
        return { kind: 'done', label: '검수 필요', tone: 'warn', canRetry: v.kind === 'partial' && v.canRetry, detail: tip, ...act };
      case 'queued':
        return { kind: 'done', label: '수집 완료', tone: 'ok', canRetry: false, detail: tip };
      case 'skipped':
        // 중복 방지로 자동 작성을 건너뛴 경우는 툴팁만으로는 모르고 지나치므로 라벨로 알린다
        if (entry.job?.handoff?.action === 'none' && entry.job.handoff.reason === 'already_composed') {
          return { kind: 'done', label: '이미 작성함', tone: 'warn', canRetry: false, detail: tip, ...(hAction ? { action: hAction, actionLabel: '메일 보기' } : {}) };
        }
        return {
          kind: 'done', label: v.kind === 'completed' ? '수집 완료' : '일부 실패', tone: v.kind === 'completed' ? 'ok' : 'warn',
          canRetry: v.kind === 'partial' && v.canRetry, detail: tip, ...act,
        };
    }
  }
  switch (v.kind) {
    case 'idle': {
      const found = v.buttonLabel === '다시 수집';
      const detail = entry.otherTab ? '다른 탭에서 수집 중' : entry.error ?? undefined;
      return { kind: 'idle', label: v.buttonLabel, chip: v.chip, tone: found ? 'secondary' : 'primary', ...(detail ? { detail } : {}) };
    }
    case 'progress':
      return {
        kind: 'busy', label: v.attach ? `첨부 ${v.attach.done}/${v.attach.total}` : v.label.slice(0, 20),
        canCancel: !v.cancelling, cancelling: v.cancelling, cancelTarget: 'collect',
      };
    case 'completed':
      return { kind: 'done', label: '수집 완료', tone: 'ok', detail: withError([v.headline, v.chip].filter(Boolean).join('\n')), canRetry: false }; // 셀이 좁아 라벨은 짧게, 나머지는 툴팁
    case 'partial':
      return {
        kind: 'done', label: '일부 실패', tone: 'warn', canRetry: v.canRetry,
        detail: withError([v.headline, ...v.failures.map((f) => `${f.name}: ${f.reason}`)].join('\n')),
      };
    case 'error':
      // 서비스키 오류는 키를 고친 뒤 이 행에서 바로 다시 수집할 수 있어야 한다
      if (v.action === 'settings') {
        return {
          kind: 'error', label: '수집 실패', detail: withError([v.message, v.detail, h?.text].filter(Boolean).join('\n')),
          action: 'retry', actionLabel: '다시 시도', subAction: 'settings', subActionLabel: '설정 열기',
        };
      }
      return {
        kind: 'error', label: '수집 실패', detail: withError([v.message, v.detail, h?.text].filter(Boolean).join('\n')),
        action: v.action, actionLabel: v.actionLabel,
        ...(h && h.kind === 'review' && hAction ? { subAction: hAction, subActionLabel: h.actionLabel } : {}),
      };
  }
}
