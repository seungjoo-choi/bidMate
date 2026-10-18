import type { FileMeta } from '../../messaging/protocol';

interface Entry { meta: FileMeta; next: number; total?: number; parts: Uint8Array[]; bytes: number }

const MB = 1024 * 1024;

export class FileBufferError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'FileBufferError';
  }
}

/** 청크를 순서대로 받아 File로 조립한다. 0바이트 파일은 total 0, 청크 없이 end를 받는 규칙이다. */
export class FileBuffer {
  private entries = new Map<string, Entry>();
  private readonly limitBytes: number;

  constructor(maxFileMB: number) {
    this.limitBytes = maxFileMB * 2 * MB;
  }

  private held(): number {
    let n = 0;
    for (const e of this.entries.values()) n += e.meta.size;
    return n;
  }

  begin(meta: FileMeta): void {
    if (this.entries.has(meta.fileId)) throw new FileBufferError('DUPLICATE_FILE', `이미 시작된 파일입니다: ${meta.fileId}`);
    if (this.held() + meta.size > this.limitBytes) throw new FileBufferError('BUFFER_LIMIT', '버퍼 보유량 상한을 넘습니다.');
    this.entries.set(meta.fileId, { meta, next: 0, parts: [], bytes: 0 });
  }

  async push(fileId: string, seq: number, b64: string, total?: number): Promise<number> {
    const e = this.entries.get(fileId);
    if (!e) throw new FileBufferError('UNKNOWN_FILE', `begin되지 않은 파일입니다: ${fileId}`);
    if (seq < e.next) throw new FileBufferError('DUPLICATE_CHUNK', `중복 청크입니다: ${seq}`);
    if (seq > e.next) throw new FileBufferError('OUT_OF_ORDER', `청크 순서가 어긋났습니다: 기대 ${e.next}, 수신 ${seq}`);
    if (total !== undefined) {
      if (e.total !== undefined && e.total !== total) throw new FileBufferError('TOTAL_MISMATCH', 'total 값이 바뀌었습니다.');
      e.total = total;
    }
    const res = await fetch('data:application/octet-stream;base64,' + b64);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (e.bytes + bytes.length > e.meta.size) throw new FileBufferError('SIZE_MISMATCH', '선언된 크기를 넘는 데이터입니다.');
    e.parts.push(bytes);
    e.bytes += bytes.length;
    e.next += 1;
    return e.next;
  }

  end(fileId: string): File {
    const e = this.entries.get(fileId);
    if (!e) throw new FileBufferError('UNKNOWN_FILE', `begin되지 않은 파일입니다: ${fileId}`);
    if (e.total !== undefined && e.next !== e.total) throw new FileBufferError('INCOMPLETE', `청크가 부족합니다: ${e.next}/${e.total}`);
    if (e.bytes !== e.meta.size) throw new FileBufferError('SIZE_MISMATCH', `크기가 다릅니다: 선언 ${e.meta.size}, 수신 ${e.bytes}`);
    return new File(e.parts as BlobPart[], e.meta.name, e.meta.mime ? { type: e.meta.mime } : undefined);
  }

  /** 조립/첨부가 끝난 파일의 보유량을 반환한다. */
  release(fileId: string): void {
    this.entries.delete(fileId);
  }

  clear(): void {
    this.entries.clear();
  }
}
