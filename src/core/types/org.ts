import type { ISODate } from './common';

export type OpKind = 'Servc' | 'Thng' | 'Cnstwk' | 'Frgcpt';
export interface NoticeCodes { demandOrgCode?: string; orderingOrgCode?: string; clsfcNo?: string; opKind?: OpKind }
export interface OrgBidder { bizNo: string; name?: string; rank: number | null; amount: number | null }
export interface OrgNotice {
  noticeNo: string; round: string; title: string; postedAt: ISODate | null; openingAt: ISODate | null;
  estimatedPrice: number | null; awardMethod: string | null; clsfcNo: string | null;
  winner: { bizNo: string; name: string | null; amount: number | null; rate: number | null; rateSource: 'api' | 'derived' | null } | null;
  participantCount: number | null;
  bidders: OrgBidder[] | null;   // null = B 미수집
}
export interface OrgHistoryKind { opKind: OpKind; fetchedAt: ISODate; range: { from: string; to: string }; notices: OrgNotice[]; truncated: boolean; calls: number; warnings: string[]; biddersFetched: number }
export interface OrgHistoryFile { schemaVersion: 1; orgCode: string; orgName: string; updatedAt: ISODate; kinds: Partial<Record<OpKind, OrgHistoryKind>> }
export const ORG_YEARS = 3;
export const ORG_NOTICE_CAP = 150;
export const ORG_CALL_BUDGET = 200;
