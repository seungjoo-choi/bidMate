/** 정량평가 표 요약(extras.quantTable)의 값 표기. 값을 문자열로 두면 valueKey가 같은 범주 집합끼리만 같은 값으로 본다. */
export const QUANT_TABLE_EXTRA = 'quantTable';
export type QuantCat = 'perf' | 'cred' | 'mgmt' | 'other';

const CATS: QuantCat[] = ['perf', 'cred', 'mgmt', 'other'];

/** "<합계 배점>:<정렬된 범주 쉼표 연결>" 예: "10:mgmt,perf". */
export function formatQuantValue({ total, cats }: { total: number; cats: Set<QuantCat> }): string {
  return `${total}:${[...cats].sort().join(',')}`;
}

export function parseQuantValue(v: unknown): { total: number; cats: Set<QuantCat> } | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d+(?:\.\d+)?):([a-z,]*)$/.exec(v);
  if (!m) return null;
  const cats = new Set<QuantCat>();
  for (const s of m[2]!.split(',')) {
    if (s === '') continue;
    if (!CATS.includes(s as QuantCat)) return null;
    cats.add(s as QuantCat);
  }
  return { total: Number(m[1]), cats };
}
