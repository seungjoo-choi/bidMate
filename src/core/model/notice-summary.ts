import { conflictCountOf, coveredByGroup, reviewCountOf } from '../extraction/review-count';
import type { FieldStatus } from '../types/common';
import { EXTRACTION_KEYS, type Extraction, type ExtractionKey, type ExtractionStatus } from '../types/extraction';
import type { Notice, NoticeKind } from '../types/notice';

export interface BasicFacts {
  kind: NoticeKind; noticeNo: string; round: string | null; title: string | null;
  orderingOrg: string | null; demandOrg: string | null; estimatedPrice: number | null;
  contractMethod: string | null; awardMethod: string | null; jointVentureAllowed: boolean | null;
  eligibility: string | null; projectPeriod: string | null; bidCloseAt: string | null; openingAt: string | null;
  attachmentCount: number;
  prespec?: { opinionCloseAt: string | null; assignedBudget: number | null; bizDivision: string | null };
}
export type EvalFactKey = 'performanceScore' | 'managementScore' | 'credibilityScore' | 'performancePeriod' | 'performanceMinAmount' | 'differentialScoring';
export interface EvalFactItem { value: unknown; status: FieldStatus; needsCheck: boolean }
export interface EvalFacts { items: Record<EvalFactKey, EvalFactItem>; reviewCount: number; conflictCount: number; extractionStatus: ExtractionStatus }

const EVAL_FACT_KEYS: EvalFactKey[] = ['performanceScore', 'managementScore', 'credibilityScore', 'performancePeriod', 'performanceMinAmount', 'differentialScoring'];

/** 열거된 키만 읽는다(허용 목록). officerName, officerTel, customFields, sourceUrl은 읽지 않는다. */
export function basicFacts(n: Notice): BasicFacts {
  const kind = n.ref.kind ?? 'bid';
  const facts: BasicFacts = {
    kind, noticeNo: n.basic.noticeNo.value ?? n.ref.noticeNo, round: n.basic.round.value, title: n.basic.title.value,
    orderingOrg: n.basic.orderingOrg.value, demandOrg: n.basic.demandOrg.value, estimatedPrice: n.basic.estimatedPrice.value,
    contractMethod: n.basic.contractMethod.value, awardMethod: n.basic.awardMethod.value, jointVentureAllowed: n.basic.jointVentureAllowed.value,
    eligibility: n.basic.eligibility.value, projectPeriod: n.basic.projectPeriod.value,
    bidCloseAt: n.schedule.bidCloseAt.value, openingAt: n.schedule.openingAt.value,
    attachmentCount: n.attachments.length,
  };
  if (kind === 'prespec') {
    facts.prespec = { opinionCloseAt: n.prespec.opinionCloseAt.value, assignedBudget: n.prespec.assignedBudget.value, bizDivision: n.prespec.bizDivision.value };
  }
  return facts;
}

export function evalFacts(n: Notice, x: Extraction | null): EvalFacts {
  const items = {} as Record<EvalFactKey, EvalFactItem>;
  for (const k of EVAL_FACT_KEYS) {
    const f = n.evaluation[k];
    // 같은 개념 그룹(대외신인도/경영상태)의 다른 항목이 충족이면 확인 필요로 보지 않는다(reviewCountOf와 같은 기준).
    const covered = !!x && (EXTRACTION_KEYS as string[]).includes(k) && coveredByGroup(x.items, k as ExtractionKey);
    items[k] = { value: f.value, status: f.status, needsCheck: (f.status === 'needs_review' || f.status === 'missing') && !covered };
  }
  return {
    items,
    reviewCount: x ? reviewCountOf(x) : 0,
    conflictCount: x ? conflictCountOf(x) : 0,
    extractionStatus: x?.status ?? 'not_run',
  };
}
