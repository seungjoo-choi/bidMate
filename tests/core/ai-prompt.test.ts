import { describe, expect, it } from 'vitest';
import { AI_KEYS, isDocAiKey } from '../../src/core/ai/keys';
import { buildPrompt, ITEM_DEFS, PROMPT_VERSION, REQUEST_MARKER } from '../../src/core/ai/prompt';

describe('buildPrompt', () => {
  const base = { runId: 'run-1', excerpt: '=== 파일: a.hwp (제안요청서) ===\n신용평가 10점', skippedFiles: [] as string[] };

  it('요청 키만 spec.keys에 들어가고 프롬프트에도 그 키만 정의된다', () => {
    const p = buildPrompt({ ...base, keys: ['performanceScore', 'credibilityScore'] });
    expect(p.spec.keys).toEqual(['credibilityScore', 'performanceScore']);
    expect(p.spec.runId).toBe('run-1');
    expect(p.spec.tag).toBe('bidmate-ai-review/2');
    expect(p.user).toContain('### credibilityScore');
    expect(p.user).not.toContain('### managementScore');
    expect(p.user).not.toContain('### differentialScoring');
  });

  it('manualText 첫 줄이 요청 마커이고 제외 파일 안내가 붙는다', () => {
    const p = buildPrompt({ ...base, keys: ['credibilityScore'], skippedFiles: ['스캔본.pdf'] });
    expect(p.manualText.split('\n')[0]).toBe(REQUEST_MARKER('run-1'));
    expect(REQUEST_MARKER('run-1')).toBe(`<<BIDMATE-AI-REQUEST runId=run-1 v=${PROMPT_VERSION}>>`);
    expect(p.manualText).toContain('글자를 읽을 수 없어 제외했습니다');
    expect(p.manualText).toContain('스캔본.pdf');
    expect(p.manualText).toContain('```json 코드 블록 하나');
    expect(buildPrompt({ ...base, keys: ['credibilityScore'] }).manualText).not.toContain('제외했습니다');
  });

  it('추출값 미포함은 입력 타입으로 보장: baseline 필드를 넘기면 타입 오류', () => {
    // @ts-expect-error buildPrompt 입력에는 baseline 같은 추출값 필드가 없다
    const p = buildPrompt({ ...base, keys: ['credibilityScore'], baseline: { credibilityScore: 'BASELINE_SENTINEL_77' } });
    expect(p.manualText).toContain('credibilityScore');
  });

  it('항목 정의는 정의 → 식별 → 이것은 아님 → 값 형식 → 다중값 순으로 렌더된다', () => {
    const p = buildPrompt({ ...base, keys: ['performanceMinAmount'] });
    const idx = ['- 정의:', '- 식별:', '- 이것은 아님:', '- 값 형식:', '- 다중값:'].map((m) => p.user.indexOf(m));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    expect(p.user).not.toContain('- 힌트:');
    expect(p.user).not.toContain('- 주의:');
    expect(ITEM_DEFS.credibilityScore.multi).toBeUndefined();
    expect(buildPrompt({ ...base, keys: ['credibilityScore'] }).user).not.toContain('- 다중값:');
  });

  it('실적 인정금액은 string 형식으로 스키마에 전달된다', () => {
    expect(PROMPT_VERSION).toBe('2.2.0');
    const p = buildPrompt({ ...base, keys: ['performanceMinAmount', 'credibilityScore'] });
    expect(p.spec.kindOf.performanceMinAmount).toBe('string');
    expect(p.spec.kindOf.credibilityScore).toBe('number');
  });

  it('16개 키 요청 시 정의 16개, 공고 잎은 string', () => {
    const p = buildPrompt({ ...base, keys: [...AI_KEYS] });
    expect(p.spec.keys).toEqual([...AI_KEYS]);
    expect(p.user.match(/^### /gm)).toHaveLength(16);
    for (const k of AI_KEYS.filter((x) => !isDocAiKey(x))) expect(p.spec.kindOf[k as never]).toBe('string');
    expect(p.system).toContain('공고 핵심 정보');
  });
});
