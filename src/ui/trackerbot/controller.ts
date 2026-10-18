import { scanG2bLinks } from '../../adapters/trackerbot/mail-scan';
import { linkToNoticeRef } from '../../adapters/g2b/link';
import { noticeId } from '../../core/model/ids';
import type { Job } from '../../core/types/job';
import { send as defaultSend } from '../../messaging/bus';
import type { NoticeLookup } from '../../messaging/protocol';
import { createRowButton, type RowButtonHandle } from './row-button';
import { handoffView } from '../handoff-view';
import { rowView, type RowEntry, type RowSubAction } from './row-view';

const ACTIVE = new Set(['queued', 'running', 'cancelling']);
const DEBOUNCE_MS = 300;
const MAX_WAIT_MS = 1000;
const POLL_MS = 3000;
const MAX_POLL_FAILS = 3;
const RESTORE_WINDOW_MS = 10 * 60 * 1000;
const LOOKUP_BATCH = 200;

/** 자동 작성 대기 중이라 compose 잡이 아직 없는 상태 */
const handoffQueued = (j: Job | null): boolean => j?.handoff?.action === 'compose' && j.handoff.state === 'queued';
const composeIdOf = (j: Job | null): string | undefined => (j?.handoff?.action === 'compose' ? j.handoff.jobId : undefined);
const isActive = (j: Job | null): boolean => !!j && ACTIVE.has(j.status);
const extAlive = (): boolean => !!globalThis.chrome?.runtime?.id;
const keyOfRef = (r: { noticeNo: string; round?: string }): string => noticeId(r.noticeNo, r.round);

export interface TrackerbotDeps { send?: typeof defaultSend; now?: () => number; isOrphaned?: () => boolean }

/** 트래커봇 메일의 입찰정보 행에 [공고 수집] 버튼을 붙이고 잡 상태를 반영한다. 웹메일 DOM은 읽기만 한다. */
export class TrackerbotController {
  private entries = new Map<string, RowEntry>();
  private buttons = new Map<string, Set<RowButtonHandle>>();
  private jobToKey = new Map<string, string>();
  private send: typeof defaultSend;
  private now: () => number;
  private isOrphaned: () => boolean;
  private stopped = false;
  private observer: MutationObserver | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pendingSince = 0;
  private poll: ReturnType<typeof setInterval> | undefined;
  private pollFails = 0;
  private orphaned = false;
  private inflight = new Set<Promise<unknown>>();

  constructor(private doc: Document, deps: TrackerbotDeps = {}) {
    this.send = deps.send ?? defaultSend;
    this.now = deps.now ?? Date.now;
    this.isOrphaned = deps.isOrphaned ?? (() => !extAlive());
  }

  start(): void {
    this.stopped = false;
    this.observer = new MutationObserver(() => this.schedule());
    this.observer.observe(this.doc.body, { childList: true, subtree: true });
    this.doc.addEventListener('visibilitychange', this.onVisible);
    this.scan();
  }

  stop(): void {
    this.stopped = true;
    this.observer?.disconnect();
    this.doc.removeEventListener('visibilitychange', this.onVisible);
    clearTimeout(this.timer);
    this.pendingSince = 0;
    clearInterval(this.poll);
    this.poll = undefined;
  }

  getEntry(key: string): RowEntry | undefined { return this.entries.get(key); }

  /** 테스트용: 진행 중인 비동기 작업이 끝날 때까지 기다린다. */
  async whenIdle(): Promise<void> {
    while (this.inflight.size > 0) await Promise.allSettled([...this.inflight]);
  }

  private track<T>(p: Promise<T>): Promise<T> {
    this.inflight.add(p);
    void p.then(() => this.inflight.delete(p), () => this.inflight.delete(p));
    return p;
  }

  private onVisible = (): void => {
    if (this.doc.visibilityState !== 'visible') return;
    this.scan();
    void this.track(this.refetchActive());
    this.ensurePoll();
  };

  /** 300ms 디바운스 + 최대 1000ms 대기 */
  private schedule(): void {
    const now = Date.now();
    if (!this.pendingSince) this.pendingSince = now;
    clearTimeout(this.timer);
    const wait = Math.max(0, Math.min(DEBOUNCE_MS, this.pendingSince + MAX_WAIT_MS - now));
    this.timer = setTimeout(() => { this.pendingSince = 0; this.scan(); }, wait);
  }

