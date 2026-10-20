import type { FieldValue } from '../types/common';
import type { ResolvedValue } from '../types/mail';
import type { Notice } from '../types/notice';
import type { TemplateFieldKey } from '../types/template';

export type CompositeKey = 'credibilityEval' | 'performanceEval' | 'evalMethodText';
export const COMPOSITE_KEYS: readonly CompositeKey[] = ['credibilityEval', 'performanceEval', 'evalMethodText'];

const REVIEW = '확인 필요';
const missing = (): ResolvedValue => ({ text: REVIEW, status: 'missing', raw: null });

/** 메일 합성 항목 하나를 해석한다. 데이터 모델은 건드리지 않는다. */
export function resolveComposite(notice: Notice, key: CompositeKey, resolveField?: (k: TemplateFieldKey) => ResolvedValue): ResolvedValue {
  if (key === 'credibilityEval') return credibilityEval(notice);
  if (key === 'performanceEval') return performanceEval(notice, resolveField);
  return evalMethodText(notice);
}

/** 배점이 없을 때 메일에 그대로 넣는 문서 문장(정량평가 주체·항목). topic 키워드가 없거나 문장이 없으면 null. */
function quantDocText(notice: Notice, topic: RegExp): ResolvedValue | null {
  const doc = notice.evaluation?.quantEvalDoc;
  if (!doc || doc.status === 'missing' || typeof doc.value !== 'string' || !doc.value.trim()) return null;
  const t = doc.value.trim();
  if (doc.status !== 'user_edited' && !topic.test(t)) return null; // 항목과 무관한 문장은 쓰지 않는다(문장 자체는 자르지 않는다)
  if (doc.status === 'needs_review') return { text: `${t} (${REVIEW})`, status: 'needs_review', raw: doc.value };
  return { text: t, status: 'ok', raw: doc.value };
}

function scorePiece(fv: FieldValue<number> | undefined, label: string): { text: string; review: boolean } | null {
  if (!fv || fv.status === 'missing' || typeof fv.value !== 'number' || !Number.isFinite(fv.value)) return null;
  const text = `${label.replace('{N}', String(Math.trunc(fv.value)))}`;
  return { text: fv.status === 'needs_review' ? `${text} (${REVIEW})` : text, review: fv.status === 'needs_review' };
}

function credibilityEval(notice: Notice): ResolvedValue {
  const e = notice.evaluation;
  const pieces = [
    scorePiece(e?.managementScore, '경영상태(신용평가등급) 평가({N}점)'),
    scorePiece(e?.credibilityScore, '대외신인도({N}점)'),
  ].filter((p): p is { text: string; review: boolean } => p !== null);
  if (pieces.length === 0) return quantDocText(notice, /경영상태|신용|신인도/) ?? missing();
  const review = pieces.some((p) => p.review);
  return { text: pieces.map((p) => p.text).join(', '), status: review ? 'needs_review' : 'ok', raw: null };
}

/** 기본 템플릿 10번(실적인정기간·실적점수·인정금액 문구)과 같은 결과. 셋 다 없으면 문서 문장, 그것도 없으면 '확인 필요'. */
function performanceEval(notice: Notice, resolveField?: (k: TemplateFieldKey) => ResolvedValue): ResolvedValue {
  if (!resolveField) return missing();
  const period = resolveField('performancePeriod');
  const score = resolveField('performanceScore');
  const amount = resolveField('performanceMinAmount');
  const parts = [period, score, amount];
  if (parts.every((p) => p.status === 'missing')) return quantDocText(notice, /실적/) ?? missing();
  const text = `${period.text} 이내 국내외 유사사업 수행실적(${score.text}) - ${amount.text} 이상인 사업에 한함`;
  return { text, status: parts.every((p) => p.status === 'ok') ? 'ok' : 'needs_review', raw: null };
}

function evalMethodText(notice: Notice): ResolvedValue {
  const doc = notice.evaluation?.evalMethodDoc;
  if (doc && doc.status !== 'missing' && typeof doc.value === 'string' && doc.value.trim()) {
    const t = doc.value.trim();
    if (doc.status === 'needs_review') return { text: `${t} (${REVIEW})`, status: 'needs_review', raw: doc.value };
    return { text: t, status: 'ok', raw: doc.value };
  }
  const fv = notice.evaluation?.evalMethod;
  if (!fv || fv.status === 'missing' || fv.value === null || fv.value === undefined) return { ...missing(), raw: fv?.value ?? null };
  const t = typeof fv.value === 'string' ? fv.value.trim() : String(fv.value).trim();
  if (!t) return { ...missing(), raw: fv.value };
  if (fv.status === 'needs_review') return { text: `${t} (${REVIEW})`, status: 'needs_review', raw: fv.value };
  return { text: t, status: 'ok', raw: fv.value };
}

/** 공동수급 메일 표기. 예: `허용(공동이행방식)`. 사이드패널 등의 formatJoint는 바꾸지 않는다. */
export function jointVentureText(fv: FieldValue<unknown> | undefined): ResolvedValue {
  if (!fv || fv.status === 'missing') return { ...missing(), raw: fv?.raw ?? fv?.value ?? null };
  const review = fv.status === 'needs_review';
  const suffix = review ? ` (${REVIEW})` : '';
  const status: ResolvedValue['status'] = review ? 'needs_review' : 'ok';
  if (fv.value === false) return { text: `불허${suffix}`, status, raw: fv.raw ?? false };
  if (fv.value === true) {
    const rawStr = typeof fv.raw === 'string' ? fv.raw : '';
    const method = rawStr.replace(/^\s*\((?:전자|수기)\)/, '').replace(/\s+/g, '');
    const text = !method || /불허|단독/.test(method) ? '허용' : `허용(${method.endsWith('방식') ? method : `${method}방식`})`;
    return { text: `${text}${suffix}`, status, raw: fv.raw ?? true };
  }
  const rawStr = typeof fv.raw === 'string' ? fv.raw.trim() : '';
  if (!rawStr) return { ...missing(), raw: null };
  return { text: `${rawStr} (${REVIEW})`, status: 'needs_review', raw: fv.raw };
}
