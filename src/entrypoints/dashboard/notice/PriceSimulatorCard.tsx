import { useEffect, useMemo, useState } from 'react';
import { defaultBaseOf, formulaVerification, priceEvalRateOf, simulate } from '../../../core/pricing/simulate';
import type { Notice } from '../../../core/types/notice';
import { send } from '../../../messaging/bus';
import { Card, Field, inputClass, InlineAlert, StatusBadge } from '../../../ui/components';
import {
  baseSourceLabel, collapsedRows, diffTone, formatDiff, formatRate, formatScore, parseNum,
  rivalSourceLabel, verificationText, WEIGHT_MISSING_WARNING, weightSourceLabel,
} from '../../../ui/notice-detail/price-sim-view';
import { formatWon } from '../../../ui/notices/result-view';

const DEFAULT_RIVAL_RATE = 88;
const toneClass = { primary: 'text-primary', warn: 'text-warn', none: '' } as const;

export function PriceSimulatorCard({ notice }: { notice: Notice }) {
  const weightDefault = useMemo(() => priceEvalRateOf(notice), [notice]);
  const baseDefault = useMemo(() => defaultBaseOf(notice), [notice]);
  // null이면 기본값을 그대로 쓴다(편집 여부 판별). 입력값은 저장하지 않는다
  const [weightIn, setWeightIn] = useState<string | null>(null);
  const [baseIn, setBaseIn] = useState<string | null>(null);
  const [rivalIn, setRivalIn] = useState<string | null>(null);
  const [limitIn, setLimitIn] = useState('');
  const [ourIn, setOurIn] = useState('');
  const [gapIn, setGapIn] = useState('');
  const [expanded, setExpanded] = useState(false);
  // 검증 비율: undefined=불러오는 중, null=확인 불가
  const [verify, setVerify] = useState<{ ok: number; total: number } | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    send('eval/get-many', {}).then(
      (recs) => { if (alive) setVerify(formulaVerification(recs)); },
      () => { if (alive) setVerify(null); },
    );
    return () => { alive = false; };
  }, []);

  const weightText = weightIn ?? (weightDefault ? String(weightDefault.value) : '');
  const baseText = baseIn ?? (baseDefault !== null ? String(baseDefault) : '');
  const rivalText = rivalIn ?? String(DEFAULT_RIVAL_RATE);

  const weight = parseNum(weightText);
  const base = parseNum(baseText);
  const rival = parseNum(rivalText);
  const limit = parseNum(limitIn);
  const our = parseNum(ourIn);
  const gap = parseNum(gapIn);

  const ready = weight !== undefined && base !== undefined && rival !== undefined;
  const sim = useMemo(
    () => (ready ? simulate({ priceWeight: weight, base, rivalRate: rival, lowerLimitRate: limit, ourRate: our, techGap: gap }) : null),
    [ready, weight, base, rival, limit, our, gap],
  );

  const inputWarnings: string[] = [];
  if (weight === undefined) inputWarnings.push(WEIGHT_MISSING_WARNING);
  if (base === undefined) inputWarnings.push('분모 금액을 입력하세요');
  if (rival === undefined) inputWarnings.push('경쟁 최저 투찰률을 입력하세요');
  const warnings = [...inputWarnings, ...(sim?.warnings ?? [])];

  const rows = sim?.rows ?? [];
  const shown = expanded ? rows : collapsedRows(rows);
  const baseSource = baseSourceLabel(baseDefault !== null, baseIn !== null);
  const be = sim?.breakEven;

  const rateInput = (id: string, value: string, set: (v: string) => void, placeholder?: string) => (
    <input id={id} className={`${inputClass} font-mono tabular-nums`} inputMode="decimal" value={value} placeholder={placeholder} onChange={(e) => set(e.target.value)} />
  );

  return (
    <Card title="투찰가 시뮬레이터" description="가격점수 공식(최저가 비례)에 따라 투찰률별 가격점수 차이를 계산합니다. 저장하지 않습니다.">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="가격 배점(점)" htmlFor="sim-weight" help={weightSourceLabel(weightDefault?.source ?? null, weightIn !== null)}>
          {rateInput('sim-weight', weightText, setWeightIn)}
        </Field>
        <Field label="분모 금액(원)" htmlFor="sim-base" help={baseSource}>
          {rateInput('sim-base', baseText, setBaseIn)}
        </Field>
        <Field label="경쟁 최저 투찰률(%)" htmlFor="sim-rival" help={rivalSourceLabel(rivalIn !== null)}>
          {rateInput('sim-rival', rivalText, setRivalIn)}
        </Field>
        <Field label="낙찰하한율(%, 선택)" htmlFor="sim-limit">
          {rateInput('sim-limit', limitIn, setLimitIn)}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="우리 투찰률(%, 선택)" htmlFor="sim-our">
          {rateInput('sim-our', ourIn, setOurIn)}
        </Field>
        <Field label="기술점수 격차(우리 − 경쟁, 선택)" htmlFor="sim-gap">
          {rateInput('sim-gap', gapIn, setGapIn)}
        </Field>
      </div>

      {warnings.length > 0 && (
        <InlineAlert tone="warn">
          <ul className="space-y-0.5">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </InlineAlert>
      )}

      {sim && be && gap !== undefined && (
        <div className="space-y-1 border-t border-line pt-4 text-sm">
          {be.impossible && <p className="text-warn">가격으로 만회할 수 없는 격차입니다(가격 배점 {weight}점)</p>}
          {be.note && <p className="text-ink">{be.note}</p>}
          {be.rate !== null && be.amount !== null && (
            <p className="text-ink">
              {gap >= 0
                ? <>격차 +{formatScore(gap)}점이면 투찰률 <b className="font-mono tabular-nums">{formatRate(be.rate)}</b> ({formatWon(be.amount)})까지 올려도 동점</>
                : <>격차 −{formatScore(Math.abs(gap))}점을 만회하려면 투찰률 <b className="font-mono tabular-nums">{formatRate(be.rate)}</b> ({formatWon(be.amount)}) 이하</>}
            </p>
          )}
          {be.excluded && <p className="text-warn">낙찰하한율 미만입니다</p>}
        </div>
      )}

      {sim?.custom && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-line pt-4 text-sm">
          <span className="text-muted">우리 투찰률 <b className="font-mono font-semibold text-ink tabular-nums">{formatRate(sim.custom.rate)}</b> ({formatWon(sim.custom.amount)})</span>
          <span className="text-muted">우리 <b className="font-mono tabular-nums text-ink">{formatScore(sim.custom.ourScore)}</b></span>
          <span className="text-muted">경쟁 <b className="font-mono tabular-nums text-ink">{formatScore(sim.custom.rivalScore)}</b></span>
          <span className={`font-mono font-semibold tabular-nums ${toneClass[diffTone(sim.custom.diff)]}`}>{formatDiff(sim.custom.diff)}</span>
          {sim.custom.excluded && <StatusBadge status="warn">하한 미만</StatusBadge>}
        </div>
      )}

      {rows.length > 0 && (
        <div className="space-y-2 border-t border-line pt-4">
          <table className="w-full table-fixed text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th className="py-1 font-medium">투찰률</th>
                <th className="py-1 font-medium">투찰가</th>
                <th className="py-1 text-right font-medium">우리 가격점수</th>
                <th className="py-1 text-right font-medium">경쟁 가격점수</th>
                <th className="py-1 text-right font-medium">차이</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.rate} className={`border-t border-line ${r.excluded ? 'text-faint' : ''} ${r.isRival ? 'font-semibold' : ''}`}>
                  <td className="py-1 pr-2 font-mono tabular-nums">
                    {formatRate(r.rate)}
                    {r.isRival && <span className="ml-2 rounded-full border border-line px-2 py-0.5 font-sans text-xs font-medium text-muted">경쟁 최저</span>}
                    {r.excluded && <span className="ml-2 font-sans text-xs font-normal">하한 미만</span>}
                  </td>
                  <td className="py-1 pr-2 font-mono tabular-nums">{formatWon(r.amount)}</td>
                  <td className="py-1 text-right font-mono tabular-nums">{formatScore(r.ourScore)}</td>
                  <td className="py-1 text-right font-mono tabular-nums">{formatScore(r.rivalScore)}</td>
                  <td className={`py-1 text-right font-mono tabular-nums ${r.excluded ? '' : toneClass[diffTone(r.diff)]}`}>{formatDiff(r.diff)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            className="text-sm font-medium text-primary hover:underline"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? '표 접기' : '표 펼치기'}
          </button>
        </div>
      )}

      <div className="space-y-1 rounded-md bg-sunken px-4 py-3 text-sm text-muted">
        <p className="font-medium text-ink">가정</p>
        <ol className="list-inside list-decimal space-y-0.5">
          <li>가격점수 = 배점 × 최저투찰가 ÷ 투찰가, 최저가 이하는 만점</li>
          <li>경쟁사는 최저 투찰률에 투찰한다고 가정</li>
          <li>분모는 {baseSource || '직접 입력한 금액'}</li>
          <li>{verify === undefined ? '공식 검증 중' : verificationText(verify)}</li>
          {sim && <li>투찰가 1% = {sim.pricePerCut}점</li>}
        </ol>
      </div>
    </Card>
  );
}
