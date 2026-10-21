import { AlertTriangle, ArrowRight, Check, Eye, Hand, Hash, Link2, Link2Off, Scissors } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { diffLines, lineStats } from '../../../core/rfp/diff';
import type { LineOp, RequirementItem, RfpCompareResult, RfpPair } from '../../../core/types/rfp';
import { Button } from '../../../ui/components';
import { refItem } from './compare-view-logic';
import { cells, LineDiff, LN_DEL, LN_INS, SplitDiff } from './LineDiff';
import { SideChip } from './SideChip';
import { STATUS_LABEL } from './SummaryStrip';

export type DetailView = 'side' | 'inline';

const BADGE: Record<RfpPair['status'], string> = {
  changed: 'bg-warn-wash text-warn', added: 'bg-ok-wash text-ok', removed: 'bg-danger-wash text-danger', same: 'bg-sunken text-muted',
};

interface FieldRow { label: string; a: string; b: string; ops: LineOp[] | null; changed: boolean }

function fieldRows(p: RfpPair): FieldRow[] {
  const both = !!(p.prev && p.next);
  const defs: Array<[string, string, string]> = [
    ['분류', p.prev?.category ?? '', p.next?.category ?? ''],
    ['명칭', p.prev?.name ?? '', p.next?.name ?? ''],
    ['정의', p.prev?.definition ?? '', p.next?.definition ?? ''],
    ['세부내용', p.prev?.detail ?? '', p.next?.detail ?? ''],
  ];
  const labels: string[] = [];
  for (const e of [...(p.prev?.extras ?? []), ...(p.next?.extras ?? [])]) if (!labels.includes(e.label)) labels.push(e.label);
  for (const l of labels) {
    const f = (it?: RequirementItem) => it?.extras?.find((e) => e.label === l)?.text ?? '';
    defs.push([l, f(p.prev), f(p.next)]);
  }
  return defs.filter(([, a, b]) => a || b).map(([label, a, b]) => ({
    label, a, b, changed: both && a !== b, ops: both ? diffLines(a, b) : null,
  }));
}

function matchedByText(p: RfpPair): ReactNode {
  if (p.matchedBy === 'id') return <><Hash className="size-3.5" />번호로 짝지음</>;
  if (p.matchedBy === 'similarity') return <><Link2 className="size-3.5" />내용이 비슷해 짝지음 · {Math.round((p.score ?? 0) * 100)}%</>;
  if (p.matchedBy === 'manual') return <><Hand className="size-3.5" />직접 짝지음</>;
  return null;
}

const Banner = ({ tone, icon, children }: { tone: 'warn' | 'info'; icon: ReactNode; children: ReactNode }) => (
  <div className={`mx-[22px] mt-3.5 flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-[0.8125rem] leading-5 [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0 ${tone === 'warn' ? 'border-warn/30 bg-warn-wash [&_svg]:text-warn' : 'border-line bg-info-wash text-muted [&_svg]:text-faint'}`}>
    {icon}<div className="min-w-0">{children}</div>
  </div>
);

const Id = ({ children }: { children: ReactNode }) => <b className="font-mono font-semibold text-ink">{children}</b>;

