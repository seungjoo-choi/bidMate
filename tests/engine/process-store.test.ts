import { describe, expect, it, vi } from 'vitest';
import { samplePrespecNotice, sampleNotice } from '../../src/core/templates/sample-notice';
import type { G2bFailureInput } from '../../src/core/diagnostics/g2b-failure';
import type { ProcessFile } from '../../src/core/types/process';
import { getProcess, processPath } from '../../src/engine/process/process-store';
import { NoticeStore } from '../../src/engine/notices/notice-store';
import { MemoryStore } from '../helpers/memory-store';

const FOLDER = 'notices/2026/R1-000_가';
const NOW = new Date('2026-11-09T12:00:00.000Z');
const ago = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();
const row = (no: string, contracts = '') => ({ bidNtceNo: no, bidNtceOrd: '000', bidNtceNm: '공고', cntrctInfoList: contracts });
const ok = (list: unknown[]) => ({ status: 200, text: async () => JSON.stringify({ response: { header: { resultCode: '00', resultMsg: 'OK' }, body: { items: list } } }) }) as Response;
const mkFetch = (list: (u: string) => unknown[]) => vi.fn(async (u: string) => ok(list(u))) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
const CONTRACT = '[1^C1^계약명^기관^수요^방법^1,000^2026-10-01]';

async function setup() {
  const mem = new MemoryStore();
  const n = sampleNotice();
  n.id = 'R1-000'; n.folder = FOLDER;
  await new NoticeStore(mem).saveNotice(n);
  return { mem, no: n.ref.noticeNo };
}
const cachedFile = (no: string, fetchedAt: string, contracts = ''): ProcessFile => ({
  schemaVersion: 1, noticeId: 'R1-000', queryNoticeNo: no, op: 'getCntrctProcssIntgOpenServc', fetchedAt,
  process: { orderPlan: null, prespec: null, procurementMethod: null, contractMethod: null, rounds: [{ noticeNo: no, round: '000', title: null, postedAt: null, demandOrg: null, bidMethod: null, winners: [], contracts: contracts ? [{ seq: 1, contractNo: 'C1', name: 'n', contractOrg: null, demandOrg: null, method: null, amount: null, contractedAt: null }] : [] }] },
});
const put = (mem: MemoryStore, f: ProcessFile) => mem.writeText(processPath(FOLDER), JSON.stringify(f));
const deps = (f: typeof fetch, extra: { isBusy?: (id: string) => boolean; onFailure?: (x: G2bFailureInput) => void } = {}) => ({ fetch: f, now: () => NOW, isBusy: extra.isBusy ?? (() => false), ...(extra.onFailure ? { onFailure: extra.onFailure } : {}) });
const P = { noticeId: 'R1-000', serviceKey: 'K' };

