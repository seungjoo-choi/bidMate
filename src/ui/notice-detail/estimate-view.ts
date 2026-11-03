import type { EstimateRow, EstimateSummary, MaxState } from '../../core/estimate/estimate';
import type { BadgeStatus } from '../components/StatusBadge';

const num = (n: number) => String(Math.round(n * 100) / 100);

/** 배점 열 표시 */
export function maxText(row: Pick<EstimateRow, 'max' | 'maxState'>): string {
  const labels: Record<MaxState, string> = { known: '', review: '', not_applicable: '해당 없음', missing: '—' };
  if (row.max === null || row.maxState === 'not_applicable') return labels[row.maxState];
  return row.maxState === 'review' ? `${num(row.max)}점 (확인 필요)` : `${num(row.max)}점`;
}

/** 카드 머리 배지: 합계, 배점 미확정이면 경고 */
export function totalBadge(s: Pick<EstimateSummary, 'total' | 'maxTotal' | 'allKnown'>): { status: BadgeStatus; text: string }[] {
  const out: { status: BadgeStatus; text: string }[] = [];
  if (s.total === null) out.push({ status: 'idle', text: '미입력' });
  else out.push({ status: 'ok', text: s.maxTotal === null ? `총 ${num(s.total)}점` : `총 ${num(s.total)} / ${num(s.maxTotal)}점` });
  if (!s.allKnown) out.push({ status: 'warn', text: '배점 확인 필요' });
  return out;
}

/** 점수 입력 문자열 해석: 빈 문자열은 null(삭제), 숫자가 아니면 undefined */
export function parseScoreInput(s: string): number | null | undefined {
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

export function scoreInputText(score: number | null): string {
  return score === null ? '' : num(score);
}

export function overMaxText(max: number | null): string {
  return max === null ? '' : `배점 ${num(max)}점을 넘습니다`;
}