  /** 멱등. 새 앵커에만 버튼을 만들고, 새 키만 조회한다. */
  scan(): void {
    if (this.stopped) return;
    const newKeys: string[] = [];
    for (const s of scanG2bLinks(this.doc)) {
      const ref = linkToNoticeRef(s.link, 'trackerbot');
      if (!ref) continue;
      const key = keyOfRef(ref);
      let entry = this.entries.get(key);
      if (!entry) {
        entry = { key, ref, title: s.title, lookup: { found: false }, job: null, compose: null, starting: false, error: null, otherTab: false };
        this.entries.set(key, entry);
        newKeys.push(key);
      } else if (!entry.title && s.title) entry.title = s.title;
      const next = s.anchor.nextElementSibling; // 우리 host가 지워졌으면 다시 만든다
      if (next && next.getAttribute('data-bidmate') === 'collect') continue;
      const handle = createRowButton(s.anchor, {
        collect: () => { void this.collect(key); },
        cancel: () => { void this.cancel(key); },
        action: (a) => { void this.onAction(key, a); },
      });
      let set = this.buttons.get(key);
      if (!set) this.buttons.set(key, (set = new Set()));
      set.add(handle);
      handle.render(rowView(entry, { orphaned: this.orphaned || this.isOrphaned() }));
    }
    for (const set of this.buttons.values()) for (const h of set) if (!h.host.isConnected) set.delete(h);
    if (newKeys.length > 0) void this.track(this.loadNew(newKeys));
  }

