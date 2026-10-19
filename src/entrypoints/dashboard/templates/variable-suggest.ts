import { variablesFor, type VariableDef } from '../../../core/templates/variables';
import type { NoticeKind } from '../../../core/types/notice';

export type FocusEl = HTMLInputElement | HTMLTextAreaElement;

/** 커서 앞에서 닫히지 않은 `{` 와 그 뒤 입력어를 찾는다. 공백이나 괄호가 끼면 변수 입력 중이 아니다. */
export function findVariableQuery(value: string, caret: number): { start: number; query: string } | null {
  const before = value.slice(0, caret);
  const start = before.lastIndexOf('{');
  if (start < 0) return null;
  const query = before.slice(start + 1);
  if (query.length > 12 || /[{}\s]/.test(query)) return null;
  return { start, query };
}

/** 입력어로 시작하는 변수를 먼저, 입력어를 포함하는 변수를 뒤에 둔다. 빈 입력어면 전체. */
export function matchVariables(query: string, kind: NoticeKind = 'bid'): VariableDef[] {
  const q = query.toLowerCase();
  const pool = variablesFor(kind);
  if (!q) return pool;
  const name = (d: VariableDef) => d.name.toLowerCase();
  return [...pool.filter((d) => name(d).startsWith(q)), ...pool.filter((d) => !name(d).startsWith(q) && name(d).includes(q))];
}

/** 입력의 [start, end) 를 text 로 바꾸고 React onChange가 돌도록 input 이벤트를 발생시킨 뒤 커서를 끝에 둔다. */
export function replaceRange(el: FocusEl, start: number, end: number, text: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter?.call(el, el.value.slice(0, start) + text + el.value.slice(end));
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.focus();
  const pos = start + text.length;
  el.setSelectionRange(pos, pos);
}

const MIRROR_PROPS = [
  'boxSizing', 'width', 'height', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch',
  'fontSize', 'lineHeight', 'fontFamily', 'textAlign', 'textTransform', 'textIndent', 'letterSpacing', 'wordSpacing', 'tabSize',
] as const;

/** pos 위치 글자의 화면 좌표(왼쪽, 줄 아래). 같은 스타일의 숨은 div에 글자를 흘려 측정한다. */
export function caretPoint(el: FocusEl, pos: number): { left: number; bottom: number } {
  const rect = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const isInput = el instanceof HTMLInputElement;
  const div = document.createElement('div');
  for (const p of MIRROR_PROPS) div.style[p] = cs[p];
  Object.assign(div.style, { position: 'absolute', visibility: 'hidden', top: '0', left: '-9999px', overflow: 'hidden', whiteSpace: isInput ? 'pre' : 'pre-wrap', overflowWrap: 'break-word' });
  div.textContent = el.value.slice(0, pos);
  const span = document.createElement('span');
  span.textContent = el.value.slice(pos) || '.';
  div.appendChild(span);
  document.body.appendChild(div);
  const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
  const left = rect.left + span.offsetLeft - el.scrollLeft;
  const bottom = isInput ? rect.bottom : rect.top + span.offsetTop - el.scrollTop + lineHeight;
  div.remove();
  return { left: Math.min(Math.max(left, rect.left), rect.right), bottom: Math.min(bottom, rect.bottom) };
}
