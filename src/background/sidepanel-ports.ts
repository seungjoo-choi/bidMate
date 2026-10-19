import { SIDEPANEL_PORT } from '../messaging/protocol';

/** 창별로 열려 있는 사이드 패널의 연결과 마지막으로 지정한 공고. 같은 버튼을 다시 누르면 닫기 위해 쓴다(SW 메모리). */
const ports = new Map<number, chrome.runtime.Port>();
const shown = new Map<number, string | undefined>();

export function registerSidePanelPorts(): void {
  chrome.runtime.onConnect.addListener((port) => {
    // 확장 페이지(사이드 패널)만 받는다. 콘텐츠 스크립트 연결은 sender.tab이 있다
    if (port.name !== SIDEPANEL_PORT || port.sender?.id !== chrome.runtime.id || port.sender?.tab) return;
    let win: number | undefined;
    port.onMessage.addListener((m: { type?: string; windowId?: number }) => {
      if (m?.type === 'hello' && typeof m.windowId === 'number') { win = m.windowId; ports.set(win, port); }
    });
    port.onDisconnect.addListener(() => {
      if (win !== undefined && ports.get(win) === port) { ports.delete(win); shown.delete(win); }
    });
  });
}

export const isSidePanelOpen = (windowId: number): boolean => ports.has(windowId);
export const shownNoticeOf = (windowId: number): string | undefined => shown.get(windowId);
export const setShownNotice = (windowId: number, noticeId: string | undefined): void => { shown.set(windowId, noticeId); };
export function closeSidePanel(windowId: number): void { ports.get(windowId)?.postMessage({ type: 'close' }); }
