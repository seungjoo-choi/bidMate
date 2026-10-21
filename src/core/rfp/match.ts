import {
  CONTAIN_MIN_CHARS, CONTAIN_THRESHOLD, ID_ACCEPT_BODY, ID_BONUS, ID_ACCEPT_NAME, MAJOR_BODY, MINOR_BODY,
  PAIR_THRESHOLD, PREFIX_BONUS, WEAK_BODY, WEAK_NAME, W_BODY, W_NAME,
} from './constants';
import { containGrams, diceGrams, grams, numberTokens, stripFormat, type Grams } from './normalize';
import type { RequirementItem, RfpCompareResult, RfpPair, RfpPairOverride, RfpPairStatus, RfpPairTag } from '../types/rfp';

/**
 * 이전·이번 요구사항을 짝지어 동일/변경/신규/삭제를 가른다. 순수·결정적(같은 입력 → 같은 출력).
 * 0. 수동 짝(override pair) 확정, unpair는 후보에서 제외
 * 1. 같은 번호: 명칭 또는 본문이 비슷하면 짝(id). 아니면 보류 + id_collision
 * 2. 남은 것끼리 내용 유사도 그리디(similarity), 번호가 다르면 renumbered
 * 3. 남은 항목은 포함률로 분할(split)·병합(merged) 그룹만 표시(상태는 신규·삭제 유지)
 * 4. 띄어쓰기·문장부호만 다르면 same(format), 아니면 changed + 태그
 */
const FIELDS = ['name', 'category', 'definition', 'detail'] as const;
export const bodyOf = (i: RequirementItem): string => [i.definition, i.detail].filter(Boolean).join('\n');
export const pairKey = (prev?: RequirementItem, next?: RequirementItem): string => `${prev?.key ?? '-'}|${next?.key ?? '-'}`;

const sameText = (a?: string, b?: string) => (a ?? '').trim() === (b ?? '').trim();
const setEq = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));

function classify(p: RfpPair, nameSim: number, bodySim: number | null): void {
  const a = p.prev!, b = p.next!;
  if (FIELDS.every((f) => stripFormat(a[f]) === stripFormat(b[f]))) {
    // 내용은 같고 번호만 바뀐 것은 조견표 번호를 고쳐야 하므로 변경으로 본다(사용자 결정)
    p.status = a.key !== b.key ? 'changed' : 'same';
    if (a.key !== b.key) p.tags.push('number_only');
    if (!FIELDS.every((f) => sameText(a[f], b[f]))) p.tags.push('format');
    return;
  }
  p.status = 'changed';
  // 본문이 한쪽이라도 비면(요약표·PDF) 본문 유사도는 판정에 쓰지 않는다
  if (p.matchedBy === 'id' && nameSim < WEAK_NAME && (bodySim === null || bodySim < WEAK_BODY)) p.tags.push('weak');
  if (bodySim !== null && bodySim < MAJOR_BODY) p.tags.push('major');
  else if (!setEq(numberTokens(bodyOf(a)), numberTokens(bodyOf(b)))) p.tags.push('numeric');
  else if (bodySim !== null && bodySim >= MINOR_BODY) p.tags.push('minor');
}

interface Sim { ns: number; bs: number | null /* 본문이 한쪽이라도 비면 null */ }

