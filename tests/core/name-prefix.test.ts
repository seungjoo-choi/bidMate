import { describe, expect, it } from 'vitest';
import { activeNamePrefix, withNamePrefix, withoutNamePrefix } from '../../src/core/model/names';
import { withDefaults } from '../../src/core/model/default-settings';
import type { Settings } from '../../src/core/types/settings';

describe('파일 이름 태그', () => {
  it('activeNamePrefix: 꺼짐·빈 문구는 undefined, 앞뒤 공백 제거', () => {
    expect(activeNamePrefix({ enabled: false, text: '[대외비 2군]' })).toBeUndefined();
    expect(activeNamePrefix({ enabled: true, text: '  ' })).toBeUndefined();
    expect(activeNamePrefix({ enabled: true, text: ' [대외비 1군] ' })).toBe('[대외비 1군]');
    expect(activeNamePrefix(undefined)).toBeUndefined();
  });
  it('activeNamePrefix: 파일명에 못 쓰는 문자는 뗀다', () => {
    expect(activeNamePrefix({ enabled: true, text: '[대외비/2군]' })).toBe('[대외비2군]');
    expect(activeNamePrefix({ enabled: true, text: '[대외비..2군]' })).toBe('[대외비.2군]');
    expect(activeNamePrefix({ enabled: true, text: '???' })).toBeUndefined();
  });
  it('withNamePrefix / withoutNamePrefix 왕복', () => {
    expect(withNamePrefix('a.hwp', '[대외비 2군]')).toBe('[대외비 2군] a.hwp');
    expect(withNamePrefix('[대외비 2군] a.hwp', '[대외비 2군]')).toBe('[대외비 2군] a.hwp');
    expect(withNamePrefix('a.hwp', undefined)).toBe('a.hwp');
    expect(withoutNamePrefix('[대외비 2군] a.hwp', '[대외비 2군]')).toBe('a.hwp');
    expect(withoutNamePrefix('[붙임1] a.hwp', '[대외비 2군]')).toBe('[붙임1] a.hwp');
    expect(withoutNamePrefix('[붙임1] a.hwp', undefined)).toBe('[붙임1] a.hwp');
    expect(withoutNamePrefix('[대외비 2군]a.hwp', '[대외비 2군]')).toBe('a.hwp');
  });
  it('예전 설정(namePrefix 없음)은 기본값 [대외비 2군] 켜짐으로 채운다', () => {
    const stored = { ...withDefaults(undefined), download: { concurrency: 1, maxRetries: 1, backoffMs: 1, maxFileMB: 5 } } as unknown as Settings;
    const s = withDefaults(stored);
    expect(s.download.maxFileMB).toBe(5);
    expect(s.download.namePrefix).toEqual({ enabled: true, text: '[대외비 2군]' });
  });
});
