import { FolderOpen, KeyRound, FlaskConical } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { loadRootRecord, saveRootHandle } from '../../engine/file-store/idb-handles';
import { send } from '../../messaging/bus';
import type { FsStatus, SmokeTestResult } from '../../messaging/protocol';
import { checkRootPath, ROOT_PATH_KEY, ROOT_PATH_SKIP_KEY, type StoredRootPath } from '../../core/model/root-path';
import { Button, Card, FormActions, InlineAlert, inputClass, StatusBadge } from '../../ui/components';

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
  // 전체 경로(나라장터 패널의 경로 복사용). 저장 폴더 이름이 같을 때만 유효하다
  const [rootPath, setRootPath] = useState<StoredRootPath | null>(null);
  const [pathEdit, setPathEdit] = useState<string | null>(null);
  const [pathError, setPathError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setHandle((await loadRootRecord())?.handle ?? null);
      setStatus(await send('fs/status', undefined, { timeoutMs: 30_000 }));
      setRootPath(((await chrome.storage.local.get(ROOT_PATH_KEY))[ROOT_PATH_KEY] as StoredRootPath | undefined) ?? null);
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
      // 폴더가 바뀌면 예전 전체 경로는 맞지 않으므로 지우고, 경로 복사 때 다시 묻게 한다
      await chrome.storage.local.remove([ROOT_PATH_KEY, ROOT_PATH_SKIP_KEY]);
      setPathEdit(null);
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

  const savePath = async () => {
    if (pathEdit === null || !status?.rootName) return;
    const r = checkRootPath(pathEdit, status.rootName);
    if (!r.ok) { setPathError(r.reason); return; }
    const stored = { rootName: status.rootName, path: r.path };
    await chrome.storage.local.set({ [ROOT_PATH_KEY]: stored });
    setRootPath(stored);
    setPathEdit(null);
  };

  const perm = status?.permission;
  const fullPath = rootPath && rootPath.rootName === status?.rootName ? rootPath.path : null;
  const isMac = /Mac/i.test(navigator.userAgent);

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
          {status?.hasRoot && pathEdit === null && (
            <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-muted">
              <span className="truncate" title={fullPath ?? undefined}>{fullPath ?? '전체 경로 미입력 (나라장터 경로 복사 시 폴더 안쪽 경로만 복사)'}</span>
              <button type="button" onClick={() => { setPathEdit(fullPath ?? ''); setPathError(null); }} className="shrink-0 cursor-pointer font-medium text-accent underline underline-offset-2 hover:text-ink">
                {fullPath ? '변경' : '입력'}
              </button>
            </div>
          )}
        </div>
        {status?.hasRoot && perm ? (
          <StatusBadge status={PERM_STATUS[perm]}>{PERM_LABEL[perm]}</StatusBadge>
        ) : (
          <StatusBadge status="idle">미설정</StatusBadge>
        )}
      </div>

      {pathEdit !== null && status?.rootName && (
        <div className="space-y-2">
          <p className="text-xs text-muted">
            {isMac ? `Finder에서 '${status.rootName}' 폴더를 ⌥ 누른 채 우클릭, '경로 이름 복사' 후 붙여 넣으세요.` : `탐색기에서 '${status.rootName}' 폴더를 Shift 누른 채 우클릭, '경로로 복사' 후 붙여 넣으세요.`}
          </p>
          <input
            autoFocus value={pathEdit} className={inputClass}
            placeholder={isMac ? `/Users/이름/Documents/${status.rootName}` : `C:\\Users\\이름\\Documents\\${status.rootName}`}
            onChange={(e) => { setPathEdit(e.target.value); setPathError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') void savePath(); if (e.key === 'Escape') setPathEdit(null); }}
          />
          {pathError && <p className="text-xs text-danger">{pathError}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPathEdit(null)}>취소</Button>
            <Button onClick={() => void savePath()}>저장</Button>
          </div>
        </div>
      )}

      {status && (!status.hasRoot || showGuide) && (
        <InlineAlert tone="info">
          <div className="font-medium">{status.hasRoot ? '폴더 고르는 방법' : '처음 한 번만 폴더를 골라 주세요'}</div>
          <FolderGuide />
        </InlineAlert>
      )}

      <FormActions>
        <Button
          variant="secondary"
          icon={<FlaskConical />}
          loading={busy === 'smoke'}
          disabled={!status?.hasRoot}
          onClick={runSmoke}
        >
          저장 테스트
        </Button>
        {perm === 'prompt' && handle && (
          <Button icon={<KeyRound />} loading={busy === 'reauth'} onClick={reauthorize}>
            접근 재승인
          </Button>
        )}
      </FormActions>

      {smoke && (
        <InlineAlert tone={smoke.ok ? 'ok' : 'error'}>
          <div className="font-medium">{smoke.ok ? '저장 테스트 통과' : '저장 테스트 실패'}</div>
          <div className="mt-1 text-xs">
            쓰기 {smoke.steps.write ? 'OK' : '실패'}, 읽기 {smoke.steps.read ? 'OK' : '실패'}, 삭제 {smoke.steps.delete ? 'OK' : '실패'}
          </div>
          {smoke.error && <div className="mt-1 wrap-anywhere text-xs">{smoke.error}</div>}
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
        <li>선택 창 왼쪽 아래 <b>새 폴더</b>를 눌러 <b>비드메이트</b> 폴더를 만듭니다.</li>
        <li>만든 <b>비드메이트</b> 폴더를 고른 채로 <b>선택</b>을 누르고, 이어서 뜨는 접근 허용 창에서 허용합니다.</li>
      </ol>
      <div className="mt-1 text-xs">바탕화면, 다운로드 폴더 전체, iCloud나 NAS 동기화 폴더는 피해 주세요. 폴더를 바꾸면 기존 폴더의 파일은 옮겨지지 않습니다.</div>
    </>
  );
}
