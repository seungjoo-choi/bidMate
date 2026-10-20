import { EXTRACTION_KEYS } from '../types/extraction';
import type { EvidenceRef, ExtractedItem, ExtractionFileStatus, ExtractionKey, ExtractionStatus } from '../types/extraction';
import type { DocKind } from './classify';
import { compact } from './normalize';
import { parseQuantValue, QUANT_TABLE_EXTRA } from './quant-table';
import { itemReviewState } from './review-count';
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
  // "계약일로부터 180일"과 "계약일로부터 180일 이내"처럼 끝의 "이내"만 다른 값은 같은 값으로 본다.
  const s = compact(String(v)).replace(/이내$/, '');
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

/** 입찰공고 첨부 후보가 있으면 그것만으로 판정하고, 사전규격 후보는 값이 같든 다르든 candidates 뒤에만 붙인다(충돌을 만들지 않음). */
function decideOne(target: string, cands: Candidate[], rules: RuleSet): ExtractedItem<unknown> {
  const hasBid = cands.some((c) => c.evidence.origin !== 'prespec');
  const main = hasBid ? cands.filter((c) => c.evidence.origin !== 'prespec') : cands;
  const dropped = hasBid ? cands.filter((c) => c.evidence.origin === 'prespec') : [];
  const item = decideMain(target, main, rules);
  if (dropped.length) item.candidates = [...(item.candidates ?? []), ...dropped.map((c) => ({ value: c.value, raw: c.raw, evidence: c.evidence }))];
  return item;
}

function decideMain(target: string, cands: Candidate[], rules: RuleSet): ExtractedItem<unknown> {
  if (cands.length === 0) return { value: null, status: 'needs_review', reason: 'not_found' };
  const sorted = cands
    .map((c, i) => ({ c, i }))
    .sort((a, b) => a.c.priority - b.c.priority || (a.c.evidence.origin === 'prespec' ? 1 : 0) - (b.c.evidence.origin === 'prespec' ? 1 : 0) || b.c.weight - a.c.weight || a.i - b.i)
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

/** 정량평가 표를 완결된 형태로 찾았는데 실적/신인도/경영상태 행이 없으면 해당 항목을 not_found 대신 "해당 없음"(verified, value null)으로 판정한다. */
function applyQuantTable(items: Record<ExtractionKey, ExtractedItem<unknown>>, extras: Record<string, ExtractedItem<unknown>>): void {
  const qt = extras[QUANT_TABLE_EXTRA];
  if (!qt || qt.status !== 'verified' || !qt.evidence) return;
  const parsed = parseQuantValue(qt.value);
  if (!parsed) return;
  const evidence = qt.evidence;
  const qd = extras.quantEvalDoc;
  const doc = qd && qd.status === 'verified' && typeof qd.value === 'string' ? qd.value : '';
  const isNF = (k: ExtractionKey) => items[k].status === 'needs_review' && items[k].reason === 'not_found';
  const na = (k: ExtractionKey) => { items[k] = { value: null, status: 'verified', reason: 'not_applicable', raw: qt.raw, evidence }; };
  if (!parsed.cats.has('perf') && !/실적/.test(doc) && isNF('performanceScore')) {
    na('performanceScore');
    for (const k of ['performancePeriod', 'performanceMinAmount', 'performanceCondition'] as const) if (isNF(k)) na(k);
  }
  if (!parsed.cats.has('cred') && !/신인도/.test(doc) && isNF('credibilityScore') && (extras[BONUS_TABLE_EXTRA]?.value ?? null) === null) na('credibilityScore');
  if (!parsed.cats.has('mgmt') && !/경영|신용/.test(doc) && isNF('managementScore')) na('managementScore');
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
  applyQuantTable(items, extras);
  return { items, extras };
}

const NOT_PARSED_OK = new Set<ExtractionFileStatus>(['unsupported', 'scanned', 'encrypted', 'drm']);

/** 전체 상태. 파일 상태 목록(skipped 제외하고 판정)을 함께 받는다. */
export function computeStatus(items: Record<ExtractionKey, ExtractedItem<unknown>>, fileStatuses: ExtractionFileStatus[]): ExtractionStatus {
  if (!fileStatuses.includes('parsed')) {
    const rel = fileStatuses.filter((s) => s !== 'skipped');
    return rel.every((s) => NOT_PARSED_OK.has(s)) ? 'unsupported' : 'failed';
  }
  const ok = EXTRACTION_KEYS.every((k) => { const st = itemReviewState(items, k); return st === 'verified' || st === 'user_edited' || st === 'covered' || st === 'not_applicable'; });
  return ok ? 'verified' : 'needs_review';
}
