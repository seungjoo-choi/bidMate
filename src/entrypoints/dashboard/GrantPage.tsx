import { FolderCheck, FolderOpen } from 'lucide-react';
import { useEffect, useState } from 'react';
import { loadRootRecord } from '../../engine/file-store/idb-handles';
import { send } from '../../messaging/bus';
import { Button, Card, InlineAlert } from '../../ui/components';
import { MascotSay } from '../../ui/mascot';

/** 패널의 [폴더 접근 허용]이 여는 작은 창. requestPermission은 클릭 핸들러의 첫 await여야 한다. */
export function GrantPage() {
  const [handle, setHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 핸들은 미리 읽어 둔다(클릭 시 await 없이 바로 requestPermission 호출).
  useEffect(() => {
    void loadRootRecord().then((r) => { setHandle(r?.handle ?? null); setLoaded(true); }, () => setLoaded(true));
  }, []);

  const grant = async () => {
    if (!handle) return;
    setError(null);
    try {
      const state = await handle.requestPermission({ mode: 'readwrite' });
      if (state !== 'granted') { setError('접근이 허용되지 않았습니다.'); return; }
      await send('fs/root-updated', undefined, { timeoutMs: 30_000 });
      await send('fs/permission-granted', undefined);
      window.close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const openSettings = async () => {
    try { await send('ui/open', { page: 'settings', section: 'storage' }); window.close(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div className="p-6">
      <Card title="저장 폴더 접근">
        <div className="space-y-3">
          <MascotSay mood="guide" size={72}>공고 첨부파일을 정리해 둘 폴더를 열 수 있게 허락해 주세요.</MascotSay>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
            <li>설정에서 고른 저장 폴더 하나만 엽니다</li>
            <li>수집한 공고 파일을 그 폴더에 저장합니다</li>
          </ul>
          <Button className="w-full" icon={<FolderCheck />} disabled={!handle} onClick={grant}>폴더 접근 허용</Button>
          {loaded && !handle && (
            <>
              <InlineAlert tone="error">저장 폴더가 설정되지 않았습니다. 설정에서 폴더를 먼저 선택해 주세요.</InlineAlert>
              <Button variant="secondary" className="w-full" icon={<FolderOpen />} onClick={openSettings}>설정에서 폴더 선택</Button>
            </>
          )}
          {error && <InlineAlert tone="error">{error}</InlineAlert>}
        </div>
      </Card>
    </div>
  );
}
