import { scanG2bLinks } from '../../adapters/trackerbot/mail-scan';
import { linkToNoticeRef } from '../../adapters/g2b/link';
import { noticeIdOf } from '../../core/model/ids';
import type { NoticeKind } from '../../core/types/notice';
import type { Job } from '../../core/types/job';
import { send as defaultSend } from '../../messaging/bus';
import type { FixTarget, NoticeLookup } from '../../messaging/protocol';
import { createRowButton, type RowButtonHandle } from './row-button';
import { handoffView } from '../handoff-view';
import { rowView, type RowEntry, type RowSubAction } from './row-view';

/** 진행 팝업의 완료 후 선택 버튼 */
export type PopupChoiceAction = 'choose-dashboard' | 'choose-compose';

export const ACTIVE =new Set(['queued', 'running', 'cancelling']);
const DEBOUNCE_MS = 300;
const MAX_WAIT_MS = 1000;
const POLL_MS = 3000;
const MAX_POLL_FAILS = 3;
const RESTORE_WINDOW_MS = 10 * 60 * 1000;
const LOOKUP_BATCH = 200;

/** 자동 작성 대기 중이라 compose 잡이 아직 없는 상태 */
export const handoffQueued = (j: Job | null): boolean => j?.handoff?.action === 'compose' && j.handoff.state === 'queued';
/** 수집이 끝나 사용자의 완료 후 선택(대시보드 편집/바로 작성)을 기다리는 상태 */
export const handoffAsk = (job?: Job | null): boolean => job?.handoff?.action === 'ask';
const composeIdOf =(j: Job | null): string | undefined => (j?.handoff?.action === 'compose' ? j.handoff.jobId : undefined);
export const isActive = (j: Job | null): boolean => !!j && ACTIVE.has(j.status);
const extAlive = (): boolean => !!globalThis.chrome?.runtime?.id;
const keyOfRef = (r: { kind?: NoticeKind; noticeNo: string; round?: string }): string => noticeIdOf(r);
/** lookup payload용. bid는 kind를 생략한다(정규형). */
const lookupRef = (r: { kind?: NoticeKind; noticeNo: string; round?: string }): { kind?: NoticeKind; noticeNo: string; round?: string } =>
  ({ ...(r.kind && r.kind !== 'bid' ? { kind: r.kind } : {}), noticeNo: r.noticeNo, round: r.round });

export interface TrackerbotDeps { send?: typeof defaultSend; now?: () => number; isOrphaned?: () => boolean }

/** 트래커봇 메일의 입찰정보 행에 [공고 수집] 버튼을 붙이고 잡 상태를 반영한다. 웹메일 DOM은 읽기만 한다. */
export class TrackerbotController {
  private entries = new Map<string, RowEntry>();
  private buttons = new Map<string, Set<RowButtonHandle>>();
  private jobToKey = new Map<string, string>();
  private send: typeof defaultSend;
  private now: () => number;
  private isOrphanedDep: () => boolean;
  private stopped = false;
  private observer: MutationObserver | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pendingSince = 0;
  private poll: ReturnType<typeof setInterval> | undefined;
  private pollFails = 0;
  private orphaned = false;
  private inflight = new Set<Promise<unknown>>();
  private listeners = new Set<() => void>();
  private revealListeners = new Set<(key: string) => void>();

  constructor(private doc: Document, deps: TrackerbotDeps = {}) {
    this.send = deps.send ?? defaultSend;
    this.now = deps.now ?? Date.now;
    this.isOrphanedDep = deps.isOrphaned ?? (() => !extAlive());
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
  getEntries(): RowEntry[] { return [...this.entries.values()]; }
  isOrphaned(): boolean { return this.orphaned || this.isOrphanedDep(); }

  /** 엔트리 상태 변화를 동기 통지한다(코얼레싱은 구독자 책임). 해제 함수를 반환한다. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  /** 행의 "수집 중"을 누르면 진행 팝업이 그 항목을 보이도록 알린다. 해제 함수를 반환한다. */
  onReveal(fn: (key: string) => void): () => void {
    this.revealListeners.add(fn);
    return () => { this.revealListeners.delete(fn); };
  }

  private reveal(key: string): void {
    for (const fn of [...this.revealListeners]) { try { fn(key); } catch { /* 구독자 오류는 무시 */ } }
  }

  /** 행 버튼 중 화면에 붙어 있는 첫 host로 스크롤한다. */
  focusRow(key: string): void {
    for (const h of this.buttons.get(key) ?? []) {
      if (h.host.isConnected) { h.host.scrollIntoView({ block: 'center', behavior: 'smooth' }); h.flash(); return; }
    }
  }

  private notify(): void {
    for (const fn of [...this.listeners]) { try { fn(); } catch { /* 구독자 오류는 무시 */ } }
  }

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
    let titleChanged = false;
    for (const s of scanG2bLinks(this.doc)) {
      const ref = linkToNoticeRef(s.link, 'trackerbot');
      if (!ref) continue;
      const key = keyOfRef(ref);
      let entry = this.entries.get(key);
      if (!entry) {
        entry = { key, ref, title: s.title, lookup: { found: false }, job: null, compose: null, starting: false, error: null, otherTab: false };
        this.entries.set(key, entry);
        newKeys.push(key);
      } else if (!entry.title && s.title) { entry.title = s.title; titleChanged = true; }
      const next = s.anchor.nextElementSibling; // 우리 host가 지워졌으면 다시 만든다
      if (next && next.getAttribute('data-bidmate') === 'collect') continue;
      const handle = createRowButton(s.anchor, {
        collect: () => { void this.collect(key); },
        reveal: () => this.reveal(key),
        action: (a) => { void this.onAction(key, a); },
      });
      let set = this.buttons.get(key);
      if (!set) this.buttons.set(key, (set = new Set()));
      set.add(handle);
      handle.render(rowView(entry, { orphaned: this.orphaned || this.isOrphanedDep() }));
    }
    for (const set of this.buttons.values()) for (const h of set) if (!h.host.isConnected) set.delete(h);
    if (titleChanged) this.notify();
    if (newKeys.length > 0) void this.track(this.loadNew(newKeys));
  }

