import type { Rule } from '../rules/schema';
import { expandTerm, hitFromUnit, origSlice, type Prepared, type RawHit, type Synonyms } from './common';

type R = Extract<Rule, { strategy: 'inline-score' }>;

/** `{라벨}[^0-9]{0,gap}?(N)점` 형태만 인정한다. 라벨 없이 "N점"만 있으면 후보가 아니다. */
export function inlineScore(p: Prepared, rule: R, syn: Synonyms): RawHit[] {
  const re = new RegExp(`${expandTerm(rule.label, syn)}[^0-9]{0,${rule.maxGap}}?(\\d+(?:\\.\\d+)?)점`, 'g');
  const excludeRe = rule.excludeLabel ? new RegExp(expandTerm(rule.excludeLabel, syn)) : null;
  const out: RawHit[] = [];
  for (const { u, m } of p.units) {
    for (const x of m.c.matchAll(re)) {
      if (Number(x[1]) === 0) continue; // "0점 처리"는 배점이 아니다
      // "수행실적 및 경영상태 4점"처럼 상대 항목이 같은 점수에 묶여 있으면 어느 한쪽의 배점이 아니다.
      // 앞 문맥은 15자 안에서 마지막 숫자 뒤만 본다("경영상태 5점, 수행실적 6점"의 6점은 유지).
      const before = m.c.slice(Math.max(0, x.index! - 15), x.index!).replace(/^.*\d/, '');
      if (excludeRe && excludeRe.test(before + x[0])) continue;
      out.push({
        ...hitFromUnit(u), value: Number(x[1]), raw: origSlice(m, x.index!, x.index! + x[0].length),
        evidence: u.text, context: u.text,
      });
    }
  }
  return out;
}
