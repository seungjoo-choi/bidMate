import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/background/job-coordinator', () => ({ getJob: vi.fn(), listJobs: vi.fn() }));
vi.mock('../../src/background/offscreen-manager', () => ({ ensureOffscreen: vi.fn() }));

import { handleSendSignal, setSendSignalDeps } from '../../src/background/send-signal';
import { getJob } from '../../src/background/job-coordinator';

const RUNTIME = 'ext-id';
const sender = (o: Partial<chrome.runtime.MessageSender> = {}) => ({ id: RUNTIME, tab: { id: 7 }, url: 'https://mail.example.com/', ...o }) as chrome.runtime.MessageSender;
const composeJob = (o: Record<string, unknown> = {}) => ({
  id: 'j1', type: 'compose', status: 'completed', composeTabId: 7, noticeId: 'N-ledger',
  result: { noticeId: 'N-ledger', recordId: 'j1-1', provider: 'naverworks' }, ...o,
});

describe('send-signal', () => {
  const toOffscreen = vi.fn(async () => ({ recorded: true }));
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('chrome', { runtime: { id: RUNTIME } });
    setSendSignalDeps({ toOffscreen: toOffscreen as never });
  });

  it('탭이 다르면 거부한다', async () => {
    vi.mocked(getJob).mockResolvedValue(composeJob({ composeTabId: 8 }) as never);
    await handleSendSignal({ jobId: 'j1', kind: 'click' }, sender());
    expect(toOffscreen).not.toHaveBeenCalled();
  });

  it('잡이 없으면 거부한다', async () => {
    vi.mocked(getJob).mockResolvedValue(undefined);
    await handleSendSignal({ jobId: 'zz', kind: 'click' }, sender());
    expect(toOffscreen).not.toHaveBeenCalled();
  });

  it('collect 잡은 거부한다', async () => {
    vi.mocked(getJob).mockResolvedValue(composeJob({ type: 'collect' }) as never);
    await handleSendSignal({ jobId: 'j1', kind: 'click' }, sender());
    expect(toOffscreen).not.toHaveBeenCalled();
  });

  it('sender.tab이 없거나 다른 확장이면 거부한다', async () => {
    vi.mocked(getJob).mockResolvedValue(composeJob() as never);
    await handleSendSignal({ jobId: 'j1', kind: 'click' }, sender({ tab: undefined }));
    await handleSendSignal({ jobId: 'j1', kind: 'click' }, sender({ id: 'other' }));
    expect(toOffscreen).not.toHaveBeenCalled();
  });

  it('정상이면 ledger 값으로 전달한다(CS 값 무시)', async () => {
    vi.mocked(getJob).mockResolvedValue(composeJob() as never);
    const forged = { jobId: 'j1', kind: 'hotkey', noticeId: 'EVIL', composeRecordId: 'EVIL', provider: 'gmail' } as never;
    await handleSendSignal(forged, sender());
    expect(toOffscreen).toHaveBeenCalledTimes(1);
    expect((toOffscreen.mock.calls as unknown[][])[0]).toEqual(['mail/sent-record', { noticeId: 'N-ledger', jobId: 'j1', composeRecordId: 'j1-1', provider: 'naverworks', kind: 'hotkey' }, expect.any(Number)]);
  });

  it('confirm은 confirmation을 함께 전달하고 전달 실패는 삼킨다', async () => {
    vi.mocked(getJob).mockResolvedValue(composeJob() as never);
    toOffscreen.mockRejectedValueOnce(new Error('x'));
    await expect(handleSendSignal({ jobId: 'j1', kind: 'confirm', confirmation: 'toast' }, sender())).resolves.toBeUndefined();
    expect((toOffscreen.mock.calls as unknown[][])[0]![1]).toMatchObject({ kind: 'confirm', confirmation: 'toast' });
  });

  it('같은 jobId의 신호는 도착 순서대로 전달한다', async () => {
    vi.mocked(getJob).mockImplementation(async () => composeJob() as never);
    const order: string[] = [];
    toOffscreen.mockImplementation((async (_t: string, pl: { kind: string }) => {
      if (pl.kind === 'click') await new Promise((r) => setTimeout(r, 20));
      order.push(pl.kind);
      return { recorded: true };
    }) as never);
    await Promise.all([
      handleSendSignal({ jobId: 'j1', kind: 'click' }, sender()),
      handleSendSignal({ jobId: 'j1', kind: 'confirm', confirmation: 'unload' }, sender()),
    ]);
    expect(order).toEqual(['click', 'confirm']);
  });
});
