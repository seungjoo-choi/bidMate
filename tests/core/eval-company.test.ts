import { describe, expect, it } from 'vitest';
import { isOurs, normalizeBizNo } from '../../src/core/evaluation/company';
import { defaultSettings, withDefaults } from '../../src/core/model/default-settings';
import type { Settings } from '../../src/core/types/settings';

const S = (bizNo: string) => ({ company: { bizNo } });

describe('company', () => {
  it('normalizeBizNo는 숫자만 남긴다', () => {
    expect(normalizeBizNo('597-86-00662')).toBe('5978600662');
    expect(normalizeBizNo(' 597 86 00662 ')).toBe('5978600662');
    expect(normalizeBizNo('')).toBe('');
  });
  it('isOurs는 설정이 10자리일 때만 비교한다', () => {
    expect(isOurs('5978600662', S('597-86-00662'))).toBe(true);
    expect(isOurs('597-86-00662', S('5978600662'))).toBe(true);
    expect(isOurs('1198633696', S('5978600662'))).toBe(false);
    expect(isOurs('', S(''))).toBe(false);
    expect(isOurs('123', S('123'))).toBe(false);
  });
  it('기본 설정과 withDefaults', () => {
    expect(defaultSettings().company).toEqual({ bizNo: '' });
    const old = { ...defaultSettings(), company: undefined } as unknown as Settings;
    expect(withDefaults(old).company).toEqual({ bizNo: '' });
    expect(withDefaults({ ...defaultSettings(), company: { bizNo: '1', name: 'x' } }).company).toEqual({ bizNo: '1', name: 'x' });
  });
});
