import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const SHOW_DELAY_MS = 250;

interface Props {
  /** 툴팁에 보여 줄 전체 문자열 */
  text: string;
  className?: string;
  children?: ReactNode;
}

/** 한 줄로 자르고, 실제로 잘렸을 때만 마우스를 올리면 전체 문구를 툴팁으로 보여 준다.
 *  스크롤 박스 안에서도 가려지지 않게 body로 띄우고, 스크롤하면 닫는다. */
export function TruncatedText({ text, className = '', children }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean } | null>(null);

  const hide = () => { window.clearTimeout(timer.current); setPos(null); };
  const show = () => {
    const el = ref.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const r = el.getBoundingClientRect();
      // 아래 공간이 모자라면 위로 띄운다
      const above = window.innerHeight - r.bottom < 120;
      setPos({ left: r.left, top: above ? r.top - 8 : r.bottom + 8, above });
    }, SHOW_DELAY_MS);
  };

  useEffect(() => {
    if (!pos) return;
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => { window.removeEventListener('scroll', hide, true); window.removeEventListener('resize', hide); };
  }, [pos]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <>
      <span ref={ref} className={`truncate ${className}`} onMouseEnter={show} onMouseLeave={hide}>{children ?? text}</span>
      {pos && createPortal(
        <div
          role="tooltip"
          style={{ left: Math.max(8, Math.min(pos.left, window.innerWidth - 488)), top: pos.top }}
          className={`pointer-events-none fixed z-50 w-max max-w-[480px] rounded-ctl bg-btn px-3.5 py-2.5 text-sm leading-relaxed font-medium text-pretty text-btn-ink shadow-raised animate-[bm-tip-in_140ms_ease-out] motion-reduce:animate-none ${pos.above ? '-translate-y-full' : ''}`}
        >
          <style>{'@keyframes bm-tip-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }'}</style>
          {text}
        </div>,
        document.body,
      )}
    </>
  );
}
