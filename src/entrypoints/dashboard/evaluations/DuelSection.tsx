import { useMemo } from 'react';
import { decompose, exchangeRatio, priceWeightOf, reversalDistance, verifyPriceFormula, verifyTechAdjust } from '../../../core/evaluation/analyze';
import { TONE_TEXT, type EvalCtx } from './ctx';
import {
  barOf, chaserSigned, duelTitle, exchangeLines, FORMULA_MISMATCH, gradeStepLabel, basisNotes, JUDGE_BASIS_NOTE, NO_OFFICIAL, PARTIAL_OFFICIAL, partNote, priceBox, reversalText, toneOf,
} from './eval-view';
import { CenterBar, Label, Section } from './Section';

const COL = 'flex min-w-0 flex-col gap-3 px-6 py-5';

export function DuelSection({ ctx }: { ctx: EvalCtx }) {
  const { rec, duel, opts } = ctx;
  const judgesBasis = duel?.basis === 'judges';
  // 공식 순위가 없어 위원 평균으로 고른 쌍에는 공식 점수 분해를 붙이지 않는다
  const dec = useMemo(() => (duel && duel.basis === 'official' ? decompose(rec, duel) : null), [rec, duel]);
  const gapSumAll = useMemo(() => (duel ? reversalDistance(rec, duel).gapSum : 0), [rec, duel]);
  const rev = useMemo(() => (duel ? reversalDistance(rec, duel, opts) : null), [rec, duel, opts]);
  const check = useMemo(() => {
    const p = verifyPriceFormula(rec);
    return p.ok ? verifyTechAdjust(rec) : p;
  }, [rec]);
  if (!duel || !rev) {
    return <Section title="승부 분해"><div className="px-6 pb-6 text-sm text-muted">비교할 업체가 2곳 이상 필요</div></Section>;
  }

  const lead = ctx.nameOf(duel.lead);
  const chase = ctx.nameOf(duel.chase);
  const relation = ctx.isOurs && ctx.ourSeq !== null ? (duel.lead === ctx.ourSeq ? 'won' : duel.chase === ctx.ourSeq ? 'lost' : 'none') : 'none';
  const chaserIsOurs = ctx.isOurs && duel.chase === ctx.ourSeq;
  const pw = priceWeightOf(rec);
  const verified = dec !== null && check.ok && dec.priceFormulaOk && dec.techAdjustOk;
  const ex = verified && pw !== null ? exchangeRatio(pw, rev.maxItemScore, rev.validJudges) : null;
  const lines = ex ? exchangeLines(ex) : null;
  const rt = reversalText(rev, rec.items.filter((i) => i.leaf).length, dec !== null);
  const notes = basisNotes({ excludedCount: ctx.excluded.size, dec, gapSumAll });

  const part = (label: string, diff: number) => {
    const v = diff === 0 ? 0 : -diff;
    const b = barOf(v, 8);
    return (
      <div key={label} className="grid grid-cols-[40px_1fr_64px] items-center gap-3 text-sm tabular-nums">
        <span className="text-muted">{label}</span>
        <CenterBar side={b.side} widthPct={b.widthPct} h="h-2.5" />
        <span className={`text-right font-bold ${TONE_TEXT[toneOf(v)]}`}>{chaserSigned(diff)}</span>
      </div>
    );
  };

  const placeholder = (text: string) => (
    <div className={`${COL} lg:col-span-2`}><Label>공식 결과 기준</Label><div className="text-sm text-muted">{text}</div></div>
  );

  return (
    <Section title="승부 분해" sub={duelTitle(lead, chase, relation, duel.leadRank, duel.chaseRank)}>
      {notes.length > 0 && (
        <div className="mx-6 mb-1 flex flex-col gap-0.5 rounded-ctl bg-sunken px-3.5 py-2 text-[13px] text-muted">
          {notes.map((n) => <div key={n}>{n}</div>)}
        </div>
      )}
      <div className="grid divide-line max-lg:divide-y lg:grid-cols-3 lg:divide-x">
        {judgesBasis ? placeholder(rec.official ? JUDGE_BASIS_NOTE : NO_OFFICIAL) : dec ? (
          <div className={COL}>
            <Label>종합점수 차이 <span className="font-normal">(공식, 전체 위원)</span></Label>
            <div className={`text-4xl leading-none font-bold tracking-tight tabular-nums ${chaserIsOurs ? 'text-warn' : 'text-ink'}`}>
              {chaserSigned(dec.totalDiff)}<span className="ml-0.5 text-lg font-semibold text-muted">점</span>
            </div>
            <div className="mt-1 flex flex-col gap-2">{part('기술', dec.techDiff)}{part('가격', dec.priceDiff)}</div>
            <div className="text-[13px] text-muted">{partNote(chase, dec)}</div>
          </div>
        ) : placeholder(rec.official ? PARTIAL_OFFICIAL : NO_OFFICIAL)}
        {dec && (
          <div className={COL}>
            <Label>기술과 가격의 교환비 <span className="font-normal">(공식, 전체 위원)</span></Label>
            {verified && lines ? (
              <>
                <dl className="flex flex-col gap-2 text-sm">
                  <div className="flex items-baseline justify-between gap-3"><dt className="whitespace-nowrap">투찰가 1% 인하</dt><dd className="font-bold whitespace-nowrap tabular-nums">{lines.cut}</dd></div>
                  {lines.grade && lines.equal && rev.maxItemScore !== null ? (
                    <>
                      <div className="flex items-baseline justify-between gap-3"><dt className="whitespace-nowrap">{gradeStepLabel(rev.maxItemScore)}</dt><dd className="font-bold whitespace-nowrap tabular-nums">{lines.grade}</dd></div>
                      <div className="flex items-baseline justify-between gap-3 text-[13px] text-muted"><dt className="whitespace-nowrap">기술 1등급</dt><dd className="whitespace-nowrap tabular-nums">{lines.equal}</dd></div>
                    </>
                  ) : (
                    <div className="text-[13px] text-muted">등급 방식이 아니라 기술 항목 환산 생략</div>
                  )}
                </dl>
                {(() => {
                  const box = priceBox(dec, chase);
                  return (
                    <div className={`flex flex-col gap-0.5 rounded-ctl px-3.5 py-3 text-[13px] ${box.tone === 'warn' ? 'bg-warn-wash' : 'bg-info-wash'}`}>
                      <div className={`text-sm font-bold ${box.tone === 'warn' ? 'text-warn' : 'text-primary'}`}>{box.head}</div>
                      <div>{box.body}</div>
                    </div>
                  );
                })()}
              </>
            ) : (
              <div className="rounded-ctl bg-sunken px-3.5 py-3 text-[13px]">
                <div>{FORMULA_MISMATCH}</div>
                {check.reason && <div className="mt-0.5 text-muted">{check.reason}</div>}
              </div>
            )}
          </div>
        )}
        <div className={COL}>
          <Label>역전 거리 <span className="font-normal">({chase} 기준, 선택한 위원 점수)</span></Label>
          <div>
            <span className={`inline-block rounded-full px-3 py-1 text-sm font-bold whitespace-nowrap ${rt.tone === 'info' ? 'bg-info-wash text-primary' : 'bg-warn-wash text-warn'}`}>{rt.verdict}</span>
          </div>
          <ul className="flex flex-col gap-1.5 text-sm">
            <li>{rt.behindLine}</li>
            <li>{rt.top3Line}</li>
            {rt.stepsLine && <li>{rt.stepsLine}</li>}
          </ul>
          {rt.advice && <div className="text-[13px] text-muted">{rt.advice}</div>}
        </div>
      </div>
    </Section>
  );
}
