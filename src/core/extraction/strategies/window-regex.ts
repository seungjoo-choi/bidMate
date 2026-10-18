import { parseKoreanAmount } from '../normalize';
import type { Rule } from '../rules/schema';
import { expandTerm, hitFromUnit, origSlice, type Prepared, type RawHit, type Synonyms } from './common';

type R = Extract<Rule, { strategy: 'window-regex' }>;

function toValue(type: R['valueType'], v: string): unknown {
  switch (type) {
    case 'amount': return parseKoreanAmount(v);
    case 'years': return /^\d+$/.test(v) ? `${v}년` : v;
    case 'number': return Number(v.replace(/,/g, ''));
    default: return v;
  }
}

/** 앵커가 있는 줄부터 blocksAfter줄 뒤까지(앵커 줄 포함) compact 텍스트에 패턴을 적용한다. */
export function windowRegex(p: Prepared, rule: R, syn: Synonyms): RawHit[] {
  const anchorRe = new RegExp(expandTerm(rule.anchor, syn));
  const re = new RegExp(expandTerm(rule.pattern, syn), 'g');
  const units = p.units;
  const out: RawHit[] = [];
  for (let i = 0; i < units.length; i++) {
    if (!anchorRe.test(units[i]!.m.c)) continue;
    const window = units.slice(i, i + rule.blocksAfter + 1);
    const context = window.map((w) => w.u.text).join('\n');
    for (const { u, m } of window) {
      for (const x of m.c.matchAll(re)) {
        const v = toValue(rule.valueType, x.groups?.v ?? x[1] ?? x[0]);
        if (v === null || (typeof v === 'number' && Number.isNaN(v))) continue;
        out.push({
          ...hitFromUnit(u), value: v, raw: origSlice(m, x.index!, x.index! + x[0].length),
          evidence: u.text, context,
        });
      }
    }
  }
  return out;
}
