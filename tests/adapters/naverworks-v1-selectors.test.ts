import { describe, expect, it } from 'vitest';
import { SELECTOR_SETS } from '../../src/adapters/naverworks/selectors';

describe('naverworks-v1 셀렉터셋', () => {
  const s = SELECTOR_SETS['naverworks-v1']!;
  it('실측 값', () => {
    expect(s).toMatchObject({ id: 'naverworks-v1', status: 'verified', version: '1.1.0' });
    expect(s.compose.readySelector).toBe('#cont_flex_area input[name="subject"]');
    expect(s.subject.input).toBe('#cont_flex_area input[name="subject"]');
    expect(s.body).toEqual({
      kind: 'iframe', iframe: '#cont_flex_area iframe', editable: '.workseditor-content[contenteditable="true"]',
      insert: ['execCommand', 'paste', 'innerHTML'], keep: '[data-workseditor="sign-content"]',
    });
    expect(s.to.input).toBe('');
    expect(s.cc.input).toBe('');
    expect(s.attach).toMatchObject({
      inBodyFrame: true, fileInput: '#fileContent', item: 'li.attachment_item', itemName: '.file_name_cover', itemSize: '.file_size', methods: ['input'],
    });
    expect(s.attach.itemProgress).toBeUndefined();
    expect(s.forbidden.send).toEqual(['[data-hotkey="sendKey"]']);
  });
});