describe('process-store', () => {
  it('캐시 없음 -> 호출하고 파일 저장, fromCache false', async () => {
    const { mem, no } = await setup();
    const f = mkFetch(() => [row(no)]);
    const r = await getProcess(mem, P, deps(f));
    expect(r).toMatchObject({ fromCache: false, file: { noticeId: 'R1-000', queryNoticeNo: no } });
    expect(r.error).toBeUndefined();
    expect(mem.files.has(processPath(FOLDER))).toBe(true);
  });

  it('마지막 차수에 계약이 있으면 30일 전 캐시도 호출 0회', async () => {
    const { mem, no } = await setup();
    await put(mem, cachedFile(no, ago(24 * 30), 'x'));
    const f = mkFetch(() => [row(no)]);
    const r = await getProcess(mem, P, deps(f));
    expect(r.fromCache).toBe(true);
    expect(f).not.toHaveBeenCalled();
  });

  it('계약 없음 + 1시간 전 -> 호출 0회', async () => {
    const { mem, no } = await setup();
    await put(mem, cachedFile(no, ago(1)));
    const f = mkFetch(() => [row(no)]);
    expect((await getProcess(mem, P, deps(f))).fromCache).toBe(true);
    expect(f).not.toHaveBeenCalled();
  });

  it('계약 없음 + 13시간 전 -> 호출하고 덮어씀', async () => {
    const { mem, no } = await setup();
    await put(mem, cachedFile(no, ago(13)));
    const f = mkFetch(() => [row(no, CONTRACT)]);
    const r = await getProcess(mem, P, deps(f));
    expect(r.fromCache).toBe(false);
    expect(f).toHaveBeenCalled();
    expect(JSON.parse(mem.files.get(processPath(FOLDER)) as string).fetchedAt).toBe(r.file?.fetchedAt);
    expect(r.file?.fetchedAt).not.toBe(ago(13));
  });

  it('force면 TTL을 무시하고 호출한다', async () => {
    const { mem, no } = await setup();
    await put(mem, cachedFile(no, ago(1), 'x'));
    const f = mkFetch(() => [row(no)]);
    const r = await getProcess(mem, { ...P, force: true }, deps(f));
    expect(r.fromCache).toBe(false);
    expect(f).toHaveBeenCalled();
  });

  it("키 '' + 캐시 있음 -> 캐시와 G2B_KEY_MISSING, 호출 0회", async () => {
    const { mem, no } = await setup();
    await put(mem, cachedFile(no, ago(13)));
    const f = mkFetch(() => [row(no)]);
    const r = await getProcess(mem, { ...P, serviceKey: '' }, deps(f));
    expect(r).toMatchObject({ fromCache: true, error: { code: 'G2B_KEY_MISSING' } });
    expect(r.file).not.toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it('fetch 실패 + 캐시 있음 -> 캐시와 error, onFailure 1회', async () => {
    const { mem, no } = await setup();
    await put(mem, cachedFile(no, ago(13)));
    const f = vi.fn(async () => { throw new Error('net'); }) as unknown as typeof fetch;
    const onFailure = vi.fn();
    const r = await getProcess(mem, P, deps(f, { onFailure }));
    expect(r.fromCache).toBe(true);
    expect(r.file).not.toBeNull();
    expect(r.error?.code).toBeTruthy();
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure.mock.calls[0]![0]).toMatchObject({ flow: 'process', stage: 'fetch', noticeNo: no });
  });

  it('손상 파일은 없음으로 보고 재조회한다', async () => {
    const { mem, no } = await setup();
    await mem.writeText(processPath(FOLDER), '{broken');
    const f = mkFetch(() => [row(no)]);
    const r = await getProcess(mem, P, deps(f));
    expect(r.fromCache).toBe(false);
    expect(f).toHaveBeenCalled();
  });

  it('isBusy true면 결과는 반환하지만 파일은 저장하지 않는다', async () => {
    const { mem, no } = await setup();
    const f = mkFetch(() => [row(no)]);
    const r = await getProcess(mem, P, deps(f, { isBusy: () => true }));
    expect(r.file).not.toBeNull();
    expect(mem.files.has(processPath(FOLDER))).toBe(false);
  });

  it('없는 noticeId -> NOT_FOUND, throw 없음', async () => {
    const { mem } = await setup();
    const f = mkFetch(() => []);
    expect(await getProcess(mem, { ...P, noticeId: 'NOPE' }, deps(f))).toMatchObject({ file: null, fromCache: false, error: { code: 'NOT_FOUND' } });
  });

  it('사전규격 + relatedBidNo 없음 -> file null, error 없음, 호출 0회', async () => {
    const mem = new MemoryStore();
    const n = samplePrespecNotice();
    await new NoticeStore(mem).saveNotice(n);
    const f = mkFetch(() => []);
    const r = await getProcess(mem, { ...P, noticeId: n.id }, deps(f));
    expect(r).toEqual({ file: null, fromCache: false });
    expect(f).not.toHaveBeenCalled();
  });

  it('사전규격 + relatedBidNo 있음 -> 그 번호로 조회한다', async () => {
    const mem = new MemoryStore();
    const n = samplePrespecNotice();
    n.prespec.relatedBidNo.value = 'R26BK99999999';
    await new NoticeStore(mem).saveNotice(n);
    const f = mkFetch(() => [row('R26BK99999999')]);
    const r = await getProcess(mem, { ...P, noticeId: n.id }, deps(f));
    expect(r.file?.queryNoticeNo).toBe('R26BK99999999');
    expect(f).toHaveBeenCalled();
  });
});
