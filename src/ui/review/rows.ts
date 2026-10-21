/** 공고정보 검토 탭 표시 모델(순수 함수). 상태 판정은 core/extraction/review-rows의 leafReviewState만 쓴다. */
import { NA_VALUE_TEXT } from '../../core/extraction/review-count';
import {
  REVIEW_KIND, REVIEW_LABEL, REVIEW_ROWS, REVIEW_ROW_LABEL, isExtractionLeaf, leafReviewState, rowStateOf,
  type LeafJudgement, type LeafState, type ReviewLeafKey, type ReviewRowKey, type ReviewValueKind,
} from '../../core/extraction/review-rows';
import { getField } from '../../core/model/notice-fields';
import type { FieldSource, FieldValue } from '../../core/types/common';
import type { AiKey } from '../../core/ai/keys';
import type { EvidenceRef, Extraction } from '../../core/types/extraction';
import type { Notice } from '../../core/types/notice';
import type { AiCardInfo } from './ai-view';
import { formatAmountFull, formatDateTime, formatDifferential, formatPeriod, formatScore } from './format';
import { buildCard, evidenceMeta, fileDisplayName, type CandidateModel, type CardBadge } from './view';

export interface ReviewLeaf {
  key: ReviewLeafKey; label: string; kind: ReviewValueKind; origin: 'document' | 'notice';
  state: LeafState; reason?: string; editedOrigin?: 'ai' | 'confirm'; note?: string;
  value: unknown; valueText: string; raw?: string; autoValueText?: string; // autoValueText: user_edited이고 자동값과 다를 때만
  sourceKind: 'api' | 'html' | 'document' | 'user' | 'derived' | 'none'; sourceText: string;
  evidence?: EvidenceRef; evidenceText?: string; // 문서 잎 EvidenceRef, 공고 잎 source.evidence 문자열
  candidates: CandidateModel[];                  // 2개 이상일 때만 채움
  ai?: AiCardInfo; aiOthers?: AiCardInfo[];      // 이 잎의 AI 제안(공고 잎 포함)
  badge: CardBadge; userEdited: boolean;
  confirmable: boolean; // state==='needs_review' && value!=null && candidates.length<2
  aiFindable: boolean;  // state==='needs_review'
}
export interface ReviewRow { key: ReviewRowKey; label: string; state: LeafState; pendingCount: number; head: ReviewLeaf; sub: ReviewLeaf[] }
export interface RowSummary { total: number; pending: number; done: number; edited: number; notRun: number }

const isNil = (v: unknown): boolean => v === null || v === undefined;

export function formatLeafValue(kind: ReviewValueKind, value: unknown, raw?: string): string {
  if (isNil(value)) return '—';
  switch (kind) {
    case 'score': return formatScore(value);
    case 'period': return formatPeriod(value);
    case 'bool': return formatDifferential(value);
    case 'amount': return typeof value === 'number' ? formatAmountFull(value) : '—';
    case 'datetime': return typeof value === 'string' ? formatDateTime(value) : '—';
    case 'joint': {
      if (typeof value !== 'boolean') return '—';
      const t = value ? '허용' : '불허';
      return raw ? `${t} (${raw})` : t;
    }
    default: return typeof value === 'string' && value ? value : '—';
  }
}

/**
 * 문서에서 온 공고 필드 출처(ref = `첨부ID#위치`)를 추출 근거 모양으로 바꾼다.
 * 파일 이름과 읽을 수 있는 위치를 보여 주고 [원문에서 확인]으로 열 수 있게 한다
 */
function documentEvidence(src: FieldSource, notice: Notice, x: Extraction | null): EvidenceRef | null {
  const hash = src.ref.lastIndexOf('#');
  if (hash <= 0) return null;
  const attachmentId = src.ref.slice(0, hash);
  const location = src.ref.slice(hash + 1);
  const file = x?.files.find((f) => f.attachmentId === attachmentId);
  const att = notice.attachments.find((a) => a.id === attachmentId || attachmentId.endsWith(`:${a.id}`));
  return {
    attachmentId, location, evidence: src.evidence ?? '', ruleId: 'notice-field',
    sourceFile: file ? fileDisplayName(file) : (att?.originalName ?? '첨부 문서'),
    docKind: file?.docKind ?? att?.docKind ?? 'other',
    ...(src.page !== undefined ? { page: src.page } : {}),
  };
}

