import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/messaging/bus', async (orig) => ({ ...(await orig<typeof import('../../src/messaging/bus')>()), listen: vi.fn() }));
vi.mock('../../src/background/job-coordinator', async (orig) => ({ ...(await orig<typeof import('../../src/background/job-coordinator')>()), addFinalListener: vi.fn() }));

import { clearG2bFailures, recordG2bFailure, registerG2bFailures, setG2bFailuresDeps } from '../../src/background/g2b-failures';
import { addFinalListener } from '../../src/background/job-coordinator';
import { listen } from '../../src/messaging/bus';

const RID = 'abcdefghijklmnop';
const input = { flow: 'eval' as const, stage: 'fetch', code: 'EVAL_API_ERROR', message: '[단계 1] HTTP 422', noticeNo: '20240101234', round: '00' };

function makeStorage(initial: Record<string, unknown> = {}) {
  const data = { ...initial };
  const get = vi.fn(async (k: string) => ({ [k]: data[k] }));
  const set = vi.fn(async (items: Record<string, unknown>) => { Object.assign(data, items); });
  return { data, get, set };
}
type H = (payload: unknown, sender: unknown) => unknown;
const handlerOf = (type: string): H => {
  const call = vi.mocked(listen).mock.calls.find((c) => c[0] === type && c[2] === 'sw');
  if (!call) throw new Error(`핸들러 없음: ${type}`);
  return call[1] as unknown as H;
};
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('g2b 실패 기록', () => {
  let st: ReturnType<typeof makeStorage>;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    st = makeStorage();
    setG2bFailuresDeps({
      storage: st, now: () => new Date('2026-10-22T00:00:00Z'), newId: () => 'id1', readServiceKey: async () => undefined,
    });
  });

  it('record는 set을 1회 호출하고 items[0] 형태를 만든다', async () => {
    await recordG2bFailure(input);
    expect(st.set).toHaveBeenCalledTimes(1);
    const file = st.data.g2bFailures as { v: number; items: Array<Record<string, unknown>> };
    expect(file.v).toBe(1);
    expect(file.items[0]).toMatchObject({ id: 'id1', flow: 'eval', code: 'EVAL_API_ERROR', count: 1, noticeNo: '20240101234' });
  });

  it('연속 record는 직렬로 처리되어 합산된다', async () => {
    await Promise.all([recordG2bFailure(input), recordG2bFailure(input), recordG2bFailure(input)]);
    const file = st.data.g2bFailures as { items: Array<{ count: number }> };
    expect(file.items).toHaveLength(1);
    expect(file.items[0]!.count).toBe(3);
  });

  it('제외 코드만 있으면 쓰기를 생략한다', async () => {
    await recordG2bFailure({ ...input, code: 'EVAL_CANCELLED' });
    expect(st.set).not.toHaveBeenCalled();
  });

  it('storage.get이 throw해도 resolve하고 이후 기록은 정상이다', async () => {
    st.get.mockRejectedValueOnce(new Error('boom'));
    await expect(recordG2bFailure(input)).resolves.toBeUndefined();
    await recordG2bFailure(input);
    expect((st.data.g2bFailures as { items: unknown[] }).items).toHaveLength(1);
  });

  it('chrome이 정의되지 않아도 resolve한다', async () => {
    setG2bFailuresDeps({});
    vi.stubGlobal('chrome', undefined);
    await expect(recordG2bFailure(input)).resolves.toBeUndefined();
    await expect(clearG2bFailures()).resolves.toBeUndefined();
  });

  describe('리스너', () => {
    const offscreen = { id: RID, url: `chrome-extension://${RID}/offscreen.html` };
    const dashboard = { id: RID, url: `chrome-extension://${RID}/dashboard.html` };
    const g2bTab = { id: RID, url: 'https://www.g2b.go.kr/', tab: { id: 1 } };
    beforeEach(() => {
      vi.stubGlobal('chrome', { runtime: { id: RID } });
      registerG2bFailures();
    });

    it('diag/g2b-failure: offscreen 발신은 기록하고 즉시 응답한다', async () => {
      expect(handlerOf('diag/g2b-failure')({ failures: [input] }, offscreen)).toBeUndefined();
      await flush();
      expect((st.data.g2bFailures as { items: unknown[] }).items).toHaveLength(1);
    });

    it('diag/g2b-failure: 대시보드 발신은 SENDER_FORBIDDEN', () => {
      expect(() => handlerOf('diag/g2b-failure')({ failures: [input] }, dashboard)).toThrowError(expect.objectContaining({ code: 'SENDER_FORBIDDEN' }));
      expect(st.set).not.toHaveBeenCalled();
    });

    it('diag/g2b-failure: 51건이면 50건만 기록한다', async () => {
      const failures = Array.from({ length: 51 }, (_, i) => ({ ...input, noticeNo: `N${i}` }));
      handlerOf('diag/g2b-failure')({ failures }, offscreen);
      await flush();
      expect((st.data.g2bFailures as { items: unknown[] }).items).toHaveLength(50);
    });

    it('clear: 확장 페이지는 빈 파일을 set한다', async () => {
      await recordG2bFailure(input);
      await handlerOf('diag/g2b-failures-clear')(undefined, dashboard);
      expect(st.data.g2bFailures).toEqual({ v: 1, items: [] });
    });

    it('clear: g2b 탭 발신은 거부한다', () => {
      expect(() => handlerOf('diag/g2b-failures-clear')(undefined, g2bTab)).toThrowError(expect.objectContaining({ code: 'SENDER_FORBIDDEN' }));
      expect(st.set).not.toHaveBeenCalled();
    });

    it('final listener: 실패한 collect 잡을 기록한다', async () => {
      const fn = vi.mocked(addFinalListener).mock.calls[0]![0];
      fn({
        id: 'job1', type: 'collect', status: 'failed', ref: { noticeNo: '20240101234', round: '00' }, noticeId: 'n1',
        errors: [{ step: 'fetch_basic', code: 'G2B_NOT_FOUND', message: '없음' }],
      } as never);
      await flush();
      const items = (st.data.g2bFailures as { items: Array<Record<string, unknown>> }).items;
      expect(items[0]).toMatchObject({ flow: 'collect', stage: 'fetch_basic', code: 'G2B_NOT_FOUND', jobId: 'job1' });
    });
  });
});
