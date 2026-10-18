import { Download, LayoutDashboard, PanelRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { isWebmailUrl } from '../../background/site-registry';
import { sendToTab } from '../../messaging/bus';
import type { G2bDetected } from '../../messaging/protocol';
import { Button, StatusBadge, Logo } from '../../ui/components';

export function App() {
  const [detected, setDetected] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [windowId, setWindowId] = useState<number | null>(null);
  const [tabId, setTabId] = useState<number | null>(null);
  const [isG2b, setIsG2b] = useState(false);
  const [g2b, setG2b] = useState<G2bDetected | null>(null);
  const [collecting, setCollecting] = useState(false);

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }).then(
      async ([tab]) => {
        setWindowId(tab?.windowId ?? null);
        setTabId(tab?.id ?? null);
        if (tab?.id !== undefined && /^https:\/\/www\.g2b\.go\.kr\//.test(tab.url ?? '')) {
          setIsG2b(true);
          try { setG2b(await sendToTab(tab.id, 'g2b/detect', undefined)); } catch { setG2b(null); }
        }
        setDetected(await isWebmailUrl(tab?.url));
      },
      () => setDetected(false),
    );
  }, []);

  // 사용자 제스처 안에서 동기적으로 sidePanel.open을 호출해야 한다.
  const openSidePanel = () => {
    if (windowId === null) return;
    chrome.sidePanel.open({ windowId }).then(
      () => window.close(),
      (e) => setError(e instanceof Error ? e.message : String(e)),
    );
  };

  const collectG2b = async () => {
    if (tabId === null) return;
    setCollecting(true);
    try {
      const r = await sendToTab(tabId, 'g2b/collect', undefined);
      if (r.started || r.code === 'JOB_ALREADY_RUNNING') window.close();
      else setError('수집을 시작하지 못했습니다.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCollecting(false);
    }
  };

  const openDashboard = () => {
    void chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
    window.close();
  };

  return (
    <div className="w-[380px] space-y-4 bg-canvas p-5">
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2">
          <Logo size={26} />
          <span>
            <span className="block text-lg leading-tight font-bold tracking-tight">BidMate</span>
            <span className="block text-xs leading-tight font-normal text-muted">나의 입찰메이트</span>
          </span>
        </h1>
        {detected && <StatusBadge status="ok">웹메일 감지</StatusBadge>}
        {detected === false && <StatusBadge status="idle">대상 사이트 아님</StatusBadge>}
      </div>
      {isG2b && (
        <div className="space-y-3 rounded-card border border-line bg-surface p-4 shadow-card">
          {g2b ? (
            <>
              <div className="text-sm font-medium">{g2b.title ?? g2b.noticeNo}</div>
              <div className="text-xs text-muted">{g2b.noticeNo}{g2b.round ? `-${g2b.round}` : ''}</div>
              <Button className="w-full" icon={<Download />} loading={collecting} onClick={collectG2b}>이 공고 수집</Button>
            </>
          ) : (
            <p className="text-sm text-muted">나라장터 공고 상세화면에서 사용할 수 있습니다</p>
          )}
        </div>
      )}
      <div className="space-y-2">
        <Button className="w-full" icon={<LayoutDashboard />} onClick={openDashboard}>
          대시보드 열기
        </Button>
        <Button className="w-full" variant="secondary" icon={<PanelRight />} disabled={windowId === null} onClick={openSidePanel}>
          사이드 패널 열기
        </Button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
