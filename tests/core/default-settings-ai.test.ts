import { describe, expect, it } from 'vitest';
import { AI_DEFAULT_MODELS } from '../../src/core/ai/constants';
import { defaultSettings, withDefaults } from '../../src/core/model/default-settings';

describe('ai 설정 기본값과 병합', () => {
  it('기본값: gemini / api / AI_DEFAULT_MODELS', () => {
    expect(defaultSettings().ai).toEqual({ provider: 'gemini', mode: 'api', models: AI_DEFAULT_MODELS, sendFullText: true });
  });
  it('ai가 없는 저장본은 기본값으로 채운다', () => {
    const { ai: _omit, ...rest } = defaultSettings();
    expect(withDefaults(rest as unknown as ReturnType<typeof defaultSettings>).ai).toEqual(defaultSettings().ai);
  });
  it('models 깊은 병합: 저장된 공급자만 덮어쓰고 나머지는 기본값', () => {
    const d = defaultSettings();
    const s = withDefaults({ ...d, ai: { provider: 'claude', mode: 'manual', models: { gemini: 'g-1' }, sendFullText: false } });
    expect(s.ai.provider).toBe('claude');
    expect(s.ai.mode).toBe('manual');
    expect(s.ai.models).toEqual({ ...AI_DEFAULT_MODELS, gemini: 'g-1' });
    expect(s.ai.sendFullText).toBe(false);
  });
  it('sendFullText가 없는 기존 저장본은 true로 채운다', () => {
    const d = defaultSettings();
    const { sendFullText: _omit, ...oldAi } = d.ai;
    expect(withDefaults({ ...d, ai: oldAi as unknown as typeof d.ai }).ai.sendFullText).toBe(true);
  });
  it('defaultSettings 호출마다 models 객체를 공유하지 않는다', () => {
    const a = defaultSettings();
    a.ai.models.claude = 'changed';
    expect(defaultSettings().ai.models.claude).toBe(AI_DEFAULT_MODELS.claude);
  });
});
