import { MoreHorizontal } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from './Button';

export interface MoreMenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  title?: string;
  disabled?: boolean;
  onSelect: () => void;
}

/** [더보기 ⋯] 버튼 + 드롭다운. 자주 안 쓰는 동작을 접어 둔다. Escape·바깥 클릭·선택 시 닫힌다. */
export function MoreMenu({ items, label = '더보기' }: { items: MoreMenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const enabled = () => Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);

  useEffect(() => { if (open) enabled()[0]?.focus(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const onMenuKey = (e: React.KeyboardEvent) => {
    const list = enabled();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    const to = e.key === 'ArrowDown' ? (i + 1) % list.length : e.key === 'ArrowUp' ? (i <= 0 ? list.length - 1 : i - 1) : -1;
    if (to < 0 || list.length === 0) return;
    e.preventDefault();
    list[to]?.focus();
  };

  if (items.length === 0) return null;
  return (
    <div ref={rootRef} className="relative">
      <Button ref={btnRef} variant="secondary" icon={<MoreHorizontal />} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>{label}</Button>
      {open && (
        <div ref={menuRef} role="menu" onKeyDown={onMenuKey} className="absolute top-full right-0 z-30 mt-1.5 min-w-52 rounded-card border border-line bg-surface p-1.5 shadow-overlay">
          {items.map((it) => (
            <button
              key={it.key} type="button" role="menuitem" title={it.title} disabled={it.disabled}
              onClick={() => { setOpen(false); btnRef.current?.focus(); it.onSelect(); }}
              className="flex w-full items-center gap-2.5 rounded-ctl px-2.5 py-2 text-left text-sm text-ink hover:bg-select focus-visible:bg-select disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-[15px] [&_svg]:shrink-0 [&_svg]:stroke-[1.75] [&_svg]:text-muted"
            >
              {it.icon}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
