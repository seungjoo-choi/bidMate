import { redactKey } from '../adapters/g2b/openapi';
import { BusError, listen, send } from '../messaging/bus';
import type { MsgType, PayloadOf, ResponseOf } from '../messaging/protocol';
import { assertExtensionSender } from './job-coordinator';
import { ensureOffscreen } from './offscreen-manager';

// op당 15초(fetchJsonOp) x 최대 4개 순차 호출 + 여유. 대시보드 대기(ProcessCard)는 이보다 길어야 원인 메시지가 전달된다.
const FETCH_WAIT_MS = 65_000;

export interface ProcessRelayDeps {
  getKey: () => Promise<string | undefined>;
  /** offscreen 문서를 보장한 뒤 요청을 보낸다. */
  toOffscreen: <T extends MsgType>(type: T, payload: PayloadOf<T>, timeoutMs: number) => Promise<ResponseOf<T>>;
}

let injected: Partial<ProcessRelayDeps> = {};

async function defaultToOffscreen<T extends MsgType>(type: T, payload: PayloadOf<T>, timeoutMs: number): Promise<ResponseOf<T>> {
  await ensureOffscreen();
  return send(type, payload, { target: 'offscreen', timeoutMs });
}

async function defaultGetKey(): Promise<string | undefined> {
  const { secrets } = await chrome.storage.local.get('secrets');
  return (secrets as { g2bServiceKey?: string } | undefined)?.g2bServiceKey;
}

function deps(): ProcessRelayDeps {
  return { getKey: injected.getKey ?? defaultGetKey, toOffscreen: injected.toOffscreen ?? defaultToOffscreen };
}

export async function getProcessRelay(p: { noticeId: string; force?: boolean }): Promise<ResponseOf<'process/get'>> {
  const d = deps();
  // 키가 없어도 캐시 반환을 위해 offscreen까지 보낸다.
  const serviceKey = (await d.getKey()) ?? '';
  try {
    return await d.toOffscreen('process/fetch', { ...p, serviceKey }, FETCH_WAIT_MS);
  } catch (e) {
    const code = (e as { code?: unknown })?.code;
    throw new BusError(typeof code === 'string' ? code : 'INTERNAL', redactKey(e instanceof Error ? e.message : String(e), serviceKey));
  }
}

/** 리스너는 최상위에서 동기로 등록한다. */
export function registerProcessRelay(d: Partial<ProcessRelayDeps> = {}): void {
  injected = d;
  listen('process/get', (p, sender) => { assertExtensionSender(sender); return getProcessRelay(p); }, 'sw');
}