  private async loadNew(keys: string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += LOOKUP_BATCH) {
      const chunk = keys.slice(i, i + LOOKUP_BATCH);
      let res: NoticeLookup[] = [];
      try {
        res = await this.send('notice/lookup-batch', { refs: chunk.map((k) => ({ noticeNo: this.entries.get(k)!.ref.noticeNo, round: this.entries.get(k)!.ref.round })) });
      } catch { /* found:false */ }
      chunk.forEach((k, idx) => {
        const e = this.entries.get(k);
        const l = res[idx];
        if (e && l) { e.lookup = l; this.render(k); }
      });
    }
    await this.restore(new Set(keys));
  }

  /** 새로 나타난 키에 이 탭이 시작한 잡을 붙인다. 본문이 늦게 렌더돼도 복원되도록 새 키마다 조회한다. */
  private async restore(keys: Set<string>): Promise<void> {
    let jobs: Job[] = [];
    try { jobs = await this.send('job/list-for-tab', undefined); } catch { return; }
    if (this.stopped) return;
    const done = new Set<string>();
    for (const job of jobs) {
      if (!job.ref) continue;
      const key = keyOfRef(job.ref);
      if (done.has(key) || !keys.has(key) || !this.entries.has(key)) continue;
      if (!isActive(job) && this.now() - Date.parse(job.updatedAt) > RESTORE_WINDOW_MS) continue;
      done.add(key);
      this.jobToKey.set(job.id, key);
      this.applyJob(key, job, false);
    }
  }

  private render(key: string): void {
    const entry = this.entries.get(key);
    const set = this.buttons.get(key);
    if (!entry || !set) return;
    const view = rowView(entry, { orphaned: this.orphaned || this.isOrphaned() });
    for (const h of set) h.render(view);
  }

  private renderAll(): void { for (const k of this.buttons.keys()) this.render(k); }

  /** 오래된 스냅샷(폴링/푸시 경합)이면 true */
  private isStale(job: Job, cur: Job | null): boolean {
    if (!cur || cur.id !== job.id) return false;
    if (job.attempt < cur.attempt) return true;
    if (job.attempt === cur.attempt) {
      if (job.updatedAt < cur.updatedAt) return true;
      if (isActive(job) && !isActive(cur) && cur.status !== 'interrupted') return true; // FINAL을 ACTIVE로 되돌리지 않는다
    }
    return false;
  }

  /** collect 잡의 handoff.jobId가 새 compose 잡을 가리키면 등록하고 조회한다. */
  private syncCompose(key: string, job: Job): void {
    const id = composeIdOf(job);
    if (!id || this.jobToKey.get(id) === key) return;
    this.jobToKey.set(id, key);
    void this.track(this.fetchJob(id));
  }

  private applyJob(key: string, job: Job, lookupOnFinal = true): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    if (job.type === 'compose') {
      if (this.isStale(job, entry.compose)) return;
      entry.compose = job;
      this.render(key);
      this.ensurePoll();
      return;
    }
    const cur = entry.job;
    if (this.isStale(job, cur)) return;
    const wasActive = isActive(cur);
    if (!cur || cur.id !== job.id) entry.compose = null; // 새 수집 잡이면 이전 compose는 버린다
    entry.job = job;
    entry.otherTab = false;
    this.render(key);
    this.syncCompose(key, job);
    this.ensurePoll();
    if (lookupOnFinal && wasActive && !isActive(job)) void this.track(this.refreshLookup(key));
  }

  private async refreshLookup(key: string): Promise<void> {
    const e = this.entries.get(key);
    if (!e) return;
    try {
      const l = await this.send('notice/lookup', { noticeNo: e.ref.noticeNo, round: e.ref.round });
      if (!this.stopped) { e.lookup = l; this.render(key); }
    } catch { /* 기존 값 유지 */ }
  }

  async collect(key: string, retryOf?: string): Promise<void> {
    const entry = this.entries.get(key);
    if (!entry || entry.starting || isActive(entry.job)) return;
    entry.starting = true;
    entry.error = null;
    entry.otherTab = false;
    this.render(key);
    try {
      const r = await this.send('job/start', { type: 'collect', ref: entry.ref, ...(retryOf ? { retryOf } : {}) });
      if (r.code) {
        // 충돌한 잡을 조회해 본다. 이 탭의 잡이면 붙이고, 아니면(다른 탭) 안내만 한다.
        let other: Job | null = null;
        try { other = await this.send('job/get', { jobId: r.jobId }); } catch { /* 안내만 */ }
        if (other) { this.jobToKey.set(other.id, key); this.applyJob(key, other); }
        else entry.otherTab = true;
      } else {
        this.jobToKey.set(r.jobId, key);
        await this.fetchJob(r.jobId);
      }
    } catch (e) {
      entry.error = e instanceof Error ? e.message : String(e);
    } finally {
      entry.starting = false;
      this.render(key);
    }
  }

  async cancel(key: string): Promise<void> {
    const entry = this.entries.get(key);
    const job = isActive(entry?.compose ?? null) ? entry!.compose! : entry?.job;
    if (!job || !isActive(job)) return;
    try { await this.send('job/cancel', { jobId: job.id }); } catch { /* 다음 갱신에서 반영 */ }
    await this.fetchJob(job.id);
  }

  private async onAction(key: string, a: 'retry' | 'grant' | RowSubAction): Promise<void> {
    const entry = this.entries.get(key);
    if (a === 'retry') { await this.collect(key, entry?.job?.id); return; }
    const noticeId = entry?.job ? handoffView(entry.job, entry.compose)?.noticeId ?? key : key;
    const payload = a === 'open-mail' ? { page: 'mail' as const, noticeId } : a === 'open-review' ? { page: 'review' as const, noticeId } : { page: a };
    try { await this.send('ui/open', payload); } catch { /* 무시 */ }
  }

  private async fetchJob(jobId: string): Promise<void> {
    const key = this.jobToKey.get(jobId);
    if (!key || this.stopped) return;
    if (this.isOrphaned()) { this.markOrphaned(); return; }
    let job: Job | null = null;
    try {
      job = await this.send('job/get', { jobId });
      this.pollFails = 0;
    } catch {
      if (this.isOrphaned() || ++this.pollFails >= MAX_POLL_FAILS) this.markOrphaned();
      return;
    }
    if (this.stopped || !job) return;
    this.applyJob(key, job);
  }

  private async refetchActive(): Promise<void> {
    const ids = new Set<string>();
    for (const e of this.entries.values()) {
      if (isActive(e.job) || handoffQueued(e.job)) ids.add(e.job!.id);
      if (isActive(e.compose)) ids.add(e.compose!.id);
      const cid = composeIdOf(e.job);
      if (cid && !e.compose) ids.add(cid); // 최초 조회가 실패한 경우 재시도
    }
    await Promise.all([...ids].map((id) => this.fetchJob(id)));
  }

  private markOrphaned(): void {
    this.orphaned = true;
    clearInterval(this.poll);
    this.poll = undefined;
    this.renderAll();
  }

  /** 진행 중 잡이 있고 탭이 보일 때만 타이머 1개로 전체를 조회한다. */
  private ensurePoll(): void {
    const need = !this.stopped && !this.orphaned && this.doc.visibilityState === 'visible'
      && [...this.entries.values()].some((e) => isActive(e.job) || isActive(e.compose) || handoffQueued(e.job) || (!!composeIdOf(e.job) && !e.compose));
    if (need && !this.poll) {
      this.pollFails = 0;
      this.poll = setInterval(() => {
        if (this.doc.visibilityState !== 'visible') return;
        void this.track(this.refetchActive());
      }, POLL_MS);
    } else if (!need && this.poll) {
      clearInterval(this.poll);
      this.poll = undefined;
    }
  }

  onProgress(jobId: string): void { if (this.jobToKey.has(jobId)) void this.track(this.fetchJob(jobId)); }
  onJobUpdate(job: Job): void {
    const key = this.jobToKey.get(job.id);
    if (key) this.applyJob(key, job);
  }
  onPermissionGranted(): void {
    for (const e of this.entries.values()) {
      const j = e.job;
      if (j && (j.status === 'failed' || j.status === 'interrupted') && j.errors[0]?.code === 'NEEDS_FS_PERMISSION') void this.collect(e.key, j.id);
    }
  }
}
