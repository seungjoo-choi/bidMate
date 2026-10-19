import { describe, expect, it } from 'vitest';
import { normalizeTemplate } from '../../src/core/templates/normalize';

const NOW = new Date('2026-10-18T00:00:00.000Z');

describe('normalizeTemplate', () => {
  it('알 수 없는 fieldKey 항목을 제거하고 warning', () => {
    const { template, warnings } = normalizeTemplate({
      id: 't1', name: 'n',
      sections: [{ id: 's', title: 'T', items: [
        { fieldKey: 'title', label: '사업명', visible: true },
        { fieldKey: 'bogus', label: 'x', visible: true },
        { fieldKey: 'custom.foo', label: 'y' },
      ] }],
    }, NOW);
    expect(template.sections[0]!.items.map((i) => (i as { fieldKey: string }).fieldKey)).toEqual(['title', 'custom.foo']);
    expect(template.sections[0]!.items[1]!.visible).toBe(true);
    expect(warnings).toHaveLength(1);
  });

  it('sections 비배열이면 빈 배열, 문자열 필드는 빈 문자열', () => {
    const { template } = normalizeTemplate({ id: 't', sections: 'x', subject: 1 }, NOW);
    expect(template.sections).toEqual([]);
    expect(template.subject).toBe('');
    expect(template.greeting).toBe('');
    expect(template.closing).toBe('');
    expect(template.updatedAt).toBe(NOW.toISOString());
  });

  it('id 없으면 tpl_ 접두 id 부여', () => {
    const { template } = normalizeTemplate({}, NOW);
    expect(template.id).toMatch(/^tpl_/);
    expect(template.isDefault).toBe(false);
  });
});

describe('normalizeTemplate kind', () => {
  it('prespec/orderplan은 보존한다', () => {
    expect(normalizeTemplate({ id: 't', kind: 'prespec' }, NOW).template.kind).toBe('prespec');
    expect(normalizeTemplate({ id: 't', kind: 'orderplan' }, NOW).template.kind).toBe('orderplan');
  });
  it('bid/없음/잘못된 값은 kind 속성을 생략한다', () => {
    for (const kind of ['bid', undefined, 'x', 1]) {
      const { template } = normalizeTemplate({ id: 't', kind }, NOW);
      expect('kind' in template).toBe(false);
    }
  });
});
