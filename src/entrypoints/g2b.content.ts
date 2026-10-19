import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { defaultIsVisible, detectDetail, readHtmlFields } from '../adapters/g2b/detail-page';
import { sameRound } from '../adapters/g2b/link';
import { listen } from '../messaging/bus';
import { PanelController } from '../ui/g2b-panel/controller';
import { mountPanel } from '../ui/g2b-panel/mount';
import '../ui/g2b-panel/style.css';

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
      return { detected, match, html, readyState: document.readyState };
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