  private async loadNew(keys: string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += LOOKUP_BATCH) {
      const chunk = keys.slice(i, i + LOOKUP_BATCH);
      let res: NoticeLookup[] = [];
      try {
        res = await this.send('notice/lookup-batch', { refs: chunk.map((k) => lookupRef(this.entries.get(k)!.ref)) });
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
      // 선택 대기(ask)는 사용자가 고를 때까지 남아야 하므로 복원 창과 무관하게 복원한다
      if (!isActive(job) && !handoffAsk(job) && this.now() - Date.parse(job.updatedAt) > RESTORE_WINDOW_MS) continue;
      done.add(key);
      this.jobToKey.set(job.id, key);
      this.applyJob(key, job, false);
    }
  }

  private render(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.notify();
    const set = this.buttons.get(key);
    if (!set) return;
    const view = rowView(entry, { orphaned: this.orphaned || this.isOrphanedDep() });
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
      const l = await this.send('notice/lookup', lookupRef(e.ref));
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

  /** 수집 중인 잡의 "완료 후 동작"을 이번 건만 바꾸거나, 끝난 ask 잡의 선택을 확정한다 */
  async chooseAfterCollect(key: string, value: 'dashboard' | 'compose'): Promise<void> {
    const job = this.entries.get(key)?.job;
    if (!job || !(job.type === 'collect' && (isActive(job) || handoffAsk(job)))) return;
    try { await this.send('auto-compose/choose', { collectJobId: job.id, afterCollect: value }); } catch { /* 다음 갱신에서 반영 */ }
    await this.fetchJob(job.id);
  }

  /** 행 버튼 동작. 진행 팝업의 끝난 항목 버튼도 이 경로를 쓴다 */
  async onAction(key: string, a: 'retry' | 'grant' | RowSubAction | PopupChoiceAction): Promise<void> {
    const entry = this.entries.get(key);
    if (a === 'retry') { await this.collect(key, entry?.job?.id); return; }
    if (a === 'choose-dashboard') { await this.chooseAfterCollect(key, 'dashboard'); return; }
    if (a === 'choose-compose') { await this.chooseAfterCollect(key, 'compose'); return; }
    const noticeId = entry?.job ? handoffView(entry.job, entry.compose)?.noticeId ?? key : key;
    const payload = a === 'open-mail' ? { page: 'mail' as const, noticeId } : a === 'open-review' ? { page: 'review' as const, noticeId } : a === 'settings' ? this.fixOf(entry) : a === 'sidepanel' ? { page: 'sidepanel' as const, noticeId } : { page: a };
    try { await this.send('ui/open', payload); } catch { /* 무시 */ }
  }

  /** 행이 보여 주는 오류를 고칠 화면. 정해진 화면이 없으면 설정 첫 화면 */
  private fixOf(entry: RowEntry | undefined): FixTarget | { page: 'settings' } {
    if (!entry) return { page: 'settings' };
    const v = rowView(entry, { orphaned: false });
    return ((v.kind === 'error' || v.kind === 'done') && v.fix) || { page: 'settings' };
  }

  private async fetchJob(jobId: string): Promise<void> {
    const key = this.jobToKey.get(jobId);
    if (!key || this.stopped) return;
    if (this.isOrphanedDep()) { this.markOrphaned(); return; }
    let job: Job | null = null;
    try {
      job = await this.send('job/get', { jobId });
      this.pollFails = 0;
    } catch {
      if (this.isOrphanedDep() || ++this.pollFails >= MAX_POLL_FAILS) this.markOrphaned();
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
    this.notify();
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
