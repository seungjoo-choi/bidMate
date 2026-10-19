import { createMascotImg, ensureMascotStyle, setMascotMood } from '../mascot/dom';
import { STEP_ICON, STEP_ICON_CSS } from '../mascot/step-icons';
import type { ProgressActionId, ProgressItem, ProgressPanelView } from './progress-view';

export interface ProgressCardHandle { host: HTMLElement; render(view: ProgressPanelView): void; dispose(): void }

const STYLE = `
:host { all: initial; }
.root {
  --blue: #2563eb; --blue-soft: #eff6ff; --violet: #7c3aed; --violet-soft: #f5f3ff;
  --ok: #16a34a; --ok-soft: #f0fdf4; --warn: #d97706; --warn-soft: #fffbeb; --err: #dc2626; --err-soft: #fef2f2;
  --ink: #0f172a; --ink-2: #475569; --ink-3: #94a3b8; --line: #eef2f7;
  --surface: #fff; --hover: #f1f5f9; --track: #e2e8f0; --edge: rgba(15, 23, 42, 0.08);
  --act-line: #e2e8f0; --act-line-hover: #cbd5e1; --go-line: #bfdbfe; --stop-line: #fecaca;
  --shade-1: rgba(15, 23, 42, 0.06); --shade-2: rgba(15, 23, 42, 0.14); --shade-3: rgba(15, 23, 42, 0.18);
  color-scheme: light;
  position: fixed; right: 20px; bottom: 20px; z-index: 2147483000; width: 340px; max-width: calc(100vw - 40px);
  font-family: 'Pretendard', -apple-system, 'Segoe UI', 'Malgun Gothic', sans-serif; font-size: 12px; line-height: 17px; color: var(--ink-2);
  -webkit-font-smoothing: antialiased;
}
* { box-sizing: border-box; }
.card {
  background: var(--surface); border: 1px solid var(--edge); border-radius: 14px;
  box-shadow: 0 12px 32px var(--shade-2), 0 2px 6px var(--shade-1);
  animation: bm-in 180ms ease-out;
}
@keyframes bm-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
button { font: inherit; cursor: pointer; border: 0; background: none; color: inherit; padding: 0; white-space: nowrap; }
button[disabled] { cursor: default; opacity: 0.6; }
button:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
svg { display: block; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

.head { display: flex; align-items: center; gap: 10px; padding: 12px 10px 12px 14px; border-bottom: 1px solid var(--line); }
/* 헤더에서 카드 위로 걸터앉은 마스코트와 말풍선. 기분(data-mood)은 render가 정한다 */
/* 칸 너비 = 마스코트 너비. 옆의 BidMate 글자를 덮지 않게 칸 밖으로는 위로만 넘친다 */
.slot { position: relative; flex: none; width: 56px; height: 26px; }
.sitter { position: absolute; left: 0; bottom: -6px; width: 56px; height: 56px; z-index: 2; pointer-events: none; }
.sitter img { width: 56px; height: 56px; display: block; transform-origin: 50% 95%; }
.bubble { position: absolute; left: 62px; top: -26px; z-index: 3; pointer-events: none; max-width: calc(100% - 72px); padding: 6px 10px; border-radius: 10px 10px 10px 3px; background: var(--surface); color: var(--ink); font-size: 11.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; box-shadow: 0 6px 18px var(--shade-2), 0 0 0 1px var(--shade-1); }
.bubble b { color: var(--blue); font-variant-numeric: tabular-nums; }
.root[data-mood="sad"] .bubble, .root[data-mood="sad"] .bubble b { color: var(--err); }
.root[data-mood="hop"] .bubble b, .root[data-mood="done"] .bubble b { color: var(--ok); }
.bubble.pop { animation: bm-bubble 240ms ease-out; }
@keyframes bm-bubble { from { transform: translateY(4px) scale(.96); opacity: .4; } to { transform: none; opacity: 1; } }
.htext { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.name { font-size: 13px; font-weight: 700; color: var(--ink); letter-spacing: -0.01em; }
.headline { font-size: 11px; color: var(--ink-3); }
.headline.busy { color: var(--blue); }
.link { padding: 4px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; color: var(--ink-2); }
.link:hover { background: var(--hover); color: var(--ink); }
.icon-btn { width: 26px; height: 26px; border-radius: 7px; display: grid; place-items: center; color: var(--ink-3); }
.icon-btn:hover { background: var(--hover); color: var(--ink); }

.list { max-height: 44vh; overflow-y: auto; padding: 6px; }
.item { position: relative; display: flex; gap: 10px; padding: 10px; border-radius: 10px; }
.item + .item { margin-top: 2px; }
.item.warn { background: var(--warn-soft); }
.item.error { background: var(--err-soft); }
.badge { flex: none; width: 22px; height: 22px; margin-top: 1px; border-radius: 50%; display: grid; place-items: center; color: #fff; }
.item.active .badge, .item.arrive .badge { background: var(--blue-soft); color: var(--blue); }
.item.active.compose .badge { background: var(--violet-soft); color: var(--violet); }
.item.fail .badge { background: var(--err-soft); color: var(--err); }
.badge .swap { display: grid; place-items: center; animation: bm-swap 220ms ease-out; }
@keyframes bm-swap { from { transform: scale(.4); opacity: 0; } to { transform: none; opacity: 1; } }
.badge svg { overflow: visible; }
.item.ok .badge { background: var(--ok); }
.item.warn .badge { background: var(--warn); }
.item.error .badge { background: var(--err); }
.spin { animation: bm-spin 0.9s linear infinite; }
@keyframes bm-spin { to { transform: rotate(360deg); } }
.body { flex: 1; min-width: 0; }
.row1 { display: flex; align-items: center; gap: 6px; }
.title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; font-weight: 600; color: var(--ink); }
.chip { flex: none; font-size: 10.5px; font-weight: 600; line-height: 16px; padding: 0 7px; border-radius: 999px; background: var(--blue-soft); color: var(--blue); }
.chip.compose { background: var(--violet-soft); color: var(--violet); }
.x { flex: none; width: 20px; height: 20px; margin: -2px -4px -2px 0; border-radius: 6px; display: grid; place-items: center; color: var(--ink-3); }
.x:hover { background: var(--hover); color: var(--ink); }
.step { margin-top: 3px; font-weight: 600; }
.step.active { color: var(--blue); }
.step.ok { color: var(--ok); }
.step.warn { color: var(--warn); }
.step.error { color: var(--err); }
.detail { margin-top: 2px; color: var(--ink-2); white-space: pre-line; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; word-break: break-all; }
/* 진행 막대 + 막대 끝을 따라가는 마스코트 */
.rail { position: relative; margin-top: 16px; }
.gauge { height: 4px; border-radius: 999px; background: var(--track); }
.gauge > i { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, #60a5fa, var(--blue)); transition: width 700ms cubic-bezier(.25,.8,.35,1); }
/* 진행 중에는 막대 위로 빛이 지나가 오래 걸리는 단계에서도 멈춰 보이지 않게 한다 */
.gauge > i { position: relative; overflow: hidden; }
.item.active .gauge > i::after { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, rgba(255, 255, 255, .65), transparent); transform: translateX(-100%); animation: bm-sheen 1.6s ease-in-out infinite; }
@keyframes bm-sheen { to { transform: translateX(100%); } }
.item.compose .gauge > i { background: linear-gradient(90deg, #a78bfa, var(--violet)); }
.item.arrive .gauge > i { background: var(--ok); }
.item.fail .gauge > i { background: linear-gradient(90deg, #fca5a5, var(--err)); }
.runner { position: absolute; bottom: 1px; left: 0; width: 22px; height: 22px; margin-left: -11px; pointer-events: none; transition: left 700ms cubic-bezier(.25,.8,.35,1); }
.runner img { position: relative; z-index: 1; width: 22px; height: 22px; display: block; transform-origin: 50% 100%; }
.runner::after { content: ""; position: absolute; left: 50%; bottom: -2px; width: 12px; height: 3px; margin-left: -6px; border-radius: 50%; background: var(--shade-3); }
.actions { display: flex; gap: 6px; margin-top: 8px; }
.actions:not(:has(button:not([hidden]))) { display: none; }
.act { padding: 3px 10px; border-radius: 6px; font-size: 11px; font-weight: 600; background: var(--surface); color: var(--ink-2); box-shadow: inset 0 0 0 1px var(--act-line); }
.act:hover { color: var(--ink); box-shadow: inset 0 0 0 1px var(--act-line-hover); }
.act.go { color: var(--blue); box-shadow: inset 0 0 0 1px var(--go-line); }
.act.go:hover { background: var(--blue-soft); }
.act.stop:hover { color: var(--err); box-shadow: inset 0 0 0 1px var(--stop-line); }
.more { padding: 8px 14px 10px; color: var(--ink-3); font-size: 11px; text-align: center; border-top: 1px solid var(--line); }

.pill {
  display: inline-flex; align-items: center; gap: 8px; float: right; padding: 8px 14px 8px 10px; border-radius: 999px;
  background: var(--surface); color: var(--ink); font-weight: 600; border: 1px solid var(--edge);
  box-shadow: 0 8px 24px var(--shade-2), 0 1px 3px var(--shade-1);
}
.pill:hover { box-shadow: 0 10px 28px var(--shade-3), 0 1px 3px var(--shade-1); }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); }
.dot.busy { background: var(--blue); animation: bm-pulse 1.4s ease-out infinite; }
@keyframes bm-pulse { 0% { box-shadow: 0 0 0 0 rgba(37, 99, 235, 0.5); } 100% { box-shadow: 0 0 0 7px rgba(37, 99, 235, 0); } }
[hidden] { display: none !important; }
/* 다크모드: 토큰만 바꾼다. 색 계열은 사이드패널 테마(theme.css)와 맞춘다 */
@media (prefers-color-scheme: dark) {
  .root {
    --blue: #7fa6ec; --blue-soft: #1b222d; --violet: #b49cf0; --violet-soft: #241e33;
    --ok: #6cc08e; --ok-soft: #18241c; --warn: #e0a44a; --warn-soft: #2a2216; --err: #ec7a6d; --err-soft: #2c1a18;
    --ink: #e9e9e5; --ink-2: #b4b4ae; --ink-3: #7c7c76; --line: #2e2e2b;
    --surface: #1c1c1b; --hover: #2a2a28; --track: #2e2e2b; --edge: rgba(255, 255, 255, 0.08);
    --act-line: #3a3a37; --act-line-hover: #4a4a46; --go-line: #2c4466; --stop-line: #5a2c27;
    --shade-1: rgba(0, 0, 0, 0.35); --shade-2: rgba(0, 0, 0, 0.5); --shade-3: rgba(0, 0, 0, 0.6);
    color-scheme: dark;
  }
  .item.active .gauge > i::after { background: linear-gradient(90deg, transparent, rgba(255, 255, 255, .25), transparent); }
  .item.ok .badge, .item.warn .badge, .item.error .badge { color: #151514; }
}
@media (prefers-reduced-motion: reduce) { *, *::after { animation: none !important; transition: none !important; } }
`;

