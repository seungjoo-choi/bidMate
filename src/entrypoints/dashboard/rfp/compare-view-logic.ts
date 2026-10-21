import { diffLines, lineStats } from '../../../core/rfp/diff';
import { bodyOf } from '../../../core/rfp/match';
import { dice } from '../../../core/rfp/normalize';
import type { RequirementItem, RfpCompareResult, RfpCompareSession, RfpPair, RfpPairOverride, RfpPairStatus } from '../../../core/types/rfp';

export interface CompareFilter {
  status: Record<RfpPairStatus, boolean>;
  prefix: string; /* '' = 전체 */
  query: string;
  numericOnly: boolean;
  todoOnly: boolean;
}
export const DEFAULT_FILTER: CompareFilter = {
  status: { changed: true, added: true, removed: true, same: false },
  prefix: '', query: '', numericOnly: false, todoOnly: false,
};

/** 목록·상세가 대표로 쓰는 항목(기준 우선). */
export const refItem = (p: RfpPair): RequirementItem => (p.next ?? p.prev)!;

const matchesBasic = (p: RfpPair, f: CompareFilter): boolean => {
  const it = refItem(p);
  if (f.prefix && it.prefix !== f.prefix) return false;
  const q = f.query.trim().toLowerCase();
  if (!q) return true;
  return [p.prev, p.next].some((i) => !!i && (i.id.toLowerCase().includes(q) || i.key.toLowerCase().includes(q) || i.name.toLowerCase().includes(q)));
};

/** 필터 조합(상태 토글 · 접두어 · 검색 · 수치만 · 미확인만)을 적용한 목록. 순서는 입력 그대로. */
export function filterPairs(pairs: RfpPair[], f: CompareFilter, reviewed: ReadonlySet<string>): RfpPair[] {
  return pairs.filter((p) => {
    if (!f.status[p.status]) return false;
    if (!matchesBasic(p, f)) return false;
    if (f.numericOnly && !p.tags.includes('numeric')) return false;
    if (f.todoOnly && (p.status === 'same' || reviewed.has(p.key))) return false;
    return true;
  });
}

/** 동일을 숨긴 상태에서 숨겨진 동일 항목 수(접두어·검색은 적용, 수치/미확인 칩은 무시). 동일을 보이는 중이면 0. */
export function hiddenSameCount(pairs: RfpPair[], f: CompareFilter): number {
  if (f.status.same) return 0;
  return pairs.filter((p) => p.status === 'same' && matchesBasic(p, f)).length;
}

/** 다음 미확인(동일 제외). 현재 다음부터 순환하고, 현재 항목만 남았거나 없으면 null. currentKey가 목록에 없으면 처음부터. */
export function nextUnreviewedKey(visible: RfpPair[], reviewed: ReadonlySet<string>, currentKey: string | null): string | null {
  const todo = (p: RfpPair) => p.status !== 'same' && !reviewed.has(p.key);
  const i = currentKey === null ? -1 : visible.findIndex((p) => p.key === currentKey);
  for (let k = 1; k <= visible.length; k++) {
    const p = visible[(i + k + visible.length) % visible.length]!;
    if (todo(p)) return p.key;
  }
  return null;
}

/** 선택 항목이 필터에서 빠졌을 때 옮길 선택: 비교 대상 목록에서 그 다음 위치의 아직 보이는 항목, 없으면 앞쪽 가장 가까운 항목, 없으면 null. */
export function nextSelectionAfterRemoval(prevVisibleKeys: string[], removedKey: string, nextVisibleKeys: string[]): string | null {
  const i = prevVisibleKeys.indexOf(removedKey);
  if (i < 0) return null;
  const alive = new Set(nextVisibleKeys);
  for (let k = i + 1; k < prevVisibleKeys.length; k++) if (alive.has(prevVisibleKeys[k]!)) return prevVisibleKeys[k]!;
  for (let k = i - 1; k >= 0; k--) if (alive.has(prevVisibleKeys[k]!)) return prevVisibleKeys[k]!;
  return null;
}

export interface PrefixGroup { prefix: string; items: RfpPair[]; total: number; changed: number }
/** 접두어별 구역. total·changed는 필터와 무관한 전체 기준(구역 머리글 "n개 · 달라짐 m"). */
export function groupByPrefix(visible: RfpPair[], all: RfpPair[]): PrefixGroup[] {
  const tot = new Map<string, { total: number; changed: number }>();
  for (const p of all) {
    const k = refItem(p).prefix, t = tot.get(k) ?? { total: 0, changed: 0 };
    t.total++; if (p.status !== 'same') t.changed++;
    tot.set(k, t);
  }
  const out: PrefixGroup[] = [];
  for (const p of visible) {
    const k = refItem(p).prefix;
    let g = out[out.length - 1];
    if (!g || g.prefix !== k) { g = { prefix: k, items: [], total: tot.get(k)!.total, changed: tot.get(k)!.changed }; out.push(g); }
    g.items.push(p);
  }
  return out;
}

