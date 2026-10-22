import type { SimRow } from '../../core/pricing/simulate';

/** 점수는 소수 2자리 */
export const formatScore = (n: number): string => n.toFixed(2);

/** 차이: 양수 +, 음수 −(유니코드 마이너스), 0은 부호 없이 0.00 */
export function formatDiff(n: number): string {
  const s = Math.abs(n).toFixed(2);
  if (Number(s) === 0) return '0.00';
  return `${n > 0 ? '+' : '−'}${s}`;
}

export type DiffTone = 'primary' | 'warn' | 'none';
export const diffTone = (n: number): DiffTone => (Number(Math.abs(n).toFixed(2)) === 0 ? 'none' : n > 0 ? 'primary' : 'warn');

/** 투찰률 %: 정수면 소수 없이, 아니면 필요한 만큼(최대 4자리) */
export const formatRate = (n: number): string => `${Number(n.toFixed(4))}%`;

export const WEIGHT_SOURCE_LABEL = { api: '공고정보', evalMethod: '평가방법 문자열에서 보정' } as const;
export const WEIGHT_MISSING_WARNING = '가격 배점을 입력하세요';

export function weightSourceLabel(source: 'api' | 'evalMethod' | null, edited: boolean): string {
  if (edited) return '직접 입력';
  return source ? WEIGHT_SOURCE_LABEL[source] : '';
}

export function baseSourceLabel(hasDefault: boolean, edited: boolean): string {
  if (edited) return '직접 입력';
  return hasDefault ? '공고정보 추정가격' : '';
}

export function rivalSourceLabel(edited: boolean): string {
  return edited ? '직접 입력' : '기본값';
}

/** 접힘 상태에서 보일 행: rival 행 기준 ±range행. rival 행이 없으면 앞쪽 2*range+1행 */
export function collapsedRows(rows: SimRow[], range = 5): SimRow[] {
  const at = rows.findIndex((r) => r.isRival);
  if (at < 0) return rows.slice(0, range * 2 + 1);
  return rows.slice(Math.max(0, at - range), at + range + 1);
}

export function verificationText(v: { ok: number; total: number } | null): string {
  if (!v) return '확인 불가';
  if (v.total === 0) return '검증할 평가 이력이 없습니다';
  return `이 공식은 저장된 평가 이력 ${v.total}건 중 ${v.ok}건에서 확인됨`;
}

/** 입력 문자열 → 숫자. 빈 칸·비숫자는 undefined */
export function parseNum(s: string): number | undefined {
  const t = s.replace(/,/g, '').trim();
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}
