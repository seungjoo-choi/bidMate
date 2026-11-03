import type { Rule } from '../rules/schema';
import { expandTerm, hitFromUnit, type Prepared, type RawHit, type Synonyms } from './common';

type R = Extract<Rule, { strategy: 'block-capture' }>;

/** 문서 끝 표시("/끝/", "-끝-", "<끝>", "끝.") 줄. 값에 넣지 않는다. */
const END_MARK = /^[/\-<(\[]?끝[/\->)\].]?$/;

/** 앵커 줄부터 stopAt에 맞는 줄 직전(앵커 자신은 제외 판정)까지, 최대 maxBlocks줄/maxChars자를 원문으로 캡처한다.
 *  직전 캡처 범위 안의 앵커는 건너뛰고, 본문이 없는 캡처(앵커 줄이 20자 미만이거나, 바로 다음 줄이 stopAt인데 앵커 줄에 콜론 뒤 내용이 없는 목차/제목)는 버린다. */
/** 앵커 뒤의 콜론 다음에 8자 이상 본문이 있는지. 다른 문서를 가리키기만 하는 안내("… 제안요청서 Ⅲ.3 참조")는 본문이 아니다. */
function hasInlineBody(line: string, anchorRe: RegExp): boolean {
  const m = anchorRe.exec(line);
  if (!m) return false;
  const tail = line.slice(m.index);
  const ci = tail.search(/[:：]/);
  if (ci < 0) return false;
  const body = tail.slice(ci + 1);
  return body.length >= 8 && !/참조|참고하|따름|따른다|제안요청서에/.test(body);
}

export function blockCapture(p: Prepared, rule: R, syn: Synonyms): RawHit[] {
  const anchorRe = new RegExp(expandTerm(rule.anchor, syn));
  const stopRe = new RegExp(expandTerm(rule.stopAt, syn));
  const units = p.units;
  const out: RawHit[] = [];
  for (let i = 0; i < units.length;) {
    if (!anchorRe.test(units[i]!.m.c)) { i++; continue; }
    let j = i + 1;
    while (j < units.length && j - i < rule.maxBlocks && !stopRe.test(units[j]!.m.c)) j++;
    const hasBody = j > i + 1;
    const stoppedNow = j < units.length && j === i + 1 && stopRe.test(units[j]!.m.c);
    // 한 줄짜리라도 "실적 인정 범위 : 결제 …"처럼 콜론 뒤에 내용이 있으면 제목이 아니라 본문이다.
    const inlineBody = hasInlineBody(units[i]!.m.c, anchorRe);
    // 콜론 뒤 본문이 있으면 20자 미만이어도 정의 한 줄이다("- 유사용역 : 어업피해영향 조사 용역").
    const keep = hasBody || inlineBody || (units[i]!.m.c.length >= 20 && !stoppedNow);
    if (keep) {
      const text = units.slice(i, j).filter((x) => !END_MARK.test(x.m.c)).map((x) => x.u.text).join('\n').slice(0, rule.maxChars);
      out.push({ ...hitFromUnit(units[i]!.u), value: text, raw: text, evidence: text, context: text });
    }
    i = j;
  }
  return out;
}
