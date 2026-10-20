import { createMascotImg, ensureMascotStyle } from '../mascot/dom';
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
/* 알약 버튼: 왼쪽 동그라미(미수집은 마스코트 얼굴, 수집 중은 스피너, 완료는 체크)로 세 상태를 잇는다 */
button.pill { display: inline-flex; align-items: center; gap: 5px; padding: 2px 10px 2px 3px; border-radius: 999px; line-height: 18px; }
.pill .bm-mascot { width: 20px; height: 20px; border-radius: 50%; background: #fff; flex: none; }
button.pill.primary:hover .bm-mascot { animation: bm-bob 1s ease-in-out infinite; }
button.pill.busy { border-color: #93b4f5; }
button.pill.busy:hover { border-color: #2563eb; background: #f5f8ff; }
.spin { display: inline-grid; place-items: center; width: 20px; height: 20px; flex: none; }
.spin::after { content: ""; width: 12px; height: 12px; box-sizing: border-box; border-radius: 50%; border: 2px solid #c7d7fb; border-top-color: #2563eb; animation: bm-spin 0.8s linear infinite; }
@keyframes bm-spin { to { transform: rotate(360deg); } }
button.pill.done { background: #ecfdf3; border-color: #86efac; color: #15803d; }
button.pill.done-warn { background: #fffbeb; border-color: #fcd34d; color: #b45309; }
.ic { display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; background: #16a34a; color: #fff; font-size: 11px; font-weight: 700; flex: none; }
.ic::after { content: "✓"; }
.done-warn .ic { background: #f59e0b; }
.done-warn .ic::after { content: "!"; }
/* 이미 수집한 공고: [✓ 수집 완료 | ↻] 한 알약 */
.split { display: inline-flex; align-items: stretch; border: 1px solid; border-radius: 999px; overflow: hidden; }
.split.done { background: #ecfdf3; border-color: #86efac; color: #15803d; }
.split.done-warn { background: #fffbeb; border-color: #fcd34d; color: #b45309; }
.split button { display: inline-flex; align-items: center; border: 0; border-radius: 0; background: transparent; color: inherit; line-height: 18px; }
.split button.main { gap: 5px; padding: 2px 8px 2px 3px; }
.split button.re { padding: 2px 8px 2px 7px; border-left: 1px solid; border-left-color: inherit; }
.split.done button.re { border-left-color: #86efac; }
.split.done-warn button.re { border-left-color: #fcd34d; }
.split button:hover { background: rgba(0, 0, 0, 0.05); }
/* 키보드 포커스 표시는 알약 모양과 상태 색을 따른다(칸 안쪽 링은 알약 테두리에 맞춰 잘린다) */
button:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
button.pill.done:focus-visible { outline-color: #16a34a; }
button.pill.done-warn:focus-visible { outline-color: #f59e0b; }
.split button:focus-visible { outline: none; box-shadow: inset 0 0 0 2px #16a34a; }
.split.done-warn button:focus-visible { box-shadow: inset 0 0 0 2px #f59e0b; }
.split button.re svg { width: 13px; height: 13px; display: block; }
@media (prefers-reduced-motion: reduce) { .pill .bm-mascot { animation: none !important; } .spin::after { animation-duration: 2.4s; } }
.msg { flex-basis: 100%; color: #b91c1c; font-size: 11px; line-height: 15px; white-space: pre-line; word-break: keep-all; overflow-wrap: anywhere; }
`;

const REFRESH_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-1.7-3.97"/><path d="M13.5 2.5v3h-3"/></svg>';

export function createRowButton(
  anchor: HTMLAnchorElement,
  on: { collect(): void; reveal(): void; action(a: 'retry' | 'grant' | RowSubAction): void },
): RowButtonHandle {
  const host = document.createElement('span');
  host.setAttribute('data-bidmate', 'collect');
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = STYLE;
  const wrap = document.createElement('span');
  wrap.className = 'wrap';
  root.append(style, wrap);
  ensureMascotStyle(root);
  for (const t of ['click', 'pointerdown', 'mousedown']) host.addEventListener(t, (e) => e.stopPropagation());
  anchor.insertAdjacentElement('afterend', host);
  // 메일 HTML은 링크 자체에 정렬을 거는 경우가 있어(셀은 왼쪽, 링크만 가운데) 링크의 계산값을 따른다
  const align = getComputedStyle(anchor).textAlign;
  host.style.textAlign = align;
  // 칩이 줄바꿈되면 wrap이 셀 너비로 늘어나 text-align이 안 먹으므로 flex 정렬도 맞춘다
  wrap.style.justifyContent = /center/.test(align) ? 'center' : /right|end/.test(align) ? 'flex-end' : 'flex-start';

  const mkBtn = (text: string, cls: string, title: string | undefined, handler: (() => void) | null): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = text;
    if (title) b.title = title;
    // 마우스 클릭(detail > 0)이면 포커스를 놓는다. 사이드 패널이 열리며 창 포커스가 오가면
    // 남은 포커스가 키보드 포커스로 취급돼 링이 계속 보이기 때문이다. 키보드(Enter·Space)는 유지한다
    if (handler) b.addEventListener('click', (e) => { if (e.detail > 0) b.blur(); handler(); });
    else b.disabled = true;
    return b;
  };

  /** 라벨 앞에 동그라미(마스코트 얼굴·스피너·체크)를 붙인 알약 버튼. textContent는 라벨만 남는다 */
  const pill = (b: HTMLButtonElement, lead: HTMLElement): HTMLButtonElement => {
    b.classList.add('pill');
    b.prepend(lead);
    return b;
  };
  const face = (): HTMLElement => createMascotImg(document, { mood: 'idle', variant: 'face', size: 20 });
  const spinner = (): HTMLElement => { const s = document.createElement('span'); s.className = 'spin'; s.setAttribute('aria-hidden', 'true'); return s; };
  const check = (): HTMLElement => { const s = document.createElement('span'); s.className = 'ic'; s.setAttribute('aria-hidden', 'true'); return s; };
  const SIDE_TIP = '누르면 사이드 패널에서 봅니다';
  const sideTip = (d?: string) => (d ? `${d}\n${SIDE_TIP}` : SIDE_TIP);

  const render = (view: RowView): void => {
    const items: HTMLElement[] = [];
    switch (view.kind) {
      case 'idle':
        if (view.tone === 'primary') items.push(pill(mkBtn(view.label, 'primary', view.detail, () => on.collect()), face()));
        else if (view.chip) {
          // 이미 수집한 공고: 완료 모양으로 보이고(누르면 요약), 다시 수집은 옆 아이콘으로
          // 칸이 좁아 버튼을 나란히 두면 줄이 바뀌므로 한 알약 안에서 칸막이로 나눈다
          const split = document.createElement('span');
          split.className = `split ${view.chipTone === 'warn' ? 'done-warn' : 'done'}`;
          const main = mkBtn(view.chip, 'main', sideTip(view.detail), () => on.action('sidepanel'));
          main.prepend(check());
          const again = mkBtn('', 're', view.label, () => on.collect());
          again.innerHTML = REFRESH_ICON;
          again.setAttribute('aria-label', view.label);
          split.append(main, again);
          items.push(split);
        } else items.push(mkBtn(view.label, view.tone, view.detail, () => on.collect()));
        break;
      case 'busy':
        // 진행 숫자와 취소는 우측 하단 진행 팝업에 있다. 누르면 팝업의 그 항목을 보인다
        items.push(pill(mkBtn(view.label, 'busy', `${view.detail ? `${view.detail}\n` : ''}진행 상황은 오른쪽 아래 팝업에서 봅니다`, () => on.reveal()), spinner()));
        break;
      case 'done':
        // 누르면 이 탭의 사이드 패널을 연다(요약 보기)
        if (view.tone === 'ok') items.push(pill(mkBtn(view.label, 'done', sideTip(view.detail), () => on.action('sidepanel')), check()));
        else items.push(mkBtn(view.label, view.tone, sideTip(view.detail), () => on.action('sidepanel')));
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
  wrap.addEventListener('animationend', (e) => { if (e.target === wrap) wrap.classList.remove('flash'); });

  return { host, render, flash, dispose: () => host.remove() };
}
