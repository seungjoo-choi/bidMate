import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { defaultIsVisible, detectDetail, MAIN_FRAME_SELECTOR, readHtmlFields } from '../adapters/g2b/detail-page';
import { fetchEvalRaw } from '../adapters/g2b/eval-fetch';
import { sameRound } from '../adapters/g2b/link';
import { BusError, listen } from '../messaging/bus';
import type { ResponseOf } from '../messaging/protocol';
import { PanelController } from '../ui/g2b-panel/controller';
import { mountPanel } from '../ui/g2b-panel/mount';
import '../ui/g2b-panel/style.css';

// 숨김 탭 진단용: 직전 요청 이후 rAF/타이머가 실제로 도달했는지
let rafFlag = false;
let timerSkew: number | null = null;

export default defineContentScript({
  matches: ['https://www.g2b.go.kr/*'],
  runAt: 'document_idle',
  cssInjectionMode: 'ui',
  async main(ctx) {
    const controller = new PanelController(document);

    // SW(notifyTab)가 보내는 진행 알림은 target 'sw'로 오고, popup/SW의 요청은 'content'로 온다.
    listen('job/progress', (p) => { controller.onProgress(p.jobId); }, 'sw');
    listen('job/update', ({ job }) => { controller.onJobUpdate(job); }, 'content');
    listen('fs/permission-granted', () => { controller.onPermissionGranted(); }, 'content');
    listen('g2b/detect', () => controller.detected(), 'content');
    listen('g2b/read-html', ({ noticeNo, round }) => {
      const detected = detectDetail(document, { url: location.href });
      const match = !!detected && detected.noticeNo === noticeNo && (!round || !detected.round || sameRound(detected.round, round));
      const html = match ? readHtmlFields(document, { isVisible: defaultIsVisible }) : null;
      // 진단 실패가 읽기 응답을 막지 않도록 따로 감싼다.
      let diag: ResponseOf<'g2b/read-html'>['diag'] = null;
      try {
        const frame = document.querySelector(MAIN_FRAME_SELECTOR);
        diag = {
          visibility: document.visibilityState,
          readyState: document.readyState,
          mainFrame: frame !== null,
          inputs: frame ? frame.querySelectorAll('input[title], textarea[title]').length : 0,
          noticeInputAny: detectDetail(document, { url: location.href, isVisible: () => true }) !== null,
          noticeInputVisible: detected !== null,
          rafFiredSinceLast: rafFlag,
          timerSkewMs: timerSkew,
          url: location.href,
        };
        // 다음 요청까지의 rAF/타이머 도달 여부를 재기 위한 1회성 프로브(상시 루프 아님)
        rafFlag = false;
        requestAnimationFrame(() => { rafFlag = true; });
        const t0 = performance.now();
        setTimeout(() => { timerSkew = performance.now() - t0 - 100; }, 100);
      } catch { /* 진단 생략 */ }
      return { detected, match, html, readyState: document.readyState, diag };
    }, 'content');
    listen('g2b/eval-fetch', async ({ noticeNo, round, withoutIdHeaders }) => {
      const r = await fetchEvalRaw({ noticeNo, ...(round ? { round } : {}) }, { fetch: window.fetch.bind(window), ...(withoutIdHeaders ? { withoutIdHeaders } : {}) });
      if (!r.ok) throw new BusError(r.error.code, `[단계 ${r.error.step}] ${r.error.message}`);
      return { raw: r.raw, warnings: r.warnings };
    }, 'content');
    listen('g2b/collect', () => controller.collect(), 'content');
    listen('g2b/retry', ({ jobId }) => controller.collect(jobId), 'content');

    const ui = await createShadowRootUi(ctx, {
      name: 'bidmate-g2b-panel',
      position: 'inline',
      anchor: 'body',
      onMount: (container) => mountPanel(container, controller),
      onRemove: (root) => { root?.unmount(); controller.stop(); },
    });
    ui.mount();
    controller.start();

    // WebSquare는 로딩 중 document.open()으로 문서를 통째로 다시 쓴다. 그러면 붙여 둔 패널과
    // body/document에 건 감시가 조용히 사라지므로, 주기적으로 확인해 다시 붙이고 감시를 새 body에 다시 건다.
    let body = document.body;
    ctx.setInterval(() => {
      if (!document.body) return;
      if (document.body === body && ui.shadowHost.isConnected) return;
      body = document.body;
      ui.remove(); // onRemove가 React 루트 해제와 controller.stop()을 처리한다
      ui.mount();
      controller.start();
    }, 1000);
  },
});
