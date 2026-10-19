import type { RowSubAction, RowView } from './row-view';

export interface RowButtonHandle { host: HTMLElement; render(view: RowView): void; flash(): void; dispose(): void }

const STYLE = `
:host { all: initial; display: block; margin-top: 4px; max-width: 100%; text-align: inherit; }
.wrap { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px; max-width: 100%; font-family: -apple-system, 'Segoe UI', 'Malgun Gothic', sans-serif; font-size: 12px; line-height: 16px; }
button { font: inherit; padding: 2px 8px; border-radius: 4px; border: 1px solid transparent; background: #fff; color: #374151; cursor: pointer; white-space: nowrap; }
button[disabled] { cursor: default; opacity: 0.7; }
.wrap.flash { border-radius: 6px; animation: bm-flash 1.8s ease-out; }
@keyframes bm-flash { 0%, 35% { box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.55); } 100% { box-shadow: 0 0 0 3px rgba(37, 99, 235, 0); } }
button.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
button.secondary { background: #fff; border-color: #9ca3af; color: #374151; }
button.ok { background: #16a34a; border-color: #16a34a; color: #fff; }
button.warn { background: #f59e0b; border-color: #f59e0b; color: #fff; }
button.danger { background: #dc2626; border-color: #dc2626; color: #fff; }
button.busy { background: #fff; border-color: #2563eb; color: #2563eb; }
button.cancel { background: #fff; border-color: #9ca3af; color: #374151; }
.chip { color: #6b7280; font-size: 11px; }
.msg { flex-basis: 100%; color: #b91c1c; font-size: 11px; line-height: 15px; white-space: pre-line; word-break: keep-all; overflow-wrap: anywhere; }
`;

export function createRowButton(
  anchor: HTMLAnchorElement,
  on: { collect(): void; cancel(): void; action(a: 'retry' | 'grant' | RowSubAction): void },
): RowButtonHandle {
  const host = document.createElement('span');
  host.setAttribute('data-bidmate', 'collect');
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = STYLE;
  const wrap = document.createElement('span');
  wrap.className = 'wrap';
  root.append(style, wrap);
  for (const t of ['click', 'pointerdown', 'mousedown']) host.addEventListener(t, (e) => e.stopPropagation());
  anchor.insertAdjacentElement('afterend', host);
  // 메일 HTML은 링크 자체에 정렬을 거는 경우가 있어(셀은 왼쪽, 링크만 가운데) 링크의 계산값을 따른다
  host.style.textAlign = getComputedStyle(anchor).textAlign;

  const mkBtn = (text: string, cls: string, title: string | undefined, handler: (() => void) | null): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = text;
    if (title) b.title = title;
    if (handler) b.addEventListener('click', handler);
    else b.disabled = true;
    return b;
  };

  const render = (view: RowView): void => {
    const items: HTMLElement[] = [];
    switch (view.kind) {
      case 'idle':
        items.push(mkBtn(view.label, view.tone, view.detail, () => on.collect()));
        if (view.chip) { const c = document.createElement('span'); c.className = 'chip'; c.textContent = view.chip; items.push(c); }
        break;
      case 'busy':
        items.push(mkBtn(view.label, 'busy', undefined, null));
        if (view.canCancel) items.push(mkBtn('취소', 'cancel', undefined, () => on.cancel()));
        break;
      case 'done':
        // 누르면 이 탭의 사이드 패널을 연다(요약 보기)
        items.push(mkBtn(view.label, view.tone, view.detail ? `${view.detail}\n누르면 사이드 패널에서 봅니다` : '누르면 사이드 패널에서 봅니다', () => on.action('sidepanel')));
        if (view.canRetry) items.push(mkBtn('재시도', 'cancel', undefined, () => on.action('retry')));
        if (view.action) { const a = view.action; items.push(mkBtn(view.actionLabel ?? '열기', 'cancel', undefined, () => on.action(a))); }
        break;
      case 'error': {
        const act = view.action === 'none' ? null : view.action;
        items.push(mkBtn(act ? (view.actionLabel ?? view.label) : view.label, 'danger', act ? `${view.label}${view.detail ? `\n${view.detail}` : ''}` : view.detail, act ? () => on.action(act) : null));
        if (view.subAction) { const a = view.subAction; items.push(mkBtn(view.subActionLabel ?? '열기', 'cancel', undefined, () => on.action(a))); }
        if (view.message) { const m = document.createElement('div'); m.className = 'msg'; m.setAttribute('role', 'alert'); m.textContent = view.message; items.push(m); }
        break;
      }
      case 'disabled':
        items.push(mkBtn(view.label, 'secondary', view.reason, null));
        break;
    }
    wrap.replaceChildren(...items);
  };

  // 진행 팝업의 [행으로 이동]: 이미 화면 안이면 스크롤이 없으므로 어느 행인지 잠깐 강조한다
  const flash = (): void => {
    wrap.classList.remove('flash');
    void wrap.offsetWidth; // 연속 클릭에도 애니메이션을 다시 시작한다
    wrap.classList.add('flash');
  };
  wrap.addEventListener('animationend', () => wrap.classList.remove('flash'));

  return { host, render, flash, dispose: () => host.remove() };
}
