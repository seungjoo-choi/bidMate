import { Check, ChevronDown, Loader2, Star } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { FollowTarget } from '../../core/types/result';
import { send } from '../../messaging/bus';
import { Button } from '../../ui/components';
import { FOLLOW_TARGET_LABEL, followErrorText, followMenuItems, followToastParts, type FollowAction } from '../../ui/notices/result-view';

export type FollowResult =
  | { ok: true; following: FollowTarget | null; startAt: string | null; title: string; body: string; mood: 'happy' | 'idle' }
  | { ok: false; text: string };

/** follow/set 호출. 실패 사유는 화면 문구로 바꿔 돌려준다(throw 없음). prev: 적용 전 범위 */
export function useFollowToggle() {
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const apply = async (noticeId: string, action: FollowAction, prev: FollowTarget | null): Promise<FollowResult> => {
    setBusy((s) => new Set(s).add(noticeId));
    try {
      const r = await send('follow/set', action.follow ? { noticeId, follow: true, target: action.target } : { noticeId, follow: false });
      const next = r.following ? r.target : null;
      const parts = followToastParts(next, prev, r.startAt);
      void send('deadline/refresh', { reason: 'manual' }).catch(() => undefined); // 팔로우는 마감 알림 대상을 바꾼다
      return { ok: true, following: next, startAt: r.startAt, title: parts.title, body: parts.text, mood: parts.mood };
    } catch (e) {
      return { ok: false, text: followErrorText((e as { code?: string }).code, e instanceof Error ? e.message : undefined) };
    } finally {
      setBusy((s) => { const n = new Set(s); n.delete(noticeId); return n; });
    }
  };
  return { apply, isBusy: (id: string) => busy.has(id) };
}

const TIP_OFF = '팔로우하면 개찰 뒤 결과를 자주 확인해 알림으로 알려 드립니다. 누르면 범위를 고릅니다';
const ITEM_SELECTOR = '[role="menuitemradio"]:not(:disabled), [role="menuitem"]:not(:disabled)';
const MENU_ROOM = 180;

