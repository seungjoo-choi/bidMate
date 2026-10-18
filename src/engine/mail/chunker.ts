export interface BlobChunk { seq: number; total: number; b64: string }

export const DEFAULT_CHUNK_BYTES = 2 * 1024 * 1024;

function readAsBase64(slice: Blob): Promise<string> {
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onerror = () => reject(r.error ?? new Error('FileReader 실패'));
      r.onload = () => {
        const s = String(r.result);
        resolve(s.slice(s.indexOf(',') + 1));
      };
      r.readAsDataURL(slice);
    });
  }
  return slice.arrayBuffer().then((buf) => {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  });
}

/**
 * Blob을 chunkBytes 단위로 잘라 base64로 내보낸다.
 * 0바이트 Blob은 total 0이고 청크를 내보내지 않는다(수신 측은 file/end에서 빈 File을 만든다).
 */
export async function* chunkBlob(blob: Blob, chunkBytes = DEFAULT_CHUNK_BYTES): AsyncGenerator<BlobChunk> {
  const total = Math.ceil(blob.size / chunkBytes);
  for (let seq = 0; seq < total; seq++) {
    yield { seq, total, b64: await readAsBase64(blob.slice(seq * chunkBytes, (seq + 1) * chunkBytes)) };
  }
}
