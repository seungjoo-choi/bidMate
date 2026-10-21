import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/messaging/bus', async (orig) => ({ ...(await orig<typeof import('../../src/messaging/bus')>()), listen: vi.fn() }));

import { fetchEvalViaTab, registerEvalCollector, setEvalCollectorDeps } from '../../src/background/eval-collector';
import { BusError, listen } from '../../src/messaging/bus';

const RUNTIME = 'ext-id';
const EXT = { id: RUNTIME, url: `chrome-extension://${RUNTIME}/dashboard.html` };
const G2B = { id: RUNTIME, url: 'https://www.g2b.go.kr/index.do', tab: { id: 5 } } as chrome.runtime.MessageSender;
const MAIL = { url: 'https://mail.example.com/', tab: { id: 6 } } as chrome.runtime.MessageSender;
const RAW = { capturedAt: 't', open: { evlNo: 'E', epropoEvalYn: null, isNego: true }, base: null, targets: [{}, {}], members: [{}], items: [{ evstNo: 'S1' }, { evstNo: 'S1' }, { evstNo: 'S2' }], scores: [{}, {}, {}, {}] };
const REF = { noticeNo: 'R26BK00000001', round: '000' };

const codeOf = async (p: Promise<unknown>): Promise<unknown> => { try { await p; return 'resolved'; } catch (e) { return (e as { code?: unknown }).code; } };

type H = (payload: unknown, sender: unknown) => Promise<any>;
const handler = (type: string): H => {
  const call = vi.mocked(listen).mock.calls.find((c) => c[0] === type && c[2] === 'sw');
  if (!call) throw new Error('핸들러 없음');
  const fn = call[1] as unknown as H;
  return async (payload, sender) => fn(payload, sender); // 동기 throw도 거부로 바꾼다
};

function setup(o: { existing?: Array<{ id: number }>; send?: (n: number) => unknown } = {}) {
  let clock = 0;
  const tabs = {
    query: vi.fn().mockResolvedValue(o.existing ?? []),
    create: vi.fn().mockResolvedValue({ id: 9 }),
    update: vi.fn().mockResolvedValue({}),
    remove: vi.fn().mockResolvedValue(undefined),
    reload: vi.fn().mockResolvedValue(undefined),
  };
  let n = 0;
  const sendToTab = vi.fn(async (..._a: unknown[]) => {
    const r = o.send ? o.send(n++) : { raw: RAW, warnings: [] };
    if (r instanceof Error) throw r;
    return r;
  });
  const waitComplete = vi.fn().mockResolvedValue(true);
  const sleep = vi.fn(async (ms: number) => { clock += ms; });
  const entry = { noticeId: 'R26BK00000001-000', hasOfficial: true };
  const toOffscreen = vi.fn(async (..._a: unknown[]) => ({ noticeId: entry.noticeId, entry, warnings: ['저장 경고'] }));
  const readServiceKey = vi.fn(async () => 'KEY');
  setEvalCollectorDeps({ tabs: tabs as never, sendToTab: sendToTab as never, waitComplete, sleep, now: () => clock, toOffscreen: toOffscreen as never, readServiceKey });
  return { tabs, sendToTab, waitComplete, sleep, toOffscreen, readServiceKey };
}

