import { useCallback, useEffect, useRef, useState } from 'react';
import { Mascot, type MascotMood } from '../mascot';

export interface ToastOptions {
  /** 주면 오른쪽 위에 마스코트 카드로 띄운다. 팔로우처럼 사용자가 기억해야 할 순간에만 쓴다 */
  mascot?: MascotMood;
  /** 마스코트 카드의 굵은 첫 줄. text는 그 아래 설명이 된다 */
  title?: string;
}

interface ToastState { text: string; opts?: ToastOptions; key: number }

/** 기본은 오른쪽 아래 2.5초 토스트. 마스코트 옵션이면 오른쪽 위 카드로 3.5초. `show(text, opts)`로 띄우고 반환된 `node`를 렌더한다. */
export function useToast() {
  const [state, setState] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback((text: string, opts?: ToastOptions) => {
    setState((s) => ({ text, opts, key: (s?.key ?? 0) + 1 }));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState(null), opts?.mascot ? 3500 : 2500);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  const node = !state ? null
    : state.opts?.mascot ? <MascotToast key={state.key} mood={state.opts.mascot} title={state.opts.title} text={state.text} />
    : <Toast text={state.text} />;
  return { show, node };
}

export function Toast({ text }: { text: string }) {
  return (
    <div role="status" className="fixed bottom-6 right-6 z-50 rounded-ctl bg-btn shadow-raised px-4 py-2.5 text-sm font-medium text-btn-ink">
      {text}
    </div>
  );
}

const MASCOT_TOAST_CSS = `
@keyframes bm-toast-in { from { opacity: 0; transform: translateY(-10px) scale(.97); } to { opacity: 1; transform: none; } }
.bm-toast { animation: bm-toast-in 240ms cubic-bezier(.2,.8,.3,1) both; }
@media (prefers-reduced-motion: reduce) { .bm-toast { animation: none; } }
`;

export function MascotToast({ mood, title, text }: { mood: MascotMood; title?: string; text: string }) {
  return (
    <div role="status" className="bm-toast fixed top-6 right-6 z-50 flex w-[22rem] max-w-[calc(100vw-3rem)] items-center gap-3.5 rounded-card border border-line bg-surface py-3.5 pr-5 pl-3.5 shadow-raised">
      <style>{MASCOT_TOAST_CSS}</style>
      <div className="grid size-12 shrink-0 place-items-center rounded-full bg-sunken">
        <Mascot mood={mood} variant="face" size={40} hops={2} />
      </div>
      <div className="min-w-0">
        {title && <div className="text-sm font-semibold text-ink">{title}</div>}
        <div className={`text-sm leading-snug ${title ? 'mt-0.5 text-muted' : 'font-medium text-ink'}`}>{text}</div>
      </div>
    </div>
  );
}
