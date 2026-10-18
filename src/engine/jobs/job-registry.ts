import { jobsConflict, type ConflictKey } from '../../core/model/job-conflict';
import type { Job } from '../../core/types/job';
import type { ActiveJob } from '../../messaging/protocol';

export type RegistryJob = Pick<Job, 'id' | 'attempt'> & ConflictKey;

/** offscreen의 실행 중 잡 권위(메모리). 입장 검사는 동기적으로 한 번에 수행한다. */
export class JobRegistry {
  private entries = new Map<string, { job: RegistryJob; ac: AbortController }>();

  tryRegister(job: RegistryJob): { ok: true } | { ok: false; conflictJobId: string } {
    if (this.entries.has(job.id)) return { ok: false, conflictJobId: job.id };
    for (const e of this.entries.values()) {
      if (jobsConflict(e.job, job)) return { ok: false, conflictJobId: e.job.id };
    }
    this.entries.set(job.id, { job, ac: new AbortController() });
    return { ok: true };
  }

  signal(jobId: string): AbortSignal {
    const e = this.entries.get(jobId);
    if (!e) throw new Error(`등록되지 않은 잡: ${jobId}`);
    return e.ac.signal;
  }

  /** 등록된 잡이면 abort하고 true. */
  abort(jobId: string): boolean {
    const e = this.entries.get(jobId);
    if (!e) return false;
    e.ac.abort();
    return true;
  }

  /** 같은 쓰기군에서 이 키와 충돌하는 실행 중 잡의 id. 없으면 undefined. */
  findConflict(key: ConflictKey): string | undefined {
    for (const e of this.entries.values()) if (jobsConflict(e.job, key)) return e.job.id;
    return undefined;
  }

  release(jobId: string): void {
    this.entries.delete(jobId);
  }

  active(): ActiveJob[] {
    return [...this.entries.values()].map((e) => ({ jobId: e.job.id, attempt: e.job.attempt }));
  }
}
