import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../helpers/memory-store';

describe('MemoryStore.readBlob', () => {
  it('바이트와 크기가 같은 Blob을 반환한다', async () => {
    const s = new MemoryStore();
    s.files.set('a/b.bin', new Uint8Array([1, 2, 3]));
    const b = await s.readBlob('a/b.bin');
    expect(b.size).toBe(3);
    expect(new Uint8Array(await b.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });
  it('텍스트 파일도 읽는다', async () => {
    const s = new MemoryStore();
    await s.writeText('t.txt', 'abc');
    expect(await (await s.readBlob('t.txt')).text()).toBe('abc');
  });
  it('없는 파일은 NotFoundError', async () => {
    await expect(new MemoryStore().readBlob('x')).rejects.toMatchObject({ name: 'NotFoundError' });
  });
});
