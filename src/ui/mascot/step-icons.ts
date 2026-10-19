/** 단계 아이콘(진행 중 단계 id -> 정적 SVG)과 움직임 CSS. 웹메일 진행 카드와 나라장터 패널이 함께 쓴다. */
export const stepSvg = (cls: string, inner: string): string =>
  `<svg class="${cls}" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
/** 진행 중 단계 아이콘(단계 id -> 정적 SVG). 없는 단계는 호출처가 스피너를 쓴다 */
export const STEP_ICON: Record<string, string> = {
  fetch_basic: stepSvg('si-basic', '<circle class="ring" cx="12" cy="12" r="11" stroke-width="1.5"/><path d="M5 20h14M7 20v-7M12 20v-7M17 20v-7M4 11l8-5 8 5"/>'),
  fetch_html: stepSvg('si-html', '<rect x="3" y="3" width="15" height="18" rx="2" opacity=".35"/><g class="lens"><circle cx="13" cy="12" r="4.5"/><path d="M16.5 15.5L20 19"/></g>'),
  download_attachments: stepSvg('si-dl', '<path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/><g class="arrow"><path d="M12 3v10M8 9l4 4 4-4"/></g>'),
  extract: stepSvg('si-ext', '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5" opacity=".45"/><path class="scan" d="M2 12h20" stroke="#f59e0b" stroke-width="2"/>'),
  render_mail: stepSvg('si-pen', '<path d="M4 20h7" opacity=".45"/><g class="pen"><path d="M15 4l5 5L9 20H4v-5z"/></g>'),
  open_compose: stepSvg('si-open', '<rect x="3" y="6" width="18" height="14" rx="2"/><path class="flap" d="M3 7l9 6 9-6"/>'),
  fill_fields: stepSvg('si-type', '<rect x="2" y="6" width="20" height="12" rx="2"/><path class="txt" d="M6 12h8" stroke-width="2.6"/><path class="caret" d="M17 9v6"/>'),
  attach_files: stepSvg('si-clip', '<g class="clip"><path d="M21.4 11l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/></g>'),
  verify: stepSvg('si-verify', '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path class="ck" d="M8.5 12l2.5 2.5 4.5-5"/>'),
};

export const STEP_ICON_CSS = `
/* 단계 아이콘 움직임 */
.si-basic .ring { transform-origin: 12px 12px; animation: si-ping 1.4s ease-out infinite; }
@keyframes si-ping { 0% { transform: scale(.5); opacity: .9; } 100% { transform: scale(1.35); opacity: 0; } }
.si-html .lens { animation: si-lens 1.6s ease-in-out infinite; }
@keyframes si-lens { 0%, 100% { transform: translate(0, 0); } 25% { transform: translate(3px, -1px); } 50% { transform: translate(3px, 3px); } 75% { transform: translate(-1px, 2px); } }
.si-dl .arrow { animation: si-drop 900ms ease-in infinite; }
@keyframes si-drop { 0% { transform: translateY(-5px); opacity: 0; } 30% { opacity: 1; } 75% { transform: translateY(1px); opacity: 1; } 100% { transform: translateY(2px); opacity: 0; } }
.si-ext .scan { animation: si-scan 1.2s ease-in-out infinite; }
@keyframes si-scan { 0%, 100% { transform: translateY(-4px); } 50% { transform: translateY(5px); } }
.si-pen .pen { transform-origin: 6px 18px; animation: si-write .5s ease-in-out infinite; }
@keyframes si-write { 0%, 100% { transform: rotate(-6deg) translateX(-1px); } 50% { transform: rotate(4deg) translateX(1.5px); } }
.si-open .flap { transform-origin: 12px 6px; animation: si-flap 1.4s ease-in-out infinite; }
@keyframes si-flap { 0%, 20% { transform: scaleY(1); } 50%, 70% { transform: scaleY(-1); } 100% { transform: scaleY(1); } }
.si-type .caret { animation: si-blink .6s steps(1) infinite; }
.si-type .txt { transform-origin: 5px 12px; animation: si-txt 1.2s steps(4, end) infinite; }
@keyframes si-blink { 50% { opacity: 0; } }
@keyframes si-txt { 0% { transform: scaleX(.1); } 70%, 100% { transform: scaleX(1); } }
.si-clip .clip { transform-origin: 12px 4px; animation: si-swing 1s ease-in-out infinite; }
@keyframes si-swing { 0%, 100% { transform: rotate(-12deg); } 50% { transform: rotate(12deg); } }
.si-verify .ck { stroke-dasharray: 16; animation: si-draw 1.1s ease-out infinite; }
@keyframes si-draw { 0% { stroke-dashoffset: 16; } 50%, 100% { stroke-dashoffset: 0; } }
@media (prefers-reduced-motion: reduce) {
  .si-basic .ring, .si-html .lens, .si-dl .arrow, .si-ext .scan, .si-pen .pen, .si-open .flap, .si-type .caret, .si-type .txt, .si-clip .clip, .si-verify .ck { animation: none !important; }
}
`;
