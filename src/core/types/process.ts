import type { ISODate } from './common';

export interface ProcessWinner { seq: number; name: string; bizNo: string; amount: number | null; rate: number | null; bidders: number | null; openedAt: ISODate | null }   // 대표자명(4번째 칸)은 버린다
export interface ProcessContract { seq: number; contractNo: string; name: string; contractOrg: string | null; demandOrg: string | null; method: string | null; amount: number | null; contractedAt: ISODate | null }
export interface ProcessRound { noticeNo: string; round: string; title: string | null; postedAt: ISODate | null; demandOrg: string | null; bidMethod: string | null; winners: ProcessWinner[]; contracts: ProcessContract[] }
export interface ContractProcess {
  orderPlan: { no: string; untyNo: string | null; name: string | null; org: string | null; ym: string | null } | null;   // orderPlanNo 비면 null
  prespec: { regNo: string; name: string | null; demandOrg: string | null; noticeOrg: string | null; opinionCloseAt: ISODate | null } | null;   // bfSpecRgstNo 비면 null
  procurementMethod: string | null; contractMethod: string | null;   // prcrmntMethdNm, cntrctCnclsMthdNm (첫 item)
  rounds: ProcessRound[];   // bidNtceOrd 오름차순, pad3
}
export interface ProcessFile { schemaVersion: 1; noticeId: string; queryNoticeNo: string; op: string | null; fetchedAt: ISODate; process: ContractProcess | null }   // process null = 0건
export type ProcessGetResult = { file: ProcessFile | null; fromCache: boolean; error?: { code: string; message: string } };
export const PROCESS_TTL_MS = 12 * 3600_000;
