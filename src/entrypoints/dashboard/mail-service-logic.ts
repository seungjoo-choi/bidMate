import { inboxHost, composeHost, originOf } from '../../core/model/mail-provider';
import type { Settings } from '../../core/types/settings';

/** 저장 시 요청할 호스트 권한. 작성과 수신 서비스의 호스트를 중복 없이 모은다. */
export function originsToRequest(s: Settings): string[] {
  return [...new Set([originOf(composeHost(s)), originOf(inboxHost(s))])];
}
