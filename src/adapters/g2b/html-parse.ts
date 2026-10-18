import { toIsoKst } from '../../core/model/dates';
import { parseJointVenture } from '../../core/model/joint-venture';
import type { FieldValue } from '../../core/types/common';
import type { NoticeFieldKey } from '../../core/types/notice';

const DATE_KEYS = new Set<NoticeFieldKey>(['postedAt', 'registrationDeadline', 'bidStartAt', 'bidCloseAt', 'proposalEvalAt', 'openingAt']);
const NUMBER_KEYS = new Set<NoticeFieldKey>(['budgetAmount', 'estimatedPrice', 'credibilityScore', 'managementScore', 'performanceScore', 'performanceMinAmount']);
const BOOL_KEYS = new Set<NoticeFieldKey>(['jointVentureAllowed', 'differentialScoring']);

/** "1,923,000,000", "1,923,000,000원" 만 숫자로 해석한다. 억/만 등 단위가 섞이면 null. */
export function parseAmount(raw: string): number | null {
  const m = /^\s*(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*(원|점|%)?\s*$/.exec(raw);
  if (!m) return null;
  const n = Number(`${m[1]!.replace(/,/g, '')}${m[2] ?? ''}`);
  return Number.isFinite(n) ? n : null;
}

/** 화면에서 읽은 원문 하나를 키별 규칙으로 FieldValue로 만든다. 실패하면 value null + needs_review(raw 보존). */
export function parseHtmlField(key: NoticeFieldKey, raw: string, ref: string, capturedAt: string): FieldValue<unknown> {
  const source = { kind: 'html' as const, ref, fetchedAt: capturedAt };
  const ok = (value: unknown): FieldValue<unknown> => ({ value, raw, status: 'verified', source });
  const fail = (note: string): FieldValue<unknown> => ({ value: null, raw, status: 'needs_review', source, note });

  if (DATE_KEYS.has(key)) {
    const iso = toIsoKst(raw);
    return iso ? ok(iso) : fail('날짜 형식을 해석하지 못함');
  }
  if (NUMBER_KEYS.has(key)) {
    const n = parseAmount(raw);
    return n === null ? fail('숫자로 해석하지 않음(단위가 섞였거나 형식이 다름)') : ok(n);
  }
  if (BOOL_KEYS.has(key)) {
    if (key !== 'jointVentureAllowed') return fail('해석 규칙 없음');
    const b = parseJointVenture(raw);
    return b === null ? fail('공동수급 여부를 판단하지 못함') : ok(b);
  }
  const text = raw.replace(/\s+/g, ' ').trim();
  return text === '' ? fail('빈 값') : { ...ok(text) };
}
