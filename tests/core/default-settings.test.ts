import { describe, expect, it } from 'vitest';
import { defaultSettings, withDefaults } from '../../src/core/model/default-settings';

describe('autoCompose 기본값', () => {
  it('defaultSettings', () => {
    expect(defaultSettings().autoCompose).toEqual({ enabled: false, recipients: { mode: 'default' }, reviewGate: 'conflicts' });
  });
  it('withDefaults: autoCompose가 없는 저장본은 기본값으로 채운다', () => {
    const { autoCompose: _omit, ...rest } = defaultSettings();
    const s = withDefaults(rest as unknown as ReturnType<typeof defaultSettings>);
    expect(s.autoCompose.enabled).toBe(false);
    expect(s.autoCompose.reviewGate).toBe('conflicts');
  });
  it('withDefaults: 저장된 값이 기본값을 덮어쓴다', () => {
    const d = defaultSettings();
    const s = withDefaults({ ...d, autoCompose: { enabled: true, recipients: { mode: 'group', groupId: 'g' }, reviewGate: 'any_review' } });
    expect(s.autoCompose).toEqual({ enabled: true, recipients: { mode: 'group', groupId: 'g' }, reviewGate: 'any_review' });
  });
});
