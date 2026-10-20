import type { ISODate } from './common';

export type DateOnly = string; // 'YYYY-MM-DD'
export interface PerformanceRecord {
  id: string; /* newId('perf') */
  title: string; /* 사업명 1~200자 */
  client: string; /* 발주기관 1~100자 */
  amount: number; /* 계약금액(원, 부가세 포함), 정수 1 이상 1e13 미만 */
  startAt: DateOnly; /* 착수일 */
  endAt?: DateOnly; /* 완료일. 없으면 진행 중 */
  share?: number; /* 지분율 % (1~100). 없으면 100 */
  category?: string; /* 분야 ≤ 50자 */
  note?: string; /* 비고 ≤ 500자 */
  source: 'excel' | 'manual';
  updatedAt: ISODate;
}
export type PerformanceInput = Omit<PerformanceRecord, 'id' | 'updatedAt' | 'source'> & { id?: string; source?: PerformanceRecord['source'] };
export interface PerformancesSnapshot { items: PerformanceRecord[]; warnings: string[] }
export interface PerformanceImportPlan { mode: 'append' | 'replace'; add: PerformanceInput[] }
export interface PerformanceImportSummary { added: number; removed: number; skipped: Array<{ row: number; reason: string }> }
export type PerformanceImportResult = PerformancesSnapshot & { summary: PerformanceImportSummary };

/** 비교 금액 = round(amount × (share ?? 100) / 100) */
export function compareAmountOf(p: Pick<PerformanceRecord, 'amount' | 'share'>): number {
  return Math.round((p.amount * (p.share ?? 100)) / 100);
}
