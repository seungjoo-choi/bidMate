import { defineBackground } from 'wxt/utils/define-background';
import { registerAutoCompose } from '../background/auto-compose';
import { registerComposeRelay } from '../background/compose-relay';
import { registerNaverworksContacts } from '../background/naverworks-contacts';
import { registerEvalCollector } from '../background/eval-collector';
import { registerDeadlineScheduler } from '../background/deadline-scheduler';
import { registerOrgRelay } from '../background/org-relay';
import { registerProcessRelay } from '../background/process-relay';
import { registerResultScheduler } from '../background/result-scheduler';
import { registerDetailReader } from '../background/detail-reader';
import { registerG2bFailures } from '../background/g2b-failures';
import { registerCoordinator } from '../background/job-coordinator';
import { registerRouter } from '../background/router';
import { registerSiteRegistry } from '../background/site-registry';
import { registerNoticeDelete } from '../background/notice-delete';
import { registerSendSignal } from '../background/send-signal';
import { registerSendTrigger } from '../background/send-trigger';
import { registerSidePanelPorts } from '../background/sidepanel-ports';

export default defineBackground({
  type: 'module',
  main() {
    registerRouter();
    registerG2bFailures();
    registerSidePanelPorts();
    registerCoordinator();
    registerAutoCompose();
    registerComposeRelay();
    registerSendSignal();
    registerSendTrigger();
    registerNaverworksContacts();
    registerDetailReader();
    registerEvalCollector();
    registerResultScheduler();
    registerOrgRelay();
    registerProcessRelay();
    registerDeadlineScheduler();
    registerSiteRegistry();
    registerNoticeDelete();
  },
});
