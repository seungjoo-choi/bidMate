// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers: Record<string, (p: unknown, s: unknown) => Promise<unknown>> = {};
vi.mock('../../src/messaging/bus', () => ({
  BusError: class extends Error { constructor(public code: string, m: string) { super(m); } },
  listen: vi.fn((type: string, fn: (p: unknown, s: unknown) => Promise<unknown>) => { handlers[type] = fn; }),
}));
vi.mock('../../src/background/job-coordinator', () => ({
  ACTIVE: new Set(['queued', 'running', 'cancelling']),
  getJob: vi.fn(), listJobs: vi.fn(), setSendState: vi.fn(async () => undefined), isOffscreenSender: vi.fn(() => true),
}));
vi.mock('../../src/background/compose-relay', () => ({ getComposeSelectorSet: vi.fn() }));
vi.mock('../../src/background/send-signal', () => ({
  enqueue: vi.fn((_id: string, fn: () => Promise<unknown>) => fn()),
  recordSignal: vi.fn(async () => undefined),
}));

import { registerSendTrigger } from '../../src/background/send-trigger';
import { getJob, listJobs, setSendState, isOffscreenSender } from '../../src/background/job-coordinator';
import { getComposeSelectorSet } from '../../src/background/compose-relay';
import { recordSignal } from '../../src/background/send-signal';

const SET = {
  hostPattern: 'mail.worksmobile.com', compose: {}, subject: { input: 'input[name=subject]' },
  autoSend: { button: 'button.send' }, sendWatch: { buttons: ['b'], gone: '#subj' },
};
const job = (o: Record<string, unknown> = {}) => ({
  id: 'j1', type: 'compose', status: 'running', composeTabId: 5, composeFrameId: 0,
  params: { autoSend: { expectSentCount: 0, fingerprint: 'f', confirmedAt: 'x' } }, ...o,
});
const P = { jobId: 'j1', composeRecordId: 'r1', subject: 'S' };
let removedListener: (id: number) => void;
const exec = vi.fn();
const tabsGet = vi.fn();
const tabsQuery = vi.fn();
const tabsRemove = vi.fn(async () => undefined);

