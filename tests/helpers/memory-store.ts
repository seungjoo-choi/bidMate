import type { IFileStore } from '../../src/engine/file-store/types';
import { normalizePath } from '../../src/core/model/path';

/** 메모리 fake FileStore. */
export class MemoryStore implements IFileStore {
  files = new Map<string, string | Uint8Array>();
  dirs = new Set<string>();
  failStreamFor = new Set<string>();
  private locks = new Map<string, Promise<unknown>>();

  withLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(path) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(fn);
    this.locks.set(path, run.catch(() => undefined));
    return run;
  }
  async writeText(path: string, text: string) { this.files.set(normalizePath(path), text); }
  async readText(path: string) {
    const v = this.files.get(normalizePath(path));
    if (v === undefined) throw Object.assign(new Error('not found'), { name: 'NotFoundError' });
    return typeof v === 'string' ? v : new TextDecoder().decode(v);
  }
  async readBytes(path: string) {
    const v = this.files.get(normalizePath(path));
    if (v === undefined) throw Object.assign(new Error('not found'), { name: 'NotFoundError' });
    return typeof v === 'string' ? new TextEncoder().encode(v) : v;
  }
  async readBlob(path: string) { return new Blob([(await this.readBytes(path)) as BlobPart]); }
  async remove(path: string) { this.files.delete(normalizePath(path)); }
  async list(path: string) {
    const p = normalizePath(path);
    const prefix = p === '' ? '' : `${p}/`;
    const out = new Map<string, 'file' | 'directory'>();
    for (const f of this.files.keys()) {
      if (!f.startsWith(prefix)) continue;
      const rest = f.slice(prefix.length);
      const i = rest.indexOf('/');
      out.set(i < 0 ? rest : rest.slice(0, i), i < 0 ? 'file' : 'directory');
    }
    if (out.size === 0 && p !== '' && !this.dirs.has(p)) throw Object.assign(new Error('not found'), { name: 'NotFoundError' });
    return [...out].map(([name, kind]) => ({ name, kind }));
  }
  async writeStream(path: string, stream: ReadableStream<Uint8Array>) {
    const p = normalizePath(path);
    // FSA처럼 쓰기 시작 시 빈 파일이 먼저 생기고, 실패해도 정리되지 않는다(정리는 호출 측 책임).
    if (!this.files.has(p)) this.files.set(p, new Uint8Array(0));
    if (this.failStreamFor.has(p)) throw Object.assign(new Error('quota'), { code: 'DISK_FULL' });
    const chunks: Uint8Array[] = [];
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const buf = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let o = 0;
    for (const c of chunks) { buf.set(c, o); o += c.length; }
    this.files.set(p, buf);
    return buf.length;
  }
  async fileSize(path: string) {
    const v = this.files.get(normalizePath(path));
    return v === undefined ? null : typeof v === 'string' ? v.length : v.length;
  }
  async ensureDir(path: string) { this.dirs.add(normalizePath(path)); }
}
