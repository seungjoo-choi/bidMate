import { missing, type FieldValue } from '../types/common';
import type { Notice, NoticeBasic, NoticeEvaluation, NoticeFieldKey, NoticePrespec, NoticeRef, NoticeSchedule } from '../types/notice';

export const BASIC_KEYS: Array<keyof NoticeBasic> = [
  'noticeNo', 'round', 'title', 'postedAt', 'noticeType', 'orderingOrg', 'demandOrg', 'budgetAmount', 'estimatedPrice',
  'projectPeriod', 'contractMethod', 'awardMethod', 'priceMethod', 'jointVentureAllowed', 'eligibility',
];
export const SCHEDULE_KEYS: Array<keyof NoticeSchedule> = [
  'registrationDeadline', 'bidStartAt', 'bidCloseAt', 'proposalPeriod', 'proposalEvalAt', 'openingAt',
];
export const EVALUATION_KEYS: Array<keyof NoticeEvaluation> = [
  'evalMethod', 'differentialScoring', 'credibilityScore', 'managementScore', 'performanceScore', 'performancePeriod', 'performanceMinAmount', 'performanceCondition', 'evalMethodDoc', 'quantEvalDoc',
];
export const PRESPEC_KEYS: Array<keyof NoticePrespec> = [
  'specRegNo', 'specName', 'bizDivision', 'assignedBudget', 'registeredAt', 'opinionCloseAt', 'officerName', 'officerTel', 'relatedBidNo',
];
export const ALL_FIELD_KEYS: NoticeFieldKey[] = [...BASIC_KEYS, ...SCHEDULE_KEYS, ...EVALUATION_KEYS, ...PRESPEC_KEYS];

export type FieldMap = Partial<Record<NoticeFieldKey, FieldValue<unknown>>>;

type Groups = Pick<Notice, 'basic' | 'schedule' | 'evaluation' | 'prespec'>;

function groupOf(n: Groups, key: NoticeFieldKey): Record<string, FieldValue<unknown>> {
  if ((BASIC_KEYS as string[]).includes(key)) return n.basic as unknown as Record<string, FieldValue<unknown>>;
  if ((SCHEDULE_KEYS as string[]).includes(key)) return n.schedule as unknown as Record<string, FieldValue<unknown>>;
  if ((PRESPEC_KEYS as string[]).includes(key)) return n.prespec as unknown as Record<string, FieldValue<unknown>>;
  return n.evaluation as unknown as Record<string, FieldValue<unknown>>;
}

export function getField(n: Groups, key: NoticeFieldKey): FieldValue<unknown> | undefined {
  return groupOf(n, key)[key];
}

export function setFields(n: Groups, fields: FieldMap): void {
  for (const key of ALL_FIELD_KEYS) {
    const v = fields[key];
    if (v) groupOf(n, key)[key] = v;
  }
}

export function emptyNotice(id: string, ref: NoticeRef, folder: string, nowIso: string): Notice {
  const fill = <K extends string>(keys: K[]) => Object.fromEntries(keys.map((k) => [k, missing()])) as Record<K, FieldValue<never>>;
  return {
    schemaVersion: 1, id, ref, folder,
    basic: fill(BASIC_KEYS) as unknown as NoticeBasic,
    schedule: fill(SCHEDULE_KEYS) as unknown as NoticeSchedule,
    evaluation: fill(EVALUATION_KEYS) as unknown as NoticeEvaluation,
    prespec: fill(PRESPEC_KEYS) as unknown as NoticePrespec,
    customFields: {}, sourceUrl: missing(),
    isCorrection: false, attachments: [],
    collect: { status: 'partial', collectedAt: nowIso, lastJobId: '', errors: [] },
    mail: { status: 'none' },
    updatedAt: nowIso,
  };
}

/** 읽기 보정: 빠진 필드를 missing()으로 채운다. 저장 경로에서는 쓰지 않는다. */
export function fillMissingFields(n: Notice): Notice {
  n.basic ??= {} as NoticeBasic;
  n.schedule ??= {} as NoticeSchedule;
  n.evaluation ??= {} as NoticeEvaluation;
  n.prespec ??= {} as NoticePrespec;
  for (const key of ALL_FIELD_KEYS) {
    const g = groupOf(n, key);
    if (g[key] === undefined) g[key] = missing();
  }
  return n;
}
