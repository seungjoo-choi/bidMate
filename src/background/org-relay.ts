import type { OrgProbeParams, OrgProbeResult } from '../adapters/g2b/org-api';
import { redactKey } from '../adapters/g2b/openapi';
import { BusError, listen, send } from '../messaging/bus';
import type { MsgType, PayloadOf, ResponseOf } from '../messaging/protocol';
import { assertExtensionSender } from './job-coordinator';
import { ensureOffscreen } from './offscreen-manager';

const PROBE_WAIT_MS = 60_000;
const ORG_CODE_RE = /^[A-Za-z0-9]{3,20}$/;
const KINDS = new Set(['Servc', 'Thng', 'Cnstwk', 'Frgcpt']);
const DATE_RE = /^\d{12}$/;
const OP_RE = /^[A-Za-z0-9{}]{1,80}$/;

export interface OrgRelayDeps {
  getKey: () => Promise<string | undefined>;
  /** offscreen 문서를 보장한 뒤 요청을 보낸다. */
  toOffscreen: <T extends MsgType>(type: T, payload: PayloadOf<T>, timeoutMs: number) => Promise<ResponseOf<T>>;
}

let injected: Partial<OrgRelayDeps> = {};

async function defaultToOffscreen<T extends MsgType>(type: T, payload: PayloadOf<T>, timeoutMs: number): Promise<ResponseOf<T>> {
  await ensureOffscreen();
  return send(type, payload, { target: 'offscreen', timeoutMs });
}

async function defaultGetKey(): Promise<string | undefined> {
  const { secrets } = await chrome.storage.local.get('secrets');
  return (secrets as { g2bServiceKey?: string } | undefined)?.g2bServiceKey;
}

function deps(): OrgRelayDeps {
  return { getKey: injected.getKey ?? defaultGetKey, toOffscreen: injected.toOffscreen ?? defaultToOffscreen };
}

// offscreen 호출은 동시에 1개만 허용한다.
let probing = false;

function validate(p: OrgProbeParams): OrgProbeParams {
  if (!p || typeof p.orgCode !== 'string' || !ORG_CODE_RE.test(p.orgCode.trim())) throw new BusError('ORG_BAD_REF', '기관코드 형식이 올바르지 않습니다.');
  if (!KINDS.has(p.kind)) throw new BusError('ORG_BAD_REF', '업무 구분이 올바르지 않습니다.');
  if (!DATE_RE.test(String(p.from)) || !DATE_RE.test(String(p.to))) throw new BusError('ORG_BAD_REF', '기간은 YYYYMMDDHHMM 12자리여야 합니다.');
  if (p.from > p.to) throw new BusError('ORG_BAD_REF', '시작 시각이 종료 시각보다 늦습니다.');
  for (const op of [p.noticeOp, p.awardOp]) {
    if (op !== undefined && op !== '' && !OP_RE.test(op)) throw new BusError('ORG_BAD_REF', '오퍼레이션 이름 형식이 올바르지 않습니다.');
  }
  return { orgCode: p.orgCode.trim(), kind: p.kind, from: p.from, to: p.to, ...(p.noticeOp ? { noticeOp: p.noticeOp } : {}), ...(p.awardOp ? { awardOp: p.awardOp } : {}) };
}

export async function probe(raw: OrgProbeParams): Promise<OrgProbeResult> {
  const d = deps();
  const p = validate(raw);
  const serviceKey = await d.getKey();
  if (!serviceKey) throw new BusError('G2B_KEY_MISSING', '나라장터 서비스키가 설정되지 않았습니다.');
  if (probing) throw new BusError('BUSY', '다른 기관 시험이 진행 중입니다.');
  probing = true;
  try {
    return await d.toOffscreen('org/probe-run', { ...p, serviceKey }, PROBE_WAIT_MS);
  } catch (e) {
    const code = (e as { code?: unknown })?.code;
    throw new BusError(typeof code === 'string' ? code : 'INTERNAL', redactKey(e instanceof Error ? e.message : String(e), serviceKey));
  } finally {
    probing = false;
  }
}

/** 리스너는 최상위에서 동기로 등록한다. */
export function registerOrgRelay(d: Partial<OrgRelayDeps> = {}): void {
  injected = d;
  listen('org/probe', (p, sender) => { assertExtensionSender(sender); return probe(p); }, 'sw');
}
