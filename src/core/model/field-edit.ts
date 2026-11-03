import { VARIABLE_BY_KEY } from '../templates/variables';
import type { FieldValue } from '../types/common';
import { EXTRACTION_KEYS, type ExtractionKey } from '../types/extraction';
import type { ReviewLeafKey } from '../extraction/review-rows';
import type { NoticeFieldKey } from '../types/notice';
import type { TemplateFieldKey } from '../types/template';
import { parseAmount } from './amount';
import { toIsoKst } from './dates';
import { ALL_FIELD_KEYS } from './notice-fields';

export type EditableKey = NoticeFieldKey | `custom.${string}`;
export const NON_EDITABLE_NOTICE_KEYS: ReadonlySet<NoticeFieldKey> = new Set<NoticeFieldKey>(['noticeNo', 'round', 'priceEvalRate']);
export const CUSTOM_KEY_RE = /^custom\.[\w가-힣-]{1,40}$/;

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const DATETIME_HINT = '2026-10-21 18:00 형식으로 입력하세요';

export function isEditableKey(k: unknown): k is EditableKey {
  if (typeof k !== 'string') return false;
  if (k.startsWith('custom.')) return CUSTOM_KEY_RE.test(k);
  return (ALL_FIELD_KEYS as string[]).includes(k) && !NON_EDITABLE_NOTICE_KEYS.has(k as NoticeFieldKey);
}

export type EditInputKind = 'text' | 'longtext' | 'amount' | 'datetime' | 'bool_joint' | 'score' | 'period' | 'amount_short' | 'bool_apply';

const LONGTEXT_KEYS = new Set<string>(['eligibility', 'performanceCondition', 'evalMethodDoc', 'proposalPeriod']);