function noticeSourceText(src: FieldSource | undefined, state: LeafState, editedOrigin: 'ai' | 'confirm' | undefined, notice?: Notice, x?: Extraction | null): string {
  if (state === 'user_edited') return editedOrigin === 'confirm' ? '확인함' : editedOrigin === 'ai' ? 'AI 적용' : '직접 수정';
  if (!src) return '—';
  switch (src.kind) {
    case 'api': case 'derived': return '나라장터 공고정보';
    case 'html': return '나라장터 상세화면';
    case 'document': {
      const ev = notice ? documentEvidence(src, notice, x ?? null) : null;
      if (ev) return evidenceMeta(ev);
      return src.ref ? `문서, ${src.ref}` : '문서'; // `첨부ID#위치` 모양이 아닌 옛 출처
    }
    default: return '—';
  }
}

function buildLeaf(
  notice: Notice, x: Extraction | null, key: ReviewLeafKey,
  ai?: Partial<Record<AiKey, AiCardInfo>>, others?: Partial<Record<AiKey, AiCardInfo[]>>,
): ReviewLeaf {
  const kind = REVIEW_KIND[key];
  const j: LeafJudgement = leafReviewState(notice, x, key);
  const docItem = isExtractionLeaf(key) ? x?.items[key] : undefined;
  const origin: ReviewLeaf['origin'] = isExtractionLeaf(key) ? 'document' : 'notice';
  const f: FieldValue<unknown> | undefined = docItem ? undefined : getField(notice, key);
  const base = {
    key, label: REVIEW_LABEL[key], kind, origin, state: j.state, ...(j.reason ? { reason: j.reason } : {}),
    ...(j.editedOrigin ? { editedOrigin: j.editedOrigin } : {}), value: j.value,
  };
  let leaf: ReviewLeaf;
  if (docItem && x && isExtractionLeaf(key)) {
    const card = buildCard(key, docItem, x.items);
    const edited = j.state === 'user_edited';
    const autoOk = edited && j.editedOrigin !== 'confirm' && !isNil(docItem.value);
    leaf = {
      ...base, valueText: formatLeafValue(kind, j.value, docItem.raw),
      ...(docItem.raw !== undefined ? { raw: docItem.raw } : {}),
      ...(card.note ? { note: card.note } : {}),
      ...(autoOk ? { autoValueText: formatLeafValue(kind, docItem.value) } : {}),
      sourceKind: edited ? 'user' : docItem.evidence ? 'document' : 'none',
      sourceText: docItem.evidence ? evidenceMeta(docItem.evidence) : '찾지 못함',
      ...(docItem.evidence ? { evidence: docItem.evidence } : {}),
      candidates: card.candidates,
      confirmable: false, aiFindable: false, badge: 'needs_review', userEdited: false,
    };
  } else if (isExtractionLeaf(key) && !x) {
    leaf = {
      ...base, valueText: formatLeafValue(kind, j.value), sourceKind: j.state === 'user_edited' ? 'user' : 'none',
      sourceText: j.state === 'user_edited' ? noticeSourceText(undefined, j.state, j.editedOrigin) : '—', candidates: [],
      confirmable: false, aiFindable: false, badge: 'needs_review', userEdited: false,
    };
  } else {
    const before = f?.userEdit?.before;
    const autoOk = j.state === 'user_edited' && j.editedOrigin !== 'confirm' && before && !isNil(before.value);
    const cands = (f?.candidates ?? []).map((c) => ({
      value: c.value, valueText: formatLeafValue(kind, c.value), sourceText: noticeSourceText(c.source, 'needs_review', undefined, notice, x),
    }));
    leaf = {
      ...base, valueText: formatLeafValue(kind, j.value, f?.raw),
      ...(f?.raw !== undefined ? { raw: f.raw } : {}),
      ...(f?.userEdit?.note ? { note: f.userEdit.note } : {}),
      ...(autoOk ? { autoValueText: formatLeafValue(kind, before!.value) } : {}),
      sourceKind: j.state === 'user_edited' ? 'user' : (f?.source?.kind ?? 'none'),
      sourceText: noticeSourceText(f?.source, j.state, j.editedOrigin, notice, x),
      ...(f?.source?.evidence ? { evidenceText: f.source.evidence } : {}),
      // 문서에서 온 값은 근거로 붙여 [원문에서 확인]을 쓸 수 있게 한다(사용자가 고친 값은 제외)
      ...(f?.source?.kind === 'document' && f.source.evidence && j.state !== 'user_edited' ? (() => {
        const ev = documentEvidence(f.source, notice, x);
        return ev ? { evidence: ev } : {};
      })() : {}),
      candidates: cands.length >= 2 ? cands : [],
      confirmable: false, aiFindable: false, badge: 'needs_review', userEdited: false,
    };
  }
  if (leaf.state === 'not_applicable') leaf.valueText = NA_VALUE_TEXT;
  leaf.confirmable = leaf.state === 'needs_review' && !isNil(leaf.value) && leaf.candidates.length < 2;
  leaf.aiFindable = leaf.state === 'needs_review';
  leaf.userEdited = leaf.state === 'user_edited';
  leaf.badge = leaf.userEdited ? 'userEdited' : leaf.state === 'not_applicable' ? 'notApplicable' : leaf.state === 'covered' ? 'covered' : leaf.state === 'verified' ? 'verified' : 'needs_review';
  if (ai?.[key]) leaf.ai = ai[key];
  if (others?.[key]?.length) leaf.aiOthers = others[key];
  return leaf;
}

