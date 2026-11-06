import type { ISODate } from './common';
import type { OpKind } from './org';

/** 낙찰 결과 API probe 응답의 한 단계 결과. sample은 앞 3건. */
export interface ProbePart {
  ok: boolean;
  count: number;
  keys: string[];
  sample: Array<Record<string, string>>;
  error?: string;
}

export interface ResultProbeResult {
  /** 공고정보 원본(fetchNotice) 1건 */
  notice: ProbePart & { op: string | null };
  opening: ProbePart;
  /** 유찰 목록 후보 op 전부 */
  failing: Array<ProbePart & { op: string }>;
  award: Array<ProbePart & { op: string }>;
}

export type ResultStatus =
  | 'waiting'          // 개찰 전이거나 결과/순위 미게시
  | 'ranked'           // 순위 있음, 최종 낙찰자 미확정
  | 'won' | 'lost' | 'not_participated' | 'no_bid' | 'expired'; // 종료

export const RESULT_TERMINAL: ReadonlySet<ResultStatus> = new Set<ResultStatus>(['won', 'lost', 'not_participated', 'no_bid', 'expired']);

/** 유찰 공고의 재공고 감시 상태(파생 캐시). 팔로우 의사는 follows.json target만 따른다 */
export interface ReannounceWatch {
  status: 'watching' | 'found' | 'expired';
  since: ISODate;
  nextCheckAt: ISODate; attempts: number; checkedAt?: ISODate;
  orgCode?: string; opKind?: OpKind;
  found?: { noticeNo: string; round: string; title: string; noticeId: string; postedAt?: ISODate; foundAt: ISODate; via: 'collect' | 'search' };
  /** 재공고 수집으로 유찰을 추정한 경우 */
  inferredNoBid?: true;
  lastError?: { code: string; message: string };
}

export interface ResultEntry {
  noticeId: string; noticeNo: string; round: string;
  status: ResultStatus;
  openingAt: ISODate;           // 없으면 bidCloseAt 대체, 둘 다 없으면 항목 미생성
  proposalEvalAt?: ISODate;
  startAt: ISODate;             // max(openingAt, proposalEvalAt)
  rank?: number; bidders?: number;
  winnerBizNo?: string; winnerName?: string; awardedAt?: ISODate; amount?: number;
  listOp?: string;
  phase?: 'burst' | 'office' | 'ranked';
  checkedAt?: ISODate; nextCheckAt: ISODate; attempts: number;
  /** 1단계 우리 행의 투찰금액(bidprcAmt). 우리 행이 없거나 값이 없으면 생략 */
  ourAmount?: number;
  /** 백필로 1단계를 다시 읽은 시각. 있으면 다시 시도하지 않는다(값 유무와 무관) */
  amountCheckedAt?: ISODate;
  lastError?: { code: string; message: string };
  reannounce?: ReannounceWatch;
}
export interface ResultFile { schemaVersion: 1; bizNo: string; updatedAt: ISODate; entries: Record<string, ResultEntry> }

export type FollowTarget = 'rank' | 'final';
export const FOLLOW_TARGET_DEFAULT: FollowTarget = 'final';
export interface FollowEntry { noticeId: string; followedAt: ISODate; target: FollowTarget; notified: { rank?: ISODate; final?: ISODate } }
export interface FollowFile { schemaVersion: 1; updatedAt: ISODate; entries: Record<string, FollowEntry> }

export type NotifyEvent =
  | { kind: 'rank'; noticeId: string; title: string; rank: number; bidders: number; followEnded?: true }  // followEnded: 개찰 결과만 팔로우라 이 알림으로 팔로우를 끝냄
  | { kind: 'final'; noticeId: string; title: string; status: 'won' | 'lost' | 'not_participated' | 'no_bid'; rank?: number; winnerName?: string; inferred?: true }
  | { kind: 'expired'; noticeId: string; title: string };

export interface ResultRunSummary {
  ran: boolean; checked: number; updated: number; won: number;
  skipped?: 'NO_KEY' | 'NO_BIZNO' | 'NO_FS' | 'THROTTLED' | 'BUSY' | 'KEY_INVALID';
  error?: string;
  nextFollowCheckAt: ISODate | null;
  events: NotifyEvent[];
}