export function inputKindOf(key: EditableKey): EditInputKind {
  if (key.startsWith('custom.')) return 'text';
  if (LONGTEXT_KEYS.has(key)) return 'longtext';
  const kind = VARIABLE_BY_KEY.get(key as TemplateFieldKey)?.kind;
  switch (kind) {
    case 'score': case 'period': case 'amount_short': case 'bool_apply': case 'amount': case 'bool_joint': return kind;
    case 'datetime': case 'date': return 'datetime';
    default: return 'text';
  }
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const VALUE_CHECK: Record<ExtractionKey, (v: unknown) => boolean> = {
  credibilityScore: (v) => finite(v) && v >= 0 && v <= 1000,
  managementScore: (v) => finite(v) && v >= 0 && v <= 1000,
  performanceScore: (v) => finite(v) && v >= 0 && v <= 1000,
  performancePeriod: (v) => typeof v === 'string' && /^\d{1,2}년$/.test(v),
  performanceMinAmount: (v) => finite(v) && Number.isInteger(v) && v >= 0,
  performanceCondition: (v) => typeof v === 'string' && v.length <= 2000,
  differentialScoring: (v) => typeof v === 'boolean',
};

export function validateFieldValue(key: EditableKey, value: unknown, raw?: string): { ok: true } | { ok: false; message: string } {
  const bad = (message: string) => ({ ok: false as const, message });
  if (raw !== undefined && (typeof raw !== 'string' || raw.length > 500)) return bad('원문(raw)은 500자 이하 문자열이어야 합니다.');
  if (Object.hasOwn(VALUE_CHECK, key)) {
    return VALUE_CHECK[key as ExtractionKey](value) ? { ok: true } : bad(`${key} 값 형식이 올바르지 않습니다.`);
  }
  switch (inputKindOf(key)) {
    case 'longtext':
      return typeof value === 'string' && value.length > 0 && value.length <= 5000 ? { ok: true } : bad('1~5000자의 문자열이어야 합니다.');
    case 'amount':
      return finite(value) && Number.isInteger(value) && value >= 0 ? { ok: true } : bad('0 이상의 정수여야 합니다.');
    case 'datetime':
      return typeof value === 'string' && ISO_RE.test(value) ? { ok: true } : bad(DATETIME_HINT);
    case 'bool_joint':
      return typeof value === 'boolean' ? { ok: true } : bad('true/false여야 합니다.');
    default:
      return typeof value === 'string' && value.length <= 2000 ? { ok: true } : bad('2000자 이하의 문자열이어야 합니다.');
  }
}

/** 템플릿 항목 하나가 가리키는 편집 대상 키들(합성 키는 하위 실제 키로 펼치고, 자동 산출 항목은 0개). */
export function editTargetsOf(fieldKey: TemplateFieldKey): EditableKey[] {
  if (fieldKey === 'credibilityEval') return ['managementScore', 'credibilityScore'];
  if (fieldKey === 'performanceEval') return ['performanceScore', 'performancePeriod', 'performanceMinAmount'];
  if (fieldKey === 'evalMethodText') return ['evalMethodDoc', 'evalMethod'];
  return isEditableKey(fieldKey) ? [fieldKey] : [];
}

/** 사용자 수정을 적용한다. before에는 수정 직전 자동값(이미 수정된 값이면 최초 자동값)을 userEdit 없이 보존한다. */
export function applyUserEdit<T>(prev: FieldValue<T> | undefined, value: T, nowIso: string, o: { raw?: string; note?: string; source?: { ref: string; evidence?: string; page?: number } }): FieldValue<T> {
  const base = prev?.status === 'user_edited' ? prev.userEdit?.before : prev;
  let before: FieldValue<T> | undefined;
  if (base) {
    const { userEdit: _u, ...rest } = base;
    before = rest;
  }
  return {
    value,
    ...(o.raw && { raw: o.raw }),
    status: 'user_edited',
    source: {
      kind: 'user', ref: o.source?.ref ?? 'dashboard',
      ...(o.source?.evidence ? { evidence: o.source.evidence } : {}), ...(o.source?.page !== undefined ? { page: o.source.page } : {}),
      fetchedAt: nowIso,
    },
    userEdit: { editedAt: nowIso, ...(o.note && { note: o.note }), ...(before && { before }) },
  };
}

/** 검토 탭 잎 값 검사. 문서 잎은 VALUE_CHECK, 공고 잎은 validateFieldValue. */
export function checkLeafValue(key: ReviewLeafKey, v: unknown): boolean {
  return (EXTRACTION_KEYS as string[]).includes(key) ? VALUE_CHECK[key as ExtractionKey](v) : validateFieldValue(key, v).ok;
}

/** 수정 전 자동값으로 되돌린다. 수정되지 않은 값은 그대로, before가 없으면 undefined. */
export function revertUserEdit<T>(prev: FieldValue<T> | undefined): FieldValue<T> | undefined {
  if (prev?.status !== 'user_edited') return prev;
  return prev.userEdit?.before;
}

export function parseFieldInput(kind: EditInputKind, text: string, extra?: { joint?: boolean }): { ok: true; value: unknown; raw?: string } | { ok: false; message: string } {
  const bad = (message: string) => ({ ok: false as const, message });
  const t = text.trim();
  switch (kind) {
    case 'text': case 'longtext':
      return t ? { ok: true, value: t } : bad('값을 입력하세요');
    case 'datetime': {
      const iso = toIsoKst(t) ?? (ISO_RE.test(t) ? t : null);
      return iso ? { ok: true, value: iso } : bad(DATETIME_HINT);
    }
    case 'amount': case 'amount_short': {
      const n = parseAmount(t);
      return n !== null && Number.isInteger(n) && n >= 0 ? { ok: true, value: n } : bad('0 이상의 정수 금액으로 입력하세요(예: 1,000,000원)');
    }
    case 'score': {
      const n = parseAmount(t);
      return n !== null && n >= 0 && n <= 1000 ? { ok: true, value: n } : bad('0~1000 사이의 숫자로 입력하세요');
    }
    case 'period': {
      if (/^\d{1,2}년$/.test(t)) return { ok: true, value: t };
      if (/^\d{1,2}$/.test(t)) return { ok: true, value: `${Number(t)}년` };
      return bad('5년 형식으로 입력하세요');
    }
    case 'bool_joint':
      if (typeof extra?.joint !== 'boolean') return bad('공동수급 여부를 선택하세요');
      return { ok: true, value: extra.joint, ...(t && { raw: t }) };
    case 'bool_apply':
      if (t === '적용') return { ok: true, value: true };
      if (t === '미적용') return { ok: true, value: false };
      return bad('적용 또는 미적용으로 입력하세요');
  }
}
