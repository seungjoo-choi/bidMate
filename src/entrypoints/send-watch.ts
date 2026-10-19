import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { send } from '../messaging/bus';
import { isSendButton, isSendHotkey } from '../adapters/naverworks/send-watch-match';
import type { SendWatchConfig } from '../adapters/naverworks/types';

// 웹메일 작성 화면 관찰 전용 스크립트. 사용자가 직접 보냈는지만 보고, DOM 변경이나 이벤트 발생은 하지 않는다.
// storage 접근 없음. 신호는 jobId와 종류만 보내고 나머지는 SW가 ledger에서 정한다.

export interface SendWatchCfg { jobId: string; sendWatch?: SendWatchConfig }
interface SendWatchApi { configure(cfg: SendWatchCfg): void }

declare global {
  interface Window { __bidMateSendWatch?: SendWatchApi }
}

const CONFIRM_WINDOW_MS = 20_000;
const POLL_MS = 500;

export default defineUnlistedScript(() => {
  if (window.__bidMateSendWatch) return; // 중복 주입 가드

  let cfg: SendWatchCfg | null = null;
  let fired = false;
  let confirmed = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let deadline = 0;

  const report = (kind: 'click' | 'hotkey' | 'confirm', confirmation?: 'ui_gone' | 'toast' | 'unload'): void => {
    if (!cfg) return;
    void send('mail/send-signal', { jobId: cfg.jobId, kind, ...(confirmation ? { confirmation } : {}) }).catch(() => { /* 신호 실패는 삼킨다 */ });
  };
  const confirm = (c: 'ui_gone' | 'toast' | 'unload'): void => {
    if (!fired || confirmed) return;
    confirmed = true;
    if (timer) clearInterval(timer);
    report('confirm', c);
  };

  const startConfirm = (): void => {
    const w = cfg?.sendWatch;
    deadline = Date.now() + CONFIRM_WINDOW_MS;
    if (!w || (!w.gone && !w.toast)) return;
    const goneSel = w.gone;
    const hadGone = goneSel ? !!document.querySelector(goneSel) : false;
    timer = setInterval(() => {
      if (confirmed || Date.now() > deadline) { clearInterval(timer); return; }
      if (goneSel && hadGone && !document.querySelector(goneSel)) { confirm('ui_gone'); return; }
      if (w.toast) {
        try {
          const re = new RegExp(w.toast.textPattern);
          for (const el of document.querySelectorAll(w.toast.selector)) if (re.test(el.textContent ?? '')) { confirm('toast'); return; }
        } catch { /* 잘못된 패턴은 건너뛴다 */ }
      }
    }, POLL_MS);
  };

  const first = (kind: 'click' | 'hotkey'): void => {
    if (fired) return;
    fired = true;
    report(kind);
    startConfirm();
  };

  document.addEventListener('click', (e) => {
    const w = cfg?.sendWatch;
    if (!w || !e.isTrusted || fired) return;
    if (isSendButton(e.target, w)) first('click');
  }, true);
  document.addEventListener('keydown', (e) => {
    const w = cfg?.sendWatch;
    if (!w || !e.isTrusted || fired) return;
    if (isSendHotkey(e, w)) first('hotkey');
  }, true);
  window.addEventListener('pagehide', () => {
    if (fired && !confirmed && Date.now() <= deadline) confirm('unload');
  });

  window.__bidMateSendWatch = {
    configure(next) { cfg = next; },
  };
});
