import { describe, expect, it } from 'vitest';
import { JobRegistry, type RegistryJob } from '../../src/engine/jobs/job-registry';

const job = (id: string, noticeNo: string, round?: string, type: RegistryJob['type'] = 'collect', attempt = 1): RegistryJob => ({
  id, type, attempt, ref: { noticeNo, round, origin: 'g2b' }, noticeId: undefined,
});

describe('JobRegistry', () => {
  it('같은 jobId 재등록 거부', () => {
    const r = new JobRegistry();
    expect(r.tryRegister(job('a', 'X', '000')).ok).toBe(true);
    expect(r.tryRegister(job('a', 'Y', '000'))).toEqual({ ok: false, conflictJobId: 'a' });
  });
  it('같은 noticeNo(round 미지정) 거부, round가 다르면 수락', () => {
    const r = new JobRegistry();
    r.tryRegister(job('a', 'X', '000'));
    expect(r.tryRegister(job('b', 'X'))).toEqual({ ok: false, conflictJobId: 'a' });
    expect(r.tryRegister(job('c', 'X', '001')).ok).toBe(true);
  });
  it('collect vs compose는 수락', () => {
    const r = new JobRegistry();
    r.tryRegister(job('a', 'X'));
    expect(r.tryRegister(job('b', 'X', undefined, 'compose')).ok).toBe(true);
  });
  it('release 후 수락', () => {
    const r = new JobRegistry();
    r.tryRegister(job('a', 'X'));
    r.release('a');
    expect(r.tryRegister(job('b', 'X')).ok).toBe(true);
  });
  it('abort는 등록 여부를 반환하고 signal을 abort한다', () => {
    const r = new JobRegistry();
    r.tryRegister(job('a', 'X'));
    const sig = r.signal('a');
    expect(r.abort('a')).toBe(true);
    expect(sig.aborted).toBe(true);
    expect(r.abort('none')).toBe(false);
  });
  it('active에 attempt 포함', () => {
    const r = new JobRegistry();
    r.tryRegister(job('a', 'X', '000', 'collect', 3));
    expect(r.active()).toEqual([{ jobId: 'a', attempt: 3 }]);
  });
});