export function PairDetail({ pair, result, view, onView, done, onToggleDone, onSelect, onUnpair, onPair, onOpenSource }: {
  pair: RfpPair; result: RfpCompareResult;
  view: DetailView; onView: (v: DetailView) => void;
  done: boolean; onToggleDone: () => void;
  onSelect: (key: string) => void; onUnpair: () => void; onPair: () => void;
  onOpenSource: (side: 'prev' | 'next') => void;
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set()); /* 부모가 key={pair.key}로 감싸 항목이 바뀌면 초기화 */
  const rows = useMemo(() => fieldRows(pair), [pair]);
  const it = refItem(pair);
  const both = !!(pair.prev && pair.next);
  const inline = view === 'inline' && both;
  const changedLabels = pair.status === 'changed' ? rows.filter((r) => r.changed).map((r) => r.label) : [];
  const st = useMemo(() => {
    const s = { mod: 0, add: 0, del: 0 };
    if (pair.status === 'changed') for (const r of rows) if (r.changed && r.ops) { const x = lineStats(r.ops); s.mod += x.mod; s.add += x.add; s.del += x.del; }
    return s;
  }, [pair, rows]);
  const by = matchedByText(pair);
  const linked = (keys: string[], side: 'prev' | 'next') =>
    keys.map((k) => result.pairs.find((p) => p[side]?.key === k)).filter((p): p is RfpPair => !!p);
  const links = pair.group
    ? (pair.group.kind === 'split' ? linked(pair.group.keys, 'prev') : linked(pair.group.keys, 'next'))
    : [];
  // 명칭·정의는 같아도 접지 않는다(무엇을 보고 있는지 바로 알 수 있게, 사용자 요구). 분류·세부내용 등만 접는다.
  const ALWAYS_OPEN = new Set(['명칭', '정의']);
  const showSameRow = (r: FieldRow) => both && !r.changed && !ALWAYS_OPEN.has(r.label) && !open.has(r.label) && pair.status !== 'same';
  const gridCols = inline ? 'grid-cols-[76px_minmax(0,1fr)]' : 'grid-cols-[76px_minmax(0,1fr)_minmax(0,1fr)]';

  return (
    <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-auto rounded-card border border-line bg-surface shadow-card">
      <div className="border-b border-line px-[22px] pb-4 pt-[18px]">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 text-[0.8125rem] leading-[26px] font-bold before:size-2 before:rounded-[2px] before:bg-current ${BADGE[pair.status]}`}>{STATUS_LABEL[pair.status]}</span>
          {by && <span className="inline-flex items-center gap-1 text-[0.8125rem] text-muted">{by}</span>}
        </div>
        <h2 className="mt-2.5 text-xl leading-7 font-bold tracking-tight">{it.name}</h2>
        <div className="mt-1 flex items-center gap-2 text-[0.8125rem] text-muted">
          {pair.prev && pair.next && pair.prev.id !== pair.next.id
            ? <><span className="font-mono">{pair.prev.id}</span><ArrowRight className="size-3.5 text-faint" /><span className="font-mono">{pair.next.id}</span><span className="rounded bg-btn-pri-wash px-1.5 text-[11px] leading-[18px] font-semibold text-btn-pri-ink">번호 바뀜</span></>
            : <span className="font-mono">{it.id}</span>}
          {it.category && <><span className="text-faint">·</span><span>{it.category}</span></>}
        </div>
        {changedLabels.length > 0 && (
          <div className="mt-2 text-[0.8125rem] text-muted">
            바뀐 칸 <b className="font-semibold text-ink">{changedLabels.join(' · ')}</b>
            {st.mod > 0 && <> · 고친 줄 <b className="font-semibold text-ink">{st.mod}</b></>}
            {st.add > 0 && <> · 새 줄 <b className="font-semibold text-ok">{st.add}</b></>}
            {st.del > 0 && <> · 빠진 줄 <b className="font-semibold text-danger">{st.del}</b></>}
          </div>
        )}
        {both && pair.status !== 'same' && (
          <div className="mt-3.5 flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-line bg-sunken p-0.5">
              {(['side', 'inline'] as const).map((v) => (
                <button key={v} type="button" onClick={() => onView(v)}
                  className={`h-[26px] rounded-md px-2.5 text-[0.8125rem] ${view === v ? 'bg-surface font-semibold text-ink shadow-btn' : 'text-muted'}`}>{v === 'side' ? '나란히' : '한 줄로'}</button>
              ))}
            </div>
            <span className="flex-1" />
            <span className="flex items-center gap-2 text-xs text-muted">
              <span className={`${LN_DEL} !m-0 !px-[7px] leading-5`}>빠진 줄</span>
              <span className={`${LN_INS} !m-0 !px-[7px] leading-5`}>새 줄</span>
              <span><del className="rounded-sm bg-diff-del px-px line-through">지운 말</del> <ins className="rounded-sm bg-diff-ins-strong px-px no-underline">바뀐 말</ins></span>
            </span>
          </div>
        )}
      </div>

      {pair.group && links.length > 0 && (
        <Banner tone="info" icon={<Scissors />}>
          {pair.group.kind === 'split'
            ? <>비교 대상 <Id>{links.map((p) => p.prev!.id).join(', ')}</Id>의 내용이 기준에서 나뉘어 들어간 것 같아요 → </>
            : <>이 항목은 기준 <Id>{links.map((p) => p.next!.id).join(', ')}</Id>에 합쳐진 것 같아요 → </>}
          {links.map((p, i) => (
            <span key={p.key}>{i > 0 && ' · '}<button type="button" className="font-mono font-semibold text-primary hover:underline" onClick={() => onSelect(p.key)}>{(pair.group!.kind === 'split' ? p.prev : p.next)!.id}</button></span>
          ))}
        </Banner>
      )}
      {pair.tags.includes('id_collision') && (
        <Banner tone="warn" icon={<AlertTriangle />}>
          양쪽에 <Id>{it.id}</Id>가 있지만 내용이 전혀 달라 짝짓지 않았어요. 같은 요구사항이 맞다면 [짝 맺기]로 이어 주세요.
        </Banner>
      )}
      {pair.tags.includes('weak') && (
        <Banner tone="warn" icon={<AlertTriangle />}>
          번호(<Id>{it.id}</Id>)는 같지만 명칭과 내용이 많이 달라요. 서로 다른 요구사항이면{' '}
          <button type="button" className="font-semibold text-primary hover:underline" onClick={onUnpair}>짝 풀기</button>로 신규·삭제로 나누세요.
        </Banner>
      )}
      {pair.tags.includes('number_only') && pair.prev && pair.next ? (
        <Banner tone="info" icon={<Check />}>
          내용은 같고 번호만 <Id>{pair.prev.id}</Id> → <Id>{pair.next.id}</Id>로 바뀌었어요. 제안서·조견표의 요구사항 번호를 고쳐 주세요.
        </Banner>
      ) : pair.tags.includes('format') && <Banner tone="info" icon={<Check />}>띄어쓰기·문장부호만 달라서 같은 항목으로 봤어요.</Banner>}

      {!inline && (
        <div className={`mt-3.5 grid border-y border-line bg-sunken text-xs font-bold ${gridCols}`}>
          <div />
          <div className="flex items-center gap-2 px-3.5 py-1.5"><SideChip side="prev" />{pair.prev ? <span className="font-mono text-muted">{pair.prev.id}</span> : '—'}</div>
          <div className="flex items-center gap-2 border-l border-line bg-btn-pri-wash/40 px-3.5 py-1.5"><SideChip side="next" />{pair.next ? <span className="font-mono text-btn-pri-ink">{pair.next.id}</span> : '—'}</div>
        </div>
      )}
      {rows.map((r) => {
        const lb = (
          <div className="py-3 pl-[22px] text-[0.8125rem] font-semibold text-muted">
            {r.label}{r.changed && pair.status === 'changed' && <span title="바뀜" className="ml-1.5 inline-block size-[7px] rounded-full bg-warn align-middle" />}
          </div>
        );
        const cell = 'whitespace-pre-wrap px-3.5 py-3 text-sm leading-7';
        if (showSameRow(r)) {
          return (
            <button key={r.label} type="button" onClick={() => setOpen((s) => new Set(s).add(r.label))}
              className={`grid w-full border-b border-line text-left hover:[&>div:last-child]:text-muted ${gridCols}`}>
              {lb}<div className={`py-[9px] px-3.5 text-[0.8125rem] text-faint ${inline ? '' : 'col-span-2'}`}>동일 · 펼치기</div>
            </button>
          );
        }
        if (inline) return <div key={r.label} className={`grid border-b border-line ${gridCols}`}>{lb}<div className={cell}><LineDiff ops={r.ops!} side="both" /></div></div>;
        if (r.ops) {
          // 좌우 줄 높이를 맞춘 나란히 보기. 오른쪽(기준) 바탕은 칸 전체에 깐다.
          return (
            <div key={r.label} className={`grid border-b border-line ${gridCols}`}>
              {lb}
              <div className="relative col-span-2 py-2.5">
                <div aria-hidden className="absolute inset-y-0 right-0 w-1/2 border-l border-line bg-btn-pri-wash/40" />
                <SplitDiff ops={r.ops} />
              </div>
            </div>
          );
        }
        const empty = (txt: string) => <div className={`${cell} flex items-center gap-1.5 text-faint [background:repeating-linear-gradient(135deg,transparent_0_8px,var(--color-sunken)_8px_9px)]`}>{txt}</div>;
        const nameRow = r.label === '명칭';
        return (
          <div key={r.label} className={`grid border-b border-line ${gridCols}`}>
            {lb}
            {pair.prev ? <div className={cell}>{cells(r.a)}</div> : empty(nameRow ? '비교 대상에 없음' : '')}
            {pair.next ? <div className={`${cell} border-l border-line bg-btn-pri-wash/40`}>{cells(r.b)}</div> : <div className="border-l border-line bg-btn-pri-wash/40">{empty(nameRow ? '기준 문서에 없음' : '')}</div>}
          </div>
        );
      })}

      <div className="flex flex-wrap items-center gap-2 px-[22px] py-3.5">
        {pair.prev && <Button variant="secondary" icon={<Eye />} onClick={() => onOpenSource('prev')}>{both ? '비교 대상 원문' : '원문 위치 보기'}</Button>}
        {pair.next && <Button variant="secondary" icon={<Eye />} onClick={() => onOpenSource('next')}>{both ? '기준 원문' : '원문 위치 보기'}</Button>}
        {both
          ? <Button variant="secondary" icon={<Link2Off />} onClick={onUnpair}>짝 풀기</Button>
          : <Button variant="secondary" icon={<Link2 />} onClick={onPair}>짝 맺기…</Button>}
        <span className="flex-1" />
        {pair.status !== 'same' && (
          <Button variant={done ? 'primary' : 'secondary'} icon={<Check />} onClick={onToggleDone}>
            {done ? '확인함' : '확인함으로 표시'}
            <kbd className={`ml-1 rounded px-1.5 font-mono text-[11px] leading-[18px] font-medium ${done ? 'bg-white/20 text-white/90' : 'border border-line-strong text-muted'}`}>Space</kbd>
          </Button>
        )}
      </div>
    </div>
  );
}
