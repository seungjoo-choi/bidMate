import { FolderCheck } from 'lucide-react';
import { useEffect } from 'react';
import { send } from '../../messaging/bus';
import { Button, InlineAlert } from '../components';

export interface FsErrorInfo { code?: string; message: string }

/** 저장 폴더 권한 오류(NEEDS_FS_PERMISSION)와 일반 오류를 표시한다. 창에 포커스가 돌아오면 onRetry를 호출한다. */
export function FsErrorAlert({ error, onRetry }: { error: FsErrorInfo | null; onRetry?: () => void }) {
  useEffect(() => {
    if (!error || !onRetry) return;
    const on = () => onRetry();
    window.addEventListener('focus', on);
    return () => window.removeEventListener('focus', on);
  }, [error, onRetry]);
  if (!error) return null;
  if (error.code === 'NEEDS_FS_PERMISSION') {
    return (
      <InlineAlert tone="warn">
        <div className="flex items-center justify-between gap-4">
          <span>저장 폴더 접근 권한이 필요합니다.</span>
          <Button variant="secondary" icon={<FolderCheck />} onClick={() => void send('ui/open', { page: 'grant' }).catch(() => undefined)}>폴더 접근 허용</Button>
        </div>
      </InlineAlert>
    );
  }
  return <InlineAlert tone="error">{error.code ? `${error.code}: ` : ''}{error.message}</InlineAlert>;
}
