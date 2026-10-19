import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { listen } from '../messaging/bus';
import { TrackerbotController } from '../ui/trackerbot/controller';
import { ProgressPopup } from '../ui/trackerbot/progress-popup';

// 웹메일 읽기 화면 content script. 트래커봇 메일의 입찰정보 행에 [공고 수집] 버튼을 붙인다.

declare global {
  interface Window { __bidMateTrackerbot?: TrackerbotController }
}

export default defineUnlistedScript(() => {
  if (window.__bidMateTrackerbot) return; // 중복 주입 가드
  const controller = new TrackerbotController(document);
  window.__bidMateTrackerbot = controller;

  listen('job/progress', (p) => { controller.onProgress(p.jobId); }, 'sw');
  listen('job/update', ({ job }) => { controller.onJobUpdate(job); }, 'content');
  listen('fs/permission-granted', () => { controller.onPermissionGranted(); }, 'content');

  // 우측 하단 진행 팝업. 최초 scan의 알림부터 받도록 컨트롤러보다 먼저 시작한다
  new ProgressPopup(document, controller).start();
  controller.start();
});
