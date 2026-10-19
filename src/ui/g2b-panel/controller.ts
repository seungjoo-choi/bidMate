import { refsConflict } from '../../core/model/job-conflict';
import { defaultIsVisible, detectDetail, peekNoticeValue, readHtmlFields, readPageTitle, type DetectedDetail } from '../../adapters/g2b/detail-page';
import type { Job } from '../../core/types/job';
import { EVAL_COLLECT_UI_TIMEOUT_MS } from '../../core/evaluation/limits';
import { evalErrorText } from '../../core/evaluation/error-text';
import { send } from '../../messaging/bus';
import type { FixTarget, G2bDetected, NoticeLookup } from '../../messaging/protocol';
import { handoffView, type HandoffAction } from '../handoff-view';

const ACTIVE = new Set(['queued', 'running', 'cancelling']);
const POLL_MS = 3000;
const PEEK_MS = 2000;
const DEBOUNCE_MS = 300;
const MAX_WAIT_MS = 1000;
const MAX_POLL_FAILS = 3;
const MAX_TITLE_READS = 5;
const RESTORE_WINDOW_MS = 10 * 60 * 1000;

export interface PanelState {
  notice: DetectedDetail | null;
  title?: string;
  job: Job | null;
  /** collect 잡의 handoff.jobId가 가리키는 자동 작성 compose 잡 */
  compose: Job | null;
  lookup: NoticeLookup;
  startError: string | null;
  /** 사이드 패널 열기 실패 문구 */
  sidePanelError: string | null;
  starting: boolean;
  /** 다른 탭의 잡이 같은 공고를 수집 중(JOB_ALREADY_RUNNING) */
  otherTab: boolean;
  /** 확장이 업데이트되어 이 페이지의 content script가 고아가 됨 */
  orphaned: boolean;
  /** 평가점수 가져오기 진행 중(버튼이 다시 그려져도 중복 실행을 막는다) */
  evalBusy: boolean;
}

const isActive = (j: Job | null): boolean => !!j && ACTIVE.has(j.status);
/** 자동 작성 대기 중이라 compose 잡이 아직 없는 상태 */
const handoffQueued = (j: Job | null): boolean => j?.handoff?.action === 'compose' && j.handoff.state === 'queued';
const sameNotice = (a: DetectedDetail | null, b: DetectedDetail | null) => a?.noticeNo === b?.noticeNo && a?.round === b?.round;
const extAlive = (): boolean => !!globalThis.chrome?.runtime?.id;

/** 상세화면 감지/잡 추적/SW 통신을 맡는 비-React 컨트롤러. 나라장터 DOM은 읽기만 한다. */
export class PanelController {
  private state: PanelState = {
    notice: null, job: null, compose: null, lookup: { found: false }, startError: null, sidePanelError: null, starting: false, otherTab: false, orphaned: false, evalBusy: false,
  };
  private listeners = new Set<() => void>();
  private jobId: string | null = null;
  private composeId: string | null = null;
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pendingSince = 0;
  private poll: ReturnType<typeof setInterval> | undefined;
  private peek: ReturnType<typeof setInterval> | undefined;
  private lastPeek: string | null = null;
  private pollFails = 0;
  private titleReads = 0;
  private observer: MutationObserver | undefined;

  constructor(private doc: Document = document) {}

