import type { ProgressActionId, ProgressItem, ProgressPanelView } from './progress-view';

export interface ProgressCardHandle { host: HTMLElement; render(view: ProgressPanelView): void; dispose(): void }

const STYLE = `
:host { all: initial; }
.root {
  --blue: #2563eb; --blue-soft: #eff6ff; --violet: #7c3aed; --violet-soft: #f5f3ff;
  --ok: #16a34a; --ok-soft: #f0fdf4; --warn: #d97706; --warn-soft: #fffbeb; --err: #dc2626; --err-soft: #fef2f2;
  --ink: #0f172a; --ink-2: #475569; --ink-3: #94a3b8; --line: #eef2f7;
  position: fixed; right: 20px; bottom: 20px; z-index: 2147483000; width: 340px; max-width: calc(100vw - 40px);
  font-family: 'Pretendard', -apple-system, 'Segoe UI', 'Malgun Gothic', sans-serif; font-size: 12px; line-height: 17px; color: var(--ink-2);
  -webkit-font-smoothing: antialiased;
}
* { box-sizing: border-box; }
.card {
  background: #fff; border: 1px solid rgba(15, 23, 42, 0.08); border-radius: 14px; overflow: hidden;
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.14), 0 2px 6px rgba(15, 23, 42, 0.06);
  animation: bm-in 180ms ease-out;
}
@keyframes bm-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
button { font: inherit; cursor: pointer; border: 0; background: none; color: inherit; padding: 0; white-space: nowrap; }
button[disabled] { cursor: default; opacity: 0.6; }
button:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
svg { display: block; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

.head { display: flex; align-items: center; gap: 10px; padding: 12px 10px 12px 14px; border-bottom: 1px solid var(--line); }
.logo { flex: none; width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center; color: #fff; font-weight: 800; font-size: 13px; background: linear-gradient(135deg, #3b82f6, #1d4ed8); box-shadow: 0 2px 6px rgba(37, 99, 235, 0.35); }
.htext { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.name { font-size: 13px; font-weight: 700; color: var(--ink); letter-spacing: -0.01em; }
.headline { font-size: 11px; color: var(--ink-3); }
.headline.busy { color: var(--blue); }
.link { padding: 4px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; color: var(--ink-2); }
.link:hover { background: #f1f5f9; color: var(--ink); }
.icon-btn { width: 26px; height: 26px; border-radius: 7px; display: grid; place-items: center; color: var(--ink-3); }
.icon-btn:hover { background: #f1f5f9; color: var(--ink); }

.list { max-height: 44vh; overflow-y: auto; padding: 6px; }
.item { position: relative; display: flex; gap: 10px; padding: 10px; border-radius: 10px; }
.item + .item { margin-top: 2px; }
.item.warn { background: var(--warn-soft); }
.item.error { background: var(--err-soft); }
.badge { flex: none; width: 22px; height: 22px; margin-top: 1px; border-radius: 50%; display: grid; place-items: center; color: #fff; }
.item.active .badge { background: var(--blue-soft); color: var(--blue); }
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
.x:hover { background: rgba(15, 23, 42, 0.06); color: var(--ink); }
.step { margin-top: 3px; font-weight: 600; }
.step.active { color: var(--blue); }
.step.ok { color: var(--ok); }
.step.warn { color: var(--warn); }
.step.error { color: var(--err); }
.detail { margin-top: 2px; color: var(--ink-2); white-space: pre-line; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; word-break: break-all; }
.gauge { margin-top: 8px; height: 4px; border-radius: 999px; background: #e2e8f0; overflow: hidden; }
.gauge > i { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, #60a5fa, var(--blue)); transition: width 300ms ease; }
.actions { display: flex; gap: 6px; margin-top: 8px; }
.actions:not(:has(button:not([hidden]))) { display: none; }
.act { padding: 3px 10px; border-radius: 6px; font-size: 11px; font-weight: 600; background: #fff; color: var(--ink-2); box-shadow: inset 0 0 0 1px #e2e8f0; }
.act:hover { color: var(--ink); box-shadow: inset 0 0 0 1px #cbd5e1; }
.act.go { color: var(--blue); box-shadow: inset 0 0 0 1px #bfdbfe; }
.act.go:hover { background: var(--blue-soft); }
.act.stop:hover { color: var(--err); box-shadow: inset 0 0 0 1px #fecaca; }
.more { padding: 8px 14px 10px; color: var(--ink-3); font-size: 11px; text-align: center; border-top: 1px solid var(--line); }

.pill {
  display: inline-flex; align-items: center; gap: 8px; float: right; padding: 8px 14px 8px 10px; border-radius: 999px;
  background: #fff; color: var(--ink); font-weight: 600; border: 1px solid rgba(15, 23, 42, 0.08);
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.14), 0 1px 3px rgba(15, 23, 42, 0.06);
}
.pill:hover { box-shadow: 0 10px 28px rgba(15, 23, 42, 0.18), 0 1px 3px rgba(15, 23, 42, 0.06); }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); }
.dot.busy { background: var(--blue); animation: bm-pulse 1.4s ease-out infinite; }
@keyframes bm-pulse { 0% { box-shadow: 0 0 0 0 rgba(37, 99, 235, 0.5); } 100% { box-shadow: 0 0 0 7px rgba(37, 99, 235, 0); } }
[hidden] { display: none !important; }
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
  style.textContent = STYLE;
  const root = doc.createElement('div');
  root.className = 'root';
  shadow.append(style, root);
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
    gauge: HTMLElement; bar: HTMLElement; cancel: HTMLButtonElement; acts: HTMLButtonElement[]; dismiss: HTMLButtonElement;
    actIds: Array<ProgressActionId | undefined>;
    state?: ProgressItem['state'];
  }
  const nodes = new Map<string, ItemNode>();
  let mode: 'none' | 'pill' | 'card' = 'none';
  let headline: HTMLElement;
  let dismissAllBtn: HTMLButtonElement;
  let list: HTMLElement;
  let more: HTMLElement;

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
    const cancel = btn('취소', 'act stop', () => on.cancel(key));
    // 끝난 항목 버튼 두 칸(첫 칸이 주 버튼). 눌린 시점의 동작은 node.actIds에서 읽는다
    const actIds: Array<ProgressActionId | undefined> = [undefined, undefined];
    const acts = [0, 1].map((i) => btn('', i === 0 ? 'act go' : 'act', () => { const id = actIds[i]; if (id) on.action(key, id); }));
    const actions = el('div', 'actions');
    actions.append(cancel, ...acts);
    body.append(row1, step, detail, gauge, actions);
    item.append(badge, body);
    return { el: item, badge, title, chip, step, detail, gauge, bar, cancel, acts, actIds, dismiss };
  };

  const updateNode = (n: ItemNode, it: ProgressItem): void => {
    const active = it.state === 'active';
    if (n.state !== it.state) {
      // 아이콘은 상태가 바뀔 때만 교체한다(스피너 애니메이션이 매 렌더마다 처음부터 돌지 않게)
      n.badge.innerHTML = it.state === 'active' ? ICON.spin : ICON[it.state as Exclude<ProgressItem['state'], 'active'>];
      n.state = it.state;
    }
    n.el.className = `item ${it.state}`;
    n.title.textContent = it.title;
    n.title.title = it.title;
    n.chip.textContent = PHASE_CHIP[it.phase];
    n.chip.className = `chip ${it.phase}`;
    n.step.className = `step ${it.state}`;
    n.step.textContent = it.stepLabel;
    n.detail.hidden = !it.detail;
    n.detail.textContent = it.detail ?? '';
    n.detail.title = it.detail ?? '';
    n.gauge.hidden = !active;
    n.bar.style.width = `${Math.round(Math.max(0, Math.min(1, it.ratio ?? 0)) * 100)}%`;
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

  const buildCard = (): void => {
    headline = el('span', 'headline');
    const htext = el('div', 'htext');
    htext.append(el('span', 'name', 'BidMate'), headline);
    dismissAllBtn = btn('모두 닫기', 'link', () => on.dismissAll());
    const head = el('div', 'head');
    head.append(el('div', 'logo', 'B'), htext, dismissAllBtn, iconBtn('접기', ICON.down, 'icon-btn', () => on.toggleCollapse()));
    list = el('div', 'list');
    more = el('div', 'more');
    const card = el('div', 'card');
    card.append(head, list, more);
    root.replaceChildren(card);
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
    if (view.kind !== 'card') {
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
    for (const [k, n] of [...nodes]) if (!keys.has(k)) { n.el.remove(); nodes.delete(k); }
    // 이미 제자리인 노드는 옮기지 않는다(포커스·mousedown 보존)
    let ref: Element | null = list.firstElementChild;
    for (const it of view.items) {
      let n = nodes.get(it.key);
      if (!n) nodes.set(it.key, (n = makeNode(it.key)));
      updateNode(n, it);
      if (ref === n.el) ref = ref.nextElementSibling;
      else list.insertBefore(n.el, ref);
    }
  };

  return { host, render, dispose: () => host.remove() };
}
