import type { DocKind } from '../../core/extraction/classify';
import { REVIEW_GROUPS, coveredByGroup } from '../../core/extraction/review-count';
import type { EvidenceRef, Extraction, ExtractionFile, ExtractionKey, ExtractedItem } from '../../core/types/extraction';
import { EXTRACTION_KEYS } from '../../core/types/extraction';
import type { AiCardInfo } from './ai-view';
import { formatAmountFull, formatDifferential, formatPeriod, formatScore } from './format';

export type ValueKind = 'score' | 'period' | 'amount' | 'text' | 'bool';
export type CardBadge = 'verified' | 'needs_review' | 'userEdited' | 'covered';

export const ITEM_LABEL: Record<ExtractionKey, string> = {
  credibilityScore: '대외신인도 배점', managementScore: '경영상태 배점', performanceScore: '수행실적 배점', performancePeriod: '실적 인정기간',
  performanceMinAmount: '실적 인정금액', performanceCondition: '실적 인정조건', differentialScoring: '차등점수제',
};
export const ITEM_KIND: Record<ExtractionKey, ValueKind> = {
  credibilityScore: 'score', managementScore: 'score', performanceScore: 'score', performancePeriod: 'period',
  performanceMinAmount: 'amount', performanceCondition: 'text', differentialScoring: 'bool',
};

export const NOT_RUN_TEXT = '이전 버전 결과, 다시 추출 필요';
export const REASON_TEXT: Record<string, string> = {
  not_found: '문서에서 찾지 못함', conflict: '문서 간 값 다름', multi: '조건별로 값이 다름', low_confidence: '질의답변에만 있음', no_documents: '분석할 문서 없음',
  no_total: '가감점 표만 있음, 합계 배점 없음',
};
export const reasonText = (r: string | undefined): string | undefined => (r ? REASON_TEXT[r] : undefined);

export function formatItemValue(key: ExtractionKey, value: unknown): string {
  if (value === null || value === undefined) return '—';
  switch (ITEM_KIND[key]) {
    case 'score': return formatScore(value);
    case 'period': return formatPeriod(value);
    case 'amount': return typeof value === 'number' ? formatAmountFull(value) : '—';
    case 'bool': return formatDifferential(value);
    default: return typeof value === 'string' && value ? value : '—';
  }
}

export function evidenceMeta(e: EvidenceRef): string {
  const parts = [e.sourceFile, e.location];
  if (e.page !== undefined) parts.push(`${e.page}쪽`);
  return parts.filter(Boolean).join(', ');
}

export interface CandidateModel { value: unknown; valueText: string; evidence: EvidenceRef; sourceText: string }
export interface CardModel {
  key: ExtractionKey; label: string; kind: ValueKind; badge: CardBadge;
  reason?: string; value: unknown; valueText: string;
  evidence?: EvidenceRef; candidates: CandidateModel[]; userEdited: boolean; note?: string;
  /** 사용자 수정이 AI 제안 적용에서 온 경우 */
  editedOrigin?: 'ai';
  /** 이 항목의 AI 제안(non-stale done run). 항목 값에는 영향이 없다 */
  ai?: AiCardInfo;
}

/** 직접 수정 배지 글자. AI 제안을 적용한 수정이면 "AI 제안 적용" */
export const userEditedBadgeText = (c: Pick<CardModel, 'editedOrigin'>): string => (c.editedOrigin === 'ai' ? 'AI 제안 적용' : '직접 수정');

export function buildCard(key: ExtractionKey, item: ExtractedItem<unknown>, items?: Record<ExtractionKey, ExtractedItem<unknown>>): CardModel {
  const edited = item.userEdited !== undefined;
  const covered = !edited && items !== undefined && coveredByGroup(items, key);
  const coverKey = covered ? REVIEW_GROUPS.find((g) => g.includes(key))?.find((m) => m !== key && (items![m].status === 'verified' || items![m].userEdited !== undefined)) : undefined;
  const value = edited ? item.userEdited!.value : item.value;
  const badge: CardBadge = edited ? 'userEdited' : covered ? 'covered' : item.status === 'verified' ? 'verified' : 'needs_review';
  const candidates = (item.candidates ?? []).map((c) => {
    const valueText = formatItemValue(key, c.value);
    return {
      value: c.value, valueText, evidence: c.evidence,
      sourceText: `${c.evidence.sourceFile}, ${c.evidence.location}${c.evidence.page !== undefined ? `, ${c.evidence.page}쪽` : ''}`,
    };
  });
  return {
    key, label: ITEM_LABEL[key], kind: ITEM_KIND[key], badge,
    reason: badge === 'covered' && coverKey ? `문서에 없음 (${ITEM_LABEL[coverKey]} 항목으로 충족)` : badge === 'needs_review' ? (item.status === 'not_run' ? NOT_RUN_TEXT : reasonText(item.reason)) : undefined,
    value, valueText: formatItemValue(key, value),
    evidence: item.evidence, candidates: candidates.length >= 2 ? candidates : [],
    userEdited: edited, note: item.userEdited?.note,
    ...(item.userEdited?.origin?.kind === 'ai' ? { editedOrigin: 'ai' as const } : {}),
  };
}

