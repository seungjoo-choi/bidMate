import { ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface MenuItem {
  key: string;
  label: string;
  description?: string;
  disabled?: boolean;
  /** 이 항목 앞에 구분선 */
  dividerBefore?: boolean;
  onSelect: () => void;
}

/**
 * 분할 버튼: 주 버튼(누르면 바로 실행) + ▾(드롭다운 메뉴).
 * tone='ai'는 AI 전용 연보라 면, 'neutral'은 기본 테두리 버튼. Escape·바깥 클릭·선택 시 닫힌다.
 */
export function MenuButton({ icon, label, hint, items, header, onOpenChange, onMain, disabled, tone = 'neutral', title, caretLabel = '다른 방법으로 실행' }: {
  icon?: ReactNode;
  label: ReactNode;
  /** 라벨 뒤 세로선 다음에 붙는 작은 글씨 */
  hint?: ReactNode;
  items: MenuItem[];
  /** 메뉴 맨 위, 항목 앞에 붙는 영역(예: 공급자 탭). 메뉴 항목이 아니라 화살표 키 이동에서 빠진다 */
  header?: ReactNode;
  onOpenChange?: (open: boolean) => void;
  onMain: () => void;
  disabled?: boolean;
  tone?: 'ai' | 'neutral';
  title?: string;
  caretLabel?: string;
}) {
  const [open, setOpenState] = useState(false);
  const setOpen = (v: boolean) => { setOpenState(v); onOpenChange?.(v); };
  const rootRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const close = (restoreFocus: boolean) => { setOpen(false); if (restoreFocus) caretRef.current?.focus(); };
  const enabledItems = () => Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
  // 열면 첫 활성 항목으로 포커스를 옮긴다
  useEffect(() => { if (open) enabledItems()[0]?.focus(); }, [open]);
  const onMenuKey = (e: React.KeyboardEvent) => {
    const list = enabledItems();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    const to = e.key === 'ArrowDown' ? (i + 1) % list.length : e.key === 'ArrowUp' ? (i <= 0 ? list.length - 1 : i - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : -1;
    if (to < 0 || list.length === 0) return;
    e.preventDefault();
    list[to]?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(true); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  const ai = tone === 'ai';
  const face = ai
    ? 'border-ai-line bg-ai-wash hover:bg-ai-line/40'
    : 'border-line-strong bg-surface hover:bg-sunken';
  return (
    <div ref={rootRef} className="relative inline-flex rounded-btn shadow-card">
      <button
        type="button" title={title} disabled={disabled} onClick={onMain}
        className={`inline-flex h-9 items-center gap-2 rounded-l-btn border border-r-0 pr-3.5 pl-3 text-sm leading-none font-semibold whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none text-ink ${face}`}
      >
        {icon}
        {label}
        {hint && <small className={`border-l pl-2.5 text-xs font-normal ${ai ? 'border-ai-line text-ai-ink' : 'border-line text-muted'}`}>{hint}</small>}
      </button>
      <button
        ref={caretRef} type="button" disabled={disabled} aria-haspopup="menu" aria-expanded={open} aria-label={caretLabel} onClick={() => setOpen(!open)}
        className={`grid h-9 w-[34px] place-items-center rounded-r-btn border transition-colors disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none ${ai ? 'text-ai-ink' : 'text-muted'} ${face}`}
      >
        <ChevronDown className="size-3.5" />
      </button>
      {open && (
        <div ref={menuRef} role="menu" onKeyDown={onMenuKey} className="absolute top-full right-0 z-30 mt-1.5 min-w-70 rounded-card border border-line bg-surface p-1.5 shadow-overlay">
          {header}
          {items.map((it) => (
            <div key={it.key}>
              {it.dividerBefore && <hr className="mx-1.5 my-1 border-line" />}
              <button
                type="button" role="menuitem" disabled={it.disabled}
                onClick={() => { close(true); it.onSelect(); }}
                className="flex w-full flex-col items-start rounded-ctl px-2.5 py-2 text-left hover:bg-select disabled:pointer-events-none disabled:opacity-40"
              >
                <span className="text-sm text-ink">{it.label}</span>
                {it.description && <span className="text-xs text-muted">{it.description}</span>}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
