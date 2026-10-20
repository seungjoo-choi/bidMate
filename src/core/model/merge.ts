import type { FieldSource, FieldValue, SourceKind } from '../types/common';
import type { Notice } from '../types/notice';
import { isNotApplicableField } from '../extraction/review-count';
import { ALL_FIELD_KEYS, EVALUATION_KEYS, getField, type FieldMap } from './notice-fields';

const DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** 충돌 비교용 정규화: 문자열은 공백 제거, 날짜는 분 단위, 그 외는 그대로. */
function normalize(v: unknown): unknown {
  if (typeof v === 'string') return DATE_RE.test(v) ? v.slice(0, 16) : v.replace(/\s+/g, '');
  return v;
}

export const sameKey = (v: unknown): string => JSON.stringify(normalize(v));

/** 충돌 직전 상태. first가 이미 충돌 상태(basis 보유)면 그 basis를 이어받는다. */
const basisOf = (v: FieldValue<unknown>): NonNullable<FieldValue<unknown>['basis']> =>
  v.basis ?? { status: v.status, ...(v.note !== undefined ? { note: v.note } : {}) };

const UNKNOWN_SOURCE: FieldSource = { kind: 'derived', ref: 'unknown', fetchedAt: '' };

/** 이번 수집에서 다시 조회한 출처. kinds에 속한 출처의 이전 값은 이번 결과로 대체/재검토 대상이 된다. */
export interface MergeLayer {
  kinds: SourceKind[];
  fields: FieldMap;
}

const hasValue = (v: FieldValue<unknown> | undefined): v is FieldValue<unknown> => !!v && v.value !== null && v.value !== undefined;

/**
 * 한 번의 수집 결과(layers, 우선순위 순서 [api, html])를 기존 공고에 병합한다. 키마다:
 * 1. existing이 user_edited면 보존
 * 2. 값이 있는 첫 layer 값을 사용. 다른 layer 값과 정규화 비교로 다르면 needs_review + candidates
 * 3. 어느 layer에도 값이 없을 때
 *    - layer가 해석 실패 값(raw 보존)을 냈으면 그것을 사용(needs_review 유지)
 *    - existing 값의 출처가 이번에 다시 조회한 kinds에 속하면 needs_review로 낮춰 유지
 *    - 이번에 조회하지 않은 출처(예: html 없이 재수집할 때의 화면값)면 그대로 유지
 *    - 아무것도 없으면 missing
 */
export function mergeFields(existing: Notice | null, layers: MergeLayer[]): FieldMap {
  const queried = new Set<SourceKind>(layers.flatMap((l) => l.kinds));
  const out: FieldMap = {};
  for (const key of ALL_FIELD_KEYS) {
    const prev = existing ? getField(existing, key) : undefined;
    if (prev?.status === 'user_edited') {
      // 사용자 값은 그대로 두고, 되돌릴 때 돌아갈 자동값(before)만 이번 수집 결과로 갱신한다.
      const auto = mergeKey(prev.userEdit?.before, layers.map((l) => l.fields[key]), queried);
      out[key] = prev.userEdit ? { ...prev, userEdit: { ...prev.userEdit, before: auto } } : prev;
      continue;
    }
    out[key] = mergeKey(prev, layers.map((l) => l.fields[key]), queried);
  }
  return out;
}

