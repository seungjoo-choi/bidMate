import type { Envelope, MsgType, PayloadOf, Reply, ResponseOf, Target } from './protocol';

export class BusError extends Error {
  constructor(public code: string, message: string, public path?: string) {
    super(message);
    this.name = 'BusError';
  }
}

/** 오류에 code가 있으면 보존해서 Reply로 변환한다. */
export function toErrorReply(e: unknown): Reply<never> {
  const code = (e as { code?: unknown })?.code;
  // CONFIG_CORRUPT 등은 어느 파일인지(path)를 화면까지 넘겨야 복구 대상을 고를 수 있다.
  const path = (e as { path?: unknown })?.path;
  return {
    ok: false,
    error: { code: typeof code === 'string' ? code : 'INTERNAL', message: e instanceof Error ? e.message : String(e), ...(typeof path === 'string' && path ? { path } : {}) },
  };
}

/** 요청/응답 전송. 기본 대상은 SW, 타임아웃 기본 15s. */
export async function send<T extends MsgType>(
  type: T,
  payload: PayloadOf<T>,
  opts: { target?: Target; timeoutMs?: number } = {},
): Promise<ResponseOf<T>> {
  const env: Envelope = {
    id: crypto.randomUUID(), type, payload, ts: Date.now(), target: opts.target ?? 'sw',
  };
  const timeoutMs = opts.timeoutMs ?? 15_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new BusError('TIMEOUT', `${type} 응답 시간 초과`)), timeoutMs);
  });
  try {
    const reply = (await Promise.race([chrome.runtime.sendMessage(env), timeout])) as Reply<ResponseOf<T>> | undefined;
    if (!reply) throw new BusError('NO_RECEIVER', `${type} 수신자 없음`);
    if (!reply.ok) throw new BusError(reply.error.code, reply.error.message, reply.error.path);
    return reply.data;
  } finally {
    clearTimeout(timer);
  }
}

/** 탭의 content script로 요청을 보낸다(popup/SW to CS). frameId를 주면 그 프레임으로만 보낸다. */
export async function sendToTab<T extends MsgType>(
  tabId: number,
  type: T,
  payload: PayloadOf<T>,
  opts: { frameId?: number; timeoutMs?: number } = {},
): Promise<ResponseOf<T>> {
  const env: Envelope = { id: crypto.randomUUID(), type, payload, ts: Date.now(), target: 'content' };
  const call = (opts.frameId === undefined
    ? chrome.tabs.sendMessage(tabId, env)
    : chrome.tabs.sendMessage(tabId, env, { frameId: opts.frameId })) as Promise<Reply<ResponseOf<T>> | undefined>;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const reply = opts.timeoutMs === undefined
    ? await call
    : await Promise.race([
      call,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new BusError('TIMEOUT', `${type} 응답 시간 초과`)), opts.timeoutMs); }),
    ]).finally(() => clearTimeout(timer));
  if (!reply) throw new BusError('NO_RECEIVER', `${type} 수신자 없음`);
  if (!reply.ok) throw new BusError(reply.error.code, reply.error.message, reply.error.path);
  return reply.data;
}

/** 자기 target 메시지만 처리한다. 항상 true를 반환하고 비동기로 응답한다. */
/** offscreen 대상 메시지의 정상 발신자는 SW뿐이다: 같은 확장이고 탭(콘텐츠 스크립트, 대시보드 탭) 발신이 아니어야 한다. runtimeId를 알 수 없으면 거부한다. */
export function isOffscreenAllowedSender(
  sender: Pick<chrome.runtime.MessageSender, 'id' | 'tab'>,
  runtimeId: string | undefined = globalThis.chrome?.runtime?.id,
): boolean {
  return !!runtimeId && sender.id === runtimeId && !sender.tab;
}

export function listen<T extends MsgType>(
  type: T,
  handler: (payload: PayloadOf<T>, sender: chrome.runtime.MessageSender) => Promise<ResponseOf<T>> | ResponseOf<T>,
  target: Target = 'sw',
): () => void {
  const fn = (msg: unknown, sender: chrome.runtime.MessageSender, sendResponse: (r: Reply<unknown>) => void) => {
    const env = msg as Partial<Envelope> | undefined;
    if (!env || env.type !== type || env.target !== target) return false;
    // offscreen 핸들러는 SW를 거치지 않은 직접 발신(나라장터 탭 등)을 거부한다. 확장 페이지 정책 검사는 SW 릴레이가 담당한다.
    if (target === 'offscreen' && !isOffscreenAllowedSender(sender)) {
      sendResponse({ ok: false, error: { code: 'SENDER_FORBIDDEN', message: '허용되지 않은 발신자입니다.' } });
      return true;
    }
    // 핸들러를 동기로 시작한다(첫 await 전까지). sidePanel.open처럼 사용자 제스처가 살아 있어야 하는 호출이 있다.
    new Promise<ResponseOf<T>>((resolve) => resolve(handler(env.payload as PayloadOf<T>, sender)))
      .then((data) => sendResponse({ ok: true, data }))
      .catch((e) => sendResponse(toErrorReply(e)));
    return true;
  };
  chrome.runtime.onMessage.addListener(fn);
  return () => chrome.runtime.onMessage.removeListener(fn);
}
