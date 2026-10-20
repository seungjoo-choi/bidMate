import { RotateCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { bidderTotals, pickDuel } from '../../../core/evaluation/analyze';
import { normalizeBizNo } from '../../../core/evaluation/company';
import { EVAL_COLLECT_UI_TIMEOUT_MS } from '../../../core/evaluation/limits';
import { evalErrorText } from '../../../core/evaluation/error-text';
import type { EvalRecord } from '../../../core/types/evaluation';
import { send } from '../../../messaging/bus';
import { Button, EmptyState, InlineAlert } from '../../../ui/components';
import { useSettings } from '../../../ui/hooks/useSettings';
import { FsErrorAlert } from '../FsErrorAlert';
import type { EvalCtx } from './ctx';
import { DuelSection } from './DuelSection';
import { dateOnly, parseView, VIEW_KEY } from './eval-view';
import { GapSection, HeatSection } from './GapHeatSection';
import { GradeSection, JudgeSection, OfficialSection } from './InsightSections';
import { Segmented } from './Section';
import { TotalsSection } from './TotalsSection';

const CHIP = 'rounded-full border border-line bg-surface px-2.5 py-0.5 whitespace-nowrap';

function readView(): 'ours' | 'all' | null {
  try { return parseView(localStorage.getItem(VIEW_KEY)); } catch { return null; }
}

export function EvaluationDetailPage({ noticeId }: { noticeId: string }) {
  const { settings } = useSettings();
  const [rec, setRec] = useState<EvalRecord | null | undefined>(undefined);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const [pickedView, setPickedView] = useState<'ours' | 'all' | null>(readView);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [refetchError, setRefetchError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRec(await send('eval/get', { noticeId }));
      setError(null);
    } catch (e) {
      setError({ code: (e as { code?: string }).code, message: e instanceof Error ? e.message : String(e) });
    }
  }, [noticeId]);
  useEffect(() => { void load(); }, [load]);

  const companyBiz = normalizeBizNo(settings?.company.bizNo ?? '');
  const hasCompany = companyBiz.length === 10;
  const participates = !!rec && hasCompany && rec.bidders.some((b) => b.bizNo === companyBiz);
  const wanted = pickedView ?? (hasCompany ? 'ours' : 'all');
  const isOurs = wanted === 'ours' && participates;

  const ctx = useMemo<EvalCtx | null>(() => {
    if (!rec) return null;
    const ourBizNo = isOurs ? companyBiz : null;
    const ourSeq = ourBizNo ? (rec.bidders.find((b) => b.bizNo === ourBizNo)?.seq ?? null) : null;
    const opts = { excludeJudges: excluded };
    const duel = pickDuel(rec, ourBizNo, opts);
    const rival = duel && ourSeq !== null ? (duel.lead === ourSeq ? duel.chase : duel.lead) : null;
    return {
      rec, isOurs: isOurs && ourSeq !== null, ourBizNo, ourSeq, excluded, opts, totals: bidderTotals(rec, opts), duel, rival,
      nameOf: (seq) => rec.bidders.find((b) => b.seq === seq)?.name ?? `업체 ${seq}`,
    };
  }, [rec, isOurs, companyBiz, excluded]);

  const setView = (v: 'ours' | 'all') => {
    setPickedView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* 저장 못 해도 이번 화면에서는 적용 */ }
  };
  const toggle = (index: number) => setExcluded((prev) => {
    const next = new Set(prev);
    if (!next.delete(index)) next.add(index);
    return next;
  });
  const refetch = async () => {
    if (!rec) return;
    setBusy(true);
    setRefetchError(null);
    try {
      await send('eval/collect', { ref: { noticeNo: rec.noticeNo, round: rec.round } }, { timeoutMs: EVAL_COLLECT_UI_TIMEOUT_MS });
      await load();
    } catch (e) {
      setRefetchError(evalErrorText((e as { code?: string }).code, e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  if (error) return <FsErrorAlert error={error} onRetry={load} />;
  if (rec === undefined || !settings) return <div className="py-16 text-center text-sm text-muted">불러오는 중</div>;
  if (rec === null || !ctx) {
    return (
      <div className="space-y-6">
        <a href="#/evaluations" className="text-sm text-primary hover:underline">평가분석</a>
        <EmptyState title="저장된 평가 데이터 없음" hint="나라장터 공고 화면에서 [평가점수 가져오기]" />
      </div>
    );
  }

  const leafCount = rec.items.filter((i) => i.leaf).length;
  const viewNote = !hasCompany ? '설정에서 우리 회사 사업자번호를 입력하면 우리 회사 기준 보기 가능' : !participates ? '우리 회사 미참여 공고, 전체 업체 기준만 가능' : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 pb-1">
        <div className="flex min-w-0 flex-1 basis-[560px] flex-col gap-2">
          <div className="text-[0.8125rem] text-muted"><a href="#/evaluations" className="text-primary hover:underline">평가분석</a><span className="mx-1.5 text-faint">/</span><span className="font-mono">{rec.noticeId}</span></div>
          <h1 className="text-[1.625rem] leading-tight font-bold tracking-tight">{rec.title}</h1>
          <div className="flex flex-wrap gap-1.5 text-[0.8125rem] text-muted">
            {rec.orgName && <span className={CHIP}>{rec.orgName}</span>}
            {dateOnly(rec.evaluatedAt) && <span className={CHIP}>평가 종료 {dateOnly(rec.evaluatedAt)}</span>}
            {rec.techWeight !== null && <span className={CHIP}>기술배점 {rec.techWeight}</span>}
            {rec.techMethodName && <span className={CHIP}>{rec.techMethodName}</span>}
            <span className={CHIP}>업체 {rec.bidders.length}, 위원 {rec.judges.length}, 세부항목 {leafCount}</span>
            <span className={`rounded-full border px-2.5 py-0.5 font-semibold ${rec.status === 'final' ? 'border-ok/30 bg-ok-wash text-ok' : 'border-warn/30 bg-warn-wash text-warn'}`}>{rec.status === 'final' ? '확정' : '임시'}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="보기 기준" value={ctx.isOurs ? 'ours' : 'all'} onChange={setView}
            options={[{ id: 'ours', label: '우리 회사 기준', disabled: !participates }, { id: 'all', label: '전체 업체' }]}
          />
          <Button variant="secondary" loading={busy} icon={<RotateCw />} onClick={() => void refetch()}>다시 가져오기</Button>
        </div>
      </div>
      {viewNote && <div className="text-[0.8125rem] text-muted">{viewNote}</div>}
      {refetchError && <InlineAlert tone="error">{refetchError}</InlineAlert>}
      {rec.warnings.length > 0 && <InlineAlert tone="warn">{rec.warnings.join(' / ')}</InlineAlert>}

      <DuelSection ctx={ctx} />
      <TotalsSection ctx={ctx} onToggle={toggle} onClear={() => setExcluded(new Set())} />
      <div className="grid items-start gap-5 2xl:grid-cols-2">
        <GapSection ctx={ctx} />
        <HeatSection ctx={ctx} />
      </div>
      <GradeSection ctx={ctx} />
      <JudgeSection ctx={ctx} />
      <OfficialSection ctx={ctx} />
    </div>
  );
}
