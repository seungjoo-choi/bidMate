import { describe, expect, it } from 'vitest';
import { EXTRACTION_KEYS } from '../../src/core/types/extraction';
import { aiErrorText, aiSetupBlock, isFindingKey, scopeKeys } from '../../src/ui/review/ai-view';

const ai = (over: Partial<{ provider: 'claude' | 'openai' | 'gemini'; mode: 'api' | 'manual'; models: Record<string, string> }> = {}) =>
  ({ provider: 'gemini' as const, mode: 'api' as const, models: { gemini: 'gemini-x' }, ...over });
const has = { claude: false, openai: false, gemini: true };

describe('aiSetupBlock', () => {
  it('키·모델이 있으면 null', () => expect(aiSetupBlock(ai(), has)).toBeNull());
  it('키 없음', () => expect(aiSetupBlock(ai(), { ...has, gemini: false })?.code).toBe('AI_KEY_MISSING'));
  it('모델 없음', () => expect(aiSetupBlock(ai({ models: { gemini: ' ' } }), has)?.code).toBe('AI_MODEL_MISSING'));
  it('반자동이거나 키 상태 로딩 중이면 null', () => {
    expect(aiSetupBlock(ai({ mode: 'manual' }), { ...has, gemini: false })).toBeNull();
    expect(aiSetupBlock(ai(), null)).toBeNull();
  });
});

describe('scopeKeys', () => {
  it('auto는 확인 필요가 있으면 그것만, 없으면 전체', () => {
    expect(scopeKeys('auto', undefined, ['managementScore'])).toEqual(['managementScore']);
    expect(scopeKeys('auto', undefined, [])).toEqual([...EXTRACTION_KEYS]);
  });
  it('keys·pending·all', () => {
    expect(scopeKeys('keys', ['credibilityScore'], [])).toEqual(['credibilityScore']);
    expect(scopeKeys('pending', undefined, ['managementScore'])).toEqual(['managementScore']);
    expect(scopeKeys('all', undefined, [])).toHaveLength(EXTRACTION_KEYS.length);
  });
});

describe('aiErrorText / isFindingKey', () => {
  it('알려진 코드는 한국어 문구, 그 외는 코드+메시지', () => {
    expect(aiErrorText('AI_RUN_BUSY', 'x')).toContain('AI 실행 중');
    expect(aiErrorText('AI_HTTP', '실패')).toBe('AI_HTTP 실패');
  });
  it('requesting run이 요청한 키만 true', () => {
    expect(isFindingKey({ status: 'requesting', keys: ['credibilityScore'] }, 'credibilityScore')).toBe(true);
    expect(isFindingKey({ status: 'requesting', keys: ['credibilityScore'] }, 'managementScore')).toBe(false);
    expect(isFindingKey({ status: 'done', keys: ['credibilityScore'] }, 'credibilityScore')).toBe(false);
    expect(isFindingKey(null, 'credibilityScore')).toBe(false);
  });
});