export const reviewTotal = (r: RfpCompareResult): number => r.pairs.filter((p) => p.status !== 'same').length;
export const reviewedCount = (r: RfpCompareResult, reviewed: ReadonlySet<string>): number =>
  r.pairs.filter((p) => p.status !== 'same' && reviewed.has(p.key)).length;
export const summaryOf = (r: RfpCompareResult): NonNullable<RfpCompareSession['summary']> => ({ counts: r.counts, reviewTotal: reviewTotal(r) });

// ── 힌트 ──
export type HintTone = 'plain' | 'ren' | 'num' | 'col';
export interface Hint { id: string; label: string; tone: HintTone; stats?: { mod: number; add: number; del: number } }

const TEXT_FIELDS = ['name', 'definition', 'detail'] as const;
/** 이름·정의·세부내용의 줄 단위 변경 수 합계(같은 칸은 건너뜀). */
export function pairLineStats(p: RfpPair): { mod: number; add: number; del: number } {
  const r = { mod: 0, add: 0, del: 0 };
  if (!p.prev || !p.next) return r;
  for (const f of TEXT_FIELDS) {
    const a = p.prev[f] ?? '', b = p.next[f] ?? '';
    if (a === b) continue;
    const s = lineStats(diffLines(a, b));
    r.mod += s.mod; r.add += s.add; r.del += s.del;
  }
  return r;
}

export function hintsOf(p: RfpPair): Hint[] {
  const t = p.tags, h: Hint[] = [];
  if (t.includes('renumbered')) h.push({ id: 'ren', label: t.includes('number_only') ? '번호만 바뀜' : '번호 바뀜', tone: 'ren' });
  if (t.includes('numeric')) h.push({ id: 'num', label: '수치', tone: 'num' });
  if (t.includes('minor')) h.push({ id: 'minor', label: '몇 글자 바뀜', tone: 'plain' });
  if (t.includes('weak')) h.push({ id: 'weak', label: '다른 항목일 수도', tone: 'col' });
  else if (t.includes('major')) h.push({ id: 'major', label: '대폭 변경', tone: 'num' });
  if (t.includes('id_collision')) h.push({ id: 'collision', label: '같은 번호, 다른 내용', tone: 'col' });
  if (t.includes('split')) h.push({ id: 'split', label: '나뉨', tone: 'plain' });
  if (t.includes('merged')) h.push({ id: 'merged', label: '합쳐짐', tone: 'plain' });
  if (p.status === 'changed' && !t.includes('minor')) {
    const st = pairLineStats(p);
    if (st.mod || st.add || st.del) h.push({ id: 'lines', label: '', tone: 'plain', stats: st });
  }
  return h;
}

// ── 방향 바꾸기 · 수동 짝 ──
const flip = (o: RfpPairOverride): RfpPairOverride => ({ op: o.op, prevKey: o.nextKey, nextKey: o.prevKey });
const sameKeys = (o: RfpPairOverride, prevKey: string, nextKey: string) => o.prevKey === prevKey && o.nextKey === nextKey;

/** 비교 대상↔기준 교체. overrides의 prevKey/nextKey도 바꾸고 확인함은 비운다(pair key가 달라지므로). */
export function swapSessionDirection(s: RfpCompareSession): RfpCompareSession {
  return { ...s, prev: s.next, next: s.prev, overrides: s.overrides.map(flip), reviewed: [] };
}

/** 수동 짝 추가. 같은 키 쌍의 unpair(와 중복 pair)는 제거한다. */
export function addPairOverride(overrides: RfpPairOverride[], prevKey: string, nextKey: string): RfpPairOverride[] {
  return [...overrides.filter((o) => !sameKeys(o, prevKey, nextKey)), { op: 'pair', prevKey, nextKey }];
}
/** 짝 풀기. 같은 키 쌍의 pair(와 중복 unpair)는 제거하고 unpair를 넣는다. */
export function addUnpairOverride(overrides: RfpPairOverride[], prevKey: string, nextKey: string): RfpPairOverride[] {
  return [...overrides.filter((o) => !sameKeys(o, prevKey, nextKey)), { op: 'unpair', prevKey, nextKey }];
}

export interface PickCandidate { item: RequirementItem; score: number }
/** 짝 맺기 후보: 반대편 미매칭 항목을 0.6·명칭+0.4·본문 유사도 내림차순. */
export function pickCandidates(base: RequirementItem, pool: RequirementItem[]): PickCandidate[] {
  const body = bodyOf(base);
  return pool
    .map((item) => ({ item, score: 0.6 * dice(base.name, item.name) + 0.4 * dice(body, bodyOf(item)) }))
    .sort((a, b) => b.score - a.score);
}
