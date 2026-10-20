import { defineBackground } from 'wxt/utils/define-background';
import { registerAutoCompose } from '../background/auto-compose';
import { registerComposeRelay } from '../background/compose-relay';
import { registerNaverworksContacts } from '../background/naverworks-contacts';
import { registerEvalCollector } from '../background/eval-collector';
import { registerDeadlineScheduler } from '../background/deadline-scheduler';
import { registerResultScheduler } from '../background/result-scheduler';
import { registerDetailReader } from '../background/detail-reader';
import { registerCoordinator } from '../background/job-coordinator';
import { registerRouter } from '../background/router';
import { registerSiteRegistry } from '../background/site-registry';
import { registerSendSignal } from '../background/send-signal';
import { registerSidePanelPorts } from '../background/sidepanel-ports';

export default defineBackground({
  type: 'module',
  main() {
    registerRouter();
    registerSidePanelPorts();
    registerCoordinator();
    registerAutoCompose();
    registerComposeRelay();
    registerSendSignal();
    registerNaverworksContacts();
    registerDetailReader();
    registerEvalCollector();
    registerResultScheduler();
    registerDeadlineScheduler();
    registerSiteRegistry();
  },
});