/** 확인 필요 항목이 먼저, 다음 충족(그룹), 나머지. 같은 등급은 EXTRACTION_KEYS 순서를 유지한다. */
const rankOf = (b: CardBadge): number => (b === 'needs_review' ? 0 : b === 'covered' ? 1 : 2);

export function buildCards(ex: Extraction, ai?: Partial<Record<ExtractionKey, AiCardInfo>>): CardModel[] {
  const cards = EXTRACTION_KEYS.filter((k) => ex.items[k]).map((k) => ({ ...buildCard(k, ex.items[k], ex.items), ...(ai?.[k] ? { ai: ai[k] } : {}) }));
  return cards
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rankOf(a.c.badge) - rankOf(b.c.badge) || a.i - b.i)
    .map((x) => x.c);
}

export interface SummaryCounts { verified: number; needsReview: number; edited: number; covered: number }
export function summarize(ex: Extraction): SummaryCounts {
  const s: SummaryCounts = { verified: 0, needsReview: 0, edited: 0, covered: 0 };
  for (const c of buildCards(ex)) {
    if (c.badge === 'userEdited') s.edited++;
    else if (c.badge === 'verified') s.verified++;
    else if (c.badge === 'covered') s.covered++;
    else s.needsReview++;
  }
  return s;
}

export const DOC_KIND_LABEL: Record<DocKind, string> = {
  eval_criteria: '평가기준', notice: '공고문', rfp: '제안요청서', qna: '질의답변', other: '기타', form: '양식', reference: '참고',
};
export const SKIP_REASON_TEXT: Record<string, string> = {
  duplicate: 'PDF 사본(같은 HWP 분석)', excluded: '양식/참고자료', budget: '시간 예산 초과',
  too_large: '크기 초과', not_saved: '다운로드 안 됨', unsupported_ext: '지원하지 않는 형식',
};
export const FILE_STATUS_LABEL: Record<string, string> = {
  parsed: '분석 완료', unsupported: '미지원', encrypted: '암호 문서', drm: '배포용 문서', scanned: '스캔 문서',
  corrupt: '손상', failed: '실패', timeout: '시간 초과', skipped: '건너뜀', cancelled: '취소됨',
};

export function fileDisplayName(f: ExtractionFile): string {
  return f.innerPath ? `${f.name} › ${f.innerPath}` : f.name;
}

export function fileRemark(f: ExtractionFile): string {
  const parts: string[] = [];
  if (f.skipReason) parts.push(SKIP_REASON_TEXT[f.skipReason] ?? f.skipReason);
  if (f.status === 'scanned') parts.push('스캔 문서(글자 없음)');
  else if (f.status === 'encrypted' || f.status === 'drm') parts.push('암호/배포용 문서');
  if (f.error) parts.push(f.error);
  return parts.join(' / ');
}

export function filePagesTables(f: ExtractionFile): string {
  const p = f.pages !== undefined ? `${f.pages}쪽` : '—';
  const t = f.tables !== undefined ? `${f.tables}표` : '—';
  return `${p}, ${t}`;
}

/** 근거의 첨부 파일(zip이면 내부 경로까지)에 해당하는 추출 텍스트 경로를 찾는다. */
export function findTextPath(files: ExtractionFile[], e: EvidenceRef): string | undefined {
  const same = files.filter((f) => f.attachmentId === e.attachmentId && f.textPath);
  const exact = same.find((f) => f.innerPath === e.sourceFile || f.name === e.sourceFile || fileDisplayName(f).endsWith(e.sourceFile));
  return (exact ?? same[0])?.textPath;
}
