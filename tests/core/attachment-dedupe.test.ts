import { describe, expect, it } from 'vitest';
import { attachmentNameKey } from '../../src/core/model/attachment-dedupe';

describe('attachmentNameKey', () => {
  it('공백, 괄호, 대소문자 차이는 같은 키', () => {
    expect(attachmentNameKey('제안요청서 (최종).HWP')).toBe(attachmentNameKey('제안요청서(최종).hwp'));
  });
  it('확장자가 다르면 다른 키', () => {
    expect(attachmentNameKey('a.hwp')).not.toBe(attachmentNameKey('a.pdf'));
    expect(attachmentNameKey('.hwp')).not.toBe(attachmentNameKey('.pdf'));
  });
  it('NFD와 NFC는 같은 키', () => {
    const nfc = '제안요청서.hwp'.normalize('NFC');
    expect(attachmentNameKey(nfc.normalize('NFD'))).toBe(attachmentNameKey(nfc));
  });
});
