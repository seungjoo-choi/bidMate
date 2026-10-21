import { handoffAsk, handoffQueued, isActive, type TrackerbotController } from './controller';
import { createProgressCard, type ProgressCardHandle } from '../progress-card/card';
import { progressItems, progressPanelView, type ProgressItem, type ProgressSession } from './progress-view';

const AUTO_DISMISS_MS = 8000;
const HOVER_RECHECK_MS = 2000;

export interface ProgressPopupDeps { now?: () => number; createCard?: typeof createProgressCard; autoDismissMs?: number; hoverRecheckMs?: number }

/** 컨트롤러 상태를 구독해 우측 하단 진행 팝업을 그린다. 상태 변경은 취소·닫기·접기·완료 후 선택뿐이다. */
export class ProgressPopup {
  private card: ProgressCardHandle;
  private now: () => number;
  private autoDismissMs: number;
  private hoverRecheckMs: number;
  private seen = new Set<string>();
  private dismissed = new Map<string, string>();
  private collapsed = false;
  private hover = false;
  private okSince = new Map<string, number>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private scheduled = false;
  private stopped = false;
  private unsubscribe: (() => void) | undefined;
  private unReveal: (() => void) | undefined;
  private pendingStart = new Map<string, string | null>(); // key -> 시작 요청 당시 기존 잡 id

  constructor(doc: Document, private controller: TrackerbotController, deps: ProgressPopupDeps = {}) {
    this.now = deps.now ?? Date.now;
    this.autoDismissMs = deps.autoDismissMs ?? AUTO_DISMISS_MS;
    this.hoverRecheckMs = deps.hoverRecheckMs ?? HOVER_RECHECK_MS;
    this.card = (deps.createCard ?? createProgressCard)(doc, {
      cancel: (key) => { void this.controller.cancel(key); },
      dismiss: (key) => { this.dismiss(key); this.refresh(); },
      dismissAll: () => {
        for (const it of progressItems(this.controller.getEntries(), this.getSession())) if (it.state !== 'active') this.dismiss(it.key);
        this.refresh();
      },
      toggleCollapse: () => { this.collapsed = !this.collapsed; this.refresh(); },
      action: (key, a) => { void this.controller.onAction(key, a); },
      hover: (over) => { this.hover = over; },
    });
  }

  start(): void {
    this.stopped = false;
    this.unsubscribe = this.controller.subscribe(() => this.schedule());
    this.unReveal = this.controller.onReveal((key) => this.reveal(key));
    this.refresh();
  }

  stop(): void {
    this.stopped = true;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.unReveal?.();
    this.unReveal = undefined;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.okSince.clear();
    this.card.dispose();
  }

  getSession(): ProgressSession {
    return { seen: this.seen, dismissed: this.dismissed, collapsed: this.collapsed };
  }

  /** 컨트롤러는 동기 통지하므로 한 틱에 모아 1회만 그린다. */
  private schedule(): void {
    if (this.scheduled || this.stopped) return;
    this.scheduled = true;
    queueMicrotask(() => { this.scheduled = false; this.refresh(); });
  }

  /** 행의 "수집 중"을 누르면 접힌 팝업을 펼치고 그 항목을 강조한다 */
  private reveal(key: string): void {
    if (this.stopped) return;
    this.collapsed = false;
    this.refresh();
    this.card.flash(key);
  }

  private dismiss(key: string): void {
    const job = this.controller.getEntry(key)?.job;
    if (job) this.dismissed.set(key, job.id);
  }

  private refresh(): void {
    if (this.stopped) return;
    if (this.controller.isOrphaned()) {
      this.card.render({ kind: 'hidden' });
      return;
    }
    const entries = this.controller.getEntries();
    for (const e of entries) {
      // ask 대기 잡은 새로고침 뒤에도 다시 보이게 관측으로 친다
      if (isActive(e.job) || handoffQueued(e.job) || handoffAsk(e.job)) this.seen.add(e.job!.id);
      if (isActive(e.compose)) this.seen.add(e.compose!.id);
      // 시작 요청 중이던 키에 잡이 생기면 즉시 실패해도 팝업에 남도록 관측으로 친다
      if (e.starting) { if (!this.pendingStart.has(e.key)) this.pendingStart.set(e.key, e.job?.id ?? null); }
      else if (this.pendingStart.has(e.key)) {
        if (e.job && e.job.id !== this.pendingStart.get(e.key)) this.seen.add(e.job.id);
        this.pendingStart.delete(e.key);
      }
    }
    // 자동 소멸은 접힘·절단과 무관하게 전체 항목 기준
    this.trackAutoDismiss(progressItems(entries, this.getSession()));
    this.card.render(progressPanelView(entries, this.getSession()));
  }

  /** ok 항목만(선택 대기 중인 awaiting 제외) 일정 시간 뒤 자동으로 닫는다. ok가 아니게 된 키는 타이머를 버린다(수집 완료 -> 메일 작성 흐름). */
  private trackAutoDismiss(items: ProgressItem[]): void {
    const okKeys = new Set(items.filter((i) => i.state === 'ok' && !i.awaiting).map((i) => i.key));
    for (const key of [...this.okSince.keys()]) {
      if (okKeys.has(key)) continue;
      this.okSince.delete(key);
      clearTimeout(this.timers.get(key));
      this.timers.delete(key);
    }
    for (const key of okKeys) {
      if (this.okSince.has(key)) continue;
      this.okSince.set(key, this.now());
      this.arm(key, this.autoDismissMs);
    }
  }

  private arm(key: string, ms: number): void {
    this.timers.set(key, setTimeout(() => {
      if (this.stopped) return;
      if (this.hover) { this.arm(key, this.hoverRecheckMs); return; }
      this.timers.delete(key);
      this.dismiss(key);
      this.refresh();
    }, ms));
  }
}
