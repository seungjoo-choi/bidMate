import type { ComposeSelectorSet } from './types';

// 웹메일 DOM에 이벤트를 보내는 유일한 파일이다. 전송/submit/modifier 키 경로는 만들지 않는다.

export class ForbiddenActionError extends Error {
  constructor(message = '금지된 요소(전송 계열)에 대한 동작입니다.') {
    super(message);
    this.name = 'ForbiddenActionError';
  }
}

export type AllowedKey = 'Enter' | 'Tab' | ';' | ',';
const ALLOWED_KEYS: readonly string[] = ['Enter', 'Tab', ';', ','];

export type InsertStrategy = 'execCommand' | 'paste' | 'innerHTML';

type TextEl = HTMLInputElement | HTMLTextAreaElement;
const isTextEl = (el: Element): el is TextEl => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;

function writeNativeValue(el: TextEl, v: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (!setter) throw new Error('value setter를 찾을 수 없습니다.');
  setter.call(el, v);
}

/** 프레임워크가 가로채는 value 프로퍼티를 우회하려고 prototype setter를 직접 호출한다. */
export function setNativeValue(el: TextEl, v: string): void {
  writeNativeValue(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

export function typeText(el: Element, text: string): void {
  const before = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: text });
  const proceed = el.dispatchEvent(before);
  if (proceed) {
    if (isTextEl(el)) writeNativeValue(el, el.value + text);
    else el.appendChild(el.ownerDocument.createTextNode(text));
  }
  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
}

export function pressKey(el: Element, key: AllowedKey): void {
  if (!ALLOWED_KEYS.includes(key)) throw new Error(`허용되지 않는 키입니다: ${String(key)}`);
  const init = { key, bubbles: true, cancelable: true };
  el.dispatchEvent(new KeyboardEvent('keydown', init));
  el.dispatchEvent(new KeyboardEvent('keypress', init));
  el.dispatchEvent(new KeyboardEvent('keyup', init));
}

/** 포커스를 잃게 한다(수신자 입력 commit 전략 blur). */
export function blurElement(el: HTMLElement): void {
  el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  el.blur();
  el.dispatchEvent(new FocusEvent('blur'));
}

export function isForbidden(el: Element, set: ComposeSelectorSet): boolean {
  for (const sel of set.forbidden.send) {
    if (!sel) continue;
    try {
      if (el.matches(sel) || el.closest(sel)) return true;
    } catch { /* 잘못된 셀렉터는 무시 */ }
  }
  // 클릭은 버블링되므로, 대상이 버튼 안의 아이콘/span이어도 감싸는 상호작용 요소까지 함께 판정한다.
  const host = el.closest('button,a,[role=button],input');
  return [el, ...(host && host !== el ? [host] : [])].some((t) => isSubmitLike(t) || matchesSendText(t, set));
}

function isSubmitLike(el: Element): boolean {
  if (el instanceof HTMLButtonElement && el.type === 'submit' && el.form !== null) return true;
  return el instanceof HTMLInputElement && (el.type === 'submit' || el.type === 'image');
}

function matchesSendText(el: Element, set: ComposeSelectorSet): boolean {
  const value = el instanceof HTMLInputElement ? el.value : '';
  const texts = [el.textContent ?? '', el.getAttribute('aria-label') ?? '', el.getAttribute('title') ?? '', value].map((t) => t.trim().toLowerCase());
  return set.forbidden.textPatterns.some((p) => {
    const pat = p.trim().toLowerCase();
    return pat !== '' && texts.some((t) => t.includes(pat));
  });
}

export function click(el: HTMLElement, set: ComposeSelectorSet): void {
  if (isForbidden(el, set)) throw new ForbiddenActionError();
  el.click();
}

function htmlToText(html: string): string {
  const t = document.createElement('template');
  t.innerHTML = html;
  return t.content.textContent ?? '';
}

/** 전략을 순서대로 시도하고 DOM이 실제로 바뀐 첫 전략 이름을 반환한다. 모두 실패하면 null. */
export function insertHtml(editable: HTMLElement, html: string, strategies: InsertStrategy[]): InsertStrategy | null {
  const doc = editable.ownerDocument;
  for (const s of strategies) {
    const before = editable.innerHTML;
    try {
      if (s === 'execCommand') {
        if (typeof doc.execCommand !== 'function') continue;
        editable.focus();
        doc.execCommand('selectAll', false);
        doc.execCommand('insertHTML', false, html);
      } else if (s === 'paste') {
        if (typeof ClipboardEvent === 'undefined' || typeof DataTransfer === 'undefined') continue;
        const dt = new DataTransfer();
        dt.setData('text/html', html);
        dt.setData('text/plain', htmlToText(html));
        editable.focus();
        editable.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      } else {
        editable.innerHTML = html;
        editable.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
      }
    } catch { continue; }
    if (editable.innerHTML !== before) return s;
  }
  return null;
}

function toFileList(files: File[]): FileList {
  const dt = new DataTransfer();
  for (const f of files) dt.items.add(f);
  return dt.files;
}

export function dropFiles(zone: Element, files: File[]): void {
  const dt = new DataTransfer();
  for (const f of files) dt.items.add(f);
  for (const type of ['dragenter', 'dragover', 'drop']) {
    zone.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
  }
}

export function pasteFiles(target: Element, files: File[]): void {
  const dt = new DataTransfer();
  for (const f of files) dt.items.add(f);
  target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}

export function setInputFiles(input: HTMLInputElement, files: File[]): void {
  const list = toFileList(files);
  try {
    input.files = list;
  } catch {
    Object.defineProperty(input, 'files', { value: list, configurable: true });
  }
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/** fn이 truthy를 반환할 때까지 폴링한다. 시간 초과면 null. */
export async function waitFor<T>(fn: () => T | Promise<T>, timeoutMs: number, intervalMs = 200): Promise<Exclude<T, false | null | undefined | 0 | ''> | null> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v as Exclude<T, false | null | undefined | 0 | ''>;
    if (Date.now() >= end) return null;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export function settle(ms = 400): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
