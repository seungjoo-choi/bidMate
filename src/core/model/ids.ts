import type { NoticeKind } from '../types/notice';

export const noticeId = (noticeNo: string, round?: string): string => `${noticeNo}-${round ?? '00'}`;

/** kind 없음 = bid. */
export const kindOf = (r: { kind?: NoticeKind } | undefined): NoticeKind => r?.kind ?? 'bid';

/** bid는 `번호-차수`, 그 외(prespec/orderplan)는 번호 그대로. */
export function noticeIdOf(ref: { kind?: NoticeKind; noticeNo: string; round?: string }): string {
  return kindOf(ref) === 'bid' ? noticeId(ref.noticeNo, ref.round) : ref.noticeNo;
}

/** 화면 표시용 라벨. bid는 `번호-차수`(기존 표시와 동일), 그 외는 번호. */
export function noticeLabel(e: { kind?: NoticeKind; noticeNo: string; round?: string }): string {
  return kindOf(e) === 'bid' ? `${e.noticeNo}-${e.round ?? '00'}` : e.noticeNo;
}

export const newId = (prefix: string): string => `${prefix}_${crypto.randomUUID()}`;
