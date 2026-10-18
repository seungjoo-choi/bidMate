import type { Rule } from '../rules/schema';
import { expandTerm, hitFromUnit, origSlice, type Prepared, type RawHit, type Synonyms } from './common';

type R = Extract<Rule, { strategy: 'keyword-enum' }>;

/** 패턴의 `v` 그룹(없으면 매치 전체)을 map으로 값 변환한다. 교대 순서가 곧 우선순위.
 *  한 줄에 값이 여러 번 나오면 첫 값을 쓴다: 라벨 바로 뒤 값이 답이고, 뒤쪽 '적용'은 대개 다른 문장이다. */
export function keywordEnum(p: Prepared, rule: R, syn: Synonyms): RawHit[] {
  const re = new RegExp(expandTerm(rule.pattern, syn), 'g');
  const out: RawHit[] = [];
  for (const { u, m } of p.units) {
    let last: RegExpMatchArray | undefined;
    for (const x of m.c.matchAll(re)) {
      if (Object.prototype.hasOwnProperty.call(rule.map, x.groups?.v ?? x[0])) { last = x; break; }
    }
    if (!last) continue;
    out.push({
      ...hitFromUnit(u), value: rule.map[last.groups?.v ?? last[0]], raw: origSlice(m, last.index!, last.index! + last[0].length),
      evidence: u.text, context: u.text,
    });
  }
  return out;
}
