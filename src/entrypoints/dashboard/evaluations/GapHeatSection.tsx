import { useEffect, useMemo, useState } from 'react';
import { heatmap, itemGaps } from '../../../core/evaluation/analyze';
import type { EvalItem } from '../../../core/types/evaluation';
import { TONE_TEXT, type EvalCtx } from './ctx';
import { barOf, f2, GRADE_NAMES, HEAT_CLASS, judgeLabel, shortName, signed, toneOf } from './eval-view';
import { CenterBar, HEAD_ROW, ROW, Section, Segmented, TD, TH } from './Section';

/** 상대보다 낮은 칸: 왼쪽 아래 모서리 삼각형. 칸 전체를 두르지 않아 많아도 숫자가 묻히지 않는다 */
const LOST_MARK = 'pointer-events-none absolute bottom-0 left-0 size-2 rounded-bl-[5px] bg-warn [clip-path:polygon(0_0,0_100%,100%_100%)]';

const leafName = (names: string[]): string => names[names.length - 1] ?? '';
const groupName = (names: string[]): string | null => (names.length > 1 ? names[0]! : null);

export function GapSection({ ctx }: { ctx: EvalCtx }) {
  const { rec, isOurs, opts } = ctx;
  const [sort, setSort] = useState<'loss' | 'item'>('loss');
  const gaps = useMemo(() => itemGaps(rec, ctx.ourBizNo, opts), [rec, ctx.ourBizNo, opts]);
  const byLoss = isOurs && sort === 'loss';
  const order = useMemo(() => new Map(rec.items.map((i: EvalItem, k) => [i.no, k] as const)), [rec]);
  const rows = byLoss ? gaps : [...gaps].sort((a, b) => (order.get(a.itemNo) ?? 0) - (order.get(b.itemNo) ?? 0));
  const bidders = rec.bidders.filter((b) => !b.excluded);
  let lastGroup: string | null | undefined;

  return (
    <Section
      title="세부항목별 격차"
      sub={isOurs ? '위원 평균 점수 차(배점 반영). 위일수록 많이 잃은 항목' : '업체별 위원 평균'}
      action={isOurs ? <Segmented label="격차 정렬" value={sort} onChange={setSort} options={[{ id: 'loss', label: '손실 큰 순' }, { id: 'item', label: '항목 순' }]} /> : undefined}
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm tabular-nums">
          <thead>
            <tr className={HEAD_ROW}>
              <th scope="col" className={`${TH} pl-6 text-left`}>항목</th>
              <th scope="col" className={`${TH} text-right`}>배점</th>
              {isOurs ? (
                <>
                  <th scope="col" className={`${TH} text-right`}>우리</th>
                  <th scope="col" className={`${TH} text-right`}>경쟁사 최고</th>
                  <th scope="col" className={`${TH} text-right`}>격차</th>
                  <th scope="col" className={`${TH} w-40 pr-6 text-center`}><span className="sr-only">격차 막대</span></th>
                </>
              ) : bidders.map((b) => <th scope="col" key={b.seq} title={b.name} className={`${TH} text-right`}>{shortName(b.name)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => {
              const grp = groupName(g.names);
              const head = !byLoss && grp !== lastGroup && grp !== null;
              if (!byLoss) lastGroup = grp;
              const tone = toneOf(g.gap);
              const bar = barOf(g.gapRatio, 0.15);
              return (
                <FragmentRows key={g.itemNo} head={head ? grp : null} span={2 + (isOurs ? 4 : bidders.length)}>
                  <tr className={ROW}>
                    <td className={`${TD} py-2 ${byLoss || grp === null ? 'pl-6' : 'pl-9'}`}>
                      {leafName(g.names)}
                      {byLoss && grp ? <span className="ml-2 rounded-full bg-sunken px-2 py-px text-[0.6875rem] text-muted">{grp}</span> : null}
                    </td>
                    <td className={`${TD} py-2 text-right text-muted`}>{g.maxScore ?? '—'}</td>
                    {isOurs ? (
                      <>
                        <td className={`${TD} py-2 text-right`}>{f2(g.ourMean)}</td>
                        <td className={`${TD} py-2 text-right text-muted`}>{f2(g.bestOtherMean)}</td>
                        <td className={`${TD} py-2 text-right font-semibold ${TONE_TEXT[tone]}`}>{signed(g.gap)}</td>
                        <td className={`${TD} py-2 pr-6`}><CenterBar side={bar.side} widthPct={bar.widthPct} /></td>
                      </>
                    ) : g.byBidder.filter((x) => bidders.some((b) => b.seq === x.seq)).map((x) => <td key={x.seq} className={`${TD} py-2 text-right`}>{f2(x.mean)}</td>)}
                  </tr>
                </FragmentRows>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

/** 대항목 머리 행(값 없음) + 항목 행 */
function FragmentRows({ head, span, children }: { head: string | null; span: number; children: React.ReactNode }) {
  return (
    <>
      {head !== null && <tr className="border-t border-line"><td colSpan={span} className="px-6 pt-3 pb-1 text-[0.8125rem] font-bold whitespace-nowrap">{head}</td></tr>}
      {children}
    </>
  );
}

export function HeatSection({ ctx }: { ctx: EvalCtx }) {
  const { rec, isOurs, opts } = ctx;
  const bidders = rec.bidders.filter((b) => !b.excluded);
  const base = isOurs && ctx.ourSeq !== null ? ctx.ourSeq : (bidders[0]?.seq ?? rec.bidders[0]?.seq ?? 0);
  const [pick, setPick] = useState<number | null>(null);
  useEffect(() => { setPick(null); }, [isOurs]);
  const seq = pick ?? base;
  // 우리 회사 기준이면 우리 업체 탭은 상대와, 상대 탭은 우리와 비교한다. 전체 보기는 다른 업체 최고값
  const against = isOurs && ctx.rival !== null && ctx.ourSeq !== null ? (seq === ctx.ourSeq ? ctx.rival : ctx.ourSeq) : null;
  const rowsAll = useMemo(() => heatmap(rec, seq, opts, against), [rec, seq, opts, against]);
  const anyLost = rowsAll.some((r) => r.cells.some((c) => c.lost));
  let lastGroup: string | null | undefined;

  return (
    <Section
      title="위원 × 세부항목 히트맵"
      sub={anyLost ? '칸 색은 배점 대비 비율, 주황 모서리는 상대보다 낮은 칸, 오른쪽 숫자는 낮은 칸 수' : '칸 색은 배점 대비 비율'}
      action={<Segmented label="히트맵 업체" value={String(seq)} onChange={(v) => setPick(Number(v))} options={bidders.map((b) => ({ id: String(b.seq), label: shortName(b.name) }))} />}
    >
      <div className="overflow-x-auto px-4 pb-1">
        <table className="w-full border-separate border-spacing-[3px] text-sm tabular-nums">
          <thead>
            <tr className="text-muted">
              <th scope="col" className="px-2 py-1 text-left text-[0.8125rem] font-semibold whitespace-nowrap">항목</th>
              {rec.judges.map((j) => (
                <th scope="col" key={j.index} title={judgeLabel(j.index)} className={`min-w-11 py-1 text-center text-[0.8125rem] font-semibold whitespace-nowrap ${ctx.excluded.has(j.index) ? 'text-faint line-through' : ''}`}>{j.index}</th>
              ))}
              {anyLost && <th scope="col" className="py-1 pl-2 text-right text-[0.8125rem] font-semibold whitespace-nowrap">낮음</th>}
            </tr>
          </thead>
          <tbody>
            {rowsAll.map((r) => {
              const grp = groupName(r.names);
              const head = grp !== lastGroup && grp !== null;
              lastGroup = grp;
              const lostCount = r.cells.filter((c) => c.lost).length;
              return (
                <FragmentHeat key={r.itemNo} head={head ? grp : null} span={1 + rec.judges.length + (anyLost ? 1 : 0)}>
                  <tr>
                    <td className="py-0.5 pr-3 pl-4 whitespace-nowrap">{leafName(r.names)}</td>
                    {r.cells.map((c) => {
                      const lostText = c.lost ? ' (상대보다 낮음)' : '';
                      const revText = c.revised !== null ? `, 수정 이력 점수 ${c.revised}` : '';
                      return (
                        <td
                          key={c.judge}
                          title={`${judgeLabel(c.judge)}, ${leafName(r.names)} ${c.score ?? '—'} / ${r.maxScore ?? '—'}${lostText}${revText}`}
                          className={`relative h-7 rounded-[5px] text-center text-xs ${c.level === null ? 'bg-sunken text-faint' : HEAT_CLASS[c.level]} ${c.skipped ? 'opacity-30' : ''}`}
                        >
                          {c.score ?? '—'}
                          {c.lost && <span className={LOST_MARK} aria-label="상대보다 낮음" />}
                          {c.revised !== null && <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-warn" aria-label="수정 이력 있음" />}
                        </td>
                      );
                    })}
                    {anyLost && (
                      <td className={`py-0.5 pl-2 text-right text-xs whitespace-nowrap ${lostCount === 0 ? 'text-faint' : lostCount * 2 > r.cells.length ? 'font-bold text-warn' : 'text-muted'}`}>
                        {lostCount}/{r.cells.length}
                      </td>
                    )}
                  </tr>
                </FragmentHeat>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-6 pt-2 pb-4 text-[0.8125rem] text-muted">
        {HEAT_CLASS.map((cls, k) => (
          <span key={k} className="inline-flex items-center gap-1.5 whitespace-nowrap"><span className={`size-3.5 rounded-[4px] ${cls}`} />{GRADE_NAMES[k]}</span>
        ))}
        {anyLost && <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><span className="relative size-3.5 overflow-hidden rounded-[4px] bg-sunken"><span className={LOST_MARK} /></span>상대보다 낮음</span>}
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><span className="size-1.5 rounded-full bg-warn" />수정 이력</span>
      </div>
    </Section>
  );
}

function FragmentHeat({ head, span, children }: { head: string | null; span: number; children: React.ReactNode }) {
  return (
    <>
      {head !== null && <tr><td colSpan={span} className="px-2 pt-3 pb-0.5 text-[0.8125rem] font-bold whitespace-nowrap">{head}</td></tr>}
      {children}
    </>
  );
}