export function compareSets(prev: RequirementItem[], next: RequirementItem[], overrides: RfpPairOverride[] = []): RfpCompareResult {
  const pairs: RfpPair[] = [];
  const usedP = new Set<RequirementItem>(), usedN = new Set<RequirementItem>();
  const pByKey = new Map(prev.map((i) => [i.key, i])), nByKey = new Map(next.map((i) => [i.key, i]));
  const banned = new Set(overrides.filter((o) => o.op === 'unpair').map((o) => `${o.prevKey}|${o.nextKey}`));
  const sims = new Map<RfpPair, Sim>();
  const collide = new Set<RequirementItem>();

  // 항목별 bigram은 한 번만 만든다(2단계가 |prev|·|next|번 비교)
  const G = new Map<RequirementItem, { n: Grams; b: Grams }>();
  for (const i of [...prev, ...next]) G.set(i, { n: grams(i.name), b: grams(bodyOf(i)) });
  const sim = (a: RequirementItem, b: RequirementItem): Sim => {
    const ga = G.get(a)!, gb = G.get(b)!;
    return { ns: diceGrams(ga.n, gb.n), bs: ga.b.s && gb.b.s ? diceGrams(ga.b, gb.b) : null };
  };
  const score = (a: RequirementItem, b: RequirementItem, s: Sim) =>
    (s.bs === null ? s.ns : W_NAME * s.ns + W_BODY * s.bs) + (a.prefix === b.prefix ? PREFIX_BONUS : 0);

  const add = (a: RequirementItem, b: RequirementItem, matchedBy: RfpPair['matchedBy'], s: Sim, sc?: number) => {
    usedP.add(a); usedN.add(b);
    const tags: RfpPairTag[] = a.key !== b.key ? ['renumbered'] : [];
    if (collide.has(a) || collide.has(b)) tags.push('id_collision'); /* 번호 충돌 항목이 다른 짝을 찾아도 표시 유지 */
    const p: RfpPair = { key: pairKey(a, b), status: 'changed', prev: a, next: b, matchedBy, tags, ...(sc !== undefined ? { score: sc } : {}) };
    pairs.push(p); sims.set(p, s);
  };

  // 0. 수동 짝(마지막 지정이 이긴다)
  const manual = new Map<string, string>();
  for (const o of overrides) if (o.op === 'pair') manual.set(o.prevKey, o.nextKey);
  for (const [pk, nk] of manual) {
    const a = pByKey.get(pk), b = nByKey.get(nk);
    if (a && b && !usedP.has(a) && !usedN.has(b)) add(a, b, 'manual', sim(a, b));
  }

  // 1~2. 같은 번호는 먼저 확정하지 않고 가산점(ID_BONUS)만 준 뒤, 모든 후보를 점수순으로 짝짓는다.
  // 항목 하나가 빠져 번호가 당겨지면(COR-005 "특수조건(1)" → COR-004) 번호만 같은 COR-005 "특수조건(2)"보다
  // 내용이 같은 쪽이 점수가 높아 먼저 맺어진다.
  // 같은 번호라도 명칭·본문이 모두 다르면 후보에서 빼고 id_collision으로 표시한다.
  const cand: Array<{ a: RequirementItem; b: RequirementItem; sc: number; s: Sim; same: boolean; ai: number; bi: number }> = [];
  prev.forEach((a, ai) => {
    if (usedP.has(a)) return;
    next.forEach((b, bi) => {
      if (usedN.has(b) || banned.has(`${a.key}|${b.key}`)) return;
      const s = sim(a, b), base = score(a, b, s), same = a.key === b.key;
      if (same) {
        if (s.ns >= ID_ACCEPT_NAME || (s.bs !== null && s.bs >= ID_ACCEPT_BODY)) cand.push({ a, b, sc: base + ID_BONUS, s, same, ai, bi });
        else { collide.add(a); collide.add(b); }
      } else if (base >= PAIR_THRESHOLD) cand.push({ a, b, sc: base, s, same, ai, bi });
    });
  });
  cand.sort((x, y) => y.sc - x.sc || x.ai - y.ai || x.bi - y.bi);
  for (const c of cand) {
    if (usedP.has(c.a) || usedN.has(c.b)) continue;
    if (c.same) add(c.a, c.b, 'id', c.s);
    else add(c.a, c.b, 'similarity', c.s, Math.min(1, c.s.bs === null ? c.s.ns : W_NAME * c.s.ns + W_BODY * c.s.bs));
  }

  for (const p of pairs) { const s = sims.get(p)!; classify(p, s.ns, s.bs); }

  // 3. 남은 항목: 신규·삭제 + 분할·병합 그룹
  const restP = prev.filter((a) => !usedP.has(a)), restN = next.filter((b) => !usedN.has(b));
  const groupOf = (part: RequirementItem, pool: RequirementItem[]): RequirementItem | undefined => {
    const gp = G.get(part)!.b;
    if (gp.s.length < CONTAIN_MIN_CHARS) return undefined;
    let best: RequirementItem | undefined, bs = CONTAIN_THRESHOLD;
    for (const w of pool) { const c = containGrams(gp, G.get(w)!.b); if (c >= bs) { bs = c; best = w; } }
    return best;
  };
  const tagsFor = (i: RequirementItem): RfpPairTag[] => (collide.has(i) ? ['id_collision'] : []);
  for (const a of restP) {
    const p: RfpPair = { key: pairKey(a, undefined), status: 'removed', prev: a, tags: tagsFor(a) };
    const w = groupOf(a, next);
    if (w) { p.group = { kind: 'merged', keys: [w.key] }; p.tags.push('merged'); }
    pairs.push(p);
  }
  for (const b of restN) {
    const p: RfpPair = { key: pairKey(undefined, b), status: 'added', next: b, tags: tagsFor(b) };
    const w = groupOf(b, prev);
    if (w) { p.group = { kind: 'split', keys: [w.key] }; p.tags.push('split'); }
    pairs.push(p);
  }

  // 정렬: 접두어 → 번호(이번 기준, 없으면 이전)
  const ref = (p: RfpPair) => (p.next ?? p.prev)!;
  pairs.sort((x, y) => {
    const a = ref(x), b = ref(y);
    return a.prefix.localeCompare(b.prefix) || a.seq - b.seq || (a.sub ?? 0) - (b.sub ?? 0) || (x.prev ? 0 : 1) - (y.prev ? 0 : 1);
  });
  const counts: Record<RfpPairStatus, number> = { same: 0, changed: 0, added: 0, removed: 0 };
  for (const p of pairs) counts[p.status]++;
  return { pairs, counts, prefixes: [...new Set(pairs.map((p) => ref(p).prefix))] };
}
