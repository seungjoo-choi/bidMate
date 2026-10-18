import * as CFB from 'cfb';
import { Inflate } from 'fflate';
import { MAX_INFLATE_BYTES } from '../../../core/doc/limits';
import { yieldToLoop } from '../yield';

export interface Hwp5Header { compressed: boolean; encrypted: boolean; drm: boolean }

const toU8 = (c: unknown): Uint8Array => Uint8Array.from(c as ArrayLike<number>);

export function openCfb(bytes: Uint8Array): CFB.CFB$Container {
  return CFB.read(bytes, { type: 'array' });
}

/** FileHeader: offset 36의 UINT32 속성. bit0 압축, bit1 암호, bit2 배포용. */
export function readHeader(c: CFB.CFB$Container): Hwp5Header | null {
  const fh = CFB.find(c, '/FileHeader');
  if (!fh?.content) return null;
  const b = toU8(fh.content);
  if (b.length < 40) return null;
  const attr = new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(36, true);
  return { compressed: (attr & 1) !== 0, encrypted: (attr & 2) !== 0, drm: (attr & 4) !== 0 };
}

/** BodyText/Section{n}을 숫자 순서로. BodyText가 없으면 빈 배열. */
export function listSections(c: CFB.CFB$Container): { n: number; bytes: Uint8Array }[] {
  const out: { n: number; bytes: Uint8Array }[] = [];
  c.FullPaths.forEach((p, i) => {
    const m = /(?:^|\/)BodyText\/Section(\d+)$/.exec(p);
    const ent = c.FileIndex[i];
    if (m && ent?.content) out.push({ n: Number(m[1]), bytes: toU8(ent.content) });
  });
  return out.sort((a, b) => a.n - b.n);
}

/** 청크 단위로 풀며 상한/취소/기한을 확인한다. 실패는 Error(message)로 던진다. */
export class InflateStop extends Error {
  constructor(readonly reason: 'cancelled' | 'timeout' | 'corrupt', message: string) { super(message); }
}

const EMPTY = new Uint8Array(0);
/** 한 번에 넣는 압축 입력 크기. deflate 최대 압축비(약 1032:1)로도 push 1회 출력이 약 64MB를 넘지 않는다. */
const IN_CHUNK = 64 * 1024;

/**
 * raw deflate를 푼다. Chrome의 DecompressionStream은 압축 끝 뒤 여분 바이트를 오류("Junk found after end of
 * compressed data")로 처리하는데, HWP 섹션 스트림에는 이런 여분이 흔하므로 여분을 무시하는 fflate를 쓴다.
 */
export async function inflateRaw(
  bytes: Uint8Array,
  opts: { signal?: AbortSignal; deadlineAt?: number; maxBytes?: number } = {},
): Promise<Uint8Array> {
  const max = opts.maxBytes ?? MAX_INFLATE_BYTES;
  const chunks: Uint8Array[] = [];
  let total = 0;
  const inflater = new Inflate((chunk) => {
    total += chunk.length;
    if (total > max) throw new InflateStop('corrupt', '압축 해제 상한 초과');
    chunks.push(chunk);
  });
  for (let i = 0; ; i += IN_CHUNK) {
    if (opts.signal?.aborted) throw new InflateStop('cancelled', '취소됨');
    if (opts.deadlineAt !== undefined && Date.now() > opts.deadlineAt) throw new InflateStop('timeout', '시간 초과');
    const last = i + IN_CHUNK >= bytes.length;
    try {
      inflater.push(bytes.subarray(i, i + IN_CHUNK), last);
    } catch (e) {
      if (e instanceof InflateStop) throw e;
      throw new InflateStop('corrupt', e instanceof Error ? e.message : '압축 해제 실패');
    }
    if (last) break;
    await yieldToLoop();
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (let i = 0; i < chunks.length; i++) {
    out.set(chunks[i]!, o);
    o += chunks[i]!.length;
    chunks[i] = EMPTY; // 합친 조각은 즉시 해제
  }
  chunks.length = 0;
  return out;
}
