import type { ReactNode } from 'react';

export interface FormActionsProps {
  /** 버튼 줄 왼쪽에 두는 상태 표시(StatusBadge 등). */
  status?: ReactNode;
  children: ReactNode;
}

// 폼·카드·다이얼로그 맨 아래의 마무리 버튼 줄. 버튼은 오른쪽에 모으고 주 버튼을 맨 오른쪽에 둔다(ConfirmDialog와 같은 규칙).
export function FormActions({ status, children }: FormActionsProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {status && <div className="min-w-0">{status}</div>}
      <div className="ml-auto flex flex-wrap justify-end gap-2">{children}</div>
    </div>
  );
}
