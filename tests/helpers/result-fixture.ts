import type { IndexEntry } from '../../src/core/types/index-file';
import { MemoryStore } from './memory-store';

export const OURS = '1234567890';
export const NOW = new Date('2026-10-20T12:00:00+09:00');

export interface Seed { id: string; openingAt?: string | null; bidCloseAt?: string | null; proposalEvalAt?: string | null; kind?: 'bid' | 'prespec'; noNotice?: boolean }

/** index.json과 notice.json(일정만)을 채운 메모리 저장소. */
export function seedStore(seeds: Seed[]): MemoryStore {
  const store = new MemoryStore();
  const notices = seeds.map((s) => ({
    ...(s.kind === 'prespec' ? { kind: 'prespec' } : {}),
    noticeId: s.id, noticeNo: s.id.slice(0, 13), round: s.id.slice(14), title: `제목 ${s.id}`, orderingOrg: '', folder: `notices/${s.id}`,
    collectedAt: '', collectStatus: 'ok', attachments: { total: 0, saved: 0, failed: 0 }, extractionStatus: 'not_run', mailStatus: 'none', isCorrection: false,
  }) as unknown as IndexEntry);
  store.files.set('index.json', JSON.stringify({ schemaVersion: 1, indexVersion: 2, generatedAt: '', notices }));
  for (const s of seeds) {
    if (s.noNotice) continue;
    const f = (v: string | null | undefined) => ({ value: v ?? null });
    store.files.set(`notices/${s.id}/notice.json`, JSON.stringify({ schedule: { openingAt: f(s.openingAt), bidCloseAt: f(s.bidCloseAt), proposalEvalAt: f(s.proposalEvalAt) } }));
  }
  return store;
}

const ok = (items: unknown[]) => ({ status: 200, text: async () => JSON.stringify({ response: { header: { resultCode: '00', resultMsg: 'OK' }, body: { items } } }) }) as Response;

/** URL에서 op/bidNtceNo를 보고 응답하는 fake fetch. calls에 호출 URL이 쌓인다. */
export function fakeG2b(handler: (op: string, noticeNo: string) => unknown[] | 'KEY_INVALID' | Error): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const f = (async (u: string) => {
    calls.push(u);
    const url = new URL(u);
    const op = url.pathname.split('/').pop()!;
    const r = handler(op, url.searchParams.get('bidNtceNo') ?? '');
    if (r instanceof Error) throw r;
    if (r === 'KEY_INVALID') return { status: 200, text: async () => JSON.stringify({ OpenAPI_ServiceResponse: { cmmMsgHeader: { errMsg: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR' } } }) } as Response;
    return ok(r);
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}
