import { formatAmountComma, formatAmountShort, formatDateSlash, formatDateTimeSlash, formatJoint, formatPeriod, formatScore, formatDifferential } from '../model/format';
import { ALL_FIELD_KEYS, getField } from '../model/notice-fields';
import { NA_VALUE_TEXT, fieldCoveringKey, isNotApplicableField } from '../extraction/review-count';
import type { FieldValue } from '../types/common';
import type { ExtractionKey } from '../types/extraction';
import type { ResolvedValue } from '../types/mail';
import type { Notice, NoticeFieldKey } from '../types/notice';
import type { TemplateFieldKey } from '../types/template';
import { jointVentureText, resolveComposite } from './composites';
import { VARIABLE_BY_KEY, type VariableKind } from './variables';

export const NEEDS_REVIEW_TEXT = '확인 필요';

/** 그룹 충족인데 추출 설명(note)이 없을 때 쓰는 사유. */
export const COVERED_TEXT = '별도 배점 없음';

const NA_KEYS: string[] = ['performanceScore', 'performancePeriod', 'performanceMinAmount', 'performanceCondition', 'credibilityScore', 'managementScore', 'differentialScoring', 'proposalEvalAt'];

const MISSING: ResolvedValue = { text: NEEDS_REVIEW_TEXT, status: 'missing', raw: null };

export function formatByKind(kind: VariableKind, value: unknown): string {
  switch (kind) {
    case 'amount': return typeof value === 'number' ? formatAmountComma(value) : '';
    case 'amount_short': {
      const t = typeof value === 'number' ? formatAmountShort(value) : '';
      return t === '—' ? '' : t;
    }
    case 'datetime': return typeof value === 'string' ? (formatDateTimeSlash(value) || value.trim()) : '';
    case 'date': return typeof value === 'string' ? (formatDateSlash(value) || value.trim()) : '';
    case 'bool_joint': return typeof value === 'boolean' ? formatJoint(value) : '';
    case 'bool_apply': return typeof value === 'boolean' ? formatDifferential(value) : '';
    case 'score': return typeof value === 'number' ? formatScore(value) : '';
    case 'period': return formatPeriod(value) === '—' ? '' : formatPeriod(value);
    case 'number': return typeof value === 'number' ? String(Math.trunc(value)) : '';
    default: return typeof value === 'string' ? value.trim() : (value === null || value === undefined ? '' : String(value).trim());
  }
}

function fromFieldValue(fv: FieldValue<unknown> | undefined, kind: VariableKind): ResolvedValue {
  if (!fv || fv.status === 'missing' || fv.value === null || fv.value === undefined) return { ...MISSING, raw: fv?.value ?? null };
  const text = formatByKind(kind, fv.value);
  if (!text) return { ...MISSING, raw: fv.value };
  if (fv.status === 'needs_review') return { text: `${text} (${NEEDS_REVIEW_TEXT})`, status: 'needs_review', raw: fv.value };
  return { text, status: 'ok', raw: fv.value };
}

/** 첨부 한 줄 표기. */
function attachmentLine(a: Notice['attachments'][number]): string {
  if (a.status === 'failed' || a.status === 'size_mismatch') return `${a.originalName} (다운로드 실패)`;
  if (a.status === 'pending' || a.status === 'downloading' || a.status === 'skipped') return `${a.originalName} (미확보)`;
  return a.originalName;
}

/** 한국 시간 기준 YYYYMMDD(예: 20261019). */
export function formatToday(now: Date): string {
  const k = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return `${k.getUTCFullYear()}${String(k.getUTCMonth() + 1).padStart(2, '0')}${String(k.getUTCDate()).padStart(2, '0')}`;
}

/** 공고에서 템플릿 필드 값을 해석한다. attachmentList의 raw는 줄 배열(string[]). today는 now(메일 내용을 만드는 시각)로 정한다. */
export function resolveValue(notice: Notice, fieldKey: TemplateFieldKey, now: Date = new Date()): ResolvedValue {
  if (fieldKey.startsWith('custom.')) {
    const key = fieldKey.slice('custom.'.length);
    return fromFieldValue(notice.customFields && Object.hasOwn(notice.customFields, key) ? notice.customFields[key] : undefined, 'text');
  }
  switch (fieldKey) {
    case 'sourceUrl': return fromFieldValue(notice.sourceUrl, 'url');
    case 'collectedAt': {
      const text = formatDateTimeSlash(notice.collect?.collectedAt);
      return text ? { text, status: 'ok', raw: notice.collect.collectedAt } : { ...MISSING };
    }
    case 'today': {
      const text = formatToday(now);
      return { text, status: 'ok', raw: text };
    }
    case 'isCorrection': return { text: notice.isCorrection ? '정정공고' : '', status: 'ok', raw: notice.isCorrection };
    case 'attachmentCount': return { text: String(notice.attachments.length), status: 'ok', raw: notice.attachments.length };
    case 'attachmentList': {
      const lines = [...notice.attachments].sort((a, b) => a.index - b.index).map(attachmentLine);
      return lines.length === 0 ? { text: '첨부 없음', status: 'ok', raw: [] } : { text: lines.join('\n'), status: 'ok', raw: lines };
    }
    case 'credibilityEval':
    case 'performanceEval':
    case 'evalMethodText': return resolveComposite(notice, fieldKey, (k) => resolveValue(notice, k, now));
    case 'jointVentureAllowed': return jointVentureText(notice.basic.jointVentureAllowed);
    default: {
      if (!(ALL_FIELD_KEYS as string[]).includes(fieldKey)) return { ...MISSING };
      const kind = VARIABLE_BY_KEY.get(fieldKey)?.kind ?? 'text';
      const fv = getField(notice, fieldKey as NoticeFieldKey);
      if (NA_KEYS.includes(fieldKey) && isNotApplicableField(fv)) return { text: NA_VALUE_TEXT, status: 'ok', raw: null };
      // 대외신인도/경영상태 중 한쪽 배점만 있으면 다른 쪽은 확인 필요 대신 사유를 쓴다(검토 탭의 그룹 충족과 같은 뜻).
      if (fieldKey === 'credibilityScore' || fieldKey === 'managementScore') {
        if (fieldCoveringKey(notice.evaluation as Partial<Record<ExtractionKey, FieldValue<unknown>>>, fieldKey)) {
          return { text: fv?.note?.trim() || COVERED_TEXT, status: 'ok', raw: fv?.value ?? null };
        }
      }
      return fromFieldValue(fv, kind);
    }
  }
}
