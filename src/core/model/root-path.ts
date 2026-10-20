/**
 * 저장 폴더의 실제 경로(사용자가 한 번 붙여 넣은 값).
 * 크롬 폴더 접근 기능은 폴더 이름만 주고 전체 경로는 주지 않으므로, 전체 경로 복사는 이 값으로 만든다.
 */

/** chrome.storage.local 키. 값은 StoredRootPath. 저장 폴더를 다시 고르면 지운다 */
export const ROOT_PATH_KEY = 'fs.rootPath';
/** 경로 입력을 건너뛰었으면 true. 다시 묻지 않고 폴더 안쪽 경로만 복사한다 */
export const ROOT_PATH_SKIP_KEY = 'fs.rootPathSkip';

export interface StoredRootPath { rootName: string; path: string; }

export type RootPathCheck = { ok: true; path: string } | { ok: false; reason: string };

const isAbsolute = (p: string) => p.startsWith('/') || p.startsWith('~/') || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\');

/** 붙여 넣은 값을 다듬고, 고른 폴더(rootName)를 가리키는지 확인한다 */
export function checkRootPath(input: string, rootName: string): RootPathCheck {
  // 윈도우 "경로로 복사"는 따옴표로 감싸고, 끝에 구분자가 붙어 오는 경우가 있다
  let p = input.trim().replace(/^["']|["']$/g, '').trim();
  if (p.startsWith('file://')) {
    try { p = decodeURIComponent(new URL(p).pathname).replace(/^\/([A-Za-z]:)/, '$1'); } catch { /* 아래 검사에서 걸린다 */ }
  }
  if (p.length > 3) p = p.replace(/[\\/]+$/, '');
  if (!p) return { ok: false, reason: '경로를 붙여 넣어 주세요' };
  if (!isAbsolute(p)) return { ok: false, reason: '전체 경로가 아닙니다. /Users/... 또는 C:\\... 처럼 시작해야 합니다' };
  const last = p.split(/[\\/]/).pop() ?? '';
  if (last.normalize('NFC') !== rootName.normalize('NFC')) return { ok: false, reason: `저장 폴더 '${rootName}'의 경로가 아닙니다` };
  return { ok: true, path: p };
}

/** 저장 폴더 경로 + 폴더 안쪽 경로(notices/2026/...). 구분자는 저장 경로의 것을 따른다 */
export function joinRootPath(root: string, rel: string): string {
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/';
  const tail = rel.split(/[\\/]+/).filter(Boolean).join(sep);
  return tail ? `${root}${sep}${tail}` : root;
}