describe('eval-collector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('chrome', { runtime: { id: RUNTIME } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('g2b 발신자는 그 탭을 쓰고 닫지 않는다', async () => {
    const m = setup();
    await fetchEvalViaTab(G2B, REF);
    expect(m.sendToTab.mock.calls[0]![0]).toBe(5);
    expect(m.tabs.query).not.toHaveBeenCalled();
    expect(m.tabs.create).not.toHaveBeenCalled();
    expect(m.tabs.remove).not.toHaveBeenCalled();
  });

  it('확장 발신자는 열린 g2b 탭을 재사용하고 닫지 않는다', async () => {
    const m = setup({ existing: [{ id: 3 }] });
    await fetchEvalViaTab(EXT, REF);
    expect(m.sendToTab.mock.calls[0]![0]).toBe(3);
    expect(m.tabs.create).not.toHaveBeenCalled();
    expect(m.tabs.remove).not.toHaveBeenCalled();
  });

  it('열린 탭이 없으면 비활성 탭을 만들고 로드를 기다린 뒤 끝나면 닫는다', async () => {
    const m = setup();
    await fetchEvalViaTab(EXT, REF);
    expect(m.tabs.create).toHaveBeenCalledWith({ url: 'https://www.g2b.go.kr/', active: false });
    expect(m.waitComplete).toHaveBeenCalledWith(9, expect.any(Number));
    expect(m.sendToTab.mock.calls[0]![0]).toBe(9);
    expect(m.tabs.remove).toHaveBeenCalledWith(9);
  });

  it('NO_RECEIVER면 700ms 간격으로 재시도하고 15초를 넘기면 포기한다', async () => {
    const m = setup({ send: (n) => (n < 2 ? new BusError('NO_RECEIVER', 'x') : { raw: RAW, warnings: [] }) });
    await expect(fetchEvalViaTab(EXT, REF)).resolves.toMatchObject({ raw: RAW });
    expect(m.sendToTab).toHaveBeenCalledTimes(3);
    expect(m.sleep).toHaveBeenCalledWith(700);

    const m2 = setup({ send: () => new BusError('NO_RECEIVER', 'x') });
    expect(await codeOf(fetchEvalViaTab(EXT, REF))).toBe('EVAL_CS_UNREACHABLE');
    expect(m2.sendToTab.mock.calls.length).toBeLessThanOrEqual(23);
    expect(m2.tabs.remove).toHaveBeenCalledWith(9);
  });

  it('열린 탭이 3초간 수신자가 없으면 새로고침해 다시 보내고 탭은 닫지 않는다', async () => {
    let reloaded = false;
    const m = setup({ existing: [{ id: 3 }], send: () => (reloaded ? { raw: RAW, warnings: [] } : new BusError('NO_RECEIVER', 'x')) });
    m.tabs.reload.mockImplementation(async () => { reloaded = true; });
    await expect(fetchEvalViaTab(EXT, REF)).resolves.toMatchObject({ raw: RAW });
    expect(m.tabs.reload).toHaveBeenCalledWith(3);
    expect(m.waitComplete).toHaveBeenCalledWith(3, expect.any(Number));
    expect(m.sendToTab.mock.calls.length).toBeLessThanOrEqual(7); // 3초 재시도분 + 새로고침 뒤 1회
    expect(m.tabs.create).not.toHaveBeenCalled();
    expect(m.tabs.remove).not.toHaveBeenCalled();
  });

  it('새로고침 뒤에도 수신자가 없으면 EVAL_CS_UNREACHABLE', async () => {
    const m = setup({ existing: [{ id: 3 }], send: () => new BusError('NO_RECEIVER', 'x') });
    expect(await codeOf(fetchEvalViaTab(EXT, REF))).toBe('EVAL_CS_UNREACHABLE');
    expect(m.tabs.reload).toHaveBeenCalledWith(3);
    expect(m.tabs.create).not.toHaveBeenCalled();
    expect(m.tabs.remove).not.toHaveBeenCalled();
  });

  it('새로고침이 안 되면 새 탭을 열어 보내고 끝나면 닫는다', async () => {
    const m = setup({ existing: [{ id: 3 }], send: () => new BusError('NO_RECEIVER', 'x') });
    m.tabs.reload.mockRejectedValue(new Error('No tab with id: 3'));
    m.sendToTab.mockImplementation(async (tabId: unknown) => { if (tabId === 9) return { raw: RAW, warnings: [] }; throw new BusError('NO_RECEIVER', 'x'); });
    await expect(fetchEvalViaTab(EXT, REF)).resolves.toMatchObject({ raw: RAW });
    expect(m.tabs.create).toHaveBeenCalledWith({ url: 'https://www.g2b.go.kr/', active: false });
    expect(m.tabs.remove).toHaveBeenCalledWith(9);
    expect(m.tabs.remove).not.toHaveBeenCalledWith(3);
  });

  it('요청한 나라장터 탭 자신은 새로고침하지 않는다', async () => {
    const m = setup({ send: () => new BusError('NO_RECEIVER', 'x') });
    expect(await codeOf(fetchEvalViaTab(G2B, REF))).toBe('EVAL_CS_UNREACHABLE');
    expect(m.tabs.reload).not.toHaveBeenCalled();
    expect(m.tabs.remove).not.toHaveBeenCalled();
  });

  it('로그인 오류면 만든 탭을 닫지 않고 활성화한다', async () => {
    const m = setup({ send: () => new BusError('EVAL_NOT_LOGGED_IN', 'x') });
    expect(await codeOf(fetchEvalViaTab(EXT, REF))).toBe('EVAL_NOT_LOGGED_IN');
    expect(m.tabs.update).toHaveBeenCalledWith(9, { active: true });
    expect(m.tabs.remove).not.toHaveBeenCalled();
  });

  it('동시 1개 FIFO로 처리한다', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const m = setup();
    m.sendToTab.mockImplementation((async (_t: number, _ty: string, p: { noticeNo: string }) => {
      order.push(`start ${p.noticeNo}`);
      if (p.noticeNo === 'R26BK00000001') await gate;
      order.push(`end ${p.noticeNo}`);
      return { raw: RAW, warnings: [] };
    }) as never);
    const a = fetchEvalViaTab(G2B, { noticeNo: 'R26BK00000001', round: '000' });
    const b = fetchEvalViaTab(G2B, { noticeNo: 'R26BK00000002', round: '000' });
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(['start R26BK00000001']);
    release();
    await Promise.all([a, b]);
    expect(order).toEqual(['start R26BK00000001', 'end R26BK00000001', 'start R26BK00000002', 'end R26BK00000002']);
  });

  it('앞 작업이 실패해도 다음 작업이 시작되고 성공한다', async () => {
    setup({ send: (n) => (n === 0 ? new BusError('EVAL_API_ERROR', 'x') : { raw: RAW, warnings: [] }) });
    const a = fetchEvalViaTab(G2B, REF);
    const b = fetchEvalViaTab(G2B, { noticeNo: 'R26BK00000002', round: '000' });
    expect(await codeOf(a)).toBe('EVAL_API_ERROR');
    await expect(b).resolves.toMatchObject({ raw: RAW });
  });

  it('만든 탭이 로딩 타임아웃이면 닫고 EVAL_TAB_TIMEOUT', async () => {
    const m = setup();
    m.waitComplete.mockResolvedValue(false);
    expect(await codeOf(fetchEvalViaTab(EXT, REF))).toBe('EVAL_TAB_TIMEOUT');
    expect(m.tabs.remove).toHaveBeenCalledWith(9);
    expect(m.sendToTab).not.toHaveBeenCalled();
  });

  describe('핸들러', () => {
    beforeEach(() => { setup(); registerEvalCollector({ ...{} }); setup(); });

    it('eval/collect: webmail과 unknown은 SENDER_FORBIDDEN', async () => {
      const h = handler('eval/collect');
      expect(await codeOf(h({ ref: REF }, MAIL))).toBe('SENDER_FORBIDDEN');
      expect(await codeOf(h({ ref: REF }, {}))).toBe('SENDER_FORBIDDEN');
    });

    it('eval/collect: extension과 g2b 발신자는 fetch 뒤 offscreen에 저장을 요청하며 가져오기 경고를 함께 보낸다', async () => {
      for (const sender of [EXT, G2B]) {
        const m = setup({ send: () => ({ raw: RAW, warnings: ['가져오기 경고'] }) });
        const r = await handler('eval/collect')({ ref: REF }, sender);
        expect(r.noticeId).toBe('R26BK00000001-000');
        expect(r.warnings).toEqual(['저장 경고']);
        expect(m.toOffscreen).toHaveBeenCalledWith('eval/save', { ref: REF, raw: RAW, serviceKey: 'KEY', fetchWarnings: ['가져오기 경고'] }, 30_000);
      }
    });

    it('eval/collect: fetch 실패면 저장하지 않고 단계를 메시지에 넣어 던진다', async () => {
      const m = setup({ send: () => new BusError('EVAL_API_ERROR', '[단계 3] ErrorCode 9') });
      const e = await handler('eval/collect')({ ref: REF }, EXT).catch((x) => x);
      expect(e).toMatchObject({ code: 'EVAL_API_ERROR', message: 'ErrorCode 9 (단계 3)' });
      expect(m.toOffscreen).not.toHaveBeenCalled();
    });

    it('eval/list|get|get-many|delete: extension만 허용하고 offscreen으로 중계한다', async () => {
      const m = setup();
      for (const t of ['eval/list', 'eval/get', 'eval/get-many', 'eval/delete']) {
        expect(await codeOf(handler(t)({}, G2B))).toBe('SENDER_FORBIDDEN');
        await handler(t)({}, EXT);
      }
      expect(m.toOffscreen.mock.calls.map((c) => c[0])).toEqual(['eval/list', 'eval/get', 'eval/get-many', 'eval/delete']);
    });

    it('eval/probe: extension만 허용하고 개수를 돌려준다', async () => {
      const h = handler('eval/probe');
      expect(await codeOf(h({ ref: REF }, G2B))).toBe('SENDER_FORBIDDEN');
      expect(await codeOf(h({ ref: REF }, MAIL))).toBe('SENDER_FORBIDDEN');
      const r = await h({ ref: { noticeNo: 'R26BK00000001' } }, EXT);
      expect(r).toMatchObject({ ok: true, counts: { targets: 2, members: 1, items: 3, scores: 4, sheets: 2 } });
    });

    it('ref 형식이 틀리면 EVAL_BAD_REF', async () => {
      expect(await codeOf(handler('eval/probe')({ ref: { noticeNo: 'bad' } }, EXT))).toBe('EVAL_BAD_REF');
      expect(await codeOf(handler('eval/probe')({ ref: { noticeNo: 'R26BK00000001', round: '1' } }, EXT))).toBe('EVAL_BAD_REF');
    });

    it('eval/probe: 실패는 code, step, message로 돌려준다', async () => {
      setup({ send: () => new BusError('EVAL_API_ERROR', '[단계 3] ErrorCode 9') });
      const r = await handler('eval/probe')({ ref: REF }, EXT);
      expect(r).toMatchObject({ ok: false, code: 'EVAL_API_ERROR', step: 3, message: 'ErrorCode 9' });
    });
  });
});
