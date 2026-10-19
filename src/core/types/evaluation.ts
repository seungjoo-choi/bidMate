import type { ISODate } from './common';

export interface EvalBidder { seq: number; bizNo: string; name: string; order: number | null; excluded: boolean }
export interface EvalJudge { index: number; key: string | null; excluded: boolean; completed: boolean }
export interface EvalItem { no: string; parentNo: string | null; sheetNo: string; depth: number; names: string[]; maxScore: number | null; method: string | null; leaf: boolean }
/** 한 칸의 점수. b=업체 seq, j=위원 순번, i=세부항목 번호, s=점수, r=수정 이력 점수(s와 다를 때만) */
export interface EvalScore { b: number; j: number; i: string; s: number; r?: number }
export interface EvalOfficialRow { bizNo: string; rank: number | null; bidAmount: number | null; priceScore: number | null; techScore: number | null; totalScore: number | null; techRaw: number | null }
export type EvalStatus = 'final' | 'provisional';
export interface EvalRecord {
  schemaVersion: 1;
  noticeId: string; noticeNo: string; round: string;
  evalNo: string; title: string; orgName: string;
  evalKindName: string | null; techMethodName: string | null; techWeight: number | null;
  excludeBestWorst: boolean | null; status: EvalStatus; evaluatedAt: ISODate | null;
  bidders: EvalBidder[]; judges: EvalJudge[]; items: EvalItem[]; scores: EvalScore[];
  official: { fetchedAt: ISODate; rows: EvalOfficialRow[] } | null;
  warnings: string[]; collectedAt: ISODate; firstCollectedAt: ISODate;
}
export interface EvalIndexEntry {
  noticeId: string; noticeNo: string; round: string; title: string; orgName: string; evalNo: string;
  status: EvalStatus; evaluatedAt: ISODate | null; collectedAt: ISODate;
  bidders: Array<{ bizNo: string; name: string }>; judgeKeys: string[]; hasOfficial: boolean;
}
export interface EvalIndexFile { schemaVersion: 1; generatedAt: ISODate; entries: EvalIndexEntry[] }
