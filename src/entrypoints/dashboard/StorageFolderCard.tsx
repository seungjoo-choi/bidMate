import { FolderOpen, KeyRound, FlaskConical } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { loadRootRecord, saveRootHandle } from '../../engine/file-store/idb-handles';
import { send } from '../../messaging/bus';
import type { FsStatus, SmokeTestResult } from '../../messaging/protocol';
import { Button, Card, InlineAlert, StatusBadge } from '../../ui/components';

const PERM_LABEL = { granted: '접근 허용됨', prompt: '재승인 필요', denied: '접근 거부됨' } as const;
const PERM_STATUS = { granted: 'ok', prompt: 'warn', denied: 'error' } as const;

// dashboard는 폴더 선택/재승인만 한다. 파일 쓰기는 offscreen이 전담한다.
export function StorageFolderCard() {
  const [status, setStatus] = useState<FsStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'pick' | 'reauth' | 'smoke' | null>(null);
  const [smoke, setSmoke] = useState<SmokeTestResult | null>(null);
  const [handle, setHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setHandle((await loadRootRecord())?.handle ?? null);
      setStatus(await send('fs/status', undefined, { timeoutMs: 30_000 }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const pick = async () => {
    setError(null);
    setBusy('pick');
    try {
      // 선택 창을 문서 폴더에서 연다. 한 번 고른 뒤에는 Chrome이 id별로 마지막 위치를 기억한다.
      const h = await window.showDirectoryPicker({ mode: 'readwrite', id: 'bidmate-root', startIn: 'documents' });
      await saveRootHandle(h);
      await send('fs/root-updated', undefined, { timeoutMs: 30_000 });
      setSmoke(null);
      await refresh();
    } catch (e) {
      if ((e as DOMException).name !== 'AbortError') setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const reauthorize = async () => {
    if (!handle) return;
    setError(null);
    setBusy('reauth');
    try {
      await handle.requestPermission({ mode: 'readwrite' });
      await send('fs/root-updated', undefined, { timeoutMs: 30_000 });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const runSmoke = async () => {
    setError(null);
    setBusy('smoke');
    try {
      setSmoke(await send('fs/smoke-test', undefined, { timeoutMs: 30_000 }));
    } catch (e) {
      setSmoke(null);
      setError(e instanceof Error ? `${(e as { code?: string }).code ?? ''} ${e.message}`.trim() : String(e));
    } finally {
      setBusy(null);
    }
  };

  const perm = status?.permission;

  return (
    <Card
      title="저장 폴더"
      description={
        <>
          공고 파일과 데이터가 저장될 내 컴퓨터의 폴더입니다.{' '}
          {status?.hasRoot && (
            <button type="button" aria-expanded={showGuide} onClick={() => setShowGuide((v) => !v)} className="font-medium text-accent underline underline-offset-2 hover:text-ink">
              폴더 고르는 방법 {showGuide ? '접기' : '보기'}
            </button>
          )}
        </>
      }
      action={
        <Button variant="secondary" icon={<FolderOpen />} loading={busy === 'pick'} onClick={pick}>
          폴더 선택
        </Button>
      }
    >
      <div className="flex items-center justify-between rounded-ctl border border-line bg-sunken inset-shadow-sunken px-4 py-3">
        <div className="min-w-0">
          <div className="text-xs text-muted">현재 폴더</div>
          <div className="truncate text-sm font-medium">{status?.hasRoot ? status.rootName : '선택된 폴더 없음'}</div>
        </div>
        {status?.hasRoot && perm ? (
          <StatusBadge status={PERM_STATUS[perm]}>{PERM_LABEL[perm]}</StatusBadge>
        ) : (
          <StatusBadge status="idle">미설정</StatusBadge>
        )}
      </div>

      {status && (!status.hasRoot || showGuide) && (
        <InlineAlert tone="info">
          <div className="font-medium">{status.hasRoot ? '폴더 고르는 방법' : '처음 한 번만 폴더를 골라 주세요'}</div>
          <FolderGuide />
        </InlineAlert>
      )}

      <div className="flex flex-wrap gap-2">
        {perm === 'prompt' && handle && (
          <Button icon={<KeyRound />} loading={busy === 'reauth'} onClick={reauthorize}>
            접근 재승인
          </Button>
        )}
        <Button
          variant="secondary"
          icon={<FlaskConical />}
          loading={busy === 'smoke'}
          disabled={!status?.hasRoot}
          onClick={runSmoke}
        >
          저장 테스트
        </Button>
      </div>

      {smoke && (
        <InlineAlert tone={smoke.ok ? 'ok' : 'error'}>
          <div className="font-medium">{smoke.ok ? '저장 테스트 통과' : '저장 테스트 실패'}</div>
          <div className="mt-1 text-xs">
            쓰기 {smoke.steps.write ? 'OK' : '실패'}, 읽기 {smoke.steps.read ? 'OK' : '실패'}, 삭제 {smoke.steps.delete ? 'OK' : '실패'}
          </div>
          {smoke.error && <div className="mt-1 break-all text-xs">{smoke.error}</div>}
        </InlineAlert>
      )}
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
    </Card>
  );
}

/** 저장 폴더 고르는 순서. 폴더가 없을 때는 항상 보이고, 있을 때는 설명 옆 버튼으로 펼친다. */
function FolderGuide() {
  return (
    <>
      <ol className="mt-1 list-decimal space-y-0.5 pl-5">
        <li>오른쪽 위 <b>폴더 선택</b>을 누르면 <b>문서</b> 폴더에서 선택 창이 열립니다.</li>
        <li>선택 창 왼쪽 아래 <b>새 폴더</b>를 눌러 <b>나의 입찰메이트</b> 폴더를 만듭니다.</li>
        <li>만든 <b>나의 입찰메이트</b> 폴더를 고른 채로 <b>선택</b>을 누르고, 이어서 뜨는 접근 허용 창에서 허용합니다.</li>
      </ol>
      <div className="mt-1 text-xs">바탕화면, 다운로드 폴더 전체, iCloud나 NAS 동기화 폴더는 피해 주세요. 폴더를 바꾸면 기존 폴더의 파일은 옮겨지지 않습니다.</div>
    </>
  );
}
