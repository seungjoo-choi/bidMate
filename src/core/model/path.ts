import { FsError } from '../../engine/file-store/errors';

/** 경로 정규화: `\`→`/`, 연속 `/` 축약, 앞뒤 `/` 제거. `.`/`..` 세그먼트는 오류. */
export function normalizePath(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter((p) => p !== '');
  for (const p of parts) {
    if (p === '.' || p === '..') throw new FsError('INVALID_PATH', `잘못된 경로: ${path}`);
  }
  return parts.join('/');
}
