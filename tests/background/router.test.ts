import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/messaging/bus', () => ({ listen: vi.fn(), send: vi.fn() }));
vi.mock('../../src/background/offscreen-manager', () => ({ ensureOffscreen: vi.fn() }));
vi.mock('../../src/background/dashboard-tabs', () => ({ openDashboard: vi.fn() }));
vi.mock('../../src/background/g2b-failures', () => ({ recordG2bFailure: vi.fn() }));

import { EXTENSION_ONLY_TYPES, registerRouter } from '../../src/background/router';
import { listen, send } from '../../src/messaging/bus';
import { ensureOffscreen } from '../../src/background/offscreen-manager';
import { openDashboard } from '../../src/background/dashboard-tabs';
import { recordG2bFailure } from '../../src/background/g2b-failures';

describe('라우터 등록', () => {
  it('수신자/그룹/템플릿/메일/config 메시지 18종을 SW에 등록한다', () => {
    registerRouter();
    const registered = vi.mocked(listen).mock.calls.filter((c) => c[2] === 'sw').map((c) => c[0] as string);
    const added = ['recipients/list', 'recipients/save', 'recipients/delete', 'groups/save', 'groups/delete', 'groups/set-default',
      'templates/list', 'templates/save', 'templates/delete', 'templates/set-default', 'mail/prepare', 'mail/draft-get', 'mail/sent-list', 'mail/sent-get', 'mail/sent-add', 'mail/sent-void', 'config/repair', 'notice/field-edit'];
    for (const t of added) {
      expect(registered).toContain(t);
      expect(EXTENSION_ONLY_TYPES as readonly string[]).toContain(t);
    }
  });
  it('recipients/import를 SW에 등록하고 EXTENSION_ONLY로 처리한다', () => {
    registerRouter();
    const registered = vi.mocked(listen).mock.calls.filter((c) => c[2] === 'sw').map((c) => c[0] as string);
    expect(registered).toContain('recipients/import');
    expect(EXTENSION_ONLY_TYPES as readonly string[]).toContain('recipients/import');
    expect(EXTENSION_ONLY_TYPES as readonly string[]).not.toContain('contacts/naverworks-fetch');
  });
});

describe('SW 릴레이 발신자 검사', () => {
  const RID = 'abcdefghijklmnop';
  const tabSender = { id: RID, url: 'https://www.g2b.go.kr/', tab: { id: 1 } };
  type H = (payload: unknown, sender: unknown) => Promise<unknown>;
  const handlerOf = (type: string): H => {
    const call = vi.mocked(listen).mock.calls.find((c) => c[0] === type && c[2] === 'sw');
    if (!call) throw new Error(`핸들러 없음: ${type}`);
    return call[1] as unknown as H;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('chrome', { runtime: { id: RID }, storage: { local: { get: vi.fn().mockResolvedValue({}) } }, tabs: { query: vi.fn().mockResolvedValue([]) } });
    registerRouter();
  });

  it('fs/smoke-test는 탭 발신을 거부하고 offscreen을 띄우지 않는다', async () => {
    await expect(handlerOf('fs/smoke-test')(undefined, tabSender)).rejects.toMatchObject({ code: 'SENDER_FORBIDDEN' });
    expect(ensureOffscreen).not.toHaveBeenCalled();
  });

  it.each(['g2b/test', 'fs/permission-granted'])('%s도 탭 발신을 거부한다', async (type) => {
    await expect(handlerOf(type)(undefined, tabSender)).rejects.toMatchObject({ code: 'SENDER_FORBIDDEN' });
  });

  it('g2b/test는 payload의 kind를 offscreen으로 전달한다', async () => {
    const ext = { id: RID, url: `chrome-extension://${RID}/dashboard.html` };
    vi.mocked(send).mockResolvedValue({ ok: true } as never);
    await handlerOf('g2b/test')({ kind: 'prespec' }, ext);
    expect(vi.mocked(send)).toHaveBeenLastCalledWith('g2b/test', expect.objectContaining({ kind: 'prespec' }), expect.objectContaining({ target: 'offscreen' }));
    await handlerOf('g2b/test')({}, ext);
    expect(vi.mocked(send).mock.calls.at(-1)![1]).not.toHaveProperty('kind');
  });

  it('g2b/test 실패 응답은 key-test 실패로 기록하고 응답은 그대로 돌려준다', async () => {
    const ext = { id: RID, url: `chrome-extension://${RID}/dashboard.html` };
    const reply = { ok: false, error: { code: 'G2B_KEY_INVALID', message: '키 오류' } };
    vi.mocked(send).mockResolvedValue(reply as never);
    await expect(handlerOf('g2b/test')({ kind: 'prespec' }, ext)).resolves.toBe(reply);
    expect(recordG2bFailure).toHaveBeenLastCalledWith({ flow: 'key-test', stage: 'prespec', code: 'G2B_KEY_INVALID', message: '키 오류', trigger: 'manual' });
    await handlerOf('g2b/test')({}, ext);
    expect(recordG2bFailure).toHaveBeenLastCalledWith(expect.objectContaining({ flow: 'key-test', stage: 'bid' }));
    vi.mocked(recordG2bFailure).mockClear();
    vi.mocked(send).mockResolvedValue({ ok: true } as never);
    await handlerOf('g2b/test')({}, ext);
    expect(recordG2bFailure).not.toHaveBeenCalled();
  });

  it('fs/permission-granted는 수신 서비스(inbox) 호스트 탭에 알린다', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const settingsCache = { sites: { trackerbot: { provider: 'gmail' } }, mail: { provider: 'naverworks' } };
    vi.stubGlobal('chrome', { runtime: { id: RID }, storage: { local: { get: vi.fn().mockResolvedValue({ settingsCache }) } }, tabs: { query, sendMessage: vi.fn() } });
    await handlerOf('fs/permission-granted')(undefined, { id: RID, url: `chrome-extension://${RID}/dashboard.html` });
    expect(query).toHaveBeenCalledWith({ url: 'https://mail.google.com/*' });
  });

  it('notice/lookup은 탭 발신도 거부하지 않는다', async () => {
    vi.mocked(send).mockResolvedValue({ found: false } as never);
    await expect(handlerOf('notice/lookup')({}, tabSender)).resolves.toEqual({ found: false });
  });

  it('notice/lookup-batch는 200개로 자르고 offscreen에 중계한다', async () => {
    vi.mocked(send).mockResolvedValue([] as never);
    const refs = Array.from({ length: 250 }, (_, i) => ({ noticeNo: `N${i}` }));
    await handlerOf('notice/lookup-batch')({ refs }, tabSender);
    const sent = vi.mocked(send).mock.calls.at(-1)!;
    expect(sent[0]).toBe('notice/lookup-batch');
    expect((sent[1] as { refs: unknown[] }).refs).toHaveLength(200);
  });

  it('notice/lookup-batch 실패 시 입력 개수만큼 found:false', async () => {
    vi.mocked(send).mockRejectedValue(new Error('x'));
    await expect(handlerOf('notice/lookup-batch')({ refs: [{ noticeNo: 'a' }, { noticeNo: 'b' }] }, tabSender))
      .resolves.toEqual([{ found: false }, { found: false }]);
  });

  it('notice/lookup-batch는 refs가 없으면 []', async () => {
    vi.mocked(send).mockRejectedValue(new Error('x'));
    await expect(handlerOf('notice/lookup-batch')({}, tabSender)).resolves.toEqual([]);
  });
});

