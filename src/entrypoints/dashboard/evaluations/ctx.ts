import type { BidderTotal, Duel, TotalsOpts } from '../../../core/evaluation/analyze';
import type { EvalRecord } from '../../../core/types/evaluation';
import type { Tone } from './eval-view';

/** 페이지가 한 번 계산해서 각 블록에 내려주는 값 */
export interface EvalCtx {
  rec: EvalRecord;
  /** 우리 회사 기준 보기인지(회사 설정과 참여가 확인된 경우만 true) */
  isOurs: boolean;
  ourBizNo: string | null;
  ourSeq: number | null;
  /** 사용자가 화면에서 뺀 위원 index */
  excluded: Set<number>;
  opts: TotalsOpts;
  totals: BidderTotal[];
  /** pickDuel 결과 */
  duel: Duel | null;
  /** 우리 회사 기준일 때 상대(1위가 우리면 2위, 아니면 1위). 전체 보기면 null */
  rival: number | null;
  nameOf: (seq: number) => string;
}

export const TONE_TEXT: Record<Tone, string> = { win: 'text-primary', lose: 'text-warn', even: 'text-muted' };
