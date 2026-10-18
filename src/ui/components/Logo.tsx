/**
 * BidMate 표시. 먹색 사각형 위에 관공서 건물(지붕, 기둥 4개, 기단). 공공입찰 발주처를 뜻한다.
 * 색은 테마 토큰을 따라 다크 모드에서 반전된다. 확장 아이콘(public/icon/*.png)도 같은 모양이다.
 */
export function Logo({ size = 24, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className={`shrink-0 ${className}`}>
      <rect x="1" y="1" width="22" height="22" rx="6" className="fill-btn" />
      <g className="fill-btn-ink">
        <path d="M12 4.2l7.8 4.1v1.5H4.2V8.3z" />
        <rect x="5.9" y="11" width="1.9" height="5.8" />
        <rect x="9.3" y="11" width="1.9" height="5.8" />
        <rect x="12.8" y="11" width="1.9" height="5.8" />
        <rect x="16.2" y="11" width="1.9" height="5.8" />
        <rect x="4.4" y="17.6" width="15.2" height="2" rx=".5" />
      </g>
    </svg>
  );
}
