import type { ExtractionKey } from '../../types/extraction';
import { EXTRACTION_KEYS } from '../../types/extraction';
import type { DocKind } from '../classify';

export type RuleTarget = ExtractionKey | `extras.${string}`;
type Base = {
  id: string; target: RuleTarget; docKinds?: DocKind[]; weight?: number;
  conflictPolicy?: 'strict' | 'prefer_priority';
};
export type Rule = Base & (
  | { strategy: 'table-score'; label: string; scoreHeader: string; excludeLabel?: string }
  | { strategy: 'inline-score'; label: string; maxGap: number; excludeLabel?: string }
  | { strategy: 'keyword-enum'; pattern: string; map: Record<string, boolean | string> }
  | { strategy: 'window-regex'; anchor: string; pattern: string; blocksAfter: number; valueType: 'amount' | 'years' | 'number' | 'string' | 'text' }
  | { strategy: 'bonus-table'; scoreHeader: string; rowLabel: string }
  | { strategy: 'quant-table'; scoreHeader: string; title: string; perfLabel: string; credLabel: string; mgmtLabel: string }
  | { strategy: 'qual-table'; scoreHeader: string; itemHeader: string; quantLabel: string }
  | { strategy: 'block-capture'; anchor: string; stopAt: string; maxBlocks: number; maxChars: number }
);
export interface RuleSet { version: string; synonyms: Record<string, string[]>; rules: Rule[] }

const DOC_KINDS: DocKind[] = ['eval_criteria', 'notice', 'rfp', 'qna', 'other', 'form', 'reference'];
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const compactLen = (s: string) => s.normalize('NFC').replace(/[\u0000\u200b-\u200d\u2060\ufeff]/g, '').replace(/\s+/g, '').length;

/** 중첩 수량자 `(…+)+`, `(…*)*`, `(…+)*` 류(ReDoS 의심). 사용자 규칙에만 적용한다. */
const NESTED_QUANT = /[+*]\)\s*[+*{]/;

/** 동의어 사전 한 항목: 비어 있지 않은 배열이고, compact 후 빈 문자열인 항목이 없어야 한다. */
export function synonymError(key: string, v: unknown): string | null {
  if (FORBIDDEN_KEYS.has(key)) return `동의어 키 금지: ${key}`;
  if (!Array.isArray(v) || v.length === 0) return `동의어 ${key}: 비어 있지 않은 배열이어야 함`;
  if (!v.every((a) => typeof a === 'string' && compactLen(a) > 0)) return `동의어 ${key}: 빈 항목 있음`;
  return null;
}

/** 라벨/앵커/패턴 문자열 검사: 동의어 키이거나, `{{key}}`가 모두 실존하고 정규식으로 컴파일돼야 한다. */
export function termError(src: string, syn: Record<string, string[]>, user: boolean): string | null {
  if (has(syn, src)) return null;
  let missing: string | null = null;
  const probe = src.replace(/\{\{(\w+)\}\}/g, (_, k: string) => {
    if (!has(syn, k)) missing = k;
    return 'x';
  });
  if (missing) return `{{${missing}}} 동의어 없음`;
  try {
    new RegExp(probe);
  } catch (e) {
    return `정규식 오류: ${(e as Error).message}`;
  }
  if (user && NESTED_QUANT.test(src)) return '중첩 수량자(ReDoS 의심)';
  return null;
}

/** 규칙 하나를 검사한다(병합된 동의어 기준). 문제 목록(빈 배열이면 유효). */
export function validateRule(r: unknown, syn: Record<string, string[]>, user = true): string[] {
  if (!isObj(r)) return ['규칙이 객체가 아님'];
  const errs: string[] = [];
  const id = isStr(r.id) ? r.id : '?';
  const bad = (m: string) => errs.push(`${id}: ${m}`);
  if (!isStr(r.id)) bad('id 누락');
  if (!isStr(r.target) || !(EXTRACTION_KEYS.includes(r.target as ExtractionKey) || (/^extras\.[A-Za-z][A-Za-z0-9_]*$/.test(r.target) && !FORBIDDEN_KEYS.has(r.target.slice(7))))) bad('target 오류');
  if (r.weight !== undefined && !isNum(r.weight)) bad('weight 오류');
  if (r.conflictPolicy !== undefined && r.conflictPolicy !== 'strict' && r.conflictPolicy !== 'prefer_priority') bad('conflictPolicy 오류');
  if (r.docKinds !== undefined && !(Array.isArray(r.docKinds) && r.docKinds.every((k) => DOC_KINDS.includes(k as DocKind)))) bad('docKinds 오류');
  const terms = (...keys: string[]) => {
    for (const k of keys) {
      const v = r[k];
      if (!isStr(v)) bad(`${k} 누락`);
      else {
        const e = termError(v, syn, user);
        if (e) bad(`${k} ${e}`);
      }
    }
  };
  switch (r.strategy) {
    case 'table-score':
      terms('label', 'scoreHeader');
      if (r.excludeLabel !== undefined) terms('excludeLabel');
      break;
    case 'inline-score':
      terms('label');
      if (r.excludeLabel !== undefined) terms('excludeLabel');
      if (!Number.isInteger(r.maxGap) || (r.maxGap as number) < 0 || (r.maxGap as number) > 200) bad('maxGap은 0~200 정수여야 함');
      break;
    case 'keyword-enum':
      terms('pattern');
      if (!isObj(r.map) || !Object.values(r.map).every((v) => typeof v === 'boolean' || typeof v === 'string')) bad('map 오류');
      break;
    case 'window-regex':
      terms('anchor', 'pattern');
      if (!isNum(r.blocksAfter)) bad('blocksAfter 오류');
      if (!['amount', 'years', 'number', 'string', 'text'].includes(r.valueType as string)) bad('valueType 오류');
      break;
    case 'bonus-table':
      terms('scoreHeader', 'rowLabel');
      break;
    case 'quant-table':
      terms('scoreHeader', 'title', 'perfLabel', 'credLabel', 'mgmtLabel');
      break;
    case 'qual-table':
      terms('scoreHeader', 'itemHeader', 'quantLabel');
      break;
    case 'block-capture':
      terms('anchor', 'stopAt');
      if (!isNum(r.maxBlocks) || !isNum(r.maxChars)) bad('maxBlocks/maxChars 오류');
      break;
    default:
      bad('strategy 오류');
  }
  return errs;
}
