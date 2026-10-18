/** 서식 있는 복사. text/html을 지원하지 않는 환경에서는 텍스트만 복사한다. */
export async function copyRich(html: string, text: string): Promise<void> {
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      })]);
      return;
    } catch { /* 텍스트 복사로 대체 */ }
  }
  await copyText(text);
}

export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}
