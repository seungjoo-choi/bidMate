import { EXTRACTION_KEYS } from '../types/extraction';
import type { EvidenceRef, ExtractedItem, ExtractionFileStatus, ExtractionKey, ExtractionStatus } from '../types/extraction';
import type { DocKind } from './classify';
import { compact } from './normalize';
import { coveredByGroup } from './review-count';
import type { RuleSet } from './rules/schema';

export interface Candidate {
  target: string; value: unknown; raw?: string; evidence: EvidenceRef; priority: number; weight: number; docKind: DocKind;
}
export interface Decision {
  items: Record<ExtractionKey, ExtractedItem<unknown>>;
  extras: Record<string, ExtractedItem<unknown>>;
}

/** 값 비교 키: number/boolean은 그대로, "N년"은 연수, string은 compact 앞 40자. */
export function valueKey(v: unknown): string {
  if (typeof v === 'number') return `n:${v}`;
  if (typeof v === 'boolean') return `b:${v}`;
  const s = compact(String(v));
  const y = /^(\d+)년$/.exec(s);
  return y ? `n:${y[1]}y` : `s:${s.slice(0, 40)}`;
}

/** 한 줄에서 조건 구분자(△, ①~⑳, " / ")와 함께 서로 다른 금액 후보가 2개 이상 나온 경우(조건별로 값이 다른 것이지 문서 간 충돌이 아님). */
const CONDITION_MARK = /[△▲①-⑳]|\s\/\s/;
function isMultiCondition(target: string, cands: Candidate[]): boolean {
  if (target !== 'performanceMinAmount') return false;
  const byLine = new Map<string, Candidate[]>();
  for (const c of cands) {
    const k = `${c.evidence.attachmentId}|${c.evidence.sourceFile}|${c.evidence.line ?? c.evidence.location}`;
    const l = byLine.get(k);
    if (l) l.push(c); else byLine.set(k, [c]);
  }
  return [...byLine.values()].some((l) => new Set(l.map((c) => valueKey(c.value))).size >= 2 && l.some((c) => CONDITION_MARK.test(c.evidence.evidence)));
}

function decideOne(target: string, cands: Candidate[], rules: RuleSet): ExtractedItem<unknown> {
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
  const reason = isMultiCondition(target, sorted) ? 'multi' : 'conflict';
  if (prefer) return { value: top.value, raw: top.raw, evidence: top.evidence, status: 'needs_review', reason, candidates };
  return { value: null, status: 'needs_review', reason, candidates };
}

/** 가감점 표만 있고 합계 배점이 없는 경우, 신인도를 not_found 대신 no_total로 바꾼다(숫자는 만들지 않는다). */
export const BONUS_TABLE_EXTRA = 'bonusTable';
function applyBonusTable(items: Record<ExtractionKey, ExtractedItem<unknown>>, extras: Record<string, ExtractedItem<unknown>>): void {
  const cur = items.credibilityScore;
  const bt = extras[BONUS_TABLE_EXTRA];
  if (cur.status !== 'needs_review' || cur.reason !== 'not_found' || !bt || bt.value === null) return;
  items.credibilityScore = { value: null, status: 'needs_review', reason: 'no_total', raw: String(bt.raw ?? bt.value), evidence: bt.evidence };
}

export function decide(cands: Candidate[], rules: RuleSet): Decision {
  const by = new Map<string, Candidate[]>();
  for (const c of cands) {
    const l = by.get(c.target);
    if (l) l.push(c); else by.set(c.target, [c]);
  }
  const items = {} as Record<ExtractionKey, ExtractedItem<unknown>>;
  for (const k of EXTRACTION_KEYS) items[k] = decideOne(k, by.get(k) ?? [], rules);
  const extras: Record<string, ExtractedItem<unknown>> = Object.create(null);
  for (const [t, list] of by) if (t.startsWith('extras.')) extras[t.slice(7)] = decideOne(t, list, rules);
  // 규칙은 있는데 후보가 없는 extras도 not_found로 남긴다.
  for (const r of rules.rules) {
    if (r.target.startsWith('extras.') && !(r.target.slice(7) in extras)) extras[r.target.slice(7)] = decideOne(r.target, [], rules);
  }
  applyBonusTable(items, extras);
  return { items, extras };
}

const NOT_PARSED_OK = new Set<ExtractionFileStatus>(['unsupported', 'scanned', 'encrypted', 'drm']);

/** 전체 상태. 파일 상태 목록(skipped 제외하고 판정)을 함께 받는다. */
export function computeStatus(items: Record<ExtractionKey, ExtractedItem<unknown>>, fileStatuses: ExtractionFileStatus[]): ExtractionStatus {
  if (!fileStatuses.includes('parsed')) {
    const rel = fileStatuses.filter((s) => s !== 'skipped');
    return rel.every((s) => NOT_PARSED_OK.has(s)) ? 'unsupported' : 'failed';
  }
  const ok = EXTRACTION_KEYS.every((k) => items[k].status === 'verified' || items[k].userEdited !== undefined || coveredByGroup(items, k));
  return ok ? 'verified' : 'needs_review';
}
