import { columnMax, totalRanks } from '../../../core/evaluation/analyze';
import { Button } from '../../../ui/components';
import type { EvalCtx } from './ctx';
import { excludedNote, f1, f2, judgeLabel, rankLabel } from './eval-view';
import { HEAD_ROW, OURS_ROW, ROW, Section, TD, TH } from './Section';

export function TotalsSection({ ctx, onToggle, onClear }: { ctx: EvalCtx; onToggle: (index: number) => void; onClear: () => void }) {
  const { rec, totals, excluded } = ctx;
  const ranks = totalRanks(rec, totals);
  const colTop = columnMax(rec, totals);
  return (
    <Section title="업체 × 평가위원 합계" sub="위원 머리를 누르면 제외하고 재계산">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm tabular-nums">
          <thead>
            <tr className={HEAD_ROW}>
              <th scope="col" className={`${TH} pl-6 text-left`}>업체</th>
              {rec.judges.map((j) => (
                <th scope="col" key={j.index} className="px-0.5 py-1">
                  <button
                    type="button" aria-pressed={excluded.has(j.index) || j.excluded} disabled={j.excluded} onClick={() => onToggle(j.index)}
                    title={j.excluded ? '시스템 제외 위원' : '눌러서 제외/포함'}
                    className={`min-h-9 w-full min-w-16 rounded-ctl px-1.5 text-[13px] font-semibold whitespace-nowrap transition-colors hover:bg-select disabled:pointer-events-none motion-reduce:transition-none ${excluded.has(j.index) || j.excluded ? 'text-faint line-through' : 'text-muted'}`}
                  >
                    {judgeLabel(j.index)}{j.excluded ? ' (제외)' : ''}
                  </button>
                </th>
              ))}
              {['평균', '최고최저 제외', '편차'].map((h) => <th scope="col" key={h} className={`${TH} text-right`}>{h}</th>)}
              <th scope="col" className={`${TH} pr-6 text-right`}>순위</th>
            </tr>
          </thead>
          <tbody>
            {rec.bidders.map((b) => {
              const t = totals.find((x) => x.seq === b.seq)!;
              const mine = ctx.isOurs && b.seq === ctx.ourSeq;
              const rank = ranks.get(b.seq) ?? null;
              return (
                <tr key={b.seq} className={`${ROW} ${mine ? OURS_ROW : ''}`}>
                  <th scope="row" className={`${TD} pl-6 text-left font-normal`}>
                    <span className="font-semibold">{b.name}</span>
                    {mine && <span className="ml-2 rounded-full bg-primary px-2 py-px text-[11px] font-semibold text-primary-ink">우리</span>}
                    {b.excluded && <span className="ml-2 rounded-full bg-sunken px-2 py-px text-[11px] font-semibold text-muted">제외</span>}
                  </th>
                  {t.byJudge.map((v, ji) => {
                    const j = rec.judges[ji]!;
                    const off = excluded.has(j.index) || j.excluded;
                    return (
                      <td key={j.index} className={`${TD} px-1 text-center ${off ? 'text-faint line-through' : v !== null && v === colTop[ji] ? 'font-bold' : 'text-ink/80'}`}>{f1(v)}</td>
                    );
                  })}
                  <td className={`${TD} text-right text-base font-bold`}>{f2(t.mean)}</td>
                  <td className={`${TD} text-right`}>{f2(t.trimmedMean)}</td>
                  <td className={`${TD} text-right text-muted`}>{f2(t.sd)}</td>
                  <td className={`${TD} pr-6 text-right`}>
                    <span className={`inline-flex min-w-10 justify-center rounded-full px-2 py-0.5 text-[13px] font-bold ${rank === 1 ? 'bg-primary text-primary-ink' : 'bg-sunken text-ink'}`}>{rankLabel(rank)}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {excluded.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-info-wash px-6 py-2.5 text-[13px]">
          <span>{excludedNote([...excluded])}</span>
          <Button variant="secondary" className="!h-8 !px-2.5" onClick={onClear}>모두 포함</Button>
        </div>
      )}
    </Section>
  );
}