describe('ui/open', () => {
  type H = (payload: unknown, sender: unknown) => Promise<unknown>;
  const open = (payload: unknown, sender: unknown = { tab: { id: 4 } }) => {
    const call = vi.mocked(listen).mock.calls.find((c) => c[0] === 'ui/open' && c[2] === 'sw')!;
    return (call[1] as unknown as H)(payload, sender);
  };
  beforeEach(() => { vi.clearAllMocks(); registerRouter(); });

  it('mail은 인코딩한 noticeId 해시로 대시보드를 연다', async () => {
    await open({ page: 'mail', noticeId: 'A B-000' });
    expect(openDashboard).toHaveBeenCalledWith('#/mail/A%20B-000', { nearTabId: 4 });
  });
  it('review와 settings도 openDashboard를 쓴다', async () => {
    await open({ page: 'review', noticeId: 'N-000' }, {});
    expect(openDashboard).toHaveBeenCalledWith('#/review/N-000', { nearTabId: undefined });
    await open({ page: 'settings' });
    expect(openDashboard).toHaveBeenLastCalledWith('#/settings', { nearTabId: 4 });
  });
  it('settings section과 recipients는 고칠 화면으로 바로 연다', async () => {
    await open({ page: 'settings', section: 'auto-compose' });
    expect(openDashboard).toHaveBeenLastCalledWith(expect.stringMatching(/^#\/settings\?section=auto-compose&t=\d+$/), { nearTabId: 4 });
    await open({ page: 'settings', section: 'evil"' });
    expect(openDashboard).toHaveBeenLastCalledWith('#/settings', { nearTabId: 4 });
    await open({ page: 'recipients' });
    expect(openDashboard).toHaveBeenLastCalledWith('#/recipients', { nearTabId: 4 });
  });
});

describe('performances 메시지', () => {
  it('estimate/* 2종을 SW에 등록하고 EXTENSION_ONLY로 처리한다', () => {
    registerRouter();
    const registered = vi.mocked(listen).mock.calls.filter((c) => c[2] === 'sw').map((c) => c[0] as string);
    for (const t of ['estimate/get', 'estimate/save']) {
      expect(registered).toContain(t);
      expect(EXTENSION_ONLY_TYPES as readonly string[]).toContain(t);
    }
  });
  it('performances/* 4종을 SW에 등록하고 EXTENSION_ONLY로 처리한다', () => {
    registerRouter();
    const registered = vi.mocked(listen).mock.calls.filter((c) => c[2] === 'sw').map((c) => c[0] as string);
    for (const t of ['performances/list', 'performances/save', 'performances/delete', 'performances/import']) {
      expect(registered).toContain(t);
      expect(EXTENSION_ONLY_TYPES as readonly string[]).toContain(t);
    }
  });
});
