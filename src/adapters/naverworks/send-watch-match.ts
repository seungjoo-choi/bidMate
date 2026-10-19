import type { SendWatchConfig } from './types';

// send-watch.ts의 순수 판정 함수. DOM을 읽기만 하고 바꾸지 않는다.

const CLICKABLE = 'button,a,[role=button],input';

/** 클릭 대상이 보내기 버튼인지: closest 요소가 buttons 셀렉터에 맞거나 텍스트/aria-label/title이 패턴에 맞을 때. */
export function isSendButton(target: EventTarget | null, cfg: SendWatchConfig): boolean {
  const el = target instanceof Element ? target.closest(CLICKABLE) : null;
  if (!el) return false;
  for (const sel of cfg.buttons) {
    try { if (el.matches(sel) || el.closest(sel)) return true; } catch { /* 잘못된 셀렉터는 건너뛴다 */ }
  }
  const pats = cfg.textPatterns ?? [];
  if (pats.length === 0) return false;
  const texts = [el.textContent ?? '', el.getAttribute('aria-label') ?? '', el.getAttribute('title') ?? ''];
  // input은 버튼 종류일 때만 value를 본다(텍스트 입력칸의 내용으로 오탐하지 않는다).
  if (el instanceof HTMLInputElement && (el.type === 'button' || el.type === 'submit')) texts.push(el.value);
  return texts.some((t) => { const s = t.trim(); return s.length > 0 && pats.some((p) => s.includes(p)); });
}

/** Ctrl/Cmd+Enter 단축키인지. */
export function isSendHotkey(e: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'key'>, cfg: SendWatchConfig): boolean {
  return !!cfg.hotkey && (e.ctrlKey || e.metaKey) && e.key === 'Enter';
}
