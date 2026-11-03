import type { ISODate } from './common';

export type EstimateKey = 'management' | 'credibility' | 'performance';
export const ESTIMATE_KEYS: EstimateKey[] = ['management', 'credibility', 'performance'];
/** 예상 점수 항목과 공고 평가 배점 필드의 대응 */
export const ESTIMATE_FIELD: Record<EstimateKey, 'managementScore' | 'credibilityScore' | 'performanceScore'> = {
  management: 'managementScore', credibility: 'credibilityScore', performance: 'performanceScore',
};
export interface EstimateEntry { score: number; note?: string /* ≤200자 */; updatedAt: ISODate }
export interface EstimateFile { schemaVersion: 1; noticeId: string; items: Partial<Record<EstimateKey, EstimateEntry>>; updatedAt: ISODate }
