import { parseKoreanAmount } from '../extraction/normalize';
import { REVIEW_KIND, isExtractionLeaf } from '../extraction/review-rows';
import { docDateToIso, toIsoKst } from '../model/dates';
import { checkLeafValue } from '../model/field-edit';
import { parseJointVenture } from '../model/joint-venture';
import type { AiKey } from './keys';
import { AI_MAX_VARIANTS, AI_SCHEMA_TAGS_ACCEPTED, type AiErrorCode } from '../types/ai';

export interface RawAiVariant { condition: string; value: unknown; quote: string }
export interface RawAiItem { key: string; value: unknown; quote: string; file: string | null; page: number | null; note?: string; variants?: RawAiVariant[] }
export type ParseResult =
  | { ok: true; items: RawAiItem[] }
  | { ok: false; code: Extract<AiErrorCode, 'AI_CLIPBOARD_IS_PROMPT' | 'AI_BAD_RESPONSE' | 'AI_RUN_MISMATCH'>; message: string };

/** 점이 천 단위 구분자인 표기("5.000.000")는 해석이 모호해 보정하지 않는다. */
export const DOT_THOUSANDS = /\d\.\d{3}(\.|$)/;
const REQUEST_MARKER_PREFIX = '<<BIDMATE-AI-REQUEST';

/** 첫 `{`부터 문자열·이스케이프를 고려해 균형 잡힌 `}`까지. */
function balancedObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inStr) {
      if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

/** ```json 코드 블록 우선, 없으면 첫 `{`부터 균형 잡힌 `}`. JSON 문자열을 돌려준다(검증은 호출자). */
export function extractJson(text: string): string | null {
  const blocks = [...text.matchAll(/```([a-zA-Z]*)[ \t]*\r?\n?([\s\S]*?)```/g)];
  const cands = [
    ...blocks.filter((m) => m[1]!.toLowerCase() === 'json'),
    ...blocks.filter((m) => m[1]!.toLowerCase() !== 'json' && m[2]!.trim().startsWith('{')),
  ].map((m) => m[2]!.trim());
  // 앞에서부터 차례로 시도해 처음 파싱되는 블록을 쓴다. 모두 실패하면 첫 블록을 돌려줘 호출자가 BAD_RESPONSE로 처리한다.
  for (const c of cands) { try { JSON.parse(c); return c; } catch { /* 다음 블록 */ } }
  if (cands.length) return cands[0]!;
  return balancedObject(text);
}

export function detectClipboard(text: string): 'request' | 'response' | 'unknown' {
  if (text.includes(REQUEST_MARKER_PREFIX)) return 'request';
  const j = extractJson(text);
  if (!j) return 'unknown';
  try {
    const o = JSON.parse(j) as { schema?: unknown; items?: unknown } | null;
    if (o && typeof o === 'object' && (AI_SCHEMA_TAGS_ACCEPTED.includes(o.schema as string) || Array.isArray(o.items))) return 'response';
  } catch { /* unknown */ }
  return 'unknown';
}

export type Coerced = { ok: true; value: unknown } | { ok: false };

const ISO_WITH_ZONE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/;
const ISO_NO_ZONE_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2})(?:\.\d+)?)?$/;

/** 원문 표기 금액("3.7억원", "5,000만원")을 원 단위 숫자로. 해석 불가면 null. */
function amountFromText(t: string): number | null {
  if (/^[\d,.\s조억만천백]+원?$/.test(t) && /[\d조억만천백]/.test(t) && !DOT_THOUSANDS.test(t)) return parseKoreanAmount(t);
  return null;
}

/**
 * 문서 문장 표기의 공동수급 여부. parseJointVenture(API 코드값용)는 '공동'만 보면 true라
 * "공동수급 불가", "공동계약 허용하지 않음" 같은 문장을 뒤집는다. 부정어가 있고 허용 표현이 없으면 먼저 false.
 * 허용과 부정이 섞이면("공동이행 허용, 분담이행 불가") 허용으로 본다.
 */
export function jointFromDocText(raw: string): boolean | null {
  const s = raw.replace(/\s+/g, '');
  const neg = /불가|불허|금지|않|없음/.test(s);
  const pos = /허용(?!하지|안)|(?<!불)가능/.test(s);
  if (neg && !pos) return false;
  return parseJointVenture(raw);
}

/** 공고 잎(문서 잎이 아닌 키)의 AI 값 환산. AI는 전부 문자열(문서 원문 표기)로 주고 코드가 바꾼다. */
function coerceNoticeLeaf(key: AiKey, v: unknown): unknown {
  switch (REVIEW_KIND[key]) {
    case 'datetime':
      if (typeof v === 'string') {
        const t = v.trim();
        if (ISO_WITH_ZONE_RE.test(t)) return t; // Z나 오프셋이 있으면 그대로
        const nz = ISO_NO_ZONE_RE.exec(t);
        if (nz) return `${nz[1]}:${nz[2] ?? '00'}+09:00`; // 오프셋 없는 ISO는 KST로 본다
        return docDateToIso(t) ?? toIsoKst(t) ?? v; // 시각이 없으면 환산 실패(문자열 그대로 두어 검사에서 거부)
      }
      return v;
    case 'amount':
      if (typeof v === 'string') {
        const n = amountFromText(v.trim().replace(/\s*[(（][^)）]*[)）]\s*$/, '').trim());
        if (n !== null) return n;
      }
      return v;
    case 'joint':
      if (typeof v === 'string') {
        const b = jointFromDocText(v);
        return b === null ? v : b;
      }
      return v;
    default:
      return typeof v === 'string' ? v.trim() : v;
  }
}

