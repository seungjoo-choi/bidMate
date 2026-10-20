export const NOTIFY_TITLE_MAX = 60;

/** 60자 넘으면 60자 + "…". */
export const clipTitle = (s: string): string => (s.length > NOTIFY_TITLE_MAX ? `${s.slice(0, NOTIFY_TITLE_MAX)}…` : s);
