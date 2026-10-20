const MIN = 60_000;
const HOUR = 60 * MIN;

export const RESULT_BATCH_MAX = 15;
export const RESULT_BACKFILL_MAX = 10;
export const RESULT_FIRST_DELAY_MS = 30 * MIN;
export const RESULT_BACKOFF_MS: readonly number[] = [30 * MIN, 2 * HOUR, 6 * HOUR, 24 * HOUR];
export const RESULT_TRACK_DAYS = 120;
export const RESULT_REFRESH_THROTTLE_MS = 10 * MIN;
export const RESULT_RUN_TIMEOUT_MS = 120_000;
export const FOLLOW_FIRST_DELAY_MS = 10 * MIN;
export const FOLLOW_BURST_MS = 6 * HOUR;
export const FOLLOW_BURST_INTERVAL_MS = 10 * MIN;
export const FOLLOW_OFFICE_HOURS: readonly number[] = [9, 10, 11, 12, 13, 14, 15, 16, 17];
export const FOLLOW_RANKED_HOURS: readonly number[] = [10, 14, 17];
export const FOLLOW_BATCH_MAX = 20;
