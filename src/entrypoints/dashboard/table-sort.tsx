import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useMemo, useState } from 'react';

export type SortDir = 'asc' | 'desc';
export type SortValue = string | number | null | undefined;
export interface SortState<K extends string> { key: K; dir: SortDir }

/** 빈 값은 방향과 관계없이 항상 맨 뒤로 보낸다. */
function compare(a: SortValue, b: SortValue, dir: SortDir): number {
  const ea = a === null || a === undefined || a === '';
  const eb = b === null || b === undefined || b === '';
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
  const r = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'ko');
  return dir === 'asc' ? r : -r;
}

/** 열 머리글 클릭 정렬. 같은 열을 다시 누르면 방향을 뒤집고, 다른 열은 그 열의 기본 방향으로 시작한다. */
export function useSort<T, K extends string>(
  rows: T[],
  accessors: Record<K, (row: T) => SortValue>,
  initial: SortState<K>,
  firstDir: Partial<Record<K, SortDir>> = {},
) {
  const [sort, setSort] = useState<SortState<K>>(initial);
  const sorted = useMemo(() => {
    const get = accessors[sort.key];
    return [...rows].sort((a, b) => compare(get(a), get(b), sort.dir));
    // accessors는 매 렌더 새로 만들어지므로 의존성에서 뺀다(정렬 기준은 sort가 결정).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort]);
  const toggle = (key: K) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: firstDir[key] ?? 'asc' }));
  return { sorted, sort, toggle };
}

export function SortHeader<K extends string>({ label, k, sort, onSort }: { label: string; k: K; sort: SortState<K>; onSort: (k: K) => void }) {
  const on = sort.key === k;
  const Icon = !on ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={() => onSort(k)}
      className={`inline-flex items-center gap-1 transition-colors hover:text-ink motion-reduce:transition-none ${on ? 'font-semibold text-ink' : ''}`}
    >
      {label}
      <Icon className={`size-3.5 ${on ? '' : 'text-faint'}`} aria-hidden />
    </button>
  );
}
