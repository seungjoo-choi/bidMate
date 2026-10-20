export type MascotMood = 'idle' | 'guide' | 'work' | 'run' | 'happy' | 'huh';
export type MascotVariant = 'full' | 'face';

// 기분별 전용 그림. 없으면 BASE(눈 뜬 얼굴). 그림이 들어오면 여기 한 줄만 추가
const FILES: Record<MascotVariant, Partial<Record<MascotMood, string>>> = {
  full: { happy: 'full-happy.png', huh: 'full-sad.png' },
  face: { happy: 'face-happy.png', huh: 'face-sad.png' },
};
const BASE: Record<MascotVariant, string> = { full: 'full.png', face: 'face.png' };

export function mascotFile(mood: MascotMood, variant: MascotVariant): string {
  return FILES[variant][mood] ?? BASE[variant];
}

/** 호출 시점에 URL을 만든다. 확장 업데이트 뒤 남은 content script에서는 getURL이 throw하므로 폴백을 둔다 */
export function mascotSrc(mood: MascotMood = 'idle', variant: MascotVariant = 'full'): string {
  const path = `icon/mascot/${mascotFile(mood, variant)}`;
  try {
    return chrome.runtime.getURL(`/${path}` as '/icon/mascot/full.png');
  } catch {
    return `/${path}`;
  }
}

export const MASCOT_CSS = `
.bm-mascot { display: block; object-fit: contain; transform-origin: 50% 95%; user-select: none; -webkit-user-drag: none; }
.bm-mascot[data-mood="guide"] { animation: bm-bob 2.4s ease-in-out infinite; }
.bm-mascot[data-mood="work"] { animation: bm-sway 2.2s ease-in-out infinite; }
.bm-mascot[data-mood="run"] { animation: bm-run 380ms ease-in-out infinite; }
.bm-mascot[data-mood="happy"] { animation: bm-hop 700ms cubic-bezier(.3,.7,.4,1) var(--bm-hops, 1); }
.bm-mascot[data-mood="huh"] { animation: bm-shake 560ms ease-in-out 1 forwards; filter: saturate(.6); }
@keyframes bm-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
@keyframes bm-sway { 0%, 100% { transform: rotate(-3deg); } 50% { transform: rotate(3deg) translateY(-1px); } }
@keyframes bm-run { 0%, 100% { transform: translateY(0) rotate(-6deg); } 50% { transform: translateY(-3px) rotate(5deg); } }
@keyframes bm-hop { 0% { transform: none; } 18% { transform: scale(1.16, .84); } 50% { transform: translateY(-11px) scale(.95, 1.07) rotate(-8deg); } 82% { transform: scale(1.1, .9); } 100% { transform: none; } }
@keyframes bm-shake { 0% { transform: none; } 18% { transform: translateX(-3px) rotate(-12deg); } 36% { transform: translateX(3px) rotate(10deg); } 54% { transform: translateX(-2px) rotate(-7deg); } 72% { transform: translateX(2px) rotate(4deg); } 100% { transform: rotate(-13deg) translateY(1px); } }
@media (prefers-reduced-motion: reduce) {
  .bm-mascot { animation: none !important; }
  .bm-mascot[data-mood="huh"] { transform: rotate(-13deg); }
}
`;
