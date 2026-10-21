import type { Cumulative } from '../../../core/evaluation/analyze';
import type { EvalIndexEntry } from '../../../core/types/evaluation';
import { signed, shortName } from './eval-view';
import { Label } from './Section';

const CELL = 'flex min-w-0 flex-col gap-1.5 px-6 py-4';
const BIG = 'text-3xl leading-none font-bold tabular-nums';
const NAME = 'truncate text-xl leading-tight font-bold';
const NOTE = 'truncate text-[0.8125rem] text-muted';

/** 평가분석 목록 위 누적 요약: 가져온 평가, 우리 성적, 자주 만난 경쟁사, 자주 약한 대항목 */
export function StatsStrip({ cum, list, hasCompany }: { cum: Cumulative; list: EvalIndexEntry[]; hasCompany: boolean }) {
  const finals = list.filter((e) => e.status === 'final').length;
  const joined = cum.timeline.filter((t) => t.ourRank !== null);
  const firsts = joined.filter((t) => t.ourRank === 1).length;
  const rival = cum.competitors[0] ?? null;
  const weak = cum.itemWeakness.find((w) => w.meanGapRatio !== null && w.meanGapRatio < 0) ?? null;
  const noCompany = <div className={NOTE}>설정에서 우리 회사 사업자번호를 입력하면 표시</div>;

  return (
    <section className="grid divide-line overflow-hidden rounded-card border border-line bg-surface shadow-card max-lg:divide-y lg:grid-cols-4 lg:divide-x">
      <div className={CELL}>
        <Label>가져온 평가</Label>
        <div className={BIG}>{list.length}<span className="ml-0.5 text-base font-semibold text-muted">건</span></div>
        <div className={NOTE}>확정 {finals}, 임시 {list.length - finals}</div>
      </div>
      <div className={CELL}>
        <Label>우리 성적 <span className="font-normal">(위원 평균 순위)</span></Label>
        {!hasCompany ? noCompany : (
          <>
            <div className={BIG}>
              {firsts}<span className="ml-0.5 text-base font-semibold text-muted">/ {joined.length}건 1위</span>
            </div>
            <div className={NOTE}>{joined.length === 0 ? '참여한 공고 없음' : `참여 ${joined.length}건 중 1위 비율 ${Math.round((firsts / joined.length) * 100)}%`}</div>
          </>
        )}
      </div>
      <div className={CELL}>
        <Label>자주 만난 경쟁사</Label>
        {!hasCompany ? noCompany : rival ? (
          <>
            <div className={NAME} title={rival.name}>{shortName(rival.name)}</div>
            <div className={NOTE}>{rival.met}회 만남, 우리 {rival.wins}승 {rival.losses}패{rival.ties > 0 ? ` ${rival.ties}무` : ''}</div>
          </>
        ) : <div className={NOTE}>아직 없음</div>}
      </div>
      <div className={CELL}>
        <Label>자주 뒤진 대항목</Label>
        {!hasCompany ? noCompany : weak ? (
          <>
            <div className={NAME} title={weak.name}>{weak.name}</div>
            <div className={NOTE}>배점 대비 평균 {signed((weak.meanGapRatio ?? 0) * 100, 1)}%, 세부항목 {weak.count}개 누적</div>
          </>
        ) : <div className={NOTE}>뒤진 대항목 없음</div>}
      </div>
    </section>
  );
}
