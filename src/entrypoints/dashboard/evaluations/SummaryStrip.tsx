import { useMemo } from 'react';
import { reversalDistance, totalRanks } from '../../../core/evaluation/analyze';
import { TONE_TEXT, type EvalCtx } from './ctx';
import { f2, rankLabel, reversalText, signed, toneOf } from './eval-view';
import { Label } from './Section';

const CELL = 'flex min-w-0 flex-col gap-1.5 px-6 py-4';

/** 화면 맨 위 결론 한 줄: 순위, 상대, 위원 평균 차, 역전 거리 판정 */
export function SummaryStrip({ ctx }: { ctx: EvalCtx }) {
  const { rec, duel, totals, opts } = ctx;
  const meanRanks = useMemo(() => totalRanks(rec, totals), [rec, totals]);
  const rev = useMemo(() => (duel ? reversalDistance(rec, duel, opts) : null), [rec, duel, opts]);
  if (!duel || !rev) return null;

  const official = duel.basis === 'official';
  const rankOf = (seq: number) => (official ? (seq === duel.lead ? duel.leadRank : duel.chaseRank) : (meanRanks.get(seq) ?? null));
  const meanOf = (seq: number) => totals.find((t) => t.seq === seq)?.mean ?? null;
  // 우리 순위가 없어 승부 쌍에 빠졌으면 전체 보기처럼 그린다
  const ours = ctx.isOurs && (ctx.ourSeq === duel.lead || ctx.ourSeq === duel.chase) ? ctx.ourSeq : null;
  // 우리 회사 기준이면 우리를 주인공으로, 아니면 1위를 주인공으로 둔다
  const me = ours ?? duel.lead;
  const other = me === duel.lead ? duel.chase : duel.lead;
  const a = meanOf(me);
  const b = meanOf(other);
  const diff = a !== null && b !== null ? a - b : null;
  const myRank = rankOf(me);
  const rt = reversalText(rev, rec.items.filter((i) => i.leaf).length);
  const live = rec.bidders.filter((x) => !x.excluded).length;
  const rankBasis = official ? '공식' : '위원 평균';

  return (
    <section className="grid overflow-hidden rounded-card border border-line bg-surface shadow-card max-lg:divide-y lg:grid-cols-4 lg:divide-x divide-line">
      <div className={CELL}>
        <Label>{ours !== null ? '우리 순위' : '1위'} <span className="font-normal">({rankBasis})</span></Label>
        <div className="flex items-baseline gap-2">
          {ours !== null ? (
            <span className={`text-3xl leading-none font-bold tabular-nums ${myRank === 1 ? 'text-primary' : 'text-ink'}`}>{rankLabel(myRank)}</span>
          ) : (
            <span className="truncate text-xl leading-tight font-bold">{ctx.nameOf(me)}</span>
          )}
          <span className="text-[0.8125rem] whitespace-nowrap text-muted">{live}개 업체</span>
        </div>
      </div>
      <div className={CELL}>
        <Label>{ours !== null ? (me === duel.lead ? '2위 상대' : '1위 상대') : '2위'}</Label>
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-xl leading-tight font-bold">{ctx.nameOf(other)}</span>
          <span className="text-[0.8125rem] whitespace-nowrap text-muted">{rankLabel(rankOf(other))}</span>
        </div>
      </div>
      <div className={CELL}>
        <Label>위원 평균 차 <span className="font-normal">({ours !== null ? '우리 − 상대' : '1위 − 2위'})</span></Label>
        <div className={`text-3xl leading-none font-bold tabular-nums ${TONE_TEXT[toneOf(diff)]}`}>
          {signed(diff)}<span className="ml-0.5 text-base font-semibold text-muted">점</span>
        </div>
        <div className="text-[0.8125rem] text-muted tabular-nums">{f2(a)} 대 {f2(b)}</div>
      </div>
      <div className={CELL}>
        <Label>역전 거리 <span className="font-normal">({ctx.nameOf(duel.chase)} 기준)</span></Label>
        <div>
          <span className={`inline-block rounded-full px-3 py-1 text-sm font-bold whitespace-nowrap ${rt.tone === 'info' ? 'bg-info-wash text-primary' : 'bg-warn-wash text-warn'}`}>{rt.verdict}</span>
        </div>
        <div className="text-[0.8125rem] text-muted">{rt.behindLine}</div>
      </div>
    </section>
  );
}
