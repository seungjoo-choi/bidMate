import { defineBackground } from 'wxt/utils/define-background';
import { registerAutoCompose } from '../background/auto-compose';
import { registerComposeRelay } from '../background/compose-relay';
import { registerNaverworksContacts } from '../background/naverworks-contacts';
import { registerDetailReader } from '../background/detail-reader';
import { registerCoordinator } from '../background/job-coordinator';
import { registerRouter } from '../background/router';
import { registerSiteRegistry } from '../background/site-registry';

export default defineBackground({
  type: 'module',
  main() {
    registerRouter();
    registerCoordinator();
    registerAutoCompose();
    registerComposeRelay();
    registerNaverworksContacts();
    registerDetailReader();
    registerSiteRegistry();
  },
});
