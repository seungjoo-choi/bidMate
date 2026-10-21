import type { SelectOption } from '../../ui/components/Select';

/** 목록의 기관 이름으로 기관 필터 옵션을 만든다. 공고 수가 많은 순, 같으면 이름순. 빈 이름은 뺀다 */
export function orgOptions<T>(list: readonly T[], orgOf: (x: T) => string | null | undefined): SelectOption[] {
  const counts = new Map<string, number>();
  for (const x of list) {
    const org = orgOf(x)?.trim();
    if (org) counts.set(org, (counts.get(org) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
    .map(([org, n]) => ({ value: org, label: org, hint: `${n}건` }));
}
