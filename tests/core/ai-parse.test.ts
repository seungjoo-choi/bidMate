import { describe, expect, it } from 'vitest';
import { coerceValue, detectClipboard, extractJson, parseAiResponse } from '../../src/core/ai/parse';
import { REQUEST_MARKER, buildPrompt } from '../../src/core/ai/prompt';
import type { ExtractionKey } from '../../src/core/types/extraction';

const body = (runId = 'r1', items: unknown[] = [{ key: 'credibilityScore', value: 10, quote: '신용 10점', file: 'a.hwp', page: 2, note: 'n' }]) =>
  JSON.stringify({ schema: 'bidmate-ai-review/1', runId, items });
const ctx = { runId: 'r1', keys: ['credibilityScore'] as ExtractionKey[] };

describe('extractJson / parseAiResponse', () => {
  it('```json 코드 블록', () => {
    const r = parseAiResponse(`답입니다\n\`\`\`json\n${body()}\n\`\`\`\n끝`, ctx);
    expect(r.ok && r.items).toEqual([{ key: 'credibilityScore', value: 10, quote: '신용 10점', file: 'a.hwp', page: 2, note: 'n' }]);
  });
  it('json 코드 블록이 여러 개면 처음 파싱되는 것을 쓴다', () => {
    const t = `\`\`\`json
{ 깨진
\`\`\`
\`\`\`json
${body()}
\`\`\``;
    expect(parseAiResponse(t, ctx).ok).toBe(true);
  });
  it('맨 JSON', () => {
    expect(parseAiResponse(body(), ctx).ok).toBe(true);
  });
  it('설명문이 섞인 JSON(문자열 안 중괄호 포함)', () => {
    const t = `결과는 다음과 같습니다. ${body('r1', [{ key: 'credibilityScore', value: 10, quote: '{신용} 10점', file: null, page: null }])} 이상입니다.`;
    const r = parseAiResponse(t, ctx);
    expect(r.ok && r.items[0]!.quote).toBe('{신용} 10점');
    expect(extractJson('JSON 없음')).toBeNull();
  });
  it('요청문 판별', () => {
    const p = buildPrompt({ runId: 'r1', keys: ['credibilityScore'], excerpt: 'x', skippedFiles: [] });
    expect(detectClipboard(p.manualText)).toBe('request');
    expect(detectClipboard(REQUEST_MARKER('r1'))).toBe('request');
    expect(detectClipboard(body())).toBe('response');
    expect(detectClipboard('아무 글')).toBe('unknown');
    const r = parseAiResponse(p.manualText, ctx);
    expect(r.ok === false && r.code).toBe('AI_CLIPBOARD_IS_PROMPT');
  });
  it('runId 불일치·schema 불일치·깨진 JSON', () => {
    const m = parseAiResponse(body('other'), ctx);
    expect(m.ok === false && m.code).toBe('AI_RUN_MISMATCH');
    const s = parseAiResponse(JSON.stringify({ schema: 'x', runId: 'r1', items: [] }), ctx);
    expect(s.ok === false && s.code).toBe('AI_BAD_RESPONSE');
    const b = parseAiResponse('```json\n{ "schema": \n```', ctx);
    expect(b.ok === false && b.code).toBe('AI_BAD_RESPONSE');
  });
});

describe('coerceValue', () => {
  it('배점: 숫자 문자열 → number, 범위 밖·비숫자 거부', () => {
    expect(coerceValue('credibilityScore', '10')).toEqual({ ok: true, value: 10 });
    expect(coerceValue('managementScore', '5점')).toEqual({ ok: true, value: 5 });
    expect(coerceValue('performanceScore', 1001).ok).toBe(false);
    expect(coerceValue('performanceScore', '많음').ok).toBe(false);
  });
  it('금액: 한글 금액 문자열 → 원 단위 정수', () => {
    expect(coerceValue('performanceMinAmount', '5억원')).toEqual({ ok: true, value: 500_000_000 });
    expect(coerceValue('performanceMinAmount', '3.7억원')).toEqual({ ok: true, value: 370_000_000 });
    expect(coerceValue('performanceMinAmount', '3억')).toEqual({ ok: true, value: 300_000_000 });
    expect(coerceValue('performanceMinAmount', '500,000,000원')).toEqual({ ok: true, value: 500_000_000 });
    expect(coerceValue('performanceMinAmount', '500,000,000')).toEqual({ ok: true, value: 500_000_000 });
    expect(coerceValue('performanceMinAmount', 300000000)).toEqual({ ok: true, value: 300_000_000 });
    expect(coerceValue('performanceMinAmount', '5.000.000원').ok).toBe(false);
    expect(coerceValue('performanceMinAmount', '금액없음').ok).toBe(false);
    expect(coerceValue('performanceMinAmount', 1.5).ok).toBe(false);
  });
  it('기간: 숫자·"5년간" → "N년"', () => {
    expect(coerceValue('performancePeriod', 5)).toEqual({ ok: true, value: '5년' });
    expect(coerceValue('performancePeriod', '5년간')).toEqual({ ok: true, value: '5년' });
    expect(coerceValue('performancePeriod', '5')).toEqual({ ok: true, value: '5년' });
    expect(coerceValue('performancePeriod', '오년').ok).toBe(false);
  });
  it('차등점수제: 적용/미적용/true/false → boolean', () => {
    expect(coerceValue('differentialScoring', '적용')).toEqual({ ok: true, value: true });
    expect(coerceValue('differentialScoring', '미적용')).toEqual({ ok: true, value: false });
    expect(coerceValue('differentialScoring', 'true')).toEqual({ ok: true, value: true });
    expect(coerceValue('differentialScoring', 'False')).toEqual({ ok: true, value: false });
    expect(coerceValue('differentialScoring', '모름').ok).toBe(false);
  });
  it('조건: 문자열만, 2000자 초과 거부', () => {
    expect(coerceValue('performanceCondition', '원문').ok).toBe(true);
    expect(coerceValue('performanceCondition', 5).ok).toBe(false);
    expect(coerceValue('performanceCondition', 'a'.repeat(2001)).ok).toBe(false);
  });
});