describe('send-trigger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isOffscreenSender).mockReturnValue(true);
    vi.mocked(getComposeSelectorSet).mockReturnValue(SET as never);
    vi.stubGlobal('chrome', {
      scripting: { executeScript: exec },
      tabs: { get: tabsGet, query: tabsQuery, remove: tabsRemove, onRemoved: { addListener: (fn: (id: number) => void) => { removedListener = fn; } } },
    });
    registerSendTrigger();
  });

  describe('compose/send-click', () => {
    it('offscreen 발신자가 아니면 거부한다', () => {
      vi.mocked(isOffscreenSender).mockReturnValue(false);
      expect(() => handlers['compose/send-click']!(P, {})).toThrow();
    });
    it('autoSend가 없으면 거부한다', async () => {
      vi.mocked(getJob).mockResolvedValue(job({ params: {} }) as never);
      expect(await handlers['compose/send-click']!(P, {})).toEqual({ clicked: false, reason: 'CLICK_FAILED' });
      expect(exec).not.toHaveBeenCalled();
    });
    it('auto 잡이면 거부한다', async () => {
      vi.mocked(getJob).mockResolvedValue(job({ auto: { collectJobId: 'c' } }) as never);
      expect(await handlers['compose/send-click']!(P, {})).toEqual({ clicked: false, reason: 'CLICK_FAILED' });
      expect(setSendState).not.toHaveBeenCalled();
    });
    it('send가 이미 있으면 ALREADY_FIRED', async () => {
      vi.mocked(getJob).mockResolvedValue(job({ send: { clickedAt: 't', confirmed: false } }) as never);
      expect(await handlers['compose/send-click']!(P, {})).toEqual({ clicked: false, reason: 'ALREADY_FIRED' });
      expect(exec).not.toHaveBeenCalled();
    });
    it('cancelling 잡이면 거부하고 setSendState·executeScript를 호출하지 않는다', async () => {
      vi.mocked(getJob).mockResolvedValue(job({ status: 'cancelling' }) as never);
      expect(await handlers['compose/send-click']!(P, {})).toEqual({ clicked: false, reason: 'CLICK_FAILED' });
      expect(setSendState).not.toHaveBeenCalled();
      expect(exec).not.toHaveBeenCalled();
    });
    it('setSendState가 executeScript보다 먼저 호출된다', async () => {
      vi.mocked(getJob).mockResolvedValue(job() as never);
      const order: string[] = [];
      vi.mocked(setSendState).mockImplementation((async () => { order.push('state'); }) as never);
      exec.mockImplementation(async () => { order.push('exec'); return [{ result: { clicked: true } }]; });
      expect(await handlers['compose/send-click']!(P, {})).toEqual({ clicked: true });
      expect(order).toEqual(['state', 'exec']);
      expect(setSendState).toHaveBeenCalledWith('j1', expect.objectContaining({ composeRecordId: 'r1', confirmed: false }));
    });
    it('executeScript 예외는 throw한다', async () => {
      vi.mocked(getJob).mockResolvedValue(job() as never);
      exec.mockRejectedValue(new Error('boom'));
      await expect(handlers['compose/send-click']!(P, {})).rejects.toThrow('boom');
    });
  });

  describe('compose/send-click 수신자 대조(clickSend 직접 실행)', () => {
    const LISTS = { list: '.list_addrobj', chip: 'div.addr_obj_wrap > div.addr_obj > span' };
    const CHIP = { ...SET, autoSend: { button: 'button.send', recipientLists: LISTS } };
    let clickSpy: ReturnType<typeof vi.fn>;
    /** lists: 목록(to, cc, bcc ...)별 칩 텍스트 */
    function mount(lists: string[][]): void {
      document.body.innerHTML = '<input name="subject" value="S"><button class="send"></button>';
      for (const chips of lists) {
        const ul = document.createElement('ul'); ul.className = 'list_addrobj';
        for (const c of chips) {
          const li = document.createElement('li');
          li.innerHTML = '<div class="addr_obj_wrap"><div class="addr_obj"><span></span></div></div>';
          li.querySelector('span')!.textContent = c;
          ul.appendChild(li);
        }
        document.body.appendChild(ul);
      }
      const btn = document.querySelector('button.send') as HTMLButtonElement;
      btn.getClientRects = (() => [{}]) as never;
      clickSpy = vi.fn();
      btn.click = clickSpy as never;
    }
    const runClick = async (to: string[], cc: string[]) => {
      vi.mocked(getJob).mockResolvedValue(job() as never);
      vi.mocked(getComposeSelectorSet).mockReturnValue({ ...CHIP, subject: { input: 'input[name=subject]' } } as never);
      exec.mockImplementation((async (o: { func: (a: unknown) => unknown; args: unknown[] }) => [{ result: o.func(o.args[0]) }]) as never);
      (window as unknown as Record<string, unknown>).__bidMateSendWatch = { state: () => ({ fired: false }), markSent: () => ({ armed: true }) };
      return handlers['compose/send-click']!({ ...P, to, cc }, {});
    };
    const MISMATCH = { clicked: false, reason: 'RECIPIENT_MISMATCH' };
    it('to·cc가 각각 일치하고 bcc가 비어 있으면 clicked', async () => {
      mount([['a@x.com', '가 <b@x.com>'.replace(/[<>]/g, '')], ['c@x.com'], []]);
      expect(await runClick(['a@x.com', 'b@x.com'], ['c@x.com'])).toEqual({ clicked: true });
      expect(clickSpy).toHaveBeenCalled();
    });
    it('to와 cc가 뒤바뀌면 RECIPIENT_MISMATCH이고 click하지 않는다', async () => {
      mount([['c@x.com'], ['a@x.com'], []]);
      expect(await runClick(['a@x.com'], ['c@x.com'])).toEqual(MISMATCH);
      expect(clickSpy).not.toHaveBeenCalled();
    });
    it('bcc 목록에 주소가 있으면 RECIPIENT_MISMATCH', async () => {
      mount([['a@x.com'], ['c@x.com'], ['z@x.com']]);
      expect(await runClick(['a@x.com'], ['c@x.com'])).toEqual(MISMATCH);
      expect(clickSpy).not.toHaveBeenCalled();
    });
    it('목록이 1개뿐이면 RECIPIENT_MISMATCH', async () => {
      mount([['a@x.com']]);
      expect(await runClick(['a@x.com'], [])).toEqual(MISMATCH);
      expect(clickSpy).not.toHaveBeenCalled();
    });
    it('대소문자만 다르면 clicked', async () => {
      mount([['A@X.com'], ['C@x.COM'], []]);
      expect(await runClick([' a@x.com '], ['c@x.com'])).toEqual({ clicked: true });
    });
    it('executeScript args에 to·cc·recipientLists가 전달된다', async () => {
      mount([['a@x.com'], [], []]);
      await runClick(['a@x.com'], []);
      expect(exec.mock.calls[0]![0].args[0]).toMatchObject({ to: ['a@x.com'], cc: [], recipientLists: LISTS });
    });
  });

  describe('compose/close-tab', () => {
    it('호스트가 다르면 닫지 않는다', async () => {
      vi.mocked(getJob).mockResolvedValue(job() as never);
      tabsGet.mockResolvedValue({ url: 'https://evil.example.com/x', windowId: 1 });
      tabsQuery.mockResolvedValue([{}, {}]);
      expect(await handlers['compose/close-tab']!({ jobId: 'j1' }, {})).toEqual({ closed: false });
      expect(tabsRemove).not.toHaveBeenCalled();
    });
    it('창에 탭이 1개뿐이면 닫지 않는다', async () => {
      vi.mocked(getJob).mockResolvedValue(job() as never);
      tabsGet.mockResolvedValue({ url: 'https://mail.worksmobile.com/write', windowId: 1 });
      tabsQuery.mockResolvedValue([{}]);
      expect(await handlers['compose/close-tab']!({ jobId: 'j1' }, {})).toEqual({ closed: false });
      expect(tabsRemove).not.toHaveBeenCalled();
    });
    it('호스트가 같고 탭이 2개 이상이면 닫는다', async () => {
      vi.mocked(getJob).mockResolvedValue(job() as never);
      tabsGet.mockResolvedValue({ url: 'https://mail.worksmobile.com/write', windowId: 1 });
      tabsQuery.mockResolvedValue([{}, {}]);
      expect(await handlers['compose/close-tab']!({ jobId: 'j1' }, {})).toEqual({ closed: true });
      expect(tabsRemove).toHaveBeenCalledWith(5);
    });
    it('탭이 이미 없으면 closed true', async () => {
      vi.mocked(getJob).mockResolvedValue(job() as never);
      tabsGet.mockRejectedValue(new Error('no tab'));
      expect(await handlers['compose/close-tab']!({ jobId: 'j1' }, {})).toEqual({ closed: true });
    });
  });

  describe('tabs.onRemoved', () => {
    it('clickedAt이 있고 미확인이면 confirm unload를 기록한다', async () => {
      const j = job({ send: { clickedAt: 't', confirmed: false } });
      vi.mocked(listJobs).mockResolvedValue([j] as never);
      vi.mocked(getJob).mockResolvedValue(j as never);
      removedListener(5);
      await vi.waitFor(() => expect(recordSignal).toHaveBeenCalledWith(j, 'confirm', 'unload'));
      expect(setSendState).toHaveBeenCalledWith('j1', { tabRemoved: true });
    });
    it.each(['completed', 'partial'])('잡이 %s면 recordSignal을 호출하지 않는다', async (status) => {
      const j = job({ status, send: { clickedAt: 't', confirmed: false } });
      vi.mocked(listJobs).mockResolvedValue([j] as never);
      vi.mocked(getJob).mockResolvedValue(j as never);
      removedListener(5);
      await new Promise((r) => setTimeout(r, 10));
      expect(recordSignal).not.toHaveBeenCalled();
    });
    it('clickedAt이 없으면 무시한다', async () => {
      vi.mocked(listJobs).mockResolvedValue([job()] as never);
      removedListener(5);
      await new Promise((r) => setTimeout(r, 10));
      expect(recordSignal).not.toHaveBeenCalled();
    });
  });
});
