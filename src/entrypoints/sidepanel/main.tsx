import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../ui/theme/theme.css';
import { applyTheme } from '../../ui/theme/mode';
import './sidepanel.css';
import { SIDEPANEL_PORT } from '../../messaging/protocol';
import { App } from './App';

// SW에 열려 있음을 알린다. 같은 버튼을 다시 누르면 SW가 close를 보내고 패널이 스스로 닫힌다
function connectToSw(): void {
  const port = chrome.runtime.connect({ name: SIDEPANEL_PORT });
  void chrome.windows.getCurrent().then((w) => { if (w.id !== undefined) port.postMessage({ type: 'hello', windowId: w.id }); }, () => undefined);
  port.onMessage.addListener((m: { type?: string }) => { if (m?.type === 'close') window.close(); });
  // SW가 재시작되면 연결이 끊긴다. 다시 맺는다
  port.onDisconnect.addListener(() => { setTimeout(connectToSw, 1000); });
}
connectToSw();

applyTheme(document.documentElement);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
