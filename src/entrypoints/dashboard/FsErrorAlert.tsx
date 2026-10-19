import { FolderCheck, FolderOpen } from 'lucide-react';
import { useEffect, useState } from 'react';
import { loadRootRecord } from '../../engine/file-store/idb-handles';
import { send } from '../../messaging/bus';
import { Button, InlineAlert } from '../../ui/components';
import { Mascot } from '../../ui/mascot';

export interface FsErrorInfo { code?: string; message: string }

/**
 * 저장 폴더 권한 오류(NEEDS_FS_PERMISSION)와 일반 오류를 표시한다. 창에 포커스가 돌아오면 onRetry를 호출한다.
 * 권한 오류면 이 화면에서 바로 허용을 요청하고, 폴더가 아예 없으면 설정 화면으로 보낸다.
 */
export function FsErrorAlert({ error, onRetry }: { error: FsErrorInfo | null; onRetry?: () => void }) {
  const needsFs = error?.code === 'NEEDS_FS_PERMISSION';
  // undefined: 읽는 중, null: 폴더 미설정. 클릭 시 await 없이 requestPermission을 부르려고 미리 읽어 둔다.
  const [handle, setHandle] = useState<FileSystemDirectoryHandle | null | undefined>(undefined);
  const [grantError, setGrantError] = useState<string | null>(null);

  useEffect(() => {
    if (!error || !onRetry) return;
    const on = () => onRetry();
    window.addEventListener('focus', on);
    return () => window.removeEventListener('focus', on);
  }, [error, onRetry]);

  useEffect(() => {
    if (!needsFs) return;
    let alive = true;
    void loadRootRecord().then((r) => { if (alive) setHandle(r?.handle ?? null); }, () => { if (alive) setHandle(null); });
    return () => { alive = false; };
  }, [needsFs]);

  const grant = async () => {
    if (!handle) return;
    setGrantError(null);
    try {
      const state = await handle.requestPermission({ mode: 'readwrite' });
      if (state !== 'granted') { setGrantError('접근이 허용되지 않았습니다.'); return; }
      await send('fs/root-updated', undefined, { timeoutMs: 30_000 });
      await send('fs/permission-granted', undefined);
      onRetry?.();
    } catch (e) {
      setGrantError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!error) return null;
  if (needsFs) {
    const noFolder = handle === null;
    return (
      <InlineAlert tone="warn" leading={<Mascot mood="huh" size={40} />}>
        <div className="flex items-center justify-between gap-4">
          <span>{noFolder ? '저장 폴더가 설정되지 않았습니다. 설정에서 폴더를 선택해 주세요.' : '저장 폴더 접근 권한이 필요합니다.'}</span>
          {noFolder
            ? <Button variant="secondary" icon={<FolderOpen />} onClick={() => { location.hash = '#/settings'; }}>폴더 선택하러 가기</Button>
            : <Button variant="secondary" icon={<FolderCheck />} disabled={handle === undefined} onClick={() => void grant()}>폴더 접근 허용</Button>}
        </div>
        {grantError && <p className="mt-2 text-sm">{grantError}</p>}
      </InlineAlert>
    );
  }
  return <InlineAlert tone="error" leading={<Mascot mood="huh" size={40} />}>{error.code ? `${error.code}: ` : ''}{error.message}</InlineAlert>;
}
