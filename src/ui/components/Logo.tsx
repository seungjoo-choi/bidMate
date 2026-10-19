import { mascotSrc } from '../mascot';

/**
 * BidMate 표시. 마스코트 얼굴. 툴바 아이콘(public/icon/*.png)과 같은 크롭.
 * 다크 모드에서는 흰 얼굴이 떠 보이지 않게 밝기만 낮춘다.
 */
export function Logo({ size = 24, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={`inline-grid shrink-0 place-items-center rounded-full ${className}`}
    >
      <img
        src={mascotSrc('idle', 'face')} width={size} height={size} alt="" draggable={false}
        className="rounded-full dark:brightness-[.82] dark:saturate-[.88]"
      />
    </span>
  );
}
