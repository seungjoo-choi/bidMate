import { inflateSync } from 'fflate';
import { MAX_INFLATE_BYTES } from '../../core/doc/limits';

export interface ZipEntryInfo { path: string; size: number; isDir: boolean }

export const ZIP_MAX_ENTRIES = 200;
export const ZIP_MAX_TOTAL_BYTES = MAX_INFLATE_BYTES;

interface CentralEntry extends ZipEntryInfo { method: number; compSize: number; offset: number }

const u16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u32 = (b: Uint8Array, o: number) => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;

/** UTF-8 플래그가 없으면 UTF-8 시도 후 실패 시 CP949(euc-kr)로 복원한다. */
function decodeName(raw: Uint8Array, utf8Flag: boolean): string {
  if (utf8Flag) return new TextDecoder('utf-8').decode(raw);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch {
    return new TextDecoder('euc-kr').decode(raw);
  }
}

function readCentral(bytes: Uint8Array): CentralEntry[] {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip: EOCD를 찾을 수 없습니다');
  const count = u16(bytes, eocd + 10);
  if (count > ZIP_MAX_ENTRIES) throw new Error(`zip: 엔트리가 너무 많습니다(${count} > ${ZIP_MAX_ENTRIES})`);
  let p = u32(bytes, eocd + 16);
  const out: CentralEntry[] = [];
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (u32(bytes, p) !== 0x02014b50) throw new Error('zip: 중앙 디렉터리가 손상되었습니다');
    const flags = u16(bytes, p + 8);
    const method = u16(bytes, p + 10);
    const compSize = u32(bytes, p + 20);
    const size = u32(bytes, p + 24);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const offset = u32(bytes, p + 42);
    const path = decodeName(bytes.subarray(p + 46, p + 46 + nameLen), (flags & 0x800) !== 0);
    total += size;
    if (total > ZIP_MAX_TOTAL_BYTES) throw new Error('zip: 전개 총량이 200MB를 넘습니다');
    out.push({ path, size, isDir: path.endsWith('/'), method, compSize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** 중앙 디렉터리만 읽는다(inflate 없음). */
export function listZip(bytes: Uint8Array): ZipEntryInfo[] {
  return readCentral(bytes).map(({ path, size, isDir }) => ({ path, size, isDir }));
}

export interface ZipArchive { entries: ZipEntryInfo[]; read(path: string): Uint8Array }

/** 중앙 디렉터리를 한 번만 파싱하고 엔트리 목록과 read를 돌려준다. */
export function openZip(bytes: Uint8Array): ZipArchive {
  const central = readCentral(bytes);
  const byPath = new Map<string, CentralEntry>();
  for (const e of central) if (!byPath.has(e.path)) byPath.set(e.path, e);
  return {
    entries: central.map(({ path, size, isDir }) => ({ path, size, isDir })),
    read(path: string): Uint8Array {
      const e = byPath.get(path);
      if (!e) throw new Error(`zip: 엔트리가 없습니다: ${path}`);
      if (u32(bytes, e.offset) !== 0x04034b50) throw new Error('zip: 로컬 헤더가 손상되었습니다');
      const start = e.offset + 30 + u16(bytes, e.offset + 26) + u16(bytes, e.offset + 28);
      const data = bytes.subarray(start, start + e.compSize);
      if (e.method === 0) return data.slice();
      if (e.method === 8) return inflateSync(data, { out: new Uint8Array(e.size) });
      throw new Error(`zip: 지원하지 않는 압축 방식(${e.method})`);
    },
  };
}

export function readZipEntry(bytes: Uint8Array, path: string): Uint8Array {
  return openZip(bytes).read(path);
}
