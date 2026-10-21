import { Paperclip, Send } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { MailDraft } from '../../core/types/mail';
import { Button, InlineAlert } from '../components';
import { formatDateTimeSlash } from '../../core/model/format';
import { normalizeEmail } from '../../core/recipients/email';

export interface SendPreviewProps {
  draft: MailDraft;
  /** 취소되지 않은 발송 기록 수와 그중 마지막 발송 시각 */
  sentCount: number;
  lastSentAt?: string;
  /** 주소록에 있는 주소면 이름을 돌려준다. 없으면 주소를 그대로 보인다 */
  nameOf?: (email: string) => string | undefined;
  onConfirm: () => void;
  onCancel: () => void;
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3 px-3 py-2 text-sm">
      <div className="text-xs font-semibold text-muted">{label}</div>
      <div className="min-w-0 wrap-anywhere text-ink">{children}</div>
    </div>
  );
}

/**
 * [바로 발송] 마지막 확인. 이 창의 [보내기]가 자동 발송의 유일한 동의 지점이다.
 * 실수로 Enter를 눌러도 보내지 않도록 취소 버튼에 포커스를 둔다.
 */
function Recipients({ emails, nameOf }: { emails: string[]; nameOf?: (email: string) => string | undefined }) {
  if (emails.length === 0) return <span className="text-faint">없음</span>;
  return (
    <>
      {emails.map((email, i) => (
        <span key={email}>
          {i > 0 && ', '}
          <span title={email}>{nameOf?.(normalizeEmail(email)) || email}</span>
        </span>
      ))}
    </>
  );
}

export function SendPreviewDialog({ draft, sentCount, lastSentAt, nameOf, onConfirm, onCancel }: SendPreviewProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const cancel = useRef(onCancel);
  cancel.current = onCancel;

  // 열릴 때 한 번만 포커스한다. 부모가 잡 갱신으로 다시 그려져도 포커스를 빼앗지 않는다.
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cancel.current(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div role="alertdialog" aria-modal="true" aria-label="메일 발송 확인" className="flex max-h-[calc(100vh-2rem)] w-full max-w-lg flex-col rounded-card border border-line bg-surface shadow-overlay">
        <div className="px-6 pt-6">
          <h2 className="text-base font-semibold text-ink">이 메일을 보낼까요?</h2>
          <p className="mt-1 text-sm text-muted">웹메일 작성 탭을 뒤에서 열어 입력한 뒤 바로 보냅니다. 보낸 메일은 되돌릴 수 없습니다.</p>
        </div>

        <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto px-6">
          {sentCount > 0 && (
            <InlineAlert tone="warn">
              이미 {sentCount}회 발송한 공고입니다{lastSentAt ? ` (마지막 ${formatDateTimeSlash(lastSentAt)})` : ''}
            </InlineAlert>
          )}
          <div className="divide-y divide-line overflow-hidden rounded-ctl border border-line bg-sunken">
            <Row label={`받는사람 ${draft.to.length}`}><Recipients emails={draft.to} nameOf={nameOf} /></Row>
            <Row label={`참조 ${draft.cc.length}`}><Recipients emails={draft.cc} nameOf={nameOf} /></Row>
            <Row label="제목">{draft.subject}</Row>
            <Row label={`첨부 ${draft.attachments.length}`}>
              {draft.attachments.length === 0 ? <span className="text-faint">없음</span> : (
                <ul className="space-y-1">
                  {draft.attachments.map((a) => (
                    <li key={a.attachmentId} className="flex items-center gap-1.5">
                      <Paperclip className="size-3.5 shrink-0 text-faint" />
                      <span className="min-w-0 flex-1 truncate" title={a.name}>{a.name}</span>
                      <span className="shrink-0 font-mono text-xs tabular-nums text-muted">{sizeLabel(a.size)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Row>
          </div>
          <details className="rounded-ctl border border-line">
            <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-muted select-none">본문 보기</summary>
            <div className="max-h-60 overflow-y-auto border-t border-line px-3 py-2 text-sm whitespace-pre-wrap text-ink">{draft.text}</div>
          </details>
        </div>

        <div className="flex justify-end gap-2 px-6 pt-5 pb-6">
          <Button ref={cancelRef} variant="secondary" onClick={onCancel}>취소</Button>
          <Button icon={<Send />} disabled={draft.to.length === 0} onClick={onConfirm}>보내기</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