export function buildReviewRows(
  notice: Notice, x: Extraction | null,
  ai?: Partial<Record<AiKey, AiCardInfo>>, others?: Partial<Record<AiKey, AiCardInfo[]>>,
): ReviewRow[] {
  return REVIEW_ROWS.map((r) => {
    const head = buildLeaf(notice, x, r.key, ai, others);
    const sub = (r.sub ?? []).map((k) => buildLeaf(notice, x, k, ai, others));
    const all = [head, ...sub];
    return {
      key: r.key, label: REVIEW_ROW_LABEL[r.key] ?? REVIEW_LABEL[r.key], state: rowStateOf(all.map((l) => l.state)),
      pendingCount: all.filter((l) => l.state === 'needs_review').length, head, sub,
    };
  });
}

export function summarizeRows(rows: ReviewRow[]): RowSummary {
  const s: RowSummary = { total: 0, pending: 0, done: 0, edited: 0, notRun: 0 };
  for (const r of rows) {
    for (const l of [r.head, ...r.sub]) {
      s.total++;
      if (l.state === 'needs_review') s.pending++;
      else if (l.state === 'not_run') s.notRun++;
      else {
        s.done++;
        if (l.state === 'user_edited') s.edited++;
      }
    }
  }
  return s;
}

export function autoOpen(row: ReviewRow): boolean {
  if (row.state === 'needs_review') return true;
  return [row.head, ...row.sub].some((l) => {
    const sg = l.ai?.suggestion;
    return !!sg && (sg.verdict === 'differs' || sg.verdict === 'new' || sg.verdict === 'multi') && !sg.appliedAt && !sg.dismissedAt;
  });
}

export function nextPendingRowKey(rows: ReviewRow[], after?: ReviewRowKey): ReviewRowKey | null {
  const start = after ? rows.findIndex((r) => r.key === after) + 1 : 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[(start + i) % rows.length]!;
    if (r.pendingCount > 0) return r.key;
  }
  return null;
}
