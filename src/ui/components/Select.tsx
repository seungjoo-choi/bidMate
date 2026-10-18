import { Check, ChevronDown, Search, X } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { inputClass } from './Field';
import { matchesQuery } from './select-filter';

export interface SelectOption {
  value: string;
  label: string;
  /** 같은 group끼리 묶고 머리글을 단다. */
  group?: string;
  /** 오른쪽에 흐리게 붙는 보조 표시(예: 기본). */
  hint?: string;
}

export interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  /** 값에 맞는 옵션이 없을 때 버튼에 보이는 글자. */
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
  className?: string;
  /** 검색 칸 표시. 생략하면 옵션이 8개 이상일 때만 보인다. */
  searchable?: boolean;
  /** 값이 있을 때 X 버튼을 보여 선택을 비운다(onChange('')). */
  clearable?: boolean;
}

const SEARCH_MIN = 8;
const PANEL_MAX_H = 320;

/** 꾸밀 수 있는 셀렉트. 목록은 body에 띄우고, 옵션이 많으면 위에 검색 칸을 둔다(초성 검색 지원). */
export function Select({ value, options, onChange, placeholder = '선택', disabled, id, 'aria-label': ariaLabel, className = '', searchable, clearable }: SelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const showSearch = searchable ?? options.length >= SEARCH_MIN;
  const selected = options.find((o) => o.value === value);
  const filtered = useMemo(
    () => options.filter((o) => matchesQuery(`${o.label} ${o.group ?? ''}`, query)),
    [options, query],
  );

  const openPanel = () => {
    if (disabled) return;
    setQuery('');
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setRect(triggerRef.current?.getBoundingClientRect() ?? null);
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };
  const pick = (o: SelectOption | undefined) => {
    if (!o) return;
    onChange(o.value);
    close();
  };

  // 열리면 검색 칸(없으면 목록)에 포커스.
  useLayoutEffect(() => {
    if (!open) return;
    (searchRef.current ?? listRef.current)?.focus();
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  // 바깥 클릭이면 닫는다. 바깥 스크롤과 창 크기 변경에는 버튼 위치를 따라가고, 버튼이 화면 밖으로 나가면 닫는다.
  useEffect(() => {
    if (!open) return;
    const inside = (t: EventTarget | null) => t instanceof Node && (panelRef.current?.contains(t) || triggerRef.current?.contains(t));
    const onDown = (e: MouseEvent) => { if (!inside(e.target)) close(false); };
    const follow = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r || r.bottom < 0 || r.top > window.innerHeight) { close(false); return; }
      setRect(r);
    };
    const onScroll = (e: Event) => { if (!(e.target instanceof Node && panelRef.current?.contains(e.target))) follow(); };
    const onResize = follow;
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  const onTriggerKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openPanel();
    }
  };

  const onPanelKey = (e: KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    const n = filtered.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (n) setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + n) % n);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(filtered[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      close(false);
    }
  };

  // 아래 공간이 모자라면 위로 연다.
  const panelStyle = (() => {
    if (!rect) return {};
    const width = Math.max(rect.width, 200);
    const left = Math.min(rect.left, window.innerWidth - width - 8);
    const below = window.innerHeight - rect.bottom >= PANEL_MAX_H + 8 || rect.top < PANEL_MAX_H + 8;
    return below ? { left, width, top: rect.bottom + 4 } : { left, width, bottom: window.innerHeight - rect.top + 4 };
  })();

  let lastGroup: string | undefined;

  const showClear = clearable && !!selected && !disabled;
  // className에 너비가 있으면 inputClass의 w-full이 이겨서 늘어나므로 뺀다
  const baseClass = /(^|\s)w-/.test(className) ? inputClass.replace('w-full ', '') : inputClass;

  return (
    <div className={clearable ? 'relative w-full min-w-0' : 'contents'}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        onClick={() => (open ? close() : openPanel())}
        onKeyDown={onTriggerKey}
        className={`${baseClass} flex items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-50 ${open ? 'border-accent ring-2 ring-accent/20' : ''} ${className}`}
      >
        <span className={`min-w-0 truncate ${selected ? '' : 'text-faint'} ${showClear ? 'mr-7' : ''}`}>
          {selected ? selected.label : placeholder}
          {selected?.hint && <span className="ml-1.5 text-sm text-muted">{selected.hint}</span>}
        </span>
        <ChevronDown className={`size-4 shrink-0 text-muted transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
      </button>
      {showClear && (
        <button
          type="button"
          aria-label="선택 지우기"
          title="선택 지우기"
          onClick={() => { onChange(''); triggerRef.current?.focus(); }}
          className="absolute top-1/2 right-8 flex size-6 -translate-y-1/2 items-center justify-center rounded-ctl text-faint hover:bg-sunken hover:text-ink [&_svg]:size-4"
        >
          <X />
        </button>
      )}
      {open && createPortal(
        <div
          ref={panelRef}
          onKeyDown={onPanelKey}
          style={{ position: 'fixed', ...panelStyle }}
          className="z-50 flex flex-col overflow-hidden rounded-card border border-line-strong bg-surface shadow-overlay"
        >
          {showSearch && (
            <div className="flex items-center gap-2 border-b border-line px-3">
              <Search className="size-4 shrink-0 text-faint" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setActive(0); }}
                placeholder="검색 (초성도 됩니다)"
                aria-label="옵션 검색"
                aria-controls={listId}
                className="h-10 w-full bg-transparent text-sm text-ink outline-none placeholder:text-faint"
              />
            </div>
          )}
          <ul ref={listRef} id={listId} role="listbox" tabIndex={-1} aria-label={ariaLabel} className="overflow-y-auto overscroll-contain p-1 outline-none" style={{ maxHeight: PANEL_MAX_H - (showSearch ? 41 : 0) }}>
            {filtered.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">찾는 항목이 없습니다</li>}
            {filtered.map((o, i) => {
              const header = o.group && o.group !== lastGroup ? o.group : null;
              lastGroup = o.group;
              const isSel = o.value === value;
              return (
                <li key={o.value} role="presentation">
                  {header && <div className="px-2.5 pt-2 pb-1 text-xs font-semibold text-faint">{header}</div>}
                  <div
                    role="option"
                    data-index={i}
                    aria-selected={isSel}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(o)}
                    className={`flex cursor-pointer items-center gap-2 rounded-ctl px-2.5 py-2 text-sm ${i === active ? 'bg-select' : ''} ${isSel ? 'font-semibold text-ink' : 'text-ink'}`}
                  >
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.hint && <span className="shrink-0 text-xs text-muted">{o.hint}</span>}
                    <Check className={`size-4 shrink-0 text-accent ${isSel ? '' : 'invisible'}`} />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>,
        document.body,
      )}
    </div>
  );
}
