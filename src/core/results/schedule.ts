import type { ISODate } from '../types/common';
import { RESULT_TERMINAL, type ResultEntry } from '../types/result';
import { FOLLOW_BURST_INTERVAL_MS, FOLLOW_BURST_MS, FOLLOW_FIRST_DELAY_MS, FOLLOW_OFFICE_HOURS, FOLLOW_RANKED_HOURS } from './limits';

export const KST_OFFSET_MS = 9 * 3600_000;
const DAY_MS = 86_400_000;

/** KST 기준 요일(0=일), 시, 분, 그날 KST 00:00의 UTC ms. */
export function kstParts(ms: number): { dow: number; hour: number; minute: number; dayStartMs: number } {
  const shifted = ms + KST_OFFSET_MS;
  const d = new Date(shifted);
  const dayStartMs = shifted - (((shifted % DAY_MS) + DAY_MS) % DAY_MS) - KST_OFFSET_MS;
  return { dow: d.getUTCDay(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), dayStartMs };
}

export function isKstWeekday(ms: number): boolean {
  const { dow } = kstParts(ms);
  return dow >= 1 && dow <= 5;
}

/** now보다 큰 첫 평일 정시(KST). 공휴일은 고려하지 않는다. */
export function nextKstSlot(nowMs: number, hours: readonly number[]): number {
  const sorted = [...hours].sort((a, b) => a - b);
  const { dayStartMs } = kstParts(nowMs);
  for (let k = 0; k < 10; k++) {
    const day = dayStartMs + k * DAY_MS;
    if (!isKstWeekday(day)) continue;
    for (const h of sorted) {
      const t = day + h * 3600_000;
      if (t > nowMs) return t;
    }
  }
  return nowMs + DAY_MS;
}

/** max(개찰, 제안서 평가). 둘 다 없거나 해석할 수 없으면 null. */
export function followStartAt(openingAt: ISODate | null, proposalEvalAt: ISODate | null): ISODate | null {
  const ms = [openingAt, proposalEvalAt].map((v) => (v ? Date.parse(v) : NaN)).filter((n) => Number.isFinite(n));
  return ms.length === 0 ? null : new Date(Math.max(...ms)).toISOString();
}

/** 팔로우 공고의 다음 확인 시각(ms). 종료 상태면 null. */
export function followNextCheckAt(e: Pick<ResultEntry, 'status' | 'startAt'>, nowMs: number): number | null {
  if (RESULT_TERMINAL.has(e.status)) return null;
  const start = Date.parse(e.startAt);
  if (nowMs < start) return start + FOLLOW_FIRST_DELAY_MS;
  if (e.status === 'waiting') {
    if (nowMs < start + FOLLOW_BURST_MS) return nowMs + FOLLOW_BURST_INTERVAL_MS;
    return nextKstSlot(nowMs, FOLLOW_OFFICE_HOURS);
  }
  return nextKstSlot(nowMs, FOLLOW_RANKED_HOURS);
}
