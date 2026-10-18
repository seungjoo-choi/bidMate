import { EXTRACTION_KEYS } from '../types/extraction';
import type { EvidenceRef, ExtractedItem, ExtractionFileStatus, ExtractionKey, ExtractionStatus } from '../types/extraction';
import type { DocKind } from './classify';
import { compact } from './normalize';
import type { RuleSet } from './rules/schema';

export interface Candidate {
  target: string; value: unknown; raw?: string; evidence: EvidenceRef; priority: number; weight: number; docKind: DocKind;
}
export interface Decision {
  items: Record<ExtractionKey, ExtractedItem<unknown>>;
  extras: Record<string, ExtractedItem<unknown>>;
}

/** 값 비교 키: number/boolean은 그대로, "N년"은 연수, string은 compact 앞 40자. */
function valueKey(v: unknown): string {
  if (typeof v === 'number') return `n:${v}`;
  if (typeof v === 'boolean') return `b:${v}`;
  const s = compact(String(v));
  const y = /^(\d+)년$/.exec(s);
  return y ? `n:${y[1]}y` : `s:${s.slice(0, 40)}`;
}

function decideOne(cands: Candidate[], rules: RuleSet): ExtractedItem<unknown> {
  if (cands.length === 0) return { value: null, status: 'needs_review', reason: 'not_found' };
  const sorted = cands
    .map((c, i) => ({ c, i }))
    .sort((a, b) => a.c.priority - b.c.priority || b.c.weight - a.c.weight || a.i - b.i)
    .map((x) => x.c);
  const top = sorted[0]!;
  const toRef = (c: Candidate) => ({ value: c.value, raw: c.raw, evidence: c.evidence });
  const keys = new Set(sorted.map((c) => valueKey(c.value)));
  if (keys.size === 1) {
    const item: ExtractedItem<unknown> = { value: top.value, raw: top.raw, evidence: top.evidence, status: 'verified' };
    if (sorted.length > 1) item.candidates = sorted.slice(1).map(toRef);
    if (sorted.every((c) => c.docKind === 'qna')) { item.status = 'needs_review'; item.reason = 'low_confidence'; }
    return item;
  }
  const prefer = sorted.some((c) => rules.rules.find((r) => r.id === c.evidence.ruleId)?.conflictPolicy === 'prefer_priority');
  const candidates = sorted.map(toRef);
  if (prefer) return { value: top.value, raw: top.raw, evidence: top.evidence, status: 'needs_review', reason: 'conflict', candidates };
  return { value: null, status: 'needs_review', reason: 'conflict', candidates };
}

export function decide(cands: Candidate[], rules: RuleSet): Decision {
  const by = new Map<string, Candidate[]>();
  for (const c of cands) {
    const l = by.get(c.target);
    if (l) l.push(c); else by.set(c.target, [c]);
  }
  const items = {} as Record<ExtractionKey, ExtractedItem<unknown>>;
  for (const k of EXTRACTION_KEYS) items[k] = decideOne(by.get(k) ?? [], rules);
  const extras: Record<string, ExtractedItem<unknown>> = Object.create(null);
  for (const [t, list] of by) if (t.startsWith('extras.')) extras[t.slice(7)] = decideOne(list, rules);
  // 규칙은 있는데 후보가 없는 extras도 not_found로 남긴다.
  for (const r of rules.rules) {
    if (r.target.startsWith('extras.') && !(r.target.slice(7) in extras)) extras[r.target.slice(7)] = decideOne([], rules);
  }
  return { items, extras };
}

const NOT_PARSED_OK = new Set<ExtractionFileStatus>(['unsupported', 'scanned', 'encrypted', 'drm']);

/** 전체 상태. 파일 상태 목록(skipped 제외하고 판정)을 함께 받는다. */
export function computeStatus(items: Record<ExtractionKey, ExtractedItem<unknown>>, fileStatuses: ExtractionFileStatus[]): ExtractionStatus {
  if (!fileStatuses.includes('parsed')) {
    const rel = fileStatuses.filter((s) => s !== 'skipped');
    return rel.every((s) => NOT_PARSED_OK.has(s)) ? 'unsupported' : 'failed';
  }
  const ok = EXTRACTION_KEYS.every((k) => items[k].status === 'verified' || items[k].userEdited !== undefined);
  return ok ? 'verified' : 'needs_review';
}