const PHASE_CHIP = { collect: '수집', compose: '메일 작성' } as const;

// 아이콘(정적 문자열, 사용자 입력 없음)
const ICON = {
  spin: '<svg class="spin" width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-opacity="0.2" stroke-width="3"/><path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>',
  ok: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  warn: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"><path d="M12 6v7"/><path d="M12 18h.01"/></svg>',
  error: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  x: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  down: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
} as const;

/** active가 끝난 직후 막대 위 마스코트가 도착(점프)/실패(흔들기)를 보여 주는 시간 */
const TRANSIT_MS = 1300;
/** 진행률이 없는 단계 동안 막대가 단계 몫 안에서 차오르는 속도(시간 상수)와 상한(단계 몫 대비) */
const CREEP_TAU_MS = 9000;
const CREEP_MAX = 0.9;
const CREEP_TICK_MS = 400;
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** 웹메일 우측 하단 진행 팝업 카드. 상태는 갖지 않고 view를 그리기만 한다. */
export function createProgressCard(
  doc: Document,
  on: {
    cancel(key: string): void; dismiss(key: string): void; dismissAll(): void;
    toggleCollapse(): void; action(key: string, id: ProgressActionId): void; hover(over: boolean): void;
  },
): ProgressCardHandle {
  const host = doc.createElement('div');
  host.setAttribute('data-bidmate', 'progress');
  const shadow = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = STYLE + STEP_ICON_CSS;
  const root = doc.createElement('div');
  root.className = 'root';
  shadow.append(style, root);
  ensureMascotStyle(shadow);
  // 웹메일(Gmail 단축키 등)로 키·클릭이 새지 않게 한다. wheel은 목록 스크롤을 위해 막지 않는다
  for (const t of ['click', 'pointerdown', 'mousedown', 'keydown', 'keyup', 'keypress']) host.addEventListener(t, (e) => e.stopPropagation());
  host.addEventListener('mouseenter', () => on.hover(true));
  host.addEventListener('mouseleave', () => on.hover(false));

  const el = (tag: string, cls?: string, text?: string): HTMLElement => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const btn = (text: string, cls: string, handler: (() => void) | null): HTMLButtonElement => {
    const b = el('button', cls, text) as HTMLButtonElement;
    b.type = 'button';
    if (handler) b.addEventListener('click', handler);
    else b.disabled = true;
    return b;
  };
  /** 아이콘 버튼. 라벨은 화면에서 숨기고 textContent·title로 남긴다 */
  const iconBtn = (label: string, icon: string, cls: string, handler: () => void): HTMLButtonElement => {
    const b = btn('', cls, handler);
    b.innerHTML = icon;
    b.append(el('span', 'sr', label));
    b.title = label;
    b.setAttribute('aria-label', label);
    return b;
  };

  interface ItemNode {
    el: HTMLElement; badge: HTMLElement; title: HTMLElement; chip: HTMLElement; step: HTMLElement; detail: HTMLElement;
    rail: HTMLElement; bar: HTMLElement; runner: HTMLElement; cancel: HTMLButtonElement; acts: HTMLButtonElement[]; dismiss: HTMLButtonElement;
    actIds: Array<ProgressActionId | undefined>;
    state?: ProgressItem['state'];
    /** 배지에 그려 둔 아이콘 키. 같으면 다시 그리지 않는다(애니메이션이 처음부터 돌지 않게) */
    iconKey?: string;
    /** active -> 끝 전환 직후 잠깐 보여 주는 표시 상태 */
    transit?: 'arrive' | 'fail';
    transitTimer?: ReturnType<typeof setTimeout>;
    /** 마지막으로 받은 항목(차오름 타이머가 다시 그릴 때 쓴다) */
    item?: ProgressItem;
    /** 막대에 그린 비율. 뒤로 가지 않는다 */
    shown?: number;
    /** 차오름 기준: 현재 단계 id, 단계가 시작된 시각, 그때의 비율 */
    creepStep?: string;
    creepAt?: number;
    creepBase?: number;
  }
  const nodes = new Map<string, ItemNode>();
  let mode: 'none' | 'pill' | 'card' = 'none';
  let headline: HTMLElement;
  let dismissAllBtn: HTMLButtonElement;
  let list: HTMLElement;
  let more: HTMLElement;
  let bubble: HTMLElement;
  let lastView: ProgressPanelView | undefined;
  let ticker: ReturnType<typeof setInterval> | undefined;

  /**
   * 막대에 그릴 비율. 실제 ratio는 끝난 단계 수 기준이라 오래 걸리는 단계 동안 멈춰 있으므로,
   * 진행률이 없는 단계 동안 단계 몫 안에서 시간에 따라 천천히 차오르는 값과 비교해 큰 쪽을 쓴다.
   */
  const shownRatio = (n: ItemNode, it: ProgressItem): number => {
    const real = clamp01(it.ratio ?? 0);
    const now = Date.now();
    const key = it.stepId ?? '';
    if (n.creepStep !== key || n.creepAt === undefined) {
      n.creepStep = key;
      n.creepAt = now;
      n.creepBase = Math.max(n.shown ?? 0, real);
    }
    const creep = (n.creepBase ?? 0) + (it.stepSpan ?? 0) * CREEP_MAX * (1 - Math.exp(-(now - n.creepAt) / CREEP_TAU_MS));
    const v = clamp01(Math.max(real, creep, n.shown ?? 0));
    n.shown = v;
    return v;
  };
  const paintRatio = (n: ItemNode, v: number): void => {
    const pct = `${Math.round(clamp01(v) * 100)}%`;
    n.bar.style.width = pct;
    n.runner.style.left = pct;
  };
  const stopTicker = (): void => { clearInterval(ticker); ticker = undefined; };
  const tick = (): void => {
    if (!host.isConnected || lastView?.kind !== 'card') { stopTicker(); return; }
    let any = false;
    for (const n of nodes.values()) {
      if (n.state !== 'active' || n.transit || !n.item) continue;
      any = true;
      paintRatio(n, shownRatio(n, n.item));
    }
    if (any) updateMood(lastView);
    else stopTicker();
  };

  // 페이지 CSP 등으로 못 불러오면 createMascotImg가 error 이벤트에서 숨긴다
  const mascot = (size: number): HTMLImageElement => createMascotImg(doc, { size });
  const setHops = (img: HTMLImageElement, hops: number | undefined): void => {
    if (hops) img.style.setProperty('--bm-hops', String(hops));
    else img.style.removeProperty('--bm-hops');
  };

  // 렌더마다 노드를 새로 만들면 mousedown 중인 버튼이 교체돼 click이 사라진다. key별 노드를 만들어 재사용한다
  const makeNode = (key: string): ItemNode => {
    const item = el('div', 'item');
    const badge = el('div', 'badge');
    const body = el('div', 'body');
    const row1 = el('div', 'row1');
    const title = el('span', 'title');
    const chip = el('span', 'chip');
    const dismiss = iconBtn('닫기', ICON.x, 'x', () => on.dismiss(key));
    row1.append(title, chip, dismiss);
    const step = el('div', 'step');
    const detail = el('div', 'detail');
    const bar = el('i');
    const gauge = el('div', 'gauge');
    gauge.append(bar);
    const runner = el('div', 'runner');
    runner.append(mascot(22));
    const rail = el('div', 'rail');
    rail.append(gauge, runner);
    const cancel = btn('취소', 'act stop', () => on.cancel(key));
    // 끝난 항목 버튼 두 칸(첫 칸이 주 버튼). 눌린 시점의 동작은 node.actIds에서 읽는다
    const actIds: Array<ProgressActionId | undefined> = [undefined, undefined];
    const acts = [0, 1].map((i) => btn('', i === 0 ? 'act go' : 'act', () => { const id = actIds[i]; if (id) on.action(key, id); }));
    const actions = el('div', 'actions');
    actions.append(cancel, ...acts);
    body.append(row1, step, detail, rail, actions);
    item.append(badge, body);
    return { el: item, badge, title, chip, step, detail, rail, bar, runner, cancel, acts, actIds, dismiss };
  };

  const updateNode = (n: ItemNode, it: ProgressItem): void => {
    // active에서 끝으로 넘어가면 잠깐 막대를 남겨 마스코트가 도착(점프)/실패(흔들기)를 보이고 끝 상태로 바꾼다
    if (n.state === 'active' && it.state !== 'active' && !n.transit) {
      // warn(검수 필요, 메일 확인 등)은 실패가 아니므로 도착으로 보인다
      n.transit = it.state === 'error' ? 'fail' : 'arrive';
      n.transitTimer = setTimeout(() => {
        n.transit = undefined;
        n.transitTimer = undefined;
        if (lastView && host.isConnected) render(lastView);
      }, TRANSIT_MS);
    } else if (it.state === 'active' && n.transit) {
      clearTimeout(n.transitTimer);
      n.transit = undefined;
      n.transitTimer = undefined;
    }
    // 새로 active가 되면(재시도 등) 막대를 처음부터 다시 잰다
    if (it.state === 'active' && n.state !== 'active') { n.shown = 0; n.creepStep = undefined; n.creepAt = undefined; }
    n.state = it.state;
    n.item = it;
    const active = it.state === 'active';
    const shown = n.transit ?? it.state;
    // 아이콘은 키가 바뀔 때만 교체한다(애니메이션이 매 렌더마다 처음부터 돌지 않게)
    const iconKey = shown === 'active' ? `active:${it.stepId ?? ''}` : shown;
    if (n.iconKey !== iconKey) {
      const icon = shown === 'active' ? (STEP_ICON[it.stepId ?? ''] ?? ICON.spin)
        : shown === 'arrive' ? ICON.ok : shown === 'fail' ? ICON.error : ICON[shown];
      n.badge.innerHTML = `<span class="swap">${icon}</span>`;
      n.iconKey = iconKey;
    }
    n.el.className = `item ${shown} ${it.phase}`;
    const runnerImg = n.runner.querySelector('img');
    if (runnerImg) {
      setMascotMood(runnerImg, shown === 'active' ? 'run' : shown === 'arrive' ? 'happy' : shown === 'fail' ? 'huh' : 'idle');
      setHops(runnerImg, shown === 'arrive' ? 2 : undefined);
    }
    n.title.textContent = it.title;
    n.title.title = it.title;
    n.chip.textContent = PHASE_CHIP[it.phase];
    n.chip.className = `chip ${it.phase}`;
    n.step.className = `step ${it.state}`;
    n.step.textContent = it.stepLabel;
    n.detail.hidden = !it.detail;
    n.detail.textContent = it.detail ?? '';
    n.detail.title = it.detail ?? '';
    n.rail.hidden = !(active || n.transit);
    // 도착은 끝까지, 실패는 멈춘 자리에 둔다(끝난 항목에는 ratio가 없다)
    if (n.transit === 'arrive') paintRatio(n, 1);
    else if (active) paintRatio(n, shownRatio(n, it));
    n.cancel.hidden = !(active && it.cancel);
    n.cancel.disabled = !!it.cancel?.cancelling;
    n.cancel.textContent = it.cancel?.cancelling ? '취소 중…' : '취소';
    n.acts.forEach((b, i) => {
      const a = active ? undefined : it.actions?.[i];
      n.actIds[i] = a?.id;
      b.hidden = !a;
      b.textContent = a?.label ?? '';
    });
    n.dismiss.hidden = active;
  };

  /** 걸터앉은 마스코트의 기분과 말풍선. 숫자 외 사용자 데이터는 넣지 않는다 */
  const updateMood = (view: Extract<ProgressPanelView, { kind: 'card' }>): void => {
    const ns = view.items.map((it) => nodes.get(it.key)).filter((n): n is ItemNode => !!n);
    const arriving = ns.filter((n) => n.transit === 'arrive').length;
    const failing = ns.filter((n) => n.transit === 'fail').length;
    const actives = view.items.filter((it) => it.state === 'active');
    const troubled = view.items.filter((it) => it.state === 'warn' || it.state === 'error').length;
    let mood: 'busy' | 'hop' | 'sad' | 'done';
    let parts: Array<[string, boolean]>; // [텍스트, 강조]
    if (failing > 0) { mood = 'sad'; parts = [[`${failing}건`, true], [' 실패했어요. 다시 시도해 볼까요?', false]]; }
    else if (arriving > 0) { mood = 'hop'; parts = [[`${arriving}건`, true], [' 끝났어요!', false]]; }
    else if (actives.length > 0) {
      mood = 'busy';
      const avg = Math.round((actives.reduce((s, it) => s + (nodes.get(it.key)?.shown ?? clamp01(it.ratio ?? 0)), 0) / actives.length) * 100);
      parts = [['공고 ', false], [`${actives.length}건`, true], [' 처리 중, ', false], [`${avg}%`, true]];
    } else if (troubled > 0) { mood = 'sad'; parts = [[`${troubled}건`, true], [' 확인이 필요해요', false]]; }
    else { mood = 'done'; parts = [['모두 ', false], ['끝났어요', true]]; }
    if (root.dataset.mood !== mood) {
      const prev = root.dataset.mood;
      root.dataset.mood = mood;
      const sitterImg = root.querySelector<HTMLImageElement>('.sitter img');
      if (sitterImg) {
        setMascotMood(sitterImg, mood === 'busy' ? 'work' : mood === 'sad' ? 'huh' : 'happy');
        // hop -> done은 같은 happy라 애니메이션이 이어진다. 횟수를 바꾸면 도중에 끊기므로 그대로 둔다
        const stillHappy = (prev === 'hop' || prev === 'done') && (mood === 'hop' || mood === 'done');
        if (!stillHappy) setHops(sitterImg, mood === 'hop' ? 2 : mood === 'done' ? 1 : undefined);
      }
      bubble.classList.remove('pop');
      void bubble.offsetWidth;
      bubble.classList.add('pop');
    }
    bubble.replaceChildren(...parts.map(([t, strong]) => (strong ? el('b', undefined, t) : doc.createTextNode(t))));
  };

  const buildCard = (): void => {
    headline = el('span', 'headline');
    const htext = el('div', 'htext');
    htext.append(el('span', 'name', 'BidMate'), headline);
    dismissAllBtn = btn('모두 닫기', 'link', () => on.dismissAll());
    const head = el('div', 'head');
    const sitter = el('div', 'sitter');
    sitter.append(mascot(56));
    const slot = el('div', 'slot');
    slot.append(sitter);
    head.append(slot, htext, dismissAllBtn, iconBtn('접기', ICON.down, 'icon-btn', () => on.toggleCollapse()));
    list = el('div', 'list');
    more = el('div', 'more');
    const card = el('div', 'card');
    card.append(head, list, more);
    bubble = el('div', 'bubble');
    root.replaceChildren(bubble, card);
    delete root.dataset.mood;
    mode = 'card';
  };

  const buildPill = (text: string, busy: boolean): HTMLButtonElement => {
    const b = btn('', 'pill', () => on.toggleCollapse());
    b.append(el('span', busy ? 'dot busy' : 'dot'), el('span', '', text));
    b.title = '펼치기';
    return b;
  };

  const render = (view: ProgressPanelView): void => {
    if (!host.isConnected) doc.body.append(host);
    lastView = view;
    if (view.kind !== 'card') {
      stopTicker();
      for (const n of nodes.values()) clearTimeout(n.transitTimer);
      nodes.clear();
      mode = view.kind === 'pill' ? 'pill' : 'none';
      if (view.kind === 'pill') root.replaceChildren(buildPill(view.text, view.activeCount > 0));
      else root.replaceChildren();
      return;
    }
    if (mode !== 'card') buildCard();
    // headline은 'BidMate · 상태' 형식. 이름은 헤더에 따로 있으므로 상태만 보인다
    headline.textContent = view.headline.replace(/^BidMate\s*·\s*/, '');
    headline.className = view.activeCount > 0 ? 'headline busy' : 'headline';
    dismissAllBtn.hidden = view.settledCount <= 0;
    more.hidden = view.moreCount <= 0;
    more.textContent = `외 ${view.moreCount}건`;
    const keys = new Set(view.items.map((i) => i.key));
    for (const [k, n] of [...nodes]) if (!keys.has(k)) { clearTimeout(n.transitTimer); n.el.remove(); nodes.delete(k); }
    // 이미 제자리인 노드는 옮기지 않는다(포커스·mousedown 보존)
    let ref: Element | null = list.firstElementChild;
    for (const it of view.items) {
      let n = nodes.get(it.key);
      if (!n) nodes.set(it.key, (n = makeNode(it.key)));
      updateNode(n, it);
      if (ref === n.el) ref = ref.nextElementSibling;
      else list.insertBefore(n.el, ref);
    }
    updateMood(view);
    if (!ticker && view.items.some((it) => it.state === 'active')) ticker = setInterval(tick, CREEP_TICK_MS);
  };

  const dispose = (): void => {
    stopTicker();
    for (const n of nodes.values()) clearTimeout(n.transitTimer);
    lastView = undefined;
    host.remove();
  };

  return { host, render, dispose };
}
