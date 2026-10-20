/** 첨부 이름 비교 키: NFC, 소문자, 공백과 괄호류 제거(확장자 포함). */
export function attachmentNameKey(name: string): string {
  return name.normalize('NFC').toLowerCase().replace(/[\s()[\]（）]/g, '');
}