/** 키 하나의 병합. candidates는 layer별 이 키의 값(우선순위 순서). */
function mergeKey(prev: FieldValue<unknown> | undefined, candidates: Array<FieldValue<unknown> | undefined>, queried: Set<SourceKind>): FieldValue<unknown> {
  const present = candidates.filter(hasValue);
  const unparsed = candidates.filter(
    (v): v is FieldValue<unknown> => !!v && !isNotApplicableField(v) && (v.value === null || v.value === undefined) && typeof v.raw === 'string' && v.raw.trim() !== '',
  );
  if (present.length === 0) {
    // "해당 없음"은 값 없음이 아니라 판정 결과다. 해석 실패로 돌리지 않고 그대로 둔다.
    const na = candidates.find(isNotApplicableField);
    if (na) return na;
    if (unparsed[0]) return { ...unparsed[0], status: 'needs_review', note: unparsed[0].note ?? '값을 해석하지 못함' };
    if (hasValue(prev)) {
      return prev.source && queried.has(prev.source.kind)
        ? { ...prev, status: 'needs_review', note: '최근 수집에서 값이 확인되지 않음' }
        : prev;
    }
    return { value: null, status: 'missing' };
  }
  const first = present[0]!;
  const differing = present.slice(1).filter((v) => sameKey(v.value) !== sameKey(first.value));
  if (differing.length === 0) {
    // 값 없는 레이어가 후보(candidates)를 들고 오면 그 레이어 안에서 값이 갈린 것이다(예: 문서 간 충돌).
    // 후보 중 first와 다른 값이 있으면 충돌로 드러내고, 전부 같으면 first를 그대로 쓴다.
    const conflictCands = unparsed.flatMap((u) => u.candidates ?? []);
    const otherCands = conflictCands.filter((c) => sameKey(c.value) !== sameKey(first.value));
    if (otherCands.length) {
      return {
        ...first,
        status: 'needs_review',
        note: '출처별 값이 서로 다름',
        basis: basisOf(first),
        candidates: [{ value: first.value, source: first.source ?? UNKNOWN_SOURCE }, ...otherCands],
      };
    }
    // 다른 출처가 해석 실패 원문만 냈으면 값은 그대로 쓰되, 대조할 수 있게 원문을 note로 남긴다.
    const parseFailures = unparsed.filter((u) => !u.candidates?.length);
    return parseFailures.length
      ? { ...first, note: parseFailures.map((u) => `${u.source?.kind ?? '?'} 원문 해석 실패: ${u.raw}`).join(' / ') }
      : first;
  }
  return {
    ...first,
    status: 'needs_review',
    note: '출처별 값이 서로 다름',
    basis: basisOf(first),
    candidates: [first, ...differing].map((v) => ({ value: v.value, source: v.source ?? UNKNOWN_SOURCE })),
  };
}

/**
 * 문서 추출 결과를 기존 공고에 병합한다. document 레이어만으로 mergeFields를 부르면 html 값을 조용히 덮어쓰므로,
 * 기존 비문서 값을 kinds:[]인 앞 레이어로 보존한 뒤 document 레이어를 합친다.
 */
export function mergeDocumentLayer(existing: Notice, docFields: FieldMap): FieldMap {
  const retained: FieldMap = {};
  for (const key of EVALUATION_KEYS) {
    const prev = getField(existing, key);
    if (prev && prev.status !== 'user_edited' && prev.source && prev.source.kind !== 'document') retained[key] = withoutDocumentConflict(prev);
  }
  return mergeFields(existing, [{ kinds: [], fields: retained }, { kinds: ['document'], fields: docFields }]);
}

/**
 * 이전 문서 추출이 남긴 충돌 흔적(문서 출처 후보/note)을 걷어 내 api/html 값 본래 상태로 되돌린다.
 * 그래야 재추출에서 문서가 같은 값을 내거나 값을 못 찾으면 needs_review가 풀린다.
 * api/html 사이의 충돌이나 해석 실패처럼 문서와 무관한 needs_review는 그대로 둔다.
 */
function withoutDocumentConflict(prev: FieldValue<unknown>): FieldValue<unknown> {
  if (!prev.candidates?.length) return prev;
  const kept = prev.candidates.filter((c) => c.source.kind !== 'document');
  if (kept.length === prev.candidates.length) return prev;
  const distinct = new Set(kept.map((c) => sameKey(c.value)));
  if (distinct.size <= 1) {
    // 충돌 전 상태로 되돌린다. basis가 없는 옛 데이터는 상태를 바꾸지 않는다(verified로 올리지 않음).
    const { candidates: _c, note: _n, basis, ...rest } = prev;
    if (!basis) return { ...rest, status: prev.status };
    return { ...rest, status: basis.status, ...(basis.note !== undefined ? { note: basis.note } : {}) };
  }
  return { ...prev, candidates: kept };
}