/** 팔로우 범위 메뉴. 목록의 별(star)과 상세 머리의 버튼(button) 두 모양. */
export function FollowMenu({ variant, following, rankDone, notify, busy, disabled, reason, title, onSelect }: {
  variant: 'star' | 'button';
  following: FollowTarget | null;
  rankDone: boolean;
  notify: { rank: boolean; final: boolean };
  busy: boolean;
  disabled?: boolean;
  reason?: string;
  title: string;
  onSelect: (action: FollowAction) => void;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const open = rect !== null;
  const blocked = busy || !!disabled;
  const items = followMenuItems(following, rankDone, notify);

  const close = (restoreFocus: boolean) => { setRect(null); if (restoreFocus) triggerRef.current?.focus(); };
  const openMenu = () => {
    if (blocked) return;
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) setRect(r);
  };
  const enabledItems = () => Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>(ITEM_SELECTOR) ?? []);

  // 열릴 때 초기 포커스: 현재 범위, 없으면 낙찰까지. 비활성이면 첫 활성 항목
  useEffect(() => {
    if (!open) return;
    const list = enabledItems();
    const want = menuRef.current?.querySelector<HTMLButtonElement>(`[data-key="${following ?? 'final'}"]:not(:disabled)`);
    (want ?? list[0])?.focus();
  }, [open]);

  useEffect(() => { if (blocked) setRect(null); }, [blocked]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !menuRef.current?.contains(t)) setRect(null);
    };
    const onScroll = (e: Event) => { if (!(e.target instanceof Node && menuRef.current?.contains(e.target))) setRect(null); };
    const onResize = () => setRect(null);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  const onTriggerKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      openMenu();
    }
  };

  const choose = (key: FollowTarget | 'off', checked?: boolean) => {
    close(true);
    if (checked) return;
    onSelect(key === 'off' ? { follow: false } : { follow: true, target: key });
  };

  const onMenuKey = (e: ReactKeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); close(true); return; }
    if (e.key === 'Tab') { close(false); return; }
    const list = enabledItems();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    const to = e.key === 'ArrowDown' ? (i + 1) % list.length : e.key === 'ArrowUp' ? (i <= 0 ? list.length - 1 : i - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : -1;
    if (to < 0 || list.length === 0) return;
    e.preventDefault();
    list[to]?.focus();
  };

  const tip = disabled ? reason
    : following ? `${FOLLOW_TARGET_LABEL[following]} 팔로우 중입니다. 누르면 범위를 바꾸거나 해제합니다`
    : TIP_OFF;
  const ariaLabel = following ? `${title} 팔로우 메뉴 (현재 ${FOLLOW_TARGET_LABEL[following]})` : `${title} 팔로우`;
  const on = following !== null;

  const below = rect ? window.innerHeight - rect.bottom : 0;
  const above = rect ? rect.top : 0;
  const up = !!rect && below < MENU_ROOM && above >= MENU_ROOM;
  const pos = rect
    ? { right: window.innerWidth - rect.right, ...(up ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }) }
    : undefined;

  const trigger = variant === 'star' ? (
    <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <button
        ref={triggerRef} type="button" aria-haspopup="menu" aria-expanded={open} aria-label={ariaLabel} title={tip}
        disabled={blocked} onClick={() => (open ? close(false) : openMenu())} onKeyDown={onTriggerKey}
        className={`grid size-8 place-items-center rounded-btn transition-colors motion-reduce:transition-none disabled:cursor-default ${
          on ? 'text-star hover:bg-star-wash' : 'text-faint hover:bg-line hover:text-ink'
        } ${disabled ? 'opacity-35 hover:bg-transparent hover:text-faint' : ''}`}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Star className={`size-[17px] ${on ? 'fill-current' : ''}`} strokeWidth={1.9} />}
      </button>
    </div>
  ) : (
    <Button
      ref={triggerRef} variant="ghost" loading={busy} aria-haspopup="menu" aria-expanded={open} aria-label={ariaLabel} title={tip}
      onClick={() => (open ? close(false) : openMenu())} onKeyDown={onTriggerKey}
      className={on ? '!border-star/45 !bg-star-wash [&_svg]:!fill-star [&_svg]:!text-star' : ''}
      icon={<Star />}
    >
      {on ? '팔로우 중' : '팔로우'}
      {following && <small className="border-l border-line pl-2.5 text-xs font-normal text-muted">{FOLLOW_TARGET_LABEL[following]}</small>}
      <ChevronDown className="size-3.5" />
    </Button>
  );

  return (
    <>
      {trigger}
      {open && createPortal(
        <div
          ref={menuRef} role="menu" aria-label="팔로우 범위" style={{ position: 'fixed', ...pos }}
          onKeyDown={onMenuKey} onClick={(e) => e.stopPropagation()}
          className="z-50 min-w-64 rounded-card border border-line bg-surface p-1.5 shadow-overlay"
        >
          {items.map((it) => (
            <div key={it.key}>
              {it.dividerBefore && <hr className="mx-1.5 my-1 border-line" />}
              <button
                type="button" data-key={it.key} disabled={it.disabled}
                role={it.key === 'off' ? 'menuitem' : 'menuitemradio'} aria-checked={it.key === 'off' ? undefined : !!it.checked}
                onClick={() => choose(it.key, it.checked)}
                className="flex w-full flex-col items-start rounded-ctl px-2.5 py-2 text-left hover:bg-select disabled:pointer-events-none disabled:opacity-40"
              >
                <span className="flex items-center gap-1.5 text-sm text-ink">
                  {it.key !== 'off' && (it.checked ? <Check className="size-3.5" aria-hidden /> : <span className="size-3.5" aria-hidden />)}
                  {it.label}
                </span>
                {it.description && <span className={`text-xs ${it.warn ? 'text-warn' : 'text-muted'}`}>{it.description}</span>}
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
