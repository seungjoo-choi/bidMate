import { useMemo } from 'react';
import { gradeDistribution, judgeProfiles, leaveOneOut, officialCompare } from '../../../core/evaluation/analyze';
import { InlineAlert } from '../../../ui/components';
import { TONE_TEXT, type EvalCtx } from './ctx';
import { DASH, f1, f2, formatAmount, GRADE_NAMES, GRADE_SEG_CLASS, gradeShare, judgeLabel, looText, rankLabel, signed, toneOf } from './eval-view';
import { HEAD_ROW, OURS_ROW, ROW, Section, TD, TH } from './Section';

/** 비교 대상: 우리 회사 기준이면 우리와 상대, 전체 보기면 제외되지 않은 모든 업체 */
function shown(ctx: EvalCtx): number[] {
  if (ctx.isOurs && ctx.ourSeq !== null && ctx.rival !== null) return [ctx.ourSeq, ctx.rival];
  return ctx.rec.bidders.filter((b) => !b.excluded).map((b) => b.seq);
}

export function GradeSection({ ctx }: { ctx: EvalCtx }) {
  const seqs = shown(ctx);
  const dists = useMemo(() => seqs.map((s) => gradeDistribution(ctx.rec, s, ctx.opts)), [ctx.rec, ctx.opts, seqs.join(',')]);
  const groups = dists[0] ?? [];
  return (
    <Section
      title="대항목별 등급 분포"
      sub="위원 × 세부항목 칸의 등급 비율, 오른쪽 숫자는 만점 비율"
      action={
        <div className="flex flex-wrap gap-3 text-[13px] text-muted">
          {GRADE_NAMES.map((n, k) => <span key={n} className="inline-flex items-center gap-1.5 whitespace-nowrap"><span className={`size-3 rounded-[3px] ${GRADE_SEG_CLASS[k]}`} />{n}</span>)}
        </div>
      }
    >
      <div className="grid grid-cols-[repeat(auto-fit,minmax(360px,1fr))] gap-x-10 gap-y-5 px-6 pt-1 pb-5">
        {groups.map((g, gi) => (
          <div key={g.group} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <b className="whitespace-nowrap">{g.group}</b>
              <span className="text-[13px] whitespace-nowrap text-muted">배점 {g.maxScore}</span>
            </div>
            {seqs.map((s, si) => {
              const share = gradeShare(dists[si]?.[gi]?.counts ?? [0, 0, 0, 0]);
              const mine = ctx.isOurs && s === ctx.ourSeq;
              return (
                <div key={s} className="grid grid-cols-[120px_1fr_44px] items-center gap-3 text-[13px] tabular-nums">
                  <span className={`truncate ${mine ? 'font-bold text-primary' : 'text-muted'}`}>{ctx.nameOf(s)}</span>
                  <div className="flex h-2.5 gap-px overflow-hidden rounded-full bg-sunken">
                    {share.pct.map((p, k) => p > 0 && <div key={k} className={`h-full ${GRADE_SEG_CLASS[k]}`} style={{ width: `${p}%` }} title={`${GRADE_NAMES[k]} ${dists[si]?.[gi]?.counts[k] ?? 0}칸`} />)}
                  </div>
                  <span className={`text-right font-semibold ${mine ? 'text-primary' : ''}`}>{share.full}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </Section>
  );
}

export function JudgeSection({ ctx }: { ctx: EvalCtx }) {
  const { rec, opts, excluded } = ctx;
  const profiles = useMemo(() => judgeProfiles(rec, ctx.ourBizNo, opts, ctx.duel), [rec, ctx.ourBizNo, opts, ctx.duel]);
  const loo = useMemo(() => leaveOneOut(rec, ctx.ourBizNo, opts), [rec, ctx.ourBizNo, opts]);
  const pair = ctx.isOurs && ctx.ourSeq !== null && ctx.rival !== null ? ([ctx.ourSeq, ctx.rival] as const) : null;
  const seqs = shown(ctx);
  const totalOf = (seq: number, ji: number): number | null => ctx.totals.find((t) => t.seq === seq)?.byJudge[ji] ?? null;
  return (
    <Section title="평가위원별 성향" sub="후한 정도는 업체 평균 대비 가감, 변별폭은 업체 간 최대 차이">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm tabular-nums">
          <thead>
            <tr className={HEAD_ROW}>
              <th scope="col" className={`${TH} pl-6 text-left`}>위원</th>
              {pair ? ['우리 합계', `${ctx.nameOf(pair[1])} 합계`, '격차'].map((h) => <th scope="col" key={h} className={`${TH} text-right`}>{h}</th>)
                : seqs.map((s) => <th scope="col" key={s} className={`${TH} text-right`}>{ctx.nameOf(s)} 합계</th>)}
              <th scope="col" className={`${TH} text-right`}>후한 정도</th>
              <th scope="col" className={`${TH} text-right`}>변별폭</th>
              <th scope="col" className={`${TH} text-left`}>이 위원의 1위</th>
              <th scope="col" className={`${TH} pr-6 text-left`}>빼면</th>
            </tr>
          </thead>
          <tbody>
            {rec.judges.map((j, ji) => {
              const p = profiles[ji]!;
              const off = excluded.has(j.index) || j.excluded;
              const gap = p.duelGap;
              const l = looText({ excluded: off, ours: pair !== null, firstChanged: loo[ji]!.firstChanged, rankDelta: loo[ji]!.ourRankDelta });
              return (
                <tr key={j.index} className={`${ROW} ${off ? 'text-faint' : ''}`}>
                  <th scope="row" className={`${TD} pl-6 text-left font-semibold`}>{judgeLabel(j.index)}{off ? ' (제외)' : ''}</th>
                  {pair ? (
                    <>
                      <td className={`${TD} text-right`}>{f1(totalOf(pair[0], ji))}</td>
                      <td className={`${TD} text-right text-muted`}>{f1(totalOf(pair[1], ji))}</td>
                      <td className={`${TD} text-right font-bold ${TONE_TEXT[toneOf(gap)]}`}>{signed(gap, 1)}</td>
                    </>
                  ) : seqs.map((s) => <td key={s} className={`${TD} text-right`}>{f1(totalOf(s, ji))}</td>)}
                  <td className={`${TD} text-right ${p.bias === null ? 'text-muted' : p.bias >= 1.5 ? 'text-primary' : p.bias <= -1.5 ? 'text-warn' : ''}`}>{signed(p.bias)}</td>
                  <td className={`${TD} text-right`}>
                    <span className="inline-flex items-center justify-end gap-2">
                      <span className="inline-block h-1.5 rounded-full bg-primary/45" style={{ width: `${p.spread === null ? 0 : Math.min(p.spread / 12, 1) * 56}px` }} />
                      {f1(p.spread)}
                    </span>
                  </td>
                  <td className={TD}>{off || (p.topSeq === null && p.spread === null) ? DASH : p.topSeq === null ? '동점' : ctx.nameOf(p.topSeq)}</td>
                  <td className={`${TD} pr-6 ${l.strong ? 'font-bold text-primary' : 'text-muted'}`}>{l.text}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

export function OfficialSection({ ctx }: { ctx: EvalCtx }) {
  const { rec } = ctx;
  const rows = useMemo(() => officialCompare(rec).filter((r) => r.matched).sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)), [rec]);
  return (
    <Section title="공식 개찰 결과" sub="낙찰정보 API. 기술 원점수와 위원 평균의 차이는 정량 항목 때문일 수 있음(미확인)">
      {rows.length === 0 ? (
        <div className="px-6 pb-5"><InlineAlert tone="info">공식 개찰 결과 없음. 서비스키 확인 후 [다시 가져오기]</InlineAlert></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm tabular-nums">
            <thead>
              <tr className={HEAD_ROW}>
                <th scope="col" className={`${TH} pl-6 text-left`}>순위</th>
                <th scope="col" className={`${TH} text-left`}>업체</th>
                {['투찰금액', '위원 평균', '기술 원점수', '기술점수', '가격점수'].map((h) => <th scope="col" key={h} className={`${TH} text-right`}>{h}</th>)}
                <th scope="col" className={`${TH} pr-6 text-right`}>종합점수</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const mine = ctx.isOurs && r.seq === ctx.ourSeq;
                const amount = rec.official?.rows.find((o) => o.bizNo === r.bizNo)?.bidAmount ?? null;
                return (
                  <tr key={r.seq} className={`${ROW} ${mine ? OURS_ROW : ''}`}>
                    <td className={`${TD} pl-6`}>
                      <span className={`inline-flex min-w-10 justify-center rounded-full px-2 py-0.5 text-[13px] font-bold ${r.rank === 1 ? 'bg-primary text-primary-ink' : 'bg-sunken text-ink'}`}>{rankLabel(r.rank)}</span>
                    </td>
                    <th scope="row" className={`${TD} text-left font-semibold`}>{r.name}</th>
                    <td className={`${TD} text-right`}>{formatAmount(amount)}</td>
                    <td className={`${TD} text-right`}>{f2(r.judgeMean)}</td>
                    <td className={`${TD} text-right`}>{r.techRaw ?? DASH}</td>
                    <td className={`${TD} text-right`}>{r.techScore ?? DASH}</td>
                    <td className={`${TD} text-right`}>{r.priceScore ?? DASH}</td>
                    <td className={`${TD} pr-6 text-right text-base font-bold`}>{r.totalScore ?? DASH}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
