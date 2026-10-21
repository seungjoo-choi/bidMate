import { ArrowRight, Check, ChevronDown, ChevronRight, Eye, Hash, Scissors } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import { PREFIX_LABELS } from '../../../core/rfp/ids';
import type { RfpPair } from '../../../core/types/rfp';
import { hintsOf, refItem, type Hint, type HintTone, type PrefixGroup } from './compare-view-logic';
import { STATUS_DOT, STATUS_LABEL } from './SummaryStrip';

const BIG_LIST = 200;
const TONE: Record<HintTone, string> = {
  plain: 'bg-sunken text-muted', ren: 'bg-btn-pri-wash text-btn-pri-ink', num: 'bg-warn-wash text-warn', col: 'bg-danger-wash text-danger',
};

/** pair 객체는 비교 결과가 바뀔 때만 새로 만들어지므로, 힌트(줄 diff 포함)는 pair별로 한 번만 계산한다. */
const hintCache = new WeakMap<RfpPair, Hint[]>();
const hintsFor = (p: RfpPair): Hint[] => {
  let h = hintCache.get(p);
  if (!h) { h = hintsOf(p); hintCache.set(p, h); }
  return h;
};

function HintChip({ h }: { h: Hint }) {
  const cls = `inline-flex items-center gap-[3px] rounded px-1.5 text-[11px] leading-[18px] font-semibold ${TONE[h.tone]}`;
  if (h.stats) {
    const { mod, add, del } = h.stats;
    return (
      <span className={cls}>
        {mod > 0 && <>고침 {mod}</>}
        {add > 0 && <span className="text-ok">+{add}줄</span>}
        {del > 0 && <span className="text-danger">−{del}줄</span>}
      </span>
    );
  }
  return (
    <span className={cls}>
      {h.id === 'num' && <Hash className="size-2.5" />}
      {(h.id === 'split' || h.id === 'merged') && <Scissors className="size-2.5" />}
      {h.label}
    </span>
  );
}

const Row = memo(function Row({ pair, selected, done, big, onSelect, onToggle }: {
  pair: RfpPair; selected: boolean; done: boolean; big: boolean;
  onSelect: (key: string) => void; onToggle: (key: string) => void;
}) {
  const it = refItem(pair);
  const renum = pair.prev && pair.next && pair.prev.id !== pair.next.id;
  const hints = pair.status === 'same' ? [] : hintsFor(pair);
  return (
    <div
      data-k={pair.key} aria-current={selected || undefined} onClick={() => onSelect(pair.key)}
      style={big ? { contentVisibility: 'auto', containIntrinsicSize: 'auto 64px' } : undefined}
      className={`relative grid cursor-pointer grid-cols-[20px_minmax(0,1fr)_auto] items-start gap-2.5 border-t border-line py-[11px] pl-3.5 pr-4 hover:bg-sunken ${selected ? 'bg-select before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-ink' : ''}`}
    >
      <span className={`mt-1.5 size-2.5 justify-self-center rounded-[3px] ${STATUS_DOT[pair.status]}`} title={STATUS_LABEL[pair.status]} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1 font-mono text-[13px] leading-5">
          {renum ? (
            <>
              <span className="font-medium text-faint line-through decoration-faint/60">{pair.prev!.id}</span>
              <ArrowRight className="size-3 text-faint" />
              <span className="rounded bg-sunken px-1.5 font-bold text-ink">{pair.next!.id}</span>
            </>
          ) : <span className="rounded bg-sunken px-1.5 font-bold text-ink">{it.id}</span>}
        </div>
        <div className={`mt-1 text-sm leading-snug [overflow-wrap:anywhere] ${pair.status === 'same' || done ? 'font-medium text-muted' : 'font-semibold'}`}>{it.name}</div>
        {hints.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{hints.map((h) => <HintChip key={h.id} h={h} />)}</div>}
      </div>
      {pair.status !== 'same' ? (
        <button
          type="button" role="checkbox" aria-checked={done} aria-label="확인함"
          onClick={(e) => { e.stopPropagation(); onToggle(pair.key); }}
          className={`mt-0.5 grid size-5 place-items-center rounded-md border-[1.5px] ${done ? 'border-ok bg-ok text-white' : 'border-line-strong text-transparent hover:text-faint'}`}
        >
          <Check className="size-3 stroke-[3]" />
        </button>
      ) : <span />}
    </div>
  );
});

export function ChangeList({ groups, selectedKey, reviewed, onSelect, onToggleReviewed, hiddenSame, onShowSame }: {
  groups: PrefixGroup[]; selectedKey: string | null; reviewed: ReadonlySet<string>;
  onSelect: (key: string) => void; onToggleReviewed: (key: string) => void;
  hiddenSame: number; onShowSame: () => void;
}) {
  const shownCount = groups.reduce((n, g) => n + g.items.length, 0);
  const big = shownCount > BIG_LIST;
  const [toggled, setToggled] = useState<Record<string, boolean>>({}); /* 사용자가 직접 접거나 편 구역 */
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedKey) return;
    box.current?.querySelector(`[data-k="${CSS.escape(selectedKey)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selectedKey]);

  return (
    <div ref={box} className="rounded-card border border-line bg-surface shadow-card">
      {groups.map((g) => {
        const holdsSelected = !!selectedKey && g.items.some((p) => p.key === selectedKey);
        const open = holdsSelected || (toggled[g.prefix] ?? !big);
        return (
          <section key={g.prefix}>
            <button
              type="button" aria-expanded={open}
              onClick={() => setToggled((t) => ({ ...t, [g.prefix]: !open }))}
              className="sticky top-0 z-[2] flex w-full items-center gap-2 border-t border-line bg-sunken px-4 py-[9px] text-left text-[0.8125rem] font-bold first:border-t-0 first:rounded-t-card"
            >
              {big && (open ? <ChevronDown className="size-3.5 text-faint" /> : <ChevronRight className="size-3.5 text-faint" />)}
              <span className="font-mono">{g.prefix}</span>
              <span className="font-medium text-muted">{PREFIX_LABELS[g.prefix] ?? ''}</span>
              <span className="ml-auto text-xs font-medium text-faint">{g.total}개 · 달라짐 {g.changed}</span>
            </button>
            {open && g.items.map((p) => (
              <Row key={p.key} pair={p} selected={p.key === selectedKey} done={reviewed.has(p.key)} big={big} onSelect={onSelect} onToggle={onToggleReviewed} />
            ))}
          </section>
        );
      })}
      {hiddenSame > 0 && (
        <button
          type="button" onClick={onShowSame}
          className="flex w-full items-center gap-2 rounded-b-card border-t border-dashed border-line-strong bg-sunken px-4 py-3 text-left text-[0.8125rem] text-muted hover:text-ink"
        >
          <Eye className="size-3.5 shrink-0" />
          {/* flex 안에서 문장이 조각마다 따로 줄바꿈되지 않게 한 덩어리로 묶는다 */}
          <span className="min-w-0">비교 대상과 똑같은 요구사항 <b className="text-ink">{hiddenSame}개</b>는 숨겨져 있어요</span>
          <span className="ml-auto shrink-0 font-semibold text-primary">보기</span>
        </button>
      )}
    </div>
  );
}
