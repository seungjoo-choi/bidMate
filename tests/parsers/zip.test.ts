import { describe, expect, it } from 'vitest';
import { unzipSync, zipSync } from 'fflate';
import { listZip, readZipEntry } from '../../src/engine/parsers/zip';


/** 한글을 CP949 바이트로 변환한다(Node의 TextDecoder로 역조회 테이블 생성). */
function encodeCp949(s: string): number[] {
  const dec = new TextDecoder('euc-kr');
  const map = new Map<string, number[]>();
  for (let hi = 0xb0; hi <= 0xc8; hi++) {
    for (let lo = 0xa1; lo <= 0xfe; lo++) map.set(dec.decode(new Uint8Array([hi, lo])), [hi, lo]);
  }
  const out: number[] = [];
  for (const ch of s) {
    if (ch.charCodeAt(0) < 128) out.push(ch.charCodeAt(0));
    else {
      const b = map.get(ch);
      if (!b) throw new Error(`CP949 변환 불가: ${ch}`);
      out.push(...b);
    }
  }
  return out;
}

/** 이름 바이트를 그대로 넣은 stored zip(UTF-8 플래그 없음). */
function rawZip(files: Array<{ name: number[]; data: Uint8Array }>, flags = 0): Uint8Array {
  const parts: number[] = [];
  const central: number[] = [];
  const le = (n: number, len: number) => Array.from({ length: len }, (_, i) => (n >>> (8 * i)) & 0xff);
  for (const f of files) {
    const off = parts.length;
    const hdr = [...le(0x04034b50, 4), ...le(20, 2), ...le(flags, 2), ...le(0, 2), ...le(0, 2), ...le(0, 2), ...le(0, 4),
      ...le(f.data.length, 4), ...le(f.data.length, 4), ...le(f.name.length, 2), ...le(0, 2), ...f.name];
    parts.push(...hdr, ...f.data);
    central.push(...le(0x02014b50, 4), ...le(20, 2), ...le(20, 2), ...le(flags, 2), ...le(0, 2), ...le(0, 2), ...le(0, 2), ...le(0, 4),
      ...le(f.data.length, 4), ...le(f.data.length, 4), ...le(f.name.length, 2), ...le(0, 2), ...le(0, 2), ...le(0, 2), ...le(0, 2),
      ...le(0, 4), ...le(off, 4), ...f.name);
  }
  const cdOff = parts.length;
  const eocd = [...le(0x06054b50, 4), ...le(0, 2), ...le(0, 2), ...le(files.length, 2), ...le(files.length, 2),
    ...le(central.length, 4), ...le(cdOff, 4), ...le(0, 2)];
  return Uint8Array.from([...parts, ...central, ...eocd]);
}

const NAME = '붙임 4. 사업 참고 자료/1. RD 서명본.pdf';

describe('zip', () => {
  it('CP949 파일명(UTF-8 플래그 없음)을 복원하고 내용을 읽는다', () => {
    const data = new TextEncoder().encode('hello');
    const zip = rawZip([{ name: encodeCp949(NAME), data }]);
    const list = listZip(zip);
    expect(list.map((e) => e.path)).toEqual([NAME]);
    expect(list[0]!).toMatchObject({ size: 5, isDir: false });
    expect(new TextDecoder().decode(readZipEntry(zip, NAME))).toBe('hello');
  });
  it('fflate가 CP949 이름을 latin1로 돌려주는지 확인한다(정보용)', () => {
    const zip = rawZip([{ name: encodeCp949(NAME), data: new Uint8Array([1]) }]);
    const keys = Object.keys(unzipSync(zip));
    // 명세 가정: 문자코드가 모두 256 미만
    expect(keys[0]!.split('').every((c) => c.charCodeAt(0) < 256)).toBe(true);
    const back = new TextDecoder('euc-kr').decode(Uint8Array.from(keys[0]!.split('').map((c) => c.charCodeAt(0))));
    expect(back).toBe(NAME);
  });
  it('UTF-8 이름(fflate zipSync)과 deflate 내용도 동작한다', () => {
    const body = new TextEncoder().encode('가나다'.repeat(100));
    const zip = zipSync({ [NAME]: body, 'a.txt': new TextEncoder().encode('x') });
    expect(listZip(zip).map((e) => e.path).sort()).toEqual([NAME, 'a.txt'].sort());
    expect(readZipEntry(zip, NAME)).toEqual(body);
  });
  it('엔트리 200개 초과는 오류', () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < 201; i++) files[`f${i}.txt`] = new Uint8Array([1]);
    expect(() => listZip(zipSync(files))).toThrow();
  });
});
