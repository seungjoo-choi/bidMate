const OFFSCREEN_PATH = 'offscreen.html';

let creating: Promise<void> | null = null;

export async function hasOffscreen(): Promise<boolean> {
  const url = chrome.runtime.getURL(OFFSCREEN_PATH);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [url],
  });
  return contexts.length > 0;
}

/** offscreen 문서를 단일 인스턴스로 보장한다. 동시 호출은 같은 Promise를 공유한다. */
export function ensureOffscreen(): Promise<void> {
  if (creating) return creating;
  creating = (async () => {
    if (await hasOffscreen()) return;
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: [
        chrome.offscreen.Reason.BLOBS,
        chrome.offscreen.Reason.DOM_PARSER,
        chrome.offscreen.Reason.WORKERS,
      ],
      justification: '로컬 폴더 파일 I/O, 문서 파싱, 다운로드 엔진 호스팅',
    });
  })().finally(() => {
    creating = null;
  });
  return creating;
}
