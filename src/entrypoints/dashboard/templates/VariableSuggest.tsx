import { useEffect, useRef, useState, type KeyboardEvent, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import type { VariableDef } from '../../../core/templates/variables';
import { caretPoint, findVariableQuery, matchVariables, replaceRange, type FocusEl } from './variable-suggest';

const LIST_ID = 'variable-suggest-list';

interface SuggestState { el: FocusEl; start: number; query: string; matches: VariableDef[]; active: number; x: number; y: number }

/**
 * 입력칸에서 `{` 를 치면 커서 아래에 변수 목록을 띄운다.
 * 반환한 핸들러를 편집 영역 바깥 div에 capture로 달고, popup을 렌더한다.
 */
export function useVariableSuggest(isTarget: (el: EventTarget) => el is FocusEl) {
  const [state, setState] = useState<SuggestState | null>(null);

  const refresh = (e: SyntheticEvent) => {
    const el = e.target;
    if (!isTarget(el)) return;
    const caret = el.selectionStart ?? el.value.length;
    const q = el.selectionEnd === caret ? findVariableQuery(el.value, caret) : null;
    const matches = q ? matchVariables(q.query) : [];
    if (!q || matches.length === 0) { setState(null); return; }
    const p = caretPoint(el, q.start);
    setState((s) => ({
      el, start: q.start, query: q.query, matches,
      active: s && s.el === el && s.start === q.start && s.query === q.query ? s.active : 0,
      x: p.left, y: p.bottom,
    }));
  };

  const pick = (d: VariableDef) => {
    if (!state) return;
    const caret = state.el.selectionStart ?? state.el.value.length;
    replaceRange(state.el, state.start, caret, `{${d.name}}`);
    setState(null);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!state || e.target !== state.el || e.nativeEvent.isComposing) return;
    const n = state.matches.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setState({ ...state, active: (state.active + step + n) % n });
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const d = state.matches[state.active];
      if (d) pick(d);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setState(null);
    }
  };

  // 바깥이 스크롤되면 좌표가 어긋나므로 닫는다. 목록 자체의 스크롤(휠, 스크롤바, 키보드 이동)은 무시한다.
  useEffect(() => {
    if (!state) return;
    const close = (e: Event) => {
      if (e.type === 'scroll' && e.target instanceof Node && document.getElementById(LIST_ID)?.contains(e.target)) return;
      setState(null);
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [state]);

  const handlers = {
    onInputCapture: refresh,
    onSelectCapture: refresh,
    onKeyDownCapture: onKeyDown,
    onBlurCapture: () => setState(null),
  };
  const popup = state ? <SuggestList state={state} onPick={pick} onHover={(i) => setState({ ...state, active: i })} /> : null;
  return { handlers, popup };
}

function SuggestList({ state, onPick, onHover }: { state: SuggestState; onPick: (d: VariableDef) => void; onHover: (i: number) => void }) {
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    listRef.current?.children[state.active]?.scrollIntoView({ block: 'nearest' });
  }, [state.active]);

  const width = 240;
  const left = Math.min(state.x, window.innerWidth - width - 8);
  const below = state.y + 4 + 288 < window.innerHeight;
  const pos = below ? { top: state.y + 4 } : { bottom: window.innerHeight - state.y + 28 };

  return createPortal(
    <ul
      ref={listRef}
      id={LIST_ID}
      role="listbox"
      aria-label="변수"
      style={{ position: 'fixed', left, width, ...pos }}
      onMouseDown={(e) => e.preventDefault()}
      className="z-50 max-h-72 overflow-y-auto rounded-ctl border border-line-strong bg-surface p-1 shadow-overlay"
    >
      {state.matches.map((d, i) => (
        <li
          key={d.name}
          role="option"
          aria-selected={i === state.active}
          onMouseDown={(e) => { e.preventDefault(); onPick(d); }}
          onMouseEnter={() => onHover(i)}
          className={`flex cursor-pointer items-center justify-between gap-3 rounded-ctl px-2.5 py-1.5 text-sm ${i === state.active ? 'bg-select text-ink' : 'text-ink'}`}
        >
          <span className="truncate">{d.name}</span>
          <span className="shrink-0 text-xs text-faint">{d.group}</span>
        </li>
      ))}
    </ul>,
    document.body,
  );
}
