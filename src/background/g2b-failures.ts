import { redactKey } from '../adapters/g2b/openapi';
import {
  G2B_FAILURES_KEY, appendFailures, failuresFromJob, normalizeFailure,
  type G2bFailureFile, type G2bFailureInput,
} from '../core/diagnostics/g2b-failure';
import { BusError, listen } from '../messaging/bus';
import { addFinalListener, assertExtensionSender, isOffscreenSender } from './job-coordinator';

// 나라장터 연동 최종 실패 기록. 저장은 이 모듈만 한다(g2bFailures 키). 어떤 경우에도 reject·throw 하지 않는다.
export interface G2bFailuresDeps {
  storage: { get(key: string): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> };
  now?: () => Date; newId?: () => string; readServiceKey?: () => Promise<string | undefined>;
}

let injected: Partial<G2bFailuresDeps> = {};
export function setG2bFailuresDeps(d: Partial<G2bFailuresDeps>): void {
  injected = d;
}

const defaultStorage = (): G2bFailuresDeps['storage'] | undefined => {
  const local = globalThis.chrome?.storage?.local;
  return local ? (local as unknown as G2bFailuresDeps['storage']) : undefined;
};
const defaultKey = async (): Promise<string | undefined> => {
  const local = globalThis.chrome?.storage?.local;
  if (!local) return undefined;
  const r = await local.get('secrets');
  return (r?.secrets as { g2bServiceKey?: string } | undefined)?.g2bServiceKey;
};
const defaultId = (): string => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

// 쓰기 직렬화(read-modify-write 경쟁 방지).
let chain: Promise<unknown> = Promise.resolve();
function serial(fn: () => Promise<void>): Promise<void> {
  const run = chain.catch(() => undefined).then(fn);
  chain = run;
  return run.catch(() => undefined);
}

export function recordG2bFailure(input: G2bFailureInput | G2bFailureInput[]): Promise<void> {
  return serial(async () => {
    const storage = injected.storage ?? defaultStorage();
    if (!storage) return;
    let key: string | undefined;
    try { key = await (injected.readServiceKey ?? defaultKey)(); } catch { /* 키를 못 읽어도 기록은 계속한다 */ }
    const list = Array.isArray(input) ? input : [input];
    const inputs = list
      .map((raw) => normalizeFailure(raw, (s) => redactKey(s, key)))
      .filter((x): x is G2bFailureInput => x !== null);
    if (inputs.length === 0) return;
    const got = await storage.get(G2B_FAILURES_KEY);
    const next = appendFailures(got?.[G2B_FAILURES_KEY] as G2bFailureFile | undefined, inputs, (injected.now ?? (() => new Date()))(), injected.newId ?? defaultId);
    await storage.set({ [G2B_FAILURES_KEY]: next });
  });
}

export function clearG2bFailures(): Promise<void> {
  return serial(async () => {
    const storage = injected.storage ?? defaultStorage();
    if (!storage) return;
    await storage.set({ [G2B_FAILURES_KEY]: { v: 1, items: [] } satisfies G2bFailureFile });
  });
}

export function registerG2bFailures(): void {
  listen('diag/g2b-failure', (p, sender) => {
    if (!isOffscreenSender(sender)) throw new BusError('SENDER_FORBIDDEN', '허용되지 않은 발신자입니다.');
    const list = Array.isArray(p?.failures) ? p.failures.slice(0, 50) : [];
    void recordG2bFailure(list); // 기록 완료를 기다리지 않고 즉시 응답한다
  }, 'sw');
  listen('diag/g2b-failures-clear', (_, sender) => {
    assertExtensionSender(sender);
    return clearG2bFailures();
  }, 'sw');
  addFinalListener((job) => { void recordG2bFailure(failuresFromJob(job)); });
}
