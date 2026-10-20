import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  /** 확인 라벨에 '취소'가 들어갈 때 헷갈리지 않게 바꾼다(예: '닫기'). */
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** 화면 가운데 확인 팝업. 바깥을 누르거나 Esc를 누르면 취소된다. 실수로 Enter를 눌러도 지우지 않도록 취소 버튼에 포커스를 둔다. */
export function ConfirmDialog({ open, title, description, confirmLabel = '삭제', cancelLabel = '취소', onConfirm, onCancel }: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div role="alertdialog" aria-modal="true" aria-label={title} className="w-full max-w-sm rounded-card border border-line bg-surface p-6 shadow-overlay">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {description && <div className="mt-2 text-sm text-muted">{description}</div>}
        <div className="mt-6 flex justify-end gap-2">
          <Button ref={cancelRef} variant="secondary" onClick={onCancel}>{cancelLabel}</Button>
          <Button variant="danger" onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
