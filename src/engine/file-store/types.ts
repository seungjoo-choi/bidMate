/** FileStore 추상. 실제 구현은 FSA(FileStore), 테스트는 메모리 fake. */
export interface IFileStore {
  withLock<T>(path: string, fn: () => Promise<T>): Promise<T>;
  readBytes(path: string): Promise<Uint8Array>;
  readBlob(path: string): Promise<Blob>;
  writeText(path: string, text: string): Promise<void>;
  readText(path: string): Promise<string>;
  remove(path: string): Promise<void>;
  list(path: string): Promise<Array<{ name: string; kind: 'file' | 'directory' }>>;
  /** 스트림을 파일로 쓰고 최종 파일 크기를 반환한다. 실패 시 abort되어 기존 파일은 유지된다. */
  writeStream(path: string, stream: ReadableStream<Uint8Array>): Promise<number>;
  /** 파일 크기. 없으면 null. */
  fileSize(path: string): Promise<number | null>;
  ensureDir(path: string): Promise<void>;
}
