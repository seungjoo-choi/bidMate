import type { IFileStore } from './types';

/** 디렉터리 안을 먼저 지운 뒤 디렉터리를 지운다. 없으면 무시. 그 밖의 목록·파일 삭제 오류는 던진다. */
export async function removeTree(store: IFileStore, dir: string): Promise<void> {
  let items: Array<{ name: string; kind: string }>;
  try {
    items = await store.list(dir);
  } catch (e) {
    // 없음만 무시한다. 다른 오류를 삼키면 폴더가 남은 채 index만 지워져 재생성 때 되살아난다.
    const name = (e as { name?: string } | null)?.name;
    if (name === 'NotFoundError' || name === 'TypeMismatchError') return;
    throw e;
  }
  for (const it of items) {
    if (it.kind === 'directory') await removeTree(store, `${dir}/${it.name}`);
    else await store.remove(`${dir}/${it.name}`);
  }
  try {
    await store.remove(dir);
  } catch (e) {
    if ((e as { code?: string } | null)?.code === 'NEEDS_FS_PERMISSION') throw e;
  }
}
