import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { mascotSrc, type MascotMood, type MascotVariant } from './assets';
import { ensureMascotStyle } from './dom';

export function Mascot({
  mood = 'idle',
  variant = 'full',
  size = 48,
  hops,
  className = '',
  style,
}: {
  mood?: MascotMood;
  variant?: MascotVariant;
  size?: number;
  hops?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLImageElement>(null);
  useLayoutEffect(() => {
    if (ref.current) ensureMascotStyle(ref.current.getRootNode() as Document | ShadowRoot);
  }, []);
  const merged = hops != null ? ({ ...style, '--bm-hops': hops } as CSSProperties) : style;
  return (
    <img
      ref={ref}
      className={`bm-mascot ${className}`}
      data-mood={mood}
      data-variant={variant}
      width={size}
      height={size}
      src={mascotSrc(mood, variant)}
      alt=""
      aria-hidden
      draggable={false}
      style={merged}
    />
  );
}

/** 마스코트 + 오른쪽 말풍선. 확장 페이지 전용(Tailwind 테마 토큰 사용) */
export function MascotSay({
  mood,
  size = 64,
  children,
  className = '',
}: {
  mood: MascotMood;
  size?: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <Mascot mood={mood} size={size} className="shrink-0" />
      <div className="relative rounded-card border border-accent/20 bg-info-wash px-3 py-2 text-sm text-ink">
        <span
          aria-hidden
          className="absolute -left-[5px] top-1/2 h-2.5 w-2.5 -translate-y-1/2 rotate-45 border-b border-l border-accent/20 bg-info-wash"
        />
        {children}
      </div>
    </div>
  );
}
