import { ChevronDown, ChevronUp, Loader2, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { send } from '../../../messaging/bus';
import { Button, InlineAlert } from '../../../ui/components';
import { inputClass } from '../../../ui/components/Field';
import { buildTextBlocks, displayLine, evidenceSpan, type TextBlock } from '../../../ui/review/text-view';

const WINDOW = 600;
const STEP = 600;

/** query가 있으면 그 말로 검색한 상태로 연다. quote가 있으면 기준 줄 근처에서 그 원문이 걸친 줄 전체를 강조한다. */
export interface DrawerTarget { textPath: string; line?: number; title: string; query?: string; quote?: string }

/** load를 주면 extraction/text 대신 그 함수로 텍스트를 가져온다(RFP 비교 등 공고 밖 문서). 스크롤 줄은 target.line. */
export function TextDrawer({ noticeId, target, onClose, load }: { noticeId: string; target: DrawerTarget; onClose: () => void; load?: () => Promise<{ text: string }> }) {
  const [shown, setShown] = useState(false);
  const [lines, setLines] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [query, setQuery] = useState(target.query ?? '');
  const [cur, setCur] = useState(0);
  const [scrollTo, setScrollTo] = useState<number | null>(null);
  const [raw, setRaw] = useState(false);
  const [span, setSpan] = useState<[number, number] | null>(null);
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
    (load ? load() : send('extraction/text', { noticeId, textPath: target.textPath }, { timeoutMs: 30_000 })).then(
      ({ text }) => {
        if (!alive) return;
        const ls = text.split('\n');
        setLines(ls);
        const sp = evidenceSpan(ls, target.line, target.quote);
        setSpan(sp);
        const t = sp ? sp[0] : 0;
        setRange([Math.max(0, t - WINDOW), Math.min(ls.length, t + WINDOW + 1)]);
        if (sp) setScrollTo(t);
      },
      (e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)); },
    );
    return () => { alive = false; };
  }, [noticeId, target.textPath, target.line, target.quote]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !lines) return [] as number[];
    const out: number[] = [];
    lines.forEach((l, i) => { if (displayLine(l).toLowerCase().includes(q)) out.push(i); });
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

  const blocks = useMemo(() => (lines ? buildTextBlocks(lines) : []), [lines]);
  const inSpan = (i: number) => !!span && i >= span[0] && i <= span[1];
  /** 근거 구간은 진한 노랑+왼쪽 막대, 검색 일치는 옅은 노랑, 현재 일치는 테두리. */
  const hl = (i: number) => {
    const isMatch = matchSet.has(i);
    const isCur = isMatch && matches[cur] === i;
    return `${inSpan(i) ? 'bg-mark-strong shadow-[inset_3px_0_0_var(--color-warn)]' : isMatch ? 'bg-mark' : ''} ${isCur ? 'outline-2 -outline-offset-2 outline-accent' : ''}`;
  };
  const lineDiv = (i: number, text: string, extra = '') => (
    <div key={i} data-i={i} className={`min-h-6 whitespace-pre-wrap wrap-anywhere ${extra} ${hl(i)}`}>{text}</div>
  );
  const renderBlock = (b: TextBlock) => {
    if (b.kind === 'page') return <div key={b.i} data-i={b.i} className="my-3 flex items-center gap-3 px-6 text-xs text-faint"><span className="h-px flex-1 bg-line" />{b.page}쪽<span className="h-px flex-1 bg-line" /></div>;
    if (b.kind === 'line') return lineDiv(b.i, lines![b.i]!, 'px-6');
    return (
      <div key={b.start} data-i={b.start} className="my-2 overflow-x-auto px-6">
        <table className="w-full border-collapse text-[0.8125rem] leading-5">
          <tbody>
            {b.rows.map((row) => (
              <tr key={row[0]!.r}>
                {row.map((c) => (
                  <td key={c.c} rowSpan={c.rowSpan} colSpan={c.colSpan} className="border border-line px-2 py-1 align-top">
                    {c.lines.map((i) => lineDiv(i, displayLine(lines![i]!), 'min-h-5'))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };
  return (
    <>
      <div className={`fixed inset-0 z-40 bg-black/30 transition-opacity duration-200 motion-reduce:transition-none ${shown ? 'opacity-100' : 'opacity-0'}`} onClick={close} />
      <aside
        role="dialog"
        aria-label="전체 텍스트"
        className={`fixed right-0 top-0 z-50 flex h-full w-[min(820px,65vw)] flex-col border-l border-line bg-surface shadow-overlay transition-transform duration-200 motion-reduce:transition-none ${shown ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <header className="flex items-center gap-3 border-b border-line px-5 py-3">
          <div className="min-w-0 flex-1 text-base leading-snug font-semibold wrap-anywhere">{target.title}</div>
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
          <Button variant="ghost" title={raw ? '표를 원문처럼 정리해 보기' : '추출된 텍스트를 줄 번호와 함께 그대로 보기'} onClick={() => { setRaw((v) => !v); if (span) setScrollTo(span[0]); }}>{raw ? '정리된 보기' : '원본 텍스트'}</Button>
        </div>
        <div ref={listRef} className={`min-h-0 flex-1 overflow-auto py-3 text-sm leading-6 ${raw ? 'font-code' : ''}`}>
          {error && <div className="p-4"><InlineAlert tone="error">{error}</InlineAlert></div>}
          {!lines && !error && <div className="flex justify-center p-8 text-muted"><Loader2 className="size-5 animate-spin" /></div>}
          {lines && (
            <>
              {range[0] > 0 && <button className="mb-1 w-full py-2 text-center text-accent hover:bg-sunken" onClick={() => setRange([Math.max(0, range[0] - STEP), range[1]])}>앞쪽 더 보기 ({range[0]}줄 남음)</button>}
              {raw
                ? lines.slice(range[0], range[1]).map((l, k) => {
                    const i = range[0] + k;
                    return (
                      <div key={i} data-i={i} className={`flex ${hl(i)}`}>
                        <span className="w-16 shrink-0 select-none pr-4 text-right text-faint">{i + 1}</span>
                        <span className="min-w-0 whitespace-pre-wrap wrap-anywhere">{l}</span>
                      </div>
                    );
                  })
                : blocks.filter((b) => (b.kind === 'table' ? b.end >= range[0] && b.start < range[1] : b.i >= range[0] && b.i < range[1])).map(renderBlock)}
              {range[1] < lines.length && <button className="mt-1 w-full py-2 text-center text-accent hover:bg-sunken" onClick={() => setRange([range[0], Math.min(lines.length, range[1] + STEP)])}>뒤쪽 더 보기 ({lines.length - range[1]}줄 남음)</button>}
            </>
          )}
        </div>
      </aside>
    </>
  );
}
