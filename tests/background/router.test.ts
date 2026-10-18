import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/messaging/bus', () => ({ listen: vi.fn(), send: vi.fn() }));
vi.mock('../../src/background/offscreen-manager', () => ({ ensureOffscreen: vi.fn() }));
vi.mock('../../src/background/dashboard-tabs', () => ({ openDashboard: vi.fn() }));

import { EXTENSION_ONLY_TYPES, registerRouter } from '../../src/background/router';
import { listen, send } from '../../src/messaging/bus';
import { ensureOffscreen } from '../../src/background/offscreen-manager';
import { openDashboard } from '../../src/background/dashboard-tabs';

describe('라우터 등록', () => {
  it('수신자/그룹/템플릿/메일/config 메시지 14종을 SW에 등록한다', () => {
    registerRouter();
    const registered = vi.mocked(listen).mock.calls.filter((c) => c[2] === 'sw').map((c) => c[0] as string);
    const added = ['recipients/list', 'recipients/save', 'recipients/delete', 'groups/save', 'groups/delete', 'groups/set-default',
      'templates/list', 'templates/save', 'templates/delete', 'templates/set-default', 'mail/prepare', 'mail/draft-get', 'mail/set-status', 'config/repair'];
    for (const t of added) {
      expect(registered).toContain(t);
      expect(EXTENSION_ONLY_TYPES as readonly string[]).toContain(t);
    }
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
});
