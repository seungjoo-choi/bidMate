import { describe, expect, it } from 'vitest';
import { formatChars, isModelValid, keyTail, keyTails, mergeAiKey, modelOptions, originPattern } from '../../src/entrypoints/dashboard/ai-card-logic';

describe('ai-card-logic', () => {
  it('originPattern: 끝 슬래시를 정규화하고 /* 를 붙인다', () => {
    expect(originPattern('https://api.anthropic.com')).toBe('https://api.anthropic.com/*');
    expect(originPattern('https://api.openai.com/')).toBe('https://api.openai.com/*');
  });

  it('keyTail: 끝 4자리만 노출한다', () => {
    expect(keyTail('sk-abcdef1234')).toBe('****1234');
    expect(keyTail('ab')).toBe('****ab');
  });

  it('modelOptions: 현재값이 목록에 없으면 맨 위에 덧붙인다', () => {
    const opts = modelOptions([{ id: 'a' }, { id: 'b', displayName: 'Bee' }], 'x');
    expect(opts.map((o) => o.value)).toEqual(['x', 'a', 'b']);
    expect(opts[2]?.label).toBe('Bee (b)');
    expect(modelOptions([{ id: 'a' }], 'a')).toHaveLength(1);
    expect(modelOptions([], '')).toEqual([]);
  });

  it('isModelValid: 목록이 있으면 포함 여부, 없으면 비어 있지 않은지', () => {
    expect(isModelValid([], 'foo')).toBe(true);
    expect(isModelValid([], '  ')).toBe(false);
    expect(isModelValid([{ id: 'a' }], 'a')).toBe(true);
    expect(isModelValid([{ id: 'a' }], 'b')).toBe(false);
  });

  it('formatChars: 약 N자', () => {
    expect(formatChars(30000)).toMatch(/^약 30[,.]?000자$/);
  });

  it('mergeAiKey: 기존 secrets와 다른 공급자 키를 보존한다', () => {
    expect(mergeAiKey(undefined, 'gemini', 'k1')).toEqual({ ai: { gemini: 'k1' } });
    expect(mergeAiKey({ g2bServiceKey: 'g', ai: { claude: 'c' } }, 'gemini', 'k1')).toEqual({ g2bServiceKey: 'g', ai: { claude: 'c', gemini: 'k1' } });
  });

  it('keyTails: 끝 4자리만 남기고 원문·빈 값은 제외한다', () => {
    const r = keyTails({ claude: 'sk-ant-SECRET9999', openai: '', gemini: 'AIzaXYZ1234' });
    expect(r).toEqual({ claude: '****9999', gemini: '****1234' });
    expect(JSON.stringify(r)).not.toContain('SECRET');
    expect(keyTails(undefined)).toEqual({});
  });
});
