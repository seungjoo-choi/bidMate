import type { ISODate } from './common';

export type DeadlineKind = 'bidClose' | 'registration';
export const DEADLINE_OFFSETS = [3, 1, 0] as const;          // D-3, D-1, 당일
export type DeadlineOffset = (typeof DEADLINE_OFFSETS)[number];
export const DEADLINE_HOUR_KST = 9;

/** 한 공고의 알림 대상 일정 하나 */
export interface DeadlineItem { noticeId: string; title: string; kind: DeadlineKind; at: ISODate }
/** 알림 1건 */
export interface DeadlineNotice extends DeadlineItem { offset: DeadlineOffset; fireAt: number /* UTC ms */; key: string /* deadline:<noticeId>:<kind>:<offset> */ }
export interface DeadlinePlan { builtAt: ISODate; items: DeadlineNotice[] }   // fireAt 오름차순
/** storage.local 키 */
export const DEADLINE_PLAN_KEY = 'deadlinePlan';
export const DEADLINE_SENT_KEY = 'deadlineSent';       // Record<key, ISODate 발송 시각>
export interface DeadlineRefreshSummary { ran: boolean; planned: number; nextAlarmAt: ISODate | null; skipped?: 'NO_FS' | 'BUSY'; error?: string }
