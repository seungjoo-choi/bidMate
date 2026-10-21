import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/background/job-coordinator', () => ({ getJob: vi.fn(), listJobs: vi.fn(), setSendState: vi.fn(async () => undefined) }));
vi.mock('../../src/background/offscreen-manager', () => ({ ensureOffscreen: vi.fn() }));

import { handleSendSignal, setSendSignalDeps } from '../../src/background/send-signal';
import { getJob, setSendState } from '../../src/background/job-coordinator';

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

  it('kind auto를 전달한다', async () => {
    vi.mocked(getJob).mockResolvedValue(composeJob() as never);
    await handleSendSignal({ jobId: 'j1', kind: 'auto' }, sender());
    expect((toOffscreen.mock.calls as unknown[][])[0]![1]).toMatchObject({ kind: 'auto' });
  });

  it('send가 있으면 ledger 상태를 갱신한다(confirm이면 confirmed true)', async () => {
    vi.mocked(getJob).mockResolvedValue(composeJob({ send: { clickedAt: 't', confirmed: false } }) as never);
    await handleSendSignal({ jobId: 'j1', kind: 'confirm', confirmation: 'ui_gone' }, sender());
    expect(setSendState).toHaveBeenCalledWith('j1', expect.objectContaining({ confirmed: true, confirmation: 'ui_gone', lastSignalAt: expect.any(String) }));
  });

  it('click/auto는 기존 confirmed를 유지하고, send가 없으면 ledger를 건드리지 않는다', async () => {
    vi.mocked(getJob).mockResolvedValue(composeJob({ send: { clickedAt: 't', confirmed: true } }) as never);
    await handleSendSignal({ jobId: 'j1', kind: 'auto' }, sender());
    expect(setSendState).toHaveBeenCalledWith('j1', expect.objectContaining({ confirmed: true }));
    vi.mocked(setSendState).mockClear();
    vi.mocked(getJob).mockResolvedValue(composeJob() as never);
    await handleSendSignal({ jobId: 'j1', kind: 'click' }, sender());
    expect(setSendState).not.toHaveBeenCalled();
  });

  it('composeRecordId는 job.send 값이 result.recordId보다 우선한다', async () => {
    vi.mocked(getJob).mockResolvedValue(composeJob({ send: { clickedAt: 't', confirmed: false, composeRecordId: 'pre-1' } }) as never);
    await handleSendSignal({ jobId: 'j1', kind: 'auto' }, sender());
    expect((toOffscreen.mock.calls as unknown[][])[0]![1]).toMatchObject({ composeRecordId: 'pre-1' });
  });

  it('result가 없으면 send.composeRecordId만 쓴다', async () => {
    vi.mocked(getJob).mockResolvedValue(composeJob({ result: undefined, send: { clickedAt: 't', confirmed: false, composeRecordId: 'pre-2' } }) as never);
    await handleSendSignal({ jobId: 'j1', kind: 'auto' }, sender());
    expect((toOffscreen.mock.calls as unknown[][])[0]![1]).toMatchObject({ noticeId: 'N-ledger', composeRecordId: 'pre-2' });
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