  subscribe = (fn: () => void): (() => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  getSnapshot = (): PanelState => this.state;
  private set(patch: Partial<PanelState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  start(): void {
    this.stopped = false;
    this.observer = new MutationObserver(() => this.schedule());
    this.observer.observe(this.doc.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style', 'class'] });
    this.doc.addEventListener('visibilitychange', this.onVisible);
    // 값(value)만 바뀌는 공고 전환은 MutationObserver가 못 잡으므로 입찰공고번호 값만 가볍게 확인한다.
    this.peek = setInterval(() => {
      if (this.doc.visibilityState !== 'visible' || !this.state.notice) return;
      if (peekNoticeValue(this.doc) !== this.lastPeek) { this.detect(); return; }
      // 공고명이 늦게 채워지는 경우: 비어 있으면 최대 5회까지 다시 읽는다.
      if (!this.state.title && this.titleReads < MAX_TITLE_READS) {
        this.titleReads++;
        const t = readPageTitle(this.doc);
        if (t) this.set({ title: t });
      }
    }, PEEK_MS);
    this.detect();
  }

  stop(): void {
    this.stopped = true;
    this.observer?.disconnect();
    this.doc.removeEventListener('visibilitychange', this.onVisible);
    clearTimeout(this.timer);
    this.pendingSince = 0;
    clearInterval(this.poll);
    clearInterval(this.peek);
    this.poll = this.peek = undefined;
  }

  private onVisible = () => {
    if (this.doc.visibilityState !== 'visible') return;
    if (this.jobId) void this.fetchJob();
    void this.fetchCompose();
    this.ensurePoll();
  };

  /** 300ms 디바운스 + 최대 1000ms 대기 */
  private schedule(): void {
    const now = Date.now();
    if (!this.pendingSince) this.pendingSince = now;
    clearTimeout(this.timer);
    const wait = Math.max(0, Math.min(DEBOUNCE_MS, this.pendingSince + MAX_WAIT_MS - now));
    this.timer = setTimeout(() => { this.pendingSince = 0; this.detect(); }, wait);
  }

  private detect(): void {
    if (this.stopped) return;
    this.lastPeek = peekNoticeValue(this.doc);
    const found = detectDetail(this.doc, { url: location.href });
    if (sameNotice(found, this.state.notice)) return;
    // 공고가 바뀌면 초기화한다. 진행 중 잡은 유지한다.
    const keepJob = isActive(this.state.job);
    this.set({
      notice: found, title: found ? readPageTitle(this.doc) : undefined, startError: null, otherTab: false,
      ...(keepJob ? {} : { job: null, compose: null, lookup: { found: false } }),
    });
    this.titleReads = 0;
    if (!keepJob) { this.jobId = null; this.composeId = null; }
    if (found) {
      void this.refreshLookup(found);
      if (!keepJob) void this.restoreJob(found);
    }
  }

  private async refreshLookup(n: DetectedDetail): Promise<void> {
    let lookup: NoticeLookup = { found: false };
    try { lookup = await send('notice/lookup', { noticeNo: n.noticeNo, round: n.round }); } catch { /* found:false */ }
    if (!this.stopped && sameNotice(this.state.notice, n)) this.set({ lookup });
  }

  /** 새로고침 등으로 잃은 이전 잡을 SW(ledger)에서 복원한다. 저장소는 쓰지 않는다. */
  private async restoreJob(n: DetectedDetail): Promise<void> {
    let job: Job | null = null;
    try { job = await send('job/latest-for-tab', { noticeNo: n.noticeNo, round: n.round }); } catch { return; }
    if (this.stopped || !job || this.jobId || !sameNotice(this.state.notice, n)) return;
    if (!isActive(job) && Date.now() - Date.parse(job.updatedAt) > RESTORE_WINDOW_MS) return;
    this.jobId = job.id;
    this.set({ job });
    this.syncCompose(job);
    this.ensurePoll();
  }

  /** popup g2b/detect 응답용 */
  detected(): G2bDetected | null {
    const n = this.state.notice;
    return n ? { noticeNo: n.noticeNo, round: n.round, title: this.state.title } : null;
  }

  /** 보조 폴링: 보이는 탭에서 진행 중 잡이 있을 때만. 종료는 job/update 푸시가 주 경로. */
  private ensurePoll(): void {
    const need = !this.stopped && (isActive(this.state.job) || isActive(this.state.compose) || handoffQueued(this.state.job)) && this.doc.visibilityState === 'visible' && !this.state.orphaned;
    if (need && !this.poll) {
      this.pollFails = 0;
      this.poll = setInterval(() => {
        if (this.doc.visibilityState !== 'visible') return;
        void this.fetchJob();
        void this.fetchCompose();
      }, POLL_MS);
    } else if (!need && this.poll) {
      clearInterval(this.poll);
      this.poll = undefined;
    }
  }

  async fetchJob(): Promise<void> {
    const id = this.jobId;
    if (!id || this.stopped) return;
    if (!extAlive()) { this.markOrphaned(); return; }
    let job: Job | null = null;
    try {
      job = await send('job/get', { jobId: id });
      this.pollFails = 0;
    } catch {
      if (!extAlive() || ++this.pollFails >= MAX_POLL_FAILS) this.markOrphaned();
      return;
    }
    if (this.stopped || this.jobId !== id) return;
    if (!job) { this.jobId = null; this.composeId = null; this.set({ job: null, compose: null }); this.ensurePoll(); return; }
    this.applyJob(job);
  }

  private markOrphaned(): void {
    if (!extAlive()) this.set({ orphaned: true });
    clearInterval(this.poll);
    this.poll = undefined;
  }

  private applyJob(job: Job): void {
    const cur = this.state.job;
    if (cur && cur.id === job.id) {
      // 오래된 스냅샷(폴링/푸시 경합)은 버린다.
      if (job.attempt < cur.attempt) return;
      if (job.attempt === cur.attempt) {
        if (job.updatedAt < cur.updatedAt) return;
        if (isActive(job) && !isActive(cur) && cur.status !== 'interrupted') return; // FINAL을 ACTIVE로 되돌리지 않는다
      }
    }
    const wasActive = isActive(this.state.job);
    // 새 수집 잡이면 이전 잡의 compose는 버린다.
    const fresh = !cur || cur.id !== job.id;
    if (fresh) this.composeId = null;
    this.set(fresh ? { job, compose: null } : { job });
    this.syncCompose(job);
    this.ensurePoll();
    if (wasActive && !isActive(job) && this.state.notice) void this.refreshLookup(this.state.notice);
  }

  /** collect 잡의 handoff.jobId가 새 compose 잡을 가리키면 추적을 시작한다. */
  private syncCompose(job: Job): void {
    const id = job.handoff?.action === 'compose' ? job.handoff.jobId : undefined;
    if (!id || id === this.composeId) return;
    this.composeId = id;
    void this.fetchCompose();
  }

  async fetchCompose(): Promise<void> {
    const id = this.composeId;
    if (!id || this.stopped) return;
    if (!extAlive()) return;
    let job: Job | null = null;
    try { job = await send('job/get', { jobId: id }); } catch { return; }
    if (this.stopped || this.composeId !== id || !job) return;
    this.applyCompose(job);
  }

  private applyCompose(job: Job): void {
    const cur = this.state.compose;
    if (cur && cur.id === job.id) {
      if (job.attempt < cur.attempt) return;
      if (job.attempt === cur.attempt) {
        if (job.updatedAt < cur.updatedAt) return;
        if (isActive(job) && !isActive(cur) && cur.status !== 'interrupted') return;
      }
    }
    this.set({ compose: job });
    this.ensurePoll();
  }

  /** SW가 notifyTab으로 보낸 job/progress */
  onProgress(jobId: string): void {
    if (jobId === this.jobId) void this.fetchJob();
    else if (jobId === this.composeId) void this.fetchCompose();
  }
  /** SW가 종료 시 푸시한 스냅샷 */
  onJobUpdate(job: Job): void {
    if (job.id === this.jobId) this.applyJob(job);
    else if (job.id === this.composeId) this.applyCompose(job);
  }

  /** handoff 줄의 버튼 동작 */
  async handoffAction(a: HandoffAction): Promise<void> {
    const job = this.state.job;
    if (!job) return;
    const v = handoffView(job, this.state.compose);
    switch (a) {
      case 'open-mail': this.openUi('mail', v?.noticeId); return;
      case 'open-review': this.openUi('review', v?.noticeId); return;
      case 'settings': this.openFix(v?.fix); return;
      case 'dequeue':
        try { await send('auto-compose/dequeue', { collectJobId: job.id }); } catch { /* 다음 갱신에서 반영 */ }
        await this.fetchJob();
        return;
      case 'cancel-compose': {
        const id = v?.composeJobId;
        if (!id) return;
        try { await send('job/cancel', { jobId: id }); } catch { /* 다음 갱신에서 반영 */ }
        await this.fetchCompose();
        return;
      }
      case 'none': return;
    }
  }

  /** 현재 화면의 공고와 잡의 공고가 다르면 true */
  isForeign(job: Job | null = this.state.job): boolean {
    const n = this.state.notice;
    return !!job?.ref && !!n && !refsConflict(job.ref, n);
  }

  /** 클릭/popup 공통 수집 시작. retryOf가 있으면 해당 잡을 재개한다. */
  async collect(retryOf?: string): Promise<{ started: boolean; jobId?: string; code?: string }> {
    const n = this.state.notice;
    if (!n || this.state.starting) return { started: false };
    this.set({ starting: true, startError: null, otherTab: false });
    try {
      const t = readPageTitle(this.doc); // 클릭 시점에는 항상 다시 읽는다
      if (t) this.set({ title: t });
      const r = await send('job/start', {
        type: 'collect',
        ref: { noticeNo: n.noticeNo, round: n.round, origin: 'g2b', detailUrl: location.href },
        html: readHtmlFields(this.doc, { isVisible: defaultIsVisible }),
        ...(retryOf ? { retryOf } : {}),
      });
      if (r.code) {
        // 충돌한 잡을 조회해 본다. 이 탭의 잡이면 그 패널로 전환하고, 아니면(다른 탭) 현재 카드는 두고 안내만 덧붙인다.
        let other: Job | null = null;
        try { other = await send('job/get', { jobId: r.jobId }); } catch { /* 안내만 */ }
        if (other) { this.jobId = other.id; this.applyJob(other); }
        else this.set({ otherTab: true });
      } else {
        this.jobId = r.jobId;
        await this.fetchJob();
      }
      return { started: !r.code, jobId: r.jobId, code: r.code };
    } catch (e) {
      const code = (e as { code?: string }).code;
      this.set({ startError: e instanceof Error ? e.message : String(e) });
      return { started: false, code };
    } finally {
      this.set({ starting: false });
    }
  }

  /** 평가점수를 가져와 저장하고 평가분석 화면을 연다. 실패 문구는 코드별로 돌려준다. */
  async collectEval(): Promise<{ ok: true } | { ok: false; message: string }> {
    const n = this.state.notice;
    if (!n) return { ok: false, message: '공고를 확인하지 못했습니다.' };
    if (this.state.evalBusy) return { ok: false, message: '이미 평가점수를 가져오는 중입니다.' };
    this.set({ evalBusy: true });
    try {
      let noticeId: string;
      try {
        noticeId = (await send('eval/collect', { ref: { noticeNo: n.noticeNo, round: n.round } }, { timeoutMs: EVAL_COLLECT_UI_TIMEOUT_MS })).noticeId;
      } catch (e) {
        return { ok: false, message: evalErrorText((e as { code?: string }).code, e instanceof Error ? e.message : String(e)) };
      }
      try {
        await send('ui/open', { page: 'evaluation', noticeId });
      } catch {
        return { ok: false, message: '저장했지만 분석 화면을 열지 못했습니다. 대시보드 평가분석에서 확인하세요' };
      }
      return { ok: true };
    } finally {
      this.set({ evalBusy: false });
    }
  }

  /** 현재 공고의 잡만 재시도한다. */
  async retry(): Promise<void> {
    const j = this.state.job;
    if (!j || this.isForeign(j)) return;
    await this.collect(j.id);
  }
  async cancel(force = false): Promise<void> {
    if (!this.jobId) return;
    try { await send('job/cancel', { jobId: this.jobId, force }); } catch { /* 다음 갱신에서 반영 */ }
    await this.fetchJob();
  }
  /** 권한 허용 후 자동 재시도(현재 공고의 잡만) */
  onPermissionGranted(): void {
    const j = this.state.job;
    if (j && !this.isForeign(j) && (j.status === 'failed' || j.status === 'interrupted') && j.errors[0]?.code === 'NEEDS_FS_PERMISSION') void this.retry();
  }
  /** 완료 패널을 접어 상태 A로 돌린다. */
  dismissJob(): void {
    this.jobId = null;
    this.composeId = null;
    this.set({ job: null, compose: null });
    this.ensurePoll();
  }
  openUi(page: 'settings' | 'grant' | 'review' | 'mail', noticeId?: string): void { void send('ui/open', { page, noticeId }).catch(() => undefined); }
  /** 이 탭의 사이드 패널을 연다. 클릭 핸들러 안에서 바로 불러야 한다(사용자 제스처). */
  openSidePanel(): void {
    this.set({ sidePanelError: null });
    send('ui/open', { page: 'sidepanel' }).catch((e: unknown) => {
      this.set({ sidePanelError: `사이드 패널을 열지 못했습니다: ${e instanceof Error ? e.message : String(e)}` });
    });
  }
  /** 오류를 고칠 화면을 연다. 정해진 화면이 없으면 설정 첫 화면 */
  openFix(fix: FixTarget | undefined): void { void send('ui/open', fix ?? { page: 'settings' }).catch(() => undefined); }
}
