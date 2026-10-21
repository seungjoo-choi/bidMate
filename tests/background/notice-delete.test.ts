import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/messaging/bus', () => ({ listen: vi.fn(), send: vi.fn() }));
vi.mock('../../src/background/offscreen-manager', () => ({ ensureOffscreen: vi.fn() }));
vi.mock('../../src/background/auto-compose', () => ({ dequeueByNotice: vi.fn().mockResolvedValue(0) }));
vi.mock('../../src/background/deadline-scheduler', () => ({ refreshDeadlines: vi.fn().mockResolvedValue({}) }));

import { registerNoticeDelete } from '../../src/background/notice-delete';
import { listen, send } from '../../src/messaging/bus';
import { ensureOffscreen } from '../../src/background/offscreen-manager';
import { dequeueByNotice } from '../../src/background/auto-compose';
import { refreshDeadlines } from '../../src/background/deadline-scheduler';

const RID = 'abcdefghijklmnop';
const tabSender = { id: RID, url: 'https://www.g2b.go.kr/', tab: { id: 1 } };
const dash = { id: RID, url: `chrome-extension://${RID}/dashboard.html` };
type H = (payload: unknown, sender: unknown) => Promise<unknown>;
const handler = (): H => {
  const call = vi.mocked(listen).mock.calls.find((c) => c[0] === 'notice/delete' && c[2] === 'sw');
  if (!call) throw new Error('핸들러 없음');
  return call[1] as unknown as H;
};

describe('notice/delete SW 핸들러', () => {
  let remove: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.clearAllMocks();
    remove = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('chrome', { runtime: { id: RID }, storage: { session: { remove } } });
    registerNoticeDelete();
  });

  it('확장 페이지가 아닌 발신은 SENDER_FORBIDDEN', async () => {
    await expect(handler()({ noticeIds: ['a'] }, tabSender)).rejects.toMatchObject({ code: 'SENDER_FORBIDDEN' });
    expect(send).not.toHaveBeenCalled();
  });

  it('201건은 PAYLOAD_TOO_LARGE, 빈 배열·비문자열은 INVALID_VALUE', async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `n${i}`);
    await expect(handler()({ noticeIds: ids }, dash)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    await expect(handler()({ noticeIds: [] }, dash)).rejects.toMatchObject({ code: 'INVALID_VALUE' });
    await expect(handler()({ noticeIds: ['a', 1] }, dash)).rejects.toMatchObject({ code: 'INVALID_VALUE' });
    expect(send).not.toHaveBeenCalled();
  });

  it('중복을 제거해 offscreen에 보내고, 응답 후 정리 작업을 하고 응답을 그대로 돌려준다', async () => {
    const res = { deleted: ['a', 'b'], failed: [] };
    vi.mocked(send).mockResolvedValue(res as never);
    expect(await handler()({ noticeIds: ['a', 'b', 'a'] }, dash)).toBe(res);
    expect(ensureOffscreen).toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith('notice/delete', { noticeIds: ['a', 'b'] }, expect.objectContaining({ target: 'offscreen' }));
    expect(dequeueByNotice).toHaveBeenCalledWith(['a', 'b']);
    expect(remove).toHaveBeenCalledWith(['aiRun.a', 'aiRun.b']);
    expect(refreshDeadlines).toHaveBeenCalledWith('manual');
  });
});
