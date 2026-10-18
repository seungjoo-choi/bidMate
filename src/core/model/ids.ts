export const noticeId = (noticeNo: string, round?: string): string => `${noticeNo}-${round ?? '00'}`;

export const newId = (prefix: string): string => `${prefix}_${crypto.randomUUID()}`;