export function coerceValue(key: AiKey, v: unknown): Coerced {
  let out: unknown = v;
  if (!isExtractionLeaf(key)) {
    const nv = coerceNoticeLeaf(key, v);
    return nv !== '' && checkLeafValue(key, nv) ? { ok: true, value: nv } : { ok: false };
  }
  switch (key) {
    case 'credibilityScore': case 'managementScore': case 'performanceScore':
      if (typeof v === 'string') {
        const m = /^\s*(\d+(?:\.\d+)?)\s*점?\s*$/.exec(v.replace(/,/g, ''));
        if (m) out = parseFloat(m[1]!);
      }
      break;
    case 'performanceMinAmount':
      if (typeof v === 'string') {
        // v2는 원문 표기로 받으므로 "5억원 이상"의 꼬리 "이상"은 떼고 해석한다.
        const n = amountFromText(v.trim().replace(/\s*이상$/, ''));
        if (n !== null) out = n;
      }
      break;
    case 'performancePeriod':
      if (typeof v === 'number' && Number.isInteger(v)) out = `${v}년`;
      else if (typeof v === 'string') {
        // v2 원문 표기("최근 5년", "5년 이내", "5년간")도 받는다.
        // 숫자만 있으면 그대로, "최근"·"이내"가 붙으면 '년'이 있어야 한다.
        const m = /^\s*(\d{1,2})\s*(?:년(?:간)?)?\s*$/.exec(v) ?? /^\s*(?:최근\s*)?(\d{1,2})\s*년(?:간)?\s*(?:이내)?\s*$/.exec(v);
        if (m) out = `${parseInt(m[1]!, 10)}년`;
      }
      break;
    case 'differentialScoring':
      if (typeof v === 'string') {
        const t = v.trim().toLowerCase();
        if (t === 'true' || t === '적용') out = true;
        else if (t === 'false' || t === '미적용') out = false;
      }
      break;
    default: break; // performanceCondition: 문자열 그대로
  }
  return checkLeafValue(key, out) ? { ok: true, value: out } : { ok: false };
}

export function parseAiResponse(text: string, ctx: { runId: string; keys: AiKey[] }): ParseResult {
  const bad = (code: Extract<ParseResult, { ok: false }>['code'], message: string): ParseResult => ({ ok: false, code, message });
  if (detectClipboard(text) === 'request') return bad('AI_CLIPBOARD_IS_PROMPT', '붙여넣은 내용이 프롬프트입니다. AI의 답변을 복사해 주세요.');
  const j = extractJson(text);
  if (!j) return bad('AI_BAD_RESPONSE', '답변에서 JSON을 찾지 못했습니다.');
  let o: unknown;
  try { o = JSON.parse(j); } catch { return bad('AI_BAD_RESPONSE', '답변 JSON을 읽을 수 없습니다.'); }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return bad('AI_BAD_RESPONSE', '답변 형식이 올바르지 않습니다.');
  const r = o as { schema?: unknown; runId?: unknown; items?: unknown };
  if (typeof r.schema !== 'string' || !AI_SCHEMA_TAGS_ACCEPTED.includes(r.schema)) return bad('AI_BAD_RESPONSE', '답변의 schema 값이 다릅니다.');
  if (r.runId !== ctx.runId) return bad('AI_RUN_MISMATCH', '다른 요청에 대한 답변입니다(runId 불일치).');
  if (!Array.isArray(r.items)) return bad('AI_BAD_RESPONSE', '답변에 items 배열이 없습니다.');
  const items: RawAiItem[] = [];
  for (const it of r.items) {
    if (!it || typeof it !== 'object' || typeof (it as { key?: unknown }).key !== 'string') continue;
    const x = it as Record<string, unknown>;
    const variants: RawAiVariant[] = Array.isArray(x.variants)
      ? x.variants.slice(0, AI_MAX_VARIANTS).flatMap((v): RawAiVariant[] => {
        if (!v || typeof v !== 'object') return [];
        const y = v as Record<string, unknown>;
        return [{ condition: typeof y.condition === 'string' ? y.condition : '', value: y.value === undefined ? null : y.value, quote: typeof y.quote === 'string' ? y.quote : '' }];
      })
      : [];
    items.push({
      key: x.key as string,
      value: x.value === undefined ? null : x.value,
      quote: typeof x.quote === 'string' ? x.quote : '',
      file: typeof x.file === 'string' && x.file ? x.file : null,
      page: typeof x.page === 'number' && Number.isFinite(x.page) ? x.page : null,
      ...(typeof x.note === 'string' && x.note ? { note: x.note } : {}),
      ...(variants.length ? { variants } : {}),
    });
  }
  return { ok: true, items };
}
