export const TAG = { PARA_HEADER: 66, PARA_TEXT: 67, CTRL_HEADER: 71, LIST_HEADER: 72, TABLE: 77 } as const;

export interface Rec { tag: number; level: number; body: Uint8Array }

export function readRecords(buf: Uint8Array, warnings?: string[]): Rec[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out: Rec[] = [];
  let o = 0;
  while (o + 4 <= buf.length) {
    const h = dv.getUint32(o, true);
    o += 4;
    let size = h >>> 20;
    if (size === 0xfff) {
      if (o + 4 > buf.length) { warnings?.push('레코드가 잘려 중단됨'); break; }
      size = dv.getUint32(o, true);
      o += 4;
    }
    if (o + size > buf.length) { warnings?.push('레코드가 잘려 중단됨'); break; }
    out.push({ tag: h & 0x3ff, level: (h >> 10) & 0x3ff, body: buf.subarray(o, o + size) });
    o += size;
  }
  return out;
}

const SKIP16 = new Set([1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);

/** PARA_TEXT(UTF-16LE) → 문자열. 줄바꿈 코드는 공백으로 접는다(블록 텍스트는 한 줄 유지). */
export function decodeParaText(body: Uint8Array): string {
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  let s = '';
  for (let i = 0; i + 1 < body.length; i += 2) {
    const ch = dv.getUint16(i, true);
    if (ch >= 32) {
      s += String.fromCharCode(ch);
    } else if (SKIP16.has(ch)) {
      i += 14;
    } else if (ch === 9) {
      i += 14;
      s += '\t';
    } else if (ch === 30 || ch === 31) {
      s += ' ';
    } else if (ch === 10 || ch === 13) {
      s += ' ';
    }
  }
  return s.replace(/\u0000/g, '').trim();
}

export const ctrlId = (body: Uint8Array): string => String.fromCharCode(...body.subarray(0, 4));
export const u16 = (body: Uint8Array, off: number): number =>
  off + 2 <= body.length ? body[off]! | (body[off + 1]! << 8) : 0;
