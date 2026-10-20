import { ChevronDown, ChevronUp, Loader2, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { send } from '../../../messaging/bus';
import { Button, InlineAlert } from '../../../ui/components';
import { inputClass } from '../../../ui/components/Field';

const WINDOW = 600;
const STEP = 600;

/** query가 있으면 그 말로 검색한 상태로 연다. */
export interface DrawerTarget { textPath: string; line?: number; title: string; query?: string }

export function TextDrawer({ noticeId, target, onClose }: { noticeId: string; target: DrawerTarget; onClose: () => void }) {
  const [shown, setShown] = useState(false);
  const [lines, setLines] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [query, setQuery] = useState(target.query ?? '');
  const [cur, setCur] = useState(0);
  const [scrollTo, setScrollTo] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const close = () => { setShown(false); setTimeout(onClose, 200); };

  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', on);
    return () => document.removeEventListener('keydown', on);
  });

  useEffect(() => {
    let alive = true;
    send('extraction/text', { noticeId, textPath: target.textPath }, { timeoutMs: 30_000 }).then(
      ({ text }) => {
        if (!alive) return;
        const ls = text.split('\n');
        setLines(ls);
        const t = target.line && target.line >= 1 ? Math.min(target.line, ls.length) - 1 : 0;
        setRange([Math.max(0, t - WINDOW), Math.min(ls.length, t + WINDOW + 1)]);
        if (target.line) setScrollTo(t);
      },
      (e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)); },
    );
    return () => { alive = false; };
  }, [noticeId, target.textPath, target.line]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !lines) return [] as number[];
    const out: number[] = [];
    lines.forEach((l, i) => { if (l.toLowerCase().includes(q)) out.push(i); });
    return out;
  }, [query, lines]);
  const matchSet = useMemo(() => new Set(matches), [matches]);

  useEffect(() => { setCur(0); if (matches[0] !== undefined) goto(matches[0]); }, [matches]); // eslint-disable-line react-hooks/exhaustive-deps

  const goto = (i: number) => {
    setRange(([s, e]) => (i >= s && i < e ? [s, e] : [Math.max(0, i - WINDOW), Math.min(lines?.length ?? 0, i + WINDOW + 1)]));
    setScrollTo(i);
  };
  useEffect(() => {
    if (scrollTo === null) return;
    listRef.current?.querySelector(`[data-i="${scrollTo}"]`)?.scrollIntoView({ block: 'center' });
    setScrollTo(null);
  }, [scrollTo, range]);

  const step = (d: number) => {
    if (!matches.length) return;
    const n = (cur + d + matches.length) % matches.length;
    setCur(n);
    goto(matches[n]!);
  };

  const targetIdx = target.line ? target.line - 1 : -1;
  return (
    <>
      <div className={`fixed inset-0 z-40 bg-black/30 transition-opacity duration-200 motion-reduce:transition-none ${shown ? 'opacity-100' : 'opacity-0'}`} onClick={close} />
      <aside
        role="dialog"
        aria-label="전체 텍스트"
        className={`fixed right-0 top-0 z-50 flex h-full w-[min(820px,65vw)] flex-col border-l border-line bg-surface shadow-overlay transition-transform duration-200 motion-reduce:transition-none ${shown ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <header className="flex items-center gap-3 border-b border-line px-5 py-3">
          <div className="min-w-0 flex-1 truncate text-base font-semibold">{target.title}</div>
          <Button variant="ghost" size="icon" aria-label="닫기" icon={<X />} onClick={close} />
        </header>
        <div className="flex items-center gap-1.5 border-b border-line px-5 py-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
            <input
              className={`${inputClass} pl-8`} placeholder="텍스트 검색" value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) step(e.shiftKey ? -1 : 1);
                else if (e.key === 'ArrowDown') { e.preventDefault(); step(1); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
              }}
            />
          </div>
          <span className="w-16 text-center text-xs text-muted">{query.trim() ? (matches.length ? `${cur + 1}/${matches.length}` : '없음') : ''}</span>
          <Button variant="ghost" size="icon" aria-label="이전 일치" icon={<ChevronUp />} onClick={() => step(-1)} />
          <Button variant="ghost" size="icon" aria-label="다음 일치" icon={<ChevronDown />} onClick={() => step(1)} />
        </div>
        <div ref={listRef} className="min-h-0 flex-1 overflow-auto py-3 font-mono text-sm leading-6">
          {error && <div className="p-4"><InlineAlert tone="error">{error}</InlineAlert></div>}
          {!lines && !error && <div className="flex justify-center p-8 text-muted"><Loader2 className="size-5 animate-spin" /></div>}
          {lines && (
            <>
              {range[0] > 0 && <button className="mb-1 w-full py-2 text-center text-accent hover:bg-sunken" onClick={() => setRange([Math.max(0, range[0] - STEP), range[1]])}>앞쪽 더 보기 ({range[0]}줄 남음)</button>}
              {lines.slice(range[0], range[1]).map((l, k) => {
                const i = range[0] + k;
                const isTarget = i === targetIdx;
                const isMatch = matchSet.has(i);
                const isCur = isMatch && matches[cur] === i;
                return (
                  <div key={i} data-i={i} className={`flex ${isTarget ? 'bg-warn-wash' : ''} ${isMatch ? (isCur ? 'bg-mark-strong' : 'bg-mark') : ''}`}>
                    <span className="w-16 shrink-0 select-none pr-4 text-right text-faint">{i + 1}</span>
                    <span className="min-w-0 whitespace-pre-wrap wrap-anywhere">{l}</span>
                  </div>
                );
              })}
              {range[1] < lines.length && <button className="mt-1 w-full py-2 text-center text-accent hover:bg-sunken" onClick={() => setRange([range[0], Math.min(lines.length, range[1] + STEP)])}>뒤쪽 더 보기 ({lines.length - range[1]}줄 남음)</button>}
            </>
          )}
        </div>
      </aside>
    </>
  );
}
