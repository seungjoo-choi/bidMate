import { loadRootRecord } from './idb-handles';
import { FsError } from './errors';
import type { IFileStore } from './types';
import { normalizePath } from '../../core/model/path';
import type { FsPermission } from '../../messaging/protocol';

export { FsError };

const splitPath = (path: string): string[] => normalizePath(path).split('/').filter((p) => p !== '');

/** 권한 관련 DOMException을 NEEDS_FS_PERMISSION으로 변환한다. */
async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const name = (e as { name?: string } | null)?.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw new FsError('NEEDS_FS_PERMISSION', '저장 폴더 접근 권한이 필요합니다.');
    }
    if (name === 'QuotaExceededError') throw new FsError('DISK_FULL', '저장 공간이 부족합니다.');
    throw e;
  }
}

/** FSA 단일 작성자. offscreen 문서에서만 사용한다. */
export class FileStore implements IFileStore {
  private root: FileSystemDirectoryHandle | null = null;
  private rootName: string | undefined;
  private locks = new Map<string, Promise<unknown>>();

  /** IDB에서 루트 핸들을 (다시) 로드한다. */
  async reload(): Promise<boolean> {
    const rec = await loadRootRecord();
    this.root = rec?.handle ?? null;
    this.rootName = rec?.name;
    return this.root !== null;
  }

  async status(): Promise<{ hasRoot: boolean; rootName?: string; permission: FsPermission }> {
    if (!this.root) await this.reload();
    if (!this.root) return { hasRoot: false, permission: 'prompt' };
    const permission = (await this.root.queryPermission({ mode: 'readwrite' })) as FsPermission;
    return { hasRoot: true, rootName: this.rootName, permission };
  }

  /** 쓰기 가능한 루트를 반환한다. 권한이 granted가 아니면 NEEDS_FS_PERMISSION. */
  private async requireRoot(): Promise<FileSystemDirectoryHandle> {
    const st = await this.status();
    if (!st.hasRoot || st.permission !== 'granted' || !this.root) {
      throw new FsError('NEEDS_FS_PERMISSION', '저장 폴더 접근 권한이 필요합니다.');
    }
    return this.root;
  }

  private async getDir(path: string, create: boolean): Promise<FileSystemDirectoryHandle> {
    let dir = await this.requireRoot();
    for (const part of splitPath(path)) dir = await dir.getDirectoryHandle(part, { create });
    return dir;
  }

  private async getParent(path: string, create: boolean): Promise<{ dir: FileSystemDirectoryHandle; name: string }> {
    const parts = splitPath(path);
    const name = parts.pop();
    if (!name) throw new FsError('INVALID_PATH', `잘못된 경로: ${path}`);
    return { dir: await this.getDir(parts.join('/'), create), name };
  }

  /** 경로별 async 직렬 큐. */
  withLock<T>(rawPath: string, fn: () => Promise<T>): Promise<T> {
    let path: string;
    try {
      path = normalizePath(rawPath);
    } catch (e) {
      return Promise.reject(e);
    }
    const prev = this.locks.get(path) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(fn);
    const tail = run.catch(() => undefined);
    this.locks.set(path, tail);
    void tail.then(() => {
      if (this.locks.get(path) === tail) this.locks.delete(path);
    });
    return run;
  }

  writeText(path: string, text: string): Promise<void> {
    return guard(() => this.writeTextRaw(path, text));
  }

  private async writeTextRaw(path: string, text: string): Promise<void> {
    const { dir, name } = await this.getParent(path, true);
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    try {
      await w.write(text);
      await w.close();
    } catch (e) {
      await w.abort().catch(() => undefined);
      throw e;
    }
  }

  readText(path: string): Promise<string> {
    return guard(() => this.readTextRaw(path));
  }

  private async readTextRaw(path: string): Promise<string> {
    const { dir, name } = await this.getParent(path, false);
    const fh = await dir.getFileHandle(name);
    return (await fh.getFile()).text();
  }

  readBytes(path: string): Promise<Uint8Array> {
    return guard(async () => {
      const { dir, name } = await this.getParent(path, false);
      const fh = await dir.getFileHandle(name);
      return new Uint8Array(await (await fh.getFile()).arrayBuffer());
    });
  }

  readBlob(path: string): Promise<Blob> {
    return guard(async () => {
      const { dir, name } = await this.getParent(path, false);
      const fh = await dir.getFileHandle(name);
      return await fh.getFile();
    });
  }

  remove(path: string): Promise<void> {
    return guard(() => this.removeRaw(path));
  }

  private async removeRaw(path: string): Promise<void> {
    const { dir, name } = await this.getParent(path, false);
    await dir.removeEntry(name, { recursive: true });
  }

  /** 항목 이름 목록. `*.crswap`은 무시한다. */
  list(path: string): Promise<Array<{ name: string; kind: 'file' | 'directory' }>> {
    return guard(() => this.listRaw(path));
  }

  private async listRaw(path: string): Promise<Array<{ name: string; kind: 'file' | 'directory' }>> {
    const dir = await this.getDir(path, false);
    const out: Array<{ name: string; kind: 'file' | 'directory' }> = [];
    for await (const [name, h] of dir.entries()) {
      if (name.endsWith('.crswap')) continue;
      out.push({ name, kind: h.kind });
    }
    return out;
  }

  writeStream(path: string, stream: ReadableStream<Uint8Array>): Promise<number> {
    return guard(async () => {
      const { dir, name } = await this.getParent(path, true);
      const existed = await dir.getFileHandle(name).then(() => true, () => false);
      const fh = await dir.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      try {
        // pipeTo는 성공 시 close, 실패 시 대상을 abort한다.
        await stream.pipeTo(w);
      } catch (e) {
        await w.abort().catch(() => undefined);
        // 새로 만든 파일이면 0바이트 파일이 남지 않게 지운다. 기존 파일은 swap abort로 원본이 유지된다.
        if (!existed) await dir.removeEntry(name).catch(() => undefined);
        throw e;
      }
      return (await fh.getFile()).size;
    });
  }

  fileSize(path: string): Promise<number | null> {
    return guard(async () => {
      try {
        const { dir, name } = await this.getParent(path, false);
        return (await (await dir.getFileHandle(name)).getFile()).size;
      } catch (e) {
        if ((e as { name?: string })?.name === 'NotFoundError' || (e as { name?: string })?.name === 'TypeMismatchError') return null;
        throw e;
      }
    });
  }

  ensureDir(path: string): Promise<void> {
    return guard(async () => { await this.getDir(path, true); });
  }
}

export const fileStore = new FileStore();
