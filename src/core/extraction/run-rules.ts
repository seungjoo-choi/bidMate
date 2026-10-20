import type { DocModel } from '../doc/model';
import { renderText } from '../doc/render-text';
import type { EvidenceRef } from '../types/extraction';
import type { AttachmentOrigin } from '../types/notice';
import type { DocKind } from './classify';
import { answersOnly } from './qna';
import type { Candidate } from './decide';
import type { Rule, RuleSet } from './rules/schema';
import { blockCapture } from './strategies/block-capture';
import { bonusTable } from './strategies/bonus-table';
import { prepare, type Prepared, type RawHit } from './strategies/common';
import { inlineScore } from './strategies/inline-score';
import { keywordEnum } from './strategies/keyword-enum';
import { quantTable } from './strategies/quant-table';
import { tableScore } from './strategies/table-score';
import { windowRegex } from './strategies/window-regex';

export interface RuleDocInput { doc: DocModel; attachmentId: string; sourceFile: string; docKind: DocKind; priority: number; origin?: AttachmentOrigin }

function runStrategy(doc: Prepared, rule: Rule, syn: RuleSet['synonyms']): RawHit[] {
  switch (rule.strategy) {
    case 'table-score': return tableScore(doc, rule, syn);
    case 'inline-score': return inlineScore(doc, rule, syn);
    case 'keyword-enum': return keywordEnum(doc, rule, syn);
    case 'window-regex': return windowRegex(doc, rule, syn);
    case 'block-capture': return blockCapture(doc, rule, syn);
    case 'bonus-table': return bonusTable(doc, rule, syn);
    case 'quant-table': return quantTable(doc, rule, syn);
  }
}

export interface RunResult { candidates: Candidate[]; warnings: string[] }

/** 문서별로 모든 규칙을 실행해 후보를 만든다(문서 입력 순 → 규칙 순 → 문서 내 등장순). 규칙 단위로 격리해, 예외가 나면 warning만 남기고 다음 규칙으로 넘어간다. */
export function runRules(inputs: RuleDocInput[], rules: RuleSet): RunResult {
  const out: Candidate[] = [];
  const warnings: string[] = [];
  for (const inp of inputs) {
    renderText(inp.doc); // loc.line 채우기(질문 행을 빼기 전 원문 기준이어야 전체 텍스트 줄과 맞는다)
    const { prepared, warnings: pw } = prepare(inp.docKind === 'qna' ? answersOnly(inp.doc) : inp.doc);
    warnings.push(...pw.map((w) => `${inp.sourceFile}: ${w}`));
    for (const rule of rules.rules) {
      if (rule.docKinds && !rule.docKinds.includes(inp.docKind)) continue;
      let hits: RawHit[];
      try {
        hits = runStrategy(prepared, rule, rules.synonyms);
      } catch (e) {
        warnings.push(`규칙 ${rule.id} 건너뜀(${inp.sourceFile}): ${(e as Error).message}`);
        continue;
      }
      const seen = new Set<string>();
      for (const h of hits) {
        const key = `${h.location}\u0000${JSON.stringify(h.value)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const evidence: EvidenceRef = {
          attachmentId: inp.attachmentId, sourceFile: inp.sourceFile, location: h.location,
          evidence: h.evidence.slice(0, 300), ruleId: rule.id, docKind: inp.docKind,
          ...(inp.origin ? { origin: inp.origin } : {}),
        };
        if (h.page !== undefined) evidence.page = h.page;
        if (h.sheet !== undefined) evidence.sheet = h.sheet;
        if (h.line !== undefined) evidence.line = h.line;
        if (h.context !== undefined) evidence.context = h.context.slice(0, 400);
        out.push({ target: rule.target, value: h.value, raw: h.raw, evidence, priority: inp.priority, weight: rule.weight ?? 1, docKind: inp.docKind });
      }
    }
  }
  return { candidates: out, warnings };
}
