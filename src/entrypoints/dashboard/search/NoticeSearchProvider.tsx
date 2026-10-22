import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useToast } from '../../../ui/components';
import { NoticeSearchPanel } from './NoticeSearchPanel';

export interface SearchOpenOpts { title?: string; query?: string }
interface PanelState { noticeId: string; title: string; query: string }
interface SearchCtx {
  open(noticeId: string, opts?: SearchOpenOpts): void;
  close(): void;
  /** 화면이 "현재 공고"를 등록한다. 단축키는 등록된 화면에서만 동작한다. */
  setCurrent(noticeId: string | null, title?: string): void;
  /** 패널이 열려 있는 공고 id(없으면 null). */
  openNoticeId: string | null;
}

const noop = () => undefined;
const Ctx = createContext<SearchCtx>({ open: noop, close: noop, setCurrent: noop, openNoticeId: null });

export const useNoticeSearch = () => useContext(Ctx);

/** 입력 요소에 포커스가 있으면 `/`를 가로채지 않는다. */
export function isEditableTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

export function NoticeSearchProvider({ children }: { children: ReactNode }) {
  const [panel, setPanel] = useState<PanelState | null>(null);
  const current = useRef<{ noticeId: string; title: string } | null>(null);
  const toast = useToast();
  const showToast = toast.show;

  const open = useCallback((noticeId: string, opts?: SearchOpenOpts) => {
    setPanel({ noticeId, title: opts?.title ?? current.current?.title ?? noticeId, query: opts?.query ?? '' });
  }, []);
  const close = useCallback(() => setPanel(null), []);
  const setCurrent = useCallback((noticeId: string | null, title?: string) => {
    current.current = noticeId ? { noticeId, title: title ?? noticeId } : null;
  }, []);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const ctrlShiftF = e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'f';
      const slash = e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing && !isEditableTarget(e.target);
      if (!ctrlShiftF && !slash) return;
      // 패널이 열려 있으면 브라우저 기본 동작(빠른 찾기 등)만 막는다.
      if (panel) { e.preventDefault(); return; }
      // 다른 모달·오버레이(TextDrawer, 확인창 등)가 열려 있으면 가로채지 않는다.
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [aria-modal="true"]')) return;
      e.preventDefault();
      const c = current.current;
      if (!c) { showToast('공고 화면에서 쓸 수 있습니다'); return; }
      open(c.noticeId, { title: c.title });
    };
    document.addEventListener('keydown', on);
    return () => document.removeEventListener('keydown', on);
  }, [panel, open, showToast]);

  const value = useMemo<SearchCtx>(() => ({ open, close, setCurrent, openNoticeId: panel?.noticeId ?? null }), [open, close, setCurrent, panel?.noticeId]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {panel && <NoticeSearchPanel key={`${panel.noticeId}|${panel.query}`} noticeId={panel.noticeId} title={panel.title} initialQuery={panel.query} onClose={close} />}
      {toast.node}
    </Ctx.Provider>
  );
}

/** 공고 화면이 마운트된 동안 "현재 공고"로 등록한다(단축키 대상). */
export function useSearchContext(noticeId: string | null | undefined, title?: string): void {
  const { setCurrent } = useNoticeSearch();
  useEffect(() => {
    setCurrent(noticeId ?? null, title);
    return () => setCurrent(null);
  }, [noticeId, title, setCurrent]);
}
