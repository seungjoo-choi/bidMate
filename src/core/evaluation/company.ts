import type { Settings } from '../types/settings';

/** 숫자만 남긴다(하이픈, 공백 제거). */
export const normalizeBizNo = (s: string): string => (s ?? '').replace(/\D/g, '');

/** 우리 회사 설정이 10자리일 때만 비교한다. */
export function isOurs(bizNo: string, settings: Pick<Settings, 'company'>): boolean {
  const ours = normalizeBizNo(settings.company?.bizNo ?? '');
  return ours.length === 10 && normalizeBizNo(bizNo) === ours;
}