describe('coerceValue 공고 잎', () => {
  it('datetime: 문서 표기 -> ISO, 시각 없음 -> 실패', () => {
    expect(coerceValue('postedAt', '2026. 10. 21.(수) 14:00')).toEqual({ ok: true, value: '2026-10-21T14:00:00+09:00' });
    expect(coerceValue('proposalEvalAt', '2026-10-21 09:30')).toEqual({ ok: true, value: '2026-10-21T09:30:00+09:00' });
    expect(coerceValue('registrationDeadline', '2026. 10. 21.(수)').ok).toBe(false);
  });
  it('amount: 괄호 꼬리를 떼고 원 단위로', () => {
    expect(coerceValue('budgetAmount', '3억원(부가세 포함)')).toEqual({ ok: true, value: 300_000_000 });
    expect(coerceValue('budgetAmount', '금액 미정').ok).toBe(false);
  });
  it('joint: 허용/단독 해석, 판단 불가는 실패', () => {
    expect(coerceValue('jointVentureAllowed', '공동이행방식 허용')).toEqual({ ok: true, value: true });
    expect(coerceValue('jointVentureAllowed', '단독')).toEqual({ ok: true, value: false });
    expect(coerceValue('jointVentureAllowed', '모름').ok).toBe(false);
  });
  it('joint: 부정 문장은 false, 허용과 부정이 섞이면 true', () => {
    for (const t of ['공동수급 불가', '공동계약 불가능', '공동수급 허용하지 않음', '공동수급체 구성 금지']) {
      expect(coerceValue('jointVentureAllowed', t)).toEqual({ ok: true, value: false });
    }
    expect(coerceValue('jointVentureAllowed', '공동이행 허용, 분담이행 불가')).toEqual({ ok: true, value: true });
    expect(coerceValue('jointVentureAllowed', '공동수급 가능')).toEqual({ ok: true, value: true });
  });
  it('text: trim, 빈 문자열 실패', () => {
    expect(coerceValue('priceMethod', '  복수예비가격  ')).toEqual({ ok: true, value: '복수예비가격' });
    expect(coerceValue('priceMethod', '   ').ok).toBe(false);
  });
});

describe('variants / schema 태그', () => {
  const v2 = (items: unknown[], schema = 'bidmate-ai-review/2') => JSON.stringify({ schema, runId: 'r1', items });
  it('variants가 있으면 파싱하고(최대 8개), 없으면 필드를 두지 않는다', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ condition: `c${i}`, value: i, quote: 'q' }));
    const r = parseAiResponse(v2([{ key: 'credibilityScore', value: null, quote: '', variants: many }, { key: 'managementScore', value: 3, quote: 'q' }]), ctx);
    expect(r.ok && r.items[0]!.variants).toHaveLength(8);
    expect(r.ok && r.items[0]!.variants![0]).toEqual({ condition: 'c0', value: 0, quote: 'q' });
    expect(r.ok && r.items[1]).not.toHaveProperty('variants');
    const empty = parseAiResponse(v2([{ key: 'credibilityScore', value: 1, quote: 'q', variants: [] }]), ctx);
    expect(empty.ok && empty.items[0]).not.toHaveProperty('variants');
  });
  it('구 태그(bidmate-ai-review/1)도 받아들이고 알 수 없는 태그는 거부한다', () => {
    expect(parseAiResponse(v2([{ key: 'credibilityScore', value: 1, quote: 'q' }], 'bidmate-ai-review/1'), ctx).ok).toBe(true);
    expect(parseAiResponse(v2([], 'bidmate-ai-review/9'), ctx)).toMatchObject({ ok: false, code: 'AI_BAD_RESPONSE' });
  });
});

describe('coerceValue datetime ISO 정규화', () => {
  it('오프셋 없는 ISO는 KST, Z나 오프셋이 있으면 그대로', () => {
    expect(coerceValue('postedAt', '2026-10-21T14:00')).toEqual({ ok: true, value: '2026-10-21T14:00:00+09:00' });
    expect(coerceValue('postedAt', '2026-10-21T14:00:30')).toEqual({ ok: true, value: '2026-10-21T14:00:30+09:00' });
    expect(coerceValue('postedAt', '2026-10-21T05:00:00Z')).toEqual({ ok: true, value: '2026-10-21T05:00:00Z' });
    expect(coerceValue('postedAt', '2026-10-21T14:00:00+09:00')).toEqual({ ok: true, value: '2026-10-21T14:00:00+09:00' });
  });
});
