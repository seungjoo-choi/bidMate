import type { ComposeSelectorSet } from '../types';
import { naverworksV1 } from './naverworks-v1';

export const SELECTOR_SETS: Record<string, ComposeSelectorSet> = {
  [naverworksV1.id]: naverworksV1,
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function deepMerge(base: unknown, over: unknown): unknown {
  if (over === undefined) return base;
  if (isPlainObject(base) && isPlainObject(over)) {
    const out: Record<string, unknown> = { ...base };
    for (const k of Object.keys(over)) out[k] = deepMerge(base[k], over[k]);
    return out;
  }
  return over;   // 배열과 원시값은 교체
}

/** base에 overrides를 deep merge한다. 배열은 병합하지 않고 교체한다. */
export function mergeSelectorSet(base: ComposeSelectorSet, overrides?: Partial<ComposeSelectorSet>): ComposeSelectorSet {
  return deepMerge(base, overrides) as ComposeSelectorSet;
}
